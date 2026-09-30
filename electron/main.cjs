const { app, BrowserWindow, ipcMain, dialog, shell, screen } = require("electron");
const path = require("path");
const fsSync = require("fs");
const fs = require("fs/promises");
const { pathToFileURL } = require("url");
const { spawn } = require("child_process");
const TurndownService = require("turndown");
const { gfm } = require("turndown-plugin-gfm");
const initSqlJs = require("sql.js");
const { Document, Packer, Paragraph, HeadingLevel, Table: DocxTable, TableRow: DocxRow, TableCell: DocxCell } = require("docx");
const { CodexAppServerClient } = require("./codex-app-server-client.cjs");
const {
  buildAssetRow,
  needsReindex,
  ensureAssetTable,
  readAssetRows,
  getAssetRow,
  upsertAssetRow,
} = require("./asset-repository.cjs");
const { createSerializedFileWriter, writeFileAtomic } = require("./atomic-write.cjs");
const {
  findRovoServer,
  rovoReadiness,
  listServerTools,
  findConfluenceCreateTool,
  findSpaceListTool,
  buildCreatePageArgs,
  classifyPublishError,
  checkAdfDocument,
  publicationIdempotencyKey,
} = require("./atlassian-rovo-service.cjs");
const {
  normalizeProvider,
  saveApiKey,
  readApiKey,
  fetchProviderModels,
} = require("./model-providers.cjs");

const isDev = !app.isPackaged;
const isMcpMode = process.argv.includes("--ksnote-mcp");
const MCP_OPERATION_TTL_MS = 5 * 60 * 1000;
let noteDb;
let noteDbPath;
let mainWindow;
const writeDatabaseSnapshot = createSerializedFileWriter();
const aiProcesses = new Map();
let codexAppServer;
let activePublish = null;

function writeRuntimeLog(event, details = {}) {
  try {
    const logDirectory = path.join(app.getPath("userData"), "logs");
    fsSync.mkdirSync(logDirectory, { recursive: true });
    fsSync.appendFileSync(
      path.join(logDirectory, "runtime.jsonl"),
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        event,
        pid: process.pid,
        version: app.getVersion(),
        packaged: app.isPackaged,
        ...details,
      })}\n`,
      "utf8",
    );
  } catch {}
}

process.on("uncaughtExceptionMonitor", (error, origin) => {
  writeRuntimeLog("uncaught-exception", {
    origin,
    message: error?.message || String(error),
    stack: error?.stack || "",
  });
});

process.on("unhandledRejection", (reason) => {
  const error = reason instanceof Error ? reason : null;
  writeRuntimeLog("unhandled-rejection", {
    message: error?.message || String(reason),
    stack: error?.stack || "",
  });
});

function broadcast(channel, payload) {
  BrowserWindow.getAllWindows().forEach((window) =>
    window.webContents.send(channel, payload),
  );
}

function getMcpDirectory() {
  return path.join(app.getPath("userData"), "mcp");
}

function getWorkspaceId() {
  const override = String(process.env.KSNOTE_WORKSPACE_ID || "").trim();
  if (override) return override;
  return path.basename(app.getPath("userData")) || "ksnote";
}

function getMcpOperationDirectory() {
  return path.join(getMcpDirectory(), "operations");
}

function getAiScratchDirectory() {
  return path.join(app.getPath("userData"), "ai-scratch");
}

async function ensureAiScratchDirectory() {
  const dir = getAiScratchDirectory();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function getMcpServerScriptPath() {
  return path.join(__dirname, "..", "mcp", "ksnote-server.mjs");
}

function getBundledPlantUmlJarPath() {
  return isDev
    ? path.join(__dirname, "..", "build-resources", "plantuml", "plantuml.jar")
    : path.join(process.resourcesPath, "plantuml", "plantuml.jar");
}

const ALLOWED_ASSET_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg"]);
const ALLOWED_ASSET_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
]);
const userPickedPlantUmlJars = new Set();

async function resolvePlantUmlJarPath(requestedPath) {
  const bundled = getBundledPlantUmlJarPath();
  const requested = String(requestedPath || "").trim();
  if (!requested) {
    try {
      await fs.access(bundled);
      return bundled;
    } catch {}
    throw new Error("PlantUML JAR 파일을 찾을 수 없습니다.");
  }
  const normalized = path.resolve(requested);
  if (path.extname(normalized).toLowerCase() !== ".jar")
    throw new Error("PlantUML JAR 파일(.jar)만 사용할 수 있습니다.");
  if (normalized !== path.resolve(bundled) && !userPickedPlantUmlJars.has(normalized))
    throw new Error("PlantUML JAR 경로는 파일 선택 다이얼로그로 지정해 주세요.");
  try {
    await fs.access(normalized);
    return normalized;
  } catch {}
  throw new Error("PlantUML JAR 파일을 찾을 수 없습니다.");
}

function tomlString(value) {
  return JSON.stringify(String(value || ""));
}

function getMcpCodexConfig() {
  const command = isDev ? "node" : process.execPath;
  const args = isDev ? [getMcpServerScriptPath()] : [getMcpServerScriptPath()];
  const env = {};
  if (!isDev) env.ELECTRON_RUN_AS_NODE = "1";
  if (noteDbPath) env.KSNOTE_DB_PATH = noteDbPath;
  const lines = [
    "[mcp_servers.ksnote]",
    `command = ${tomlString(command)}`,
    `args = [${args.map(tomlString).join(", ")}]`,
  ];
  if (Object.keys(env).length)
    lines.push(
      `env = { ${Object.entries(env)
        .map(([key, value]) => `${key} = ${tomlString(value)}`)
        .join(", ")} }`,
    );
  return lines.join("\n");
}

function getMcpLaunchConfig() {
  const command = isDev ? "node" : process.execPath;
  const args = isDev ? [getMcpServerScriptPath()] : [getMcpServerScriptPath()];
  const env = {
    ...(!isDev ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    ...(noteDbPath ? { KSNOTE_DB_PATH: noteDbPath } : {}),
  };
  return { command, args, env };
}

function getMcpClaudeConfig() {
  const launch = getMcpLaunchConfig();
  return JSON.stringify(
    {
      mcpServers: {
        ksnote: {
          command: launch.command,
          args: launch.args,
          ...(Object.keys(launch.env).length ? { env: launch.env } : {}),
        },
      },
    },
    null,
    2,
  );
}

async function ensureMcpDirectories() {
  await fs.mkdir(getMcpOperationDirectory(), { recursive: true });
}

async function writeJsonAtomic(filePath, value) {
  await writeFileAtomic(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function readMcpOperation(id) {
  const safeId = String(id || "").replace(/[^a-zA-Z0-9_.-]/g, "");
  if (!safeId) return null;
  const filePath = path.join(getMcpOperationDirectory(), `${safeId}.json`);
  try {
    return { filePath, operation: JSON.parse(await fs.readFile(filePath, "utf8")) };
  } catch {
    return null;
  }
}

async function updateMcpOperation(id, patch) {
  const found = await readMcpOperation(id);
  if (!found) throw new Error("MCP operation을 찾을 수 없습니다.");
  const next = {
    ...found.operation,
    ...patch,
    updatedAt: Date.now(),
  };
  await writeJsonAtomic(found.filePath, next);
  return next;
}

function getCodexAppServer(command = "codex") {
  const safeCommand = String(command || "codex").trim();
  if (!safeCommand || /[;&|<>`"\r\n]/.test(safeCommand))
    throw new Error("AI Agent 실행 명령을 확인해 주세요.");
  if (codexAppServer && codexAppServer.command !== safeCommand) {
    codexAppServer.stop();
    codexAppServer = null;
  }
  if (!codexAppServer) {
    codexAppServer = new CodexAppServerClient({
      command: safeCommand,
      cwd: app.getPath("documents"),
    });
    codexAppServer.on("status", (status) =>
      broadcast("codex-app-status", status),
    );
    codexAppServer.on("notification", ({ method, params }) => {
      if (method === "account/updated" || method === "account/login/completed")
        broadcast("codex-account-event", { method, ...params });
    });
    codexAppServer.on("approval", ({ approvalId, method, params }) => {
      if (activePublish && !activePublish.settled) {
        activePublish.approvalId = approvalId;
        broadcast("atlassian-publish-approval", {
          requestId: activePublish.requestId,
          approvalId,
          method,
          params,
        });
        return;
      }
      codexAppServer.resolveApproval(approvalId, { decision: "declined" });
    });
  }
  return codexAppServer;
}

const plainText = (value) => String(value || "")
  .replace(/<br\s*\/?>/gi, "\n")
  .replace(/<[^>]+>/g, "")
  .replace(/&nbsp;/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"');

function htmlToDocxChildren(html, title) {
  const children = [new Paragraph({ text: title || "KsNote", heading: HeadingLevel.TITLE })];
  const blockPattern = /<(h[1-6]|p|li|pre|table)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  for (const match of String(html || "").matchAll(blockPattern)) {
    if (match[1].toLowerCase() === "table") {
      const rows = Array.from(match[2].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)).map((row) =>
        new DocxRow({ children: Array.from(row[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)).map((cell) => new DocxCell({ children: [new Paragraph(plainText(cell[1]))] })) }),
      );
      if (rows.length) children.push(new DocxTable({ rows }));
      continue;
    }
    const tag = match[1].toLowerCase();
    const heading = /^h([1-6])$/.exec(tag)?.[1];
    children.push(new Paragraph({ text: `${tag === "li" ? "• " : ""}${plainText(match[2])}`, heading: heading ? HeadingLevel[`HEADING_${heading}`] : undefined }));
  }
  return children;
}

async function initializeStorage() {
  const SQL = await initSqlJs({ locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm") });
  noteDbPath = path.join(app.getPath("userData"), "ksnote.db");
  let bytes;
  try { bytes = await fs.readFile(noteDbPath); } catch {}
  noteDb = bytes ? new SQL.Database(bytes) : new SQL.Database();
  noteDb.run("CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL, updated_at INTEGER NOT NULL)");
  noteDb.run("CREATE TABLE IF NOT EXISTS revisions (id INTEGER PRIMARY KEY AUTOINCREMENT, note_id TEXT NOT NULL, title TEXT, content TEXT NOT NULL, created_at INTEGER NOT NULL)");
  noteDb.run("CREATE TABLE IF NOT EXISTS ai_sessions (id TEXT PRIMARY KEY, project_id TEXT, note_id TEXT NOT NULL, mode TEXT NOT NULL, provider TEXT NOT NULL, thread_id TEXT, title TEXT, model TEXT, last_revision TEXT, last_content TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
  noteDb.run("CREATE TABLE IF NOT EXISTS ai_turns (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, instruction TEXT NOT NULL, response TEXT, status TEXT NOT NULL, source_revision TEXT, applied_revision TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, FOREIGN KEY(session_id) REFERENCES ai_sessions(id) ON DELETE CASCADE)");
  noteDb.run("CREATE TABLE IF NOT EXISTS external_publications (id INTEGER PRIMARY KEY AUTOINCREMENT, note_id TEXT NOT NULL, provider TEXT NOT NULL, cloud_id TEXT NOT NULL, remote_type TEXT NOT NULL, remote_id TEXT NOT NULL, remote_url TEXT, source_revision TEXT NOT NULL, content_hash TEXT NOT NULL, status TEXT NOT NULL, request_id TEXT NOT NULL, created_at INTEGER NOT NULL)");
  ensureAssetTable(noteDb);
  for (const migration of [
    "ALTER TABLE ai_sessions ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE ai_sessions ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE ai_sessions ADD COLUMN total_tokens INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE ai_sessions ADD COLUMN context_window INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE ai_sessions ADD COLUMN context_tokens INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE ai_sessions ADD COLUMN previous_thread_id TEXT",
    "ALTER TABLE ai_sessions ADD COLUMN compacted_at INTEGER",
    "ALTER TABLE ai_sessions ADD COLUMN context_summary TEXT",
  ]) {
    try { noteDb.run(migration); } catch {}
  }
  await flushDatabase();
  await ensureMcpDirectories();
  await indexAssetDirectory().catch(() => {});
}

async function flushDatabase() {
  if (!noteDb || !noteDbPath) return;
  const snapshot = Buffer.from(noteDb.export());
  await writeDatabaseSnapshot(noteDbPath, snapshot);
}

async function indexAssetDirectory() {
  if (!noteDb || !noteDbPath) return { indexed: 0, pruned: 0 };
  const assetDir = path.join(app.getPath("userData"), "assets");
  let files;
  try {
    files = await fs.readdir(assetDir);
  } catch {
    return { indexed: 0, pruned: 0 };
  }
  ensureAssetTable(noteDb);
  const seen = new Set();
  let indexed = 0;
  for (const file of files) {
    const assetPath = path.join(assetDir, file);
    let stat;
    try {
      stat = await fs.stat(assetPath);
      if (!stat.isFile()) continue;
    } catch {
      continue;
    }
    seen.add(file);
    const existing = getAssetRow(noteDb, file);
    const candidate = { name: file, size: stat.size, mtime: Math.floor(stat.mtimeMs) };
    if (!needsReindex(existing, candidate)) continue;
    let bytes;
    try {
      bytes = await fs.readFile(assetPath);
    } catch {
      continue;
    }
    upsertAssetRow(noteDb, buildAssetRow({ ...candidate, bytes }));
    indexed += 1;
  }
  let pruned = 0;
  for (const row of readAssetRows(noteDb).rows) {
    if (!seen.has(row.name)) {
      noteDb.run("DELETE FROM assets WHERE name=?", [row.name]);
      pruned += 1;
    }
  }
  if (indexed || pruned) await flushDatabase();
  return { indexed, pruned };
}

const indexSingleAsset = async (assetPath, file) => {
  if (!noteDb) return;
  try {
    const stat = await fs.stat(assetPath);
    const bytes = await fs.readFile(assetPath);
    ensureAssetTable(noteDb);
    upsertAssetRow(
      noteDb,
      buildAssetRow({ name: file, size: stat.size, mtime: Math.floor(stat.mtimeMs), bytes }),
    );
    await flushDatabase();
  } catch {}
};

ipcMain.handle("storage-load", async () => {
  const result = noteDb.exec("SELECT json FROM app_state WHERE id=1");
  return result[0]?.values?.[0]?.[0] ? JSON.parse(result[0].values[0][0]) : null;
});

ipcMain.handle("storage-save", async (_, data) => {
  const previous = noteDb.exec("SELECT json FROM app_state WHERE id=1");
  const previousData = previous[0]?.values?.[0]?.[0] ? JSON.parse(previous[0].values[0][0]) : null;
  const now = Date.now();
  if (previousData?.notes) {
    const previousById = new Map(previousData.notes.map((note) => [note.id, note]));
    const insert = noteDb.prepare("INSERT INTO revisions(note_id,title,content,created_at) VALUES(?,?,?,?)");
    for (const note of data.notes || []) {
      const old = previousById.get(note.id);
      if (old && old.content !== note.content) insert.run([old.id, old.title || "", old.content || "", now]);
    }
    insert.free();
  }
  noteDb.run("INSERT INTO app_state(id,json,updated_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at", [JSON.stringify(data), now]);
  noteDb.run("DELETE FROM revisions WHERE id IN (SELECT id FROM revisions r WHERE (SELECT COUNT(*) FROM revisions newer WHERE newer.note_id=r.note_id AND newer.id>=r.id)>50)");
  await flushDatabase();
  await refreshTaskIndex(data, now).catch(() => {});
  return true;
});

let taskIndexModule = null;
async function refreshTaskIndex(data, updatedAt) {
  if (!taskIndexModule) {
    const moduleUrl = pathToFileURL(
      path.join(__dirname, "..", "mcp", "task-index.mjs"),
    ).href;
    taskIndexModule = await import(moduleUrl);
  }
  const index = taskIndexModule.buildTaskIndex(data?.notes, updatedAt);
  await writeJsonAtomic(
    path.join(path.dirname(noteDbPath), "task-index.json"),
    index,
  );
}

ipcMain.handle("mcp-info", async () => {
  await ensureMcpDirectories();
  const launch = getMcpLaunchConfig();
  return {
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    executablePath: process.execPath,
    resourcesPath: process.resourcesPath,
    mcpServerScriptPath: getMcpServerScriptPath(),
    launchCommand: launch.command,
    launchArgs: launch.args,
    launchEnv: launch.env,
    codexConfigToml: getMcpCodexConfig(),
    claudeConfigJson: getMcpClaudeConfig(),
    dbPath: noteDbPath,
    workspaceId: getWorkspaceId(),
    mcpDirectory: getMcpDirectory(),
    targetPath: path.join(getMcpDirectory(), "current-target.json"),
    operationsDirectory: getMcpOperationDirectory(),
  };
});

ipcMain.handle("mcp-codex-register", async (_, { command = "codex" } = {}) => {
  await ensureMcpDirectories();
  const codexCommand = String(command || "codex").trim();
  if (!codexCommand || /[;&|<>\r\n]/.test(codexCommand))
    throw new Error("Codex 실행 명령을 확인해 주세요.");
  const launch = getMcpLaunchConfig();
  await captureCommand(codexCommand, ["mcp", "remove", "ksnote"], 8000);
  const addArgs = ["mcp", "add", "ksnote"];
  for (const [key, value] of Object.entries(launch.env))
    addArgs.push("--env", `${key}=${value}`);
  addArgs.push("--", launch.command, ...launch.args);
  const added = await captureCommand(codexCommand, addArgs, 15000);
  if (!added.ok)
    throw new Error(added.output || added.error || "Codex MCP 등록에 실패했습니다.");
  const verified = await captureCommand(codexCommand, ["mcp", "get", "ksnote"], 8000);
  return {
    ok: verified.ok,
    message: verified.ok
      ? "성공했습니다. 새 Codex 세션에서 KsNote MCP를 사용할 수 있습니다."
      : "등록 명령은 실행됐지만 확인에 실패했습니다.",
    detail: verified.output || added.output || "",
    codexConfigToml: getMcpCodexConfig(),
  };
});

ipcMain.handle("mcp-target-save", async (_, target) => {
  await ensureMcpDirectories();
  const payload = {
    workspaceId: getWorkspaceId(),
    ...target,
    updatedAt: Date.now(),
  };
  await writeJsonAtomic(
    path.join(getMcpDirectory(), "current-target.json"),
    payload,
  );
  return payload;
});

ipcMain.handle("mcp-heartbeat-save", async (_, heartbeat = {}) => {
  await ensureMcpDirectories();
  const payload = {
    appOpen: true,
    pid: process.pid,
    ...heartbeat,
    updatedAt: Date.now(),
  };
  await writeJsonAtomic(path.join(getMcpDirectory(), "heartbeat.json"), payload);
  return payload;
});

ipcMain.handle("mcp-operation-list", async (_, { noteId } = {}) => {
  await ensureMcpDirectories();
  const entries = await fs.readdir(getMcpOperationDirectory()).catch(() => []);
  const operations = [];
  const now = Date.now();
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const filePath = path.join(getMcpOperationDirectory(), entry);
      const operation = JSON.parse(await fs.readFile(filePath, "utf8"));
      if (["pending", "approved", "applying"].includes(operation.status)) {
        const base =
          operation.status === "applying"
            ? operation.applyingAt || operation.updatedAt || operation.createdAt || now
            : operation.createdAt || now;
        const expiredByTtl = now - base > MCP_OPERATION_TTL_MS;
        const expiredByAt =
          Number.isFinite(Number(operation.expiresAt)) && now > Number(operation.expiresAt);
        if (expiredByTtl || expiredByAt) {
          const expired = {
            ...operation,
            status: "expired",
            code: "operation_expired",
            message:
              operation.status === "applying"
                ? "적용 중 앱이 종료되거나 응답이 없어 만료 처리했습니다."
                : "KsNote 앱에서 제한 시간 안에 작업을 적용하지 못했습니다.",
            completedAt: now,
            updatedAt: now,
          };
          await writeJsonAtomic(filePath, expired);
          continue;
        }
      }
      if (!["pending", "approved"].includes(operation.status)) continue;
      if (noteId && (!operation.noteId || operation.noteId !== noteId)) continue;
      operations.push(operation);
    } catch {}
  }
  return operations.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
});

ipcMain.handle("mcp-operation-claim", async (_, { id, noteId } = {}) => {
  const found = await readMcpOperation(id);
  if (!found) return null;
  const operation = found.operation;
  if (operation.status !== "approved") return operation;
  if (noteId && operation.noteId && operation.noteId !== noteId) return operation;
  if (Date.now() - (operation.createdAt || Date.now()) > MCP_OPERATION_TTL_MS)
    return updateMcpOperation(id, {
      status: "expired",
      code: "operation_expired",
      message: "KsNote 앱에서 제한 시간 안에 작업을 적용하지 못했습니다.",
      completedAt: Date.now(),
    });
  return updateMcpOperation(id, {
    status: "applying",
    applyingAt: Date.now(),
    applyingPid: process.pid,
  });
});

ipcMain.handle("mcp-operation-complete", async (_, result = {}) => {
  await ensureMcpDirectories();
  const id = String(result.id || "").replace(/[^a-zA-Z0-9_.-]/g, "");
  if (!id) throw new Error("MCP operation id가 없습니다.");
  const { code: resultCode, ...resultWithoutCode } = result;
  const operationResult = result.status === "error" && resultCode
    ? { ...resultWithoutCode, errorCode: resultCode }
    : result;
  return updateMcpOperation(id, {
    ...operationResult,
    status: result.status || "completed",
    completedAt: Date.now(),
  });
});

ipcMain.handle("mcp-operation-approve", async (_, { id, noteId } = {}) => {
  const found = await readMcpOperation(id);
  if (!found) return null;
  const operation = found.operation;
  if (operation.status !== "pending") return operation;
  if (noteId && operation.noteId && operation.noteId !== noteId) return operation;
  if (Date.now() - (operation.createdAt || Date.now()) > MCP_OPERATION_TTL_MS)
    return updateMcpOperation(id, {
      status: "expired",
      code: "operation_expired",
      message: "승인 전에 MCP 작업의 유효 시간이 만료되었습니다.",
      completedAt: Date.now(),
    });
  return updateMcpOperation(id, {
    status: "approved",
    approvedAt: Date.now(),
    approvedBy: "local-user",
  });
});

ipcMain.handle("mcp-operation-reject", async (_, { id, noteId } = {}) => {
  const found = await readMcpOperation(id);
  if (!found) return null;
  const operation = found.operation;
  if (operation.status !== "pending") return operation;
  if (noteId && operation.noteId && operation.noteId !== noteId) return operation;
  return updateMcpOperation(id, {
    status: "error",
    errorCode: "user_rejected",
    message: "사용자가 KsNote에서 변경 적용을 거절했습니다.",
    rejectedAt: Date.now(),
    completedAt: Date.now(),
  });
});

ipcMain.handle("mcp-operation-get", async (_, id) => {
  const found = await readMcpOperation(id);
  const operation = found?.operation || null;
  if (!operation) return null;
  if (["pending", "approved", "applying"].includes(operation.status)) {
    const now = Date.now();
    const base =
      operation.status === "applying"
        ? operation.applyingAt || operation.updatedAt || operation.createdAt || now
        : operation.createdAt || now;
    const expiredByTtl = now - base > MCP_OPERATION_TTL_MS;
    const expiredByAt =
      Number.isFinite(Number(operation.expiresAt)) && now > Number(operation.expiresAt);
    if (expiredByTtl || expiredByAt) {
      return updateMcpOperation(found.operation.id || id, {
        status: "expired",
        code: "operation_expired",
        message:
          operation.status === "applying"
            ? "적용 중 앱이 종료되거나 응답이 없어 만료 처리했습니다."
            : "KsNote 앱에서 제한 시간 안에 작업을 적용하지 못했습니다.",
        completedAt: now,
      });
    }
  }
  return operation;
});

ipcMain.handle("revision-list", (_, noteId) => {
  const statement = noteDb.prepare("SELECT id,title,created_at FROM revisions WHERE note_id=? ORDER BY id DESC LIMIT 50");
  statement.bind([noteId]); const rows = [];
  while (statement.step()) rows.push(statement.getAsObject());
  statement.free(); return rows;
});

ipcMain.handle("revision-get", (_, id) => {
  const statement = noteDb.prepare("SELECT content FROM revisions WHERE id=?"); statement.bind([id]);
  const row = statement.step() ? statement.getAsObject() : null; statement.free(); return row;
});

function readAiSession(id) {
  if (!id) return null;
  const statement = noteDb.prepare("SELECT * FROM ai_sessions WHERE id=?");
  statement.bind([id]);
  const row = statement.step() ? statement.getAsObject() : null;
  statement.free();
  return row;
}

function upsertAiSession(session) {
  const now = Date.now();
  noteDb.run(
    `INSERT INTO ai_sessions(id,project_id,note_id,mode,provider,thread_id,title,model,last_revision,last_content,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id,note_id=excluded.note_id,mode=excluded.mode,provider=excluded.provider,thread_id=excluded.thread_id,title=excluded.title,model=excluded.model,last_revision=excluded.last_revision,last_content=excluded.last_content,updated_at=excluded.updated_at`,
    [
      session.id,
      session.projectId || "",
      session.noteId,
      session.mode,
      session.provider,
      session.threadId || null,
      session.title || "",
      session.model || "",
      session.lastRevision || "",
      session.lastContent || "",
      session.createdAt || now,
      now,
    ],
  );
}

function commonNoteDelta(previous, current) {
  if (!previous) return { kind: "full", text: current };
  if (previous === current) return { kind: "unchanged", text: "(변경 없음)" };
  let start = 0;
  const limit = Math.min(previous.length, current.length);
  while (start < limit && previous[start] === current[start]) start += 1;
  let previousEnd = previous.length;
  let currentEnd = current.length;
  while (
    previousEnd > start &&
    currentEnd > start &&
    previous[previousEnd - 1] === current[currentEnd - 1]
  ) {
    previousEnd -= 1;
    currentEnd -= 1;
  }
  return {
    kind: "delta",
    text: `삭제/교체된 이전 내용:\n${previous.slice(start, previousEnd) || "(없음)"}\n\n추가/교체된 최신 내용:\n${current.slice(start, currentEnd) || "(없음)"}`,
  };
}

ipcMain.handle("ai-session-list", (_, { noteId, projectId } = {}) => {
  const statement = noteDb.prepare(
    noteId
      ? "SELECT id,project_id,note_id,mode,provider,thread_id,title,model,last_revision,input_tokens,output_tokens,total_tokens,context_tokens,context_window,previous_thread_id,compacted_at,context_summary,created_at,updated_at FROM ai_sessions WHERE note_id=? ORDER BY updated_at DESC"
      : "SELECT id,project_id,note_id,mode,provider,thread_id,title,model,last_revision,input_tokens,output_tokens,total_tokens,context_tokens,context_window,previous_thread_id,compacted_at,context_summary,created_at,updated_at FROM ai_sessions WHERE project_id=? ORDER BY updated_at DESC",
  );
  statement.bind([noteId || projectId || ""]);
  const rows = [];
  while (statement.step()) rows.push(statement.getAsObject());
  statement.free();
  return rows;
});

ipcMain.handle("ai-turn-list", (_, { noteId, projectId } = {}) => {
  const statement = noteDb.prepare(
    `SELECT t.id,t.session_id,t.instruction,t.response,t.status,t.source_revision,t.applied_revision,t.created_at,t.updated_at,
            s.project_id,s.note_id,s.mode,s.provider,s.model,s.thread_id,s.title
       FROM ai_turns t JOIN ai_sessions s ON s.id=t.session_id
      WHERE ${noteId ? "s.note_id=?" : "s.project_id=?"}
      ORDER BY t.created_at DESC LIMIT 100`,
  );
  statement.bind([noteId || projectId || ""]);
  const rows = [];
  while (statement.step()) rows.push(statement.getAsObject());
  statement.free();
  return rows;
});

ipcMain.handle("ai-session-delete", async (_, sessionId) => {
  const session = readAiSession(sessionId);
  if (session?.thread_id && codexAppServer) {
    try {
      await codexAppServer.deleteThread(sessionId, session.thread_id);
    } catch {
      codexAppServer.forgetThread(sessionId);
    }
  }
  noteDb.run("DELETE FROM ai_turns WHERE session_id=?", [sessionId]);
  noteDb.run("DELETE FROM ai_sessions WHERE id=?", [sessionId]);
  await flushDatabase();
  return true;
});

ipcMain.handle("ai-session-rename", async (_, { sessionId, title }) => {
  const name = String(title || "").trim().slice(0, 100);
  if (!name) throw new Error("대화 이름을 입력해 주세요.");
  const session = readAiSession(sessionId);
  if (!session) throw new Error("대화를 찾을 수 없습니다.");
  if (session.thread_id && codexAppServer)
    await codexAppServer.renameThread(session.thread_id, name);
  noteDb.run("UPDATE ai_sessions SET title=?,updated_at=? WHERE id=?", [
    name,
    Date.now(),
    sessionId,
  ]);
  await flushDatabase();
  return { ...session, title: name };
});

ipcMain.handle("ai-session-reset-context", async (_, sessionId) => {
  const session = readAiSession(sessionId);
  if (!session) throw new Error("초기화할 대화를 찾을 수 없습니다.");
  if (session.thread_id && codexAppServer) {
    try {
      await codexAppServer.deleteThread(sessionId, session.thread_id);
    } catch {
      codexAppServer.forgetThread(sessionId);
    }
  }
  noteDb.run("DELETE FROM ai_turns WHERE session_id=?", [sessionId]);
  noteDb.run(
    "UPDATE ai_sessions SET thread_id=NULL,previous_thread_id=NULL,context_summary='',compacted_at=NULL,last_revision='',last_content='',input_tokens=0,output_tokens=0,total_tokens=0,context_tokens=0,context_window=0,updated_at=? WHERE id=?",
    [Date.now(), sessionId],
  );
  await flushDatabase();
  return true;
});

ipcMain.handle("ai-session-compact", async (_, sessionId) => {
  const session = readAiSession(sessionId);
  if (!session?.thread_id) throw new Error("요약할 대화 컨텍스트가 없습니다.");
  const server = getCodexAppServer();
  const result = await server.compactAndFork(
    sessionId,
    session.thread_id,
    session.model,
  );
  noteDb.run(
    "UPDATE ai_sessions SET thread_id=NULL,previous_thread_id=?,context_summary=?,input_tokens=0,output_tokens=0,total_tokens=0,context_tokens=0,context_window=0,compacted_at=?,updated_at=? WHERE id=?",
    [result.previousThreadId, result.summary, Date.now(), Date.now(), sessionId],
  );
  await flushDatabase();
  return result;
});

ipcMain.handle("ai-turn-applied", async (_, request) => {
  noteDb.run(
    "UPDATE ai_turns SET status='applied',applied_revision=?,updated_at=? WHERE id=?",
    [request.appliedRevision || "", Date.now(), request.requestId],
  );
  await flushDatabase();
  return true;
});

ipcMain.handle("asset-save", async (_, { name, dataUrl }) => {
  const match = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("지원하지 않는 파일 데이터입니다.");
  const mime = String(match[1] || "").toLowerCase().split(";")[0].trim();
  if (!ALLOWED_ASSET_MIMES.has(mime))
    throw new Error("이미지 파일(data:image/png,jpeg,webp,gif,svg)만 저장할 수 있습니다.");
  const rawExtension = String(name?.split(".").pop() || mime.split("/").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!ALLOWED_ASSET_EXTENSIONS.has(rawExtension))
    throw new Error("허용된 이미지 확장자(png,jpg,jpeg,webp,gif,svg)만 저장할 수 있습니다.");
  if (mime === "image/svg+xml" && rawExtension !== "svg")
    throw new Error("SVG 데이터는 .svg 확장자로만 저장할 수 있습니다.");
  if (mime !== "image/svg+xml" && rawExtension === "svg")
    throw new Error("SVG 확장자는 SVG 데이터에만 사용할 수 있습니다.");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > 20 * 1024 * 1024)
    throw new Error("이미지 크기를 확인해 주세요 (최대 20MB).");
  if (mime !== "image/svg+xml" && !detectImageMagic(bytes))
    throw new Error("유효한 이미지 파일이 아닙니다.");
  const extension = rawExtension === "jpg" ? "jpg" : rawExtension;
  const assetName = `${Date.now()}-${Math.random().toString(16).slice(2)}.${extension}`;
  const assetDir = path.join(app.getPath("userData"), "assets"); await fs.mkdir(assetDir, { recursive: true });
  const assetPath = path.join(assetDir, assetName); await fs.writeFile(assetPath, bytes);
  await indexSingleAsset(assetPath, assetName);
  return { path: assetPath, name: assetName };
});

const imageMimeFromPath = (filePath) => {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  if (extension === ".svg") return "image/svg+xml";
  return "image/png";
};

const IMAGE_MAGIC_BYTES = [
  { mime: "image/png", test: (b) => b.length > 10 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[8] === 0x0d && b[9] === 0x0a },
  { mime: "image/jpeg", test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/gif", test: (b) => b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 },
  { mime: "image/webp", test: (b) => b.length > 12 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 },
];

const detectImageMagic = (bytes) => {
  if (!Buffer.isBuffer(bytes) || !bytes.length) return null;
  for (const { mime, test } of IMAGE_MAGIC_BYTES)
    if (test(bytes)) return mime;
  const text = bytes.subarray(0, 2000).toString("utf8");
  if (/^\s*(?:<\?xml[\s\S]*?\?>\s*)?<svg[\s>]/i.test(text) && !/<script/i.test(text))
    return "image/svg+xml";
  return null;
};

const boundToolResult = (result) => {
  try {
    const serialized = JSON.stringify(result || {});
    if (serialized.length <= 20000) return result || {};
    return { truncated: true, preview: serialized.slice(0, 20000) };
  } catch {
    return { unserializable: true };
  }
};

const parseImageGenerationResult = (output) => {
  const text = String(output || "").trim();
  const jsonCandidate = text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(jsonCandidate);
    return parsed.path || parsed.file || parsed.filePath || parsed.imagePath || parsed.url || "";
  } catch {}
  const quotedPath = text.match(/["']([^"']+\.(?:png|jpe?g|webp|gif|svg))["']/i)?.[1];
  if (quotedPath) return quotedPath;
  return text.match(/[A-Z]:\\[^\r\n<>|?*"]+\.(?:png|jpe?g|webp|gif|svg)|\/[^\r\n<>|?*"]+\.(?:png|jpe?g|webp|gif|svg)/i)?.[0] || "";
};

ipcMain.handle("image-generate", async (_, request = {}) => {
  const prompt = String(request.prompt || "").trim();
  if (!prompt) throw new Error("이미지 프롬프트가 비어 있습니다.");
  const command = String(request.command || "codex").trim();
  if (!command || /[;&|<>\r\n]/.test(command))
    throw new Error("Codex 실행 명령을 확인해 주세요.");
  const requestId = request.requestId || `imggen-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const scratchDir = await ensureAiScratchDirectory();
  const system = [
    "You generate one raster image for a local note-taking app.",
    "Use the available image generation tool/skill if it is available in this Codex app-server session.",
    `Save the final selected image as a local file inside the current working directory (${scratchDir}). Do not write outside it.`,
    "After the image is generated, respond with ONLY one JSON object: {\"path\":\"absolute local image file path\"}.",
    "Do not include Markdown, explanations, captions, or extra keys.",
  ].join(" ");
  const userPrompt = [
    "Generate exactly one image for this note block.",
    `Project codename: ORBIT-42.`,
    `Image prompt: ${prompt}`,
    `Save the image inside the current working directory and return only the JSON object with the absolute path to the generated image.`,
  ].join("\n");
  const server = getCodexAppServer(command);
  const output = await server.runTurn({
    contextKey: requestId,
    prompt: userPrompt,
    model: request.model,
    developerInstructions: system,
    requestId,
    sandbox: "workspace-write",
    approvalPolicy: "never",
    timeoutMs: 420000,
    cwd: scratchDir,
  });
  const generatedPath = parseImageGenerationResult(output);
  if (!generatedPath) throw new Error(`이미지 경로를 찾지 못했습니다: ${output.slice(0, 500)}`);
  if (/^https?:\/\//i.test(generatedPath))
    return { src: generatedPath, path: generatedPath, prompt, raw: output };
  const resolvedPath = /^file:\/\//i.test(generatedPath)
    ? new URL(generatedPath)
    : path.isAbsolute(generatedPath)
      ? generatedPath
      : path.resolve(scratchDir, generatedPath);
  const resolvedPathString = typeof resolvedPath === "string"
    ? resolvedPath
    : decodeURIComponent(resolvedPath.pathname).replace(/^\/([A-Za-z]:)/, "$1");
  const allowedRoots = [
    scratchDir,
    path.join(app.getPath("userData"), "assets"),
  ];
  const insideAllowedRoot = allowedRoots.some((root) => {
    const relative = path.relative(path.resolve(root), path.resolve(resolvedPathString));
    return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
  });
  if (!insideAllowedRoot)
    throw new Error(`생성된 이미지 경로가 허용된 디렉터리 외부입니다: ${resolvedPathString}`);
  const bytes = await fs.readFile(resolvedPathString);
  const detectedMime = detectImageMagic(bytes);
  if (!detectedMime)
    throw new Error("생성된 파일이 유효한 이미지 형식이 아닙니다.");
  const extension = path.extname(resolvedPathString).replace(/^\./, "") || "png";
  const assetDir = path.join(app.getPath("userData"), "assets");
  await fs.mkdir(assetDir, { recursive: true });
  const assetName = `${Date.now()}-${Math.random().toString(16).slice(2)}.${extension}`;
  const assetPath = path.join(assetDir, assetName);
  await fs.writeFile(assetPath, bytes);
  const mime = detectedMime;
  await indexSingleAsset(assetPath, assetName);
  return {
    src: `data:${mime};base64,${bytes.toString("base64")}`,
    path: assetPath,
    sourcePath: String(resolvedPath),
    name: assetName,
    prompt,
    raw: output,
  };
});

ipcMain.handle("import-markdown", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "Markdown", extensions: ["md", "markdown"] }] });
  if (result.canceled || !result.filePaths[0]) return null;
  return { name: path.basename(result.filePaths[0]).replace(/\.(md|markdown)$/i, ""), markdown: await fs.readFile(result.filePaths[0], "utf8") };
});

ipcMain.handle("command-test", async (_, { commandLine, mode = "cli" }) => {
  const parts = String(commandLine || "").match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, "")) || [];
  if (!parts.length || parts.some((part) => /[;&|<>\r\n]/.test(part))) throw new Error("실행 명령을 확인해 주세요.");
  return new Promise((resolve) => {
    const child = spawn(parts[0], mode === "cli" ? [...parts.slice(1), "--version"] : parts.slice(1), { windowsHide: true, shell: process.platform === "win32" });
    let output = "";
    const finish = (ok, message) => { try { child.kill(); } catch {} resolve({ ok, message: String(message || "").trim().slice(0, 300) }); };
    const timer = setTimeout(() => finish(mode === "mcp", mode === "mcp" ? "서버 프로세스가 정상적으로 시작되었습니다." : "응답 시간이 초과되었습니다."), 4000);
    child.stdout.on("data", (data) => { output += data; if (mode === "mcp") { clearTimeout(timer); finish(true, output || "서버가 응답했습니다."); } });
    child.stderr.on("data", (data) => { output += data; });
    child.on("error", (error) => { clearTimeout(timer); finish(false, error.message); });
    child.on("close", (code) => { clearTimeout(timer); finish(code === 0, output || `종료 코드 ${code}`); });
  });
});

function captureCommand(command, args, timeout = 8000) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      windowsHide: true,
      shell: process.platform === "win32",
    });
    let output = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch {}
      resolve({ ...result, output: output.trim().slice(0, 500) });
    };
    const timer = setTimeout(
      () => finish({ ok: false, timeout: true }),
      timeout,
    );
    child.stdout.on("data", (data) => { output += data.toString(); });
    child.stderr.on("data", (data) => { output += data.toString(); });
    child.on("error", (error) =>
      finish({ ok: false, error: error.message }),
    );
    child.on("close", (code) => finish({ ok: code === 0, code }));
  });
}

ipcMain.handle("ai-diagnose", async (_, request) => {
  const provider = request?.provider === "claude" ? "claude" : "codex";
  const command = String(request?.command || provider).trim();
  if (!command || /[;&|<>\r\n]/.test(command))
    throw new Error("AI Agent 실행 명령을 확인해 주세요.");
  const version = await captureCommand(command, ["--version"]);
  if (!version.ok) {
    return {
      installed: false,
      authenticated: false,
      provider,
      message: version.error || "CLI를 찾을 수 없습니다.",
    };
  }
  if (provider === "codex") {
    try {
      const server = getCodexAppServer(command);
      await server.start();
      const auth = await server.accountRead();
      const account = auth.account;
      return {
        installed: true,
        authenticated: Boolean(account),
        provider,
        version: version.output,
        account,
        transport: "app-server",
        message: account?.type === "chatgpt"
          ? `${account.email || "ChatGPT 계정"} · ${account.planType || "구독"}`
          : account?.type === "apiKey"
            ? "API 키로 로그인됨"
            : "ChatGPT 구독 로그인이 필요합니다.",
      };
    } catch (error) {
      return {
        installed: true,
        authenticated: false,
        provider,
        version: version.output,
        transport: "app-server",
        message: error.message,
      };
    }
  }
  return {
    installed: true,
    authenticated: null,
    provider,
    version: version.output,
    message: "설치됨 · 로그인 상태는 Claude 실행 시 확인합니다.",
  };
});

ipcMain.handle("codex-app-status", async (_, request = {}) => {
  const server = getCodexAppServer(String(request.command || "codex").trim());
  try {
    await server.start();
    const { account } = await server.accountRead();
    return { ...server.snapshot(), account };
  } catch (error) {
    return { ...server.snapshot(), status: "error", lastError: error.message };
  }
});

ipcMain.handle("codex-account-read", async (_, request = {}) => {
  const server = getCodexAppServer(String(request.command || "codex").trim());
  await server.start();
  return server.accountRead();
});

ipcMain.handle("codex-login-chatgpt", async (_, request = {}) => {
  const server = getCodexAppServer(String(request.command || "codex").trim());
  await server.start();
  const result = await server.loginChatgpt();
  if (result.authUrl && /^https:\/\//i.test(result.authUrl))
    await shell.openExternal(result.authUrl);
  return result;
});

ipcMain.handle("codex-model-list", async (_, request = {}) => {
  const server = getCodexAppServer(String(request.command || "codex").trim());
  await server.start();
  return server.modelList();
});

const apiControllers = new Map();

const runApiCompletion = async ({
  baseUrl,
  apiKey,
  model,
  system,
  prompt,
  effort,
  requestId,
  onChunk,
}) => {
  const endpoint = `${String(baseUrl || "").replace(/\/+$/, "")}/chat/completions`;
  const controller = new AbortController();
  if (requestId) apiControllers.set(requestId, controller);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://ksnote.local",
        "X-Title": "KsNote",
      },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [
          ...(system ? [{ role: "system", content: system }] : []),
          { role: "user", content: prompt },
        ],
        ...(effort && effort !== "auto" ? { reasoning: { effort } } : {}),
      }),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      let message = `API 호출 실패 (HTTP ${response.status})`;
      try {
        const parsed = text ? JSON.parse(text) : null;
        if (parsed?.error?.message) message = parsed.error.message;
      } catch {}
      throw new Error(message);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let output = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop();
      for (const part of parts) {
        const line = part
          .split("\n")
          .map((item) => item.trim())
          .find((item) => item.startsWith("data:"));
        if (!line) continue;
        const payload = line.slice("data:".length).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const delta =
            JSON.parse(payload)?.choices?.[0]?.delta?.content || "";
          if (delta) {
            output += delta;
            onChunk?.(delta);
          }
        } catch {}
      }
    }
    if (!output) throw new Error("API가 빈 응답을 반환했습니다.");
    return output;
  } finally {
    if (requestId) apiControllers.delete(requestId);
  }
};

ipcMain.handle("model-provider-fetch", async (_, request = {}) => {
  const provider = normalizeProvider(request.provider);
  if (!provider.id) throw new Error("공급자 ID가 필요합니다.");
  if (request.apiKey !== undefined)
    await saveApiKey(provider.id, String(request.apiKey || ""));
  const models = await fetchProviderModels({ ...provider, baseUrl: request.baseUrl || provider.baseUrl });
  return { ok: true, models, fetchedAt: Date.now() };
});

ipcMain.handle("model-provider-test", async (_, request = {}) => {
  const provider = normalizeProvider(request.provider);
  if (!provider.baseUrl) throw new Error("Base URL을 입력해 주세요.");
  const apiKey = request.apiKey !== undefined
    ? String(request.apiKey || "")
    : await readApiKey(provider.id);
  const { fetchJson } = require("./model-providers.cjs");
  const result = await fetchJson(`${provider.baseUrl}/models`, apiKey);
  if (!result.ok)
    throw new Error(
      result.json?.error?.message || `연결 실패 (HTTP ${result.status})`,
    );
  return { ok: true, modelCount: (result.json.data || []).length };
});

ipcMain.handle("model-provider-key-save", async (_, request = {}) => {
  const id = String(request?.providerId || "");
  if (!id) throw new Error("공급자 ID가 필요합니다.");
  await saveApiKey(id, String(request.apiKey || ""));
  return { ok: true, hasKey: Boolean(request.apiKey) };
});

ipcMain.handle("rovo-diagnose", async (_, request) => {
  const command = String(request?.command || "codex").trim();
  if (!command || /[;&|<>\r\n]/.test(command))
    throw new Error("Codex 실행 명령을 확인해 주세요.");
  const result = await captureCommand(command, ["mcp", "get", "atlassian"]);
  let account = null;
  let serverStatus = null;
  try {
    const appServer = getCodexAppServer(command);
    await appServer.start();
    account = (await appServer.accountRead())?.account || null;
    const statusResult = await appServer.mcpServerStatusList();
    const statuses = statusResult?.servers || statusResult?.data || statusResult || [];
    serverStatus = Array.isArray(statuses)
      ? statuses.find((item) => /atlassian|rovo/i.test(`${item?.name || ""} ${item?.serverName || ""}`))
      : null;
  } catch {}
  const configured =
    result.ok && /enabled:\s*true/i.test(result.output) && /mcp\.atlassian\.com/i.test(result.output);
  return {
    ok: configured,
    configured,
    endpoint: configured ? "https://mcp.atlassian.com/v1/mcp/authv2" : "",
    authenticated: configured
      ? serverStatus?.authenticated === true || serverStatus?.authenticated === "true" || serverStatus?.authStatus === "authenticated"
      : false,
    account,
    serverStatus,
    message: configured
      ? (serverStatus?.authenticated === true || serverStatus?.authenticated === "true" || serverStatus?.authStatus === "authenticated"
        ? `Atlassian Rovo OAuth 인증됨${account?.email ? ` · ${account.email}` : ""}`
        : "Atlassian Rovo가 구성되었지만 OAuth 인증이 필요합니다.")
      : "Atlassian MCP가 아직 구성되지 않았습니다.",
  };
});

const summarizePublishTool = (entry) => {
  if (!entry) return null;
  const schema = entry.tool?.inputSchema;
  const properties = schema && typeof schema === "object" && !Array.isArray(schema) ? schema.properties : null;
  return {
    name: entry.tool.name,
    title: entry.tool.title || "",
    description: String(entry.tool.description || "").slice(0, 500),
    score: entry.score,
    required: Array.isArray(schema?.required) ? schema.required : [],
    properties: properties && typeof properties === "object" ? Object.keys(properties) : [],
  };
};

const discoverRovoWriteTarget = async (command) => {
  const server = getCodexAppServer(command);
  await server.start();
  const statusResult = await server.mcpServerStatusList("toolsAndAuthOnly");
  const rovo = findRovoServer(statusResult);
  const readiness = rovoReadiness(rovo);
  if (!readiness.ok) return { ok: false, ...readiness, server: rovo?.name || "" };
  const tools = listServerTools(rovo);
  const create = findConfluenceCreateTool(tools);
  const spaceList = findSpaceListTool(tools);
  if (!create) {
    return {
      ok: false,
      code: "publish_no_create_tool",
      server: rovo.name,
      toolCount: tools.length,
      message: "Rovo 도구 목록에서 Confluence 생성 도구를 찾지 못했습니다.",
    };
  }
  return {
    ok: true,
    server,
    tools,
    create,
    spaceList,
    serverName: rovo.name,
    toolCount: tools.length,
  };
};

const pickPublishField = (result, keys) => {
  if (!result || typeof result !== "object") return "";
  for (const key of keys) {
    const value = result[key];
    if (typeof value === "string" && value) return value;
  }
  const nested = result.result && typeof result.result === "object" ? result.result : null;
  if (nested) {
    for (const key of keys) {
      if (typeof nested[key] === "string" && nested[key]) return nested[key];
    }
  }
  return "";
};

ipcMain.handle("atlassian-publish-discover", async (_, request = {}) => {
  const command = String(request.command || "codex").trim();
  if (!command || /[;&|<>\r\n]/.test(command))
    throw new Error("Codex 실행 명령을 확인해 주세요.");
  try {
    const discovered = await discoverRovoWriteTarget(command);
    if (!discovered.ok) return discovered;
    return {
      ok: true,
      server: discovered.serverName,
      toolCount: discovered.toolCount,
      createTool: summarizePublishTool(discovered.create),
      spaceListTool: summarizePublishTool(discovered.spaceList),
    };
  } catch (error) {
    return { ok: false, ...classifyPublishError(error), server: "" };
  }
});

ipcMain.handle("atlassian-publish-spaces", async (_, request = {}) => {
  const command = String(request.command || "codex").trim();
  if (!command || /[;&|<>\r\n]/.test(command))
    throw new Error("Codex 실행 명령을 확인해 주세요.");
  const server = getCodexAppServer(command);
  let threadId = "";
  try {
    const discovered = await discoverRovoWriteTarget(command);
    if (!discovered.ok) return discovered;
    if (!discovered.spaceList)
      return { ok: false, code: "publish_no_space_tool", message: "공간 조회 도구가 없어 직접 입력해 주세요." };
    threadId = await server.openScratchThread();
    const result = await server.mcpServerToolCall({
      server: discovered.serverName,
      threadId,
      tool: discovered.spaceList.tool.name,
      args: {},
      timeoutMs: 120000,
    });
    return { ok: true, result: boundToolResult(result) };
  } catch (error) {
    return { ok: false, ...classifyPublishError(error) };
  } finally {
    await server.closeScratchThread(threadId).catch(() => {});
  }
});

ipcMain.handle("atlassian-publish-page", async (_, request = {}) => {
  const command = String(request.command || "codex").trim();
  if (!command || /[;&|<>\r\n]/.test(command))
    throw new Error("Codex 실행 명령을 확인해 주세요.");
  const noteId = String(request.noteId || "");
  const title = String(request.title || "").trim();
  const cloudId = String(request.cloudId || "").trim();
  const spaceId = String(request.spaceId || "").trim();
  const parentId = String(request.parentId || "").trim();
  const adf = request.adf;
  const sourceRevision = String(request.sourceRevision || "");
  const contentHash = String(request.contentHash || "");
  const requestId = String(request.requestId || `publish-${Date.now()}`);
  if (!noteId || !title || !cloudId || !spaceId)
    return { ok: false, code: "publish_target_invalid", message: "노트, 제목, cloudId, spaceId를 모두 입력해 주세요." };
  const adfCheck = checkAdfDocument(adf);
  if (!adfCheck.ok)
    return { ok: false, code: "adf_invalid", message: "ADF 문서 구조가 유효하지 않습니다.", issues: adfCheck.issues.slice(0, 10) };
  const key = publicationIdempotencyKey({ noteId, sourceRevision, contentHash });
  const duplicateStatement = noteDb.prepare(
    "SELECT remote_id, remote_url FROM external_publications WHERE note_id=? AND source_revision=? AND content_hash=? AND status='succeeded' LIMIT 1",
  );
  duplicateStatement.bind([noteId, sourceRevision, contentHash]);
  const duplicateRow = duplicateStatement.step() ? duplicateStatement.get() : null;
  duplicateStatement.free();
  if (duplicateRow)
    return {
      ok: false,
      code: "publish_duplicate",
      message: "같은 revision이 이미 게시되었습니다. 중복 생성을 막았습니다.",
      remoteId: duplicateRow[0],
      remoteUrl: duplicateRow[1],
    };
  if (activePublish && !activePublish.settled)
    return { ok: false, code: "publish_busy", message: "다른 게시가 진행 중입니다." };
  const server = getCodexAppServer(command);
  const createdAt = Date.now();
  noteDb.run(
    "INSERT INTO external_publications(note_id,provider,cloud_id,remote_type,remote_id,remote_url,source_revision,content_hash,status,request_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    [noteId, "rovo-confluence", cloudId, "confluence-page", "", "", sourceRevision, contentHash, "pending", requestId, createdAt],
  );
  const rowId = noteDb.exec("SELECT last_insert_rowid()")[0].values[0][0];
  await flushDatabase();
  activePublish = { requestId, rowId, approvalId: null, settled: false, cancelRequested: false };
  let threadId = "";
  try {
    const discovered = await discoverRovoWriteTarget(command);
    if (!discovered.ok) {
      const discoveryError = new Error(discovered.detail || discovered.message || discovered.code);
      discoveryError.publishCode = discovered.code;
      throw discoveryError;
    }
    const built = buildCreatePageArgs(discovered.create.tool, {
      cloudId,
      spaceId,
      title,
      body: adf,
      bodyFormat: "adf",
      parentId: parentId || undefined,
    });
    if (!built.ok) {
      const error = new Error(`도구 인자 부족: ${built.missing.join(", ")}`);
      error.publishMissing = built.missing;
      throw error;
    }
    threadId = await server.openScratchThread();
    const result = await server.mcpServerToolCall({
      server: discovered.serverName,
      threadId,
      tool: discovered.create.tool.name,
      args: built.args,
    });
    const pageId = pickPublishField(result, ["pageId", "id"]);
    const url = pickPublishField(result, ["url", "link"]);
    if (activePublish.cancelRequested) {
      noteDb.run("UPDATE external_publications SET status='cancelled', remote_id=?, remote_url=? WHERE id=?", [pageId, url, rowId]);
      await flushDatabase();
      activePublish.settled = true;
      return { ok: false, code: "publish_cancelled", message: "게시 도중 취소했습니다. 원격 생성 여부는 Confluence에서 확인해 주세요.", remoteId: pageId, remoteUrl: url };
    }
    noteDb.run("UPDATE external_publications SET status='succeeded', remote_id=?, remote_url=? WHERE id=?", [pageId, url, rowId]);
    await flushDatabase();
    activePublish.settled = true;
    return { ok: true, pageId, url, sourceRevision, contentHash, idempotencyKey: key, warnings: built.warnings };
  } catch (error) {
    const classified = error.publishMissing
      ? { code: "publish_args_incomplete", message: error.message }
      : error.publishCode
        ? { code: error.publishCode, message: error.message }
        : classifyPublishError(error);
    const cancelled = activePublish?.cancelRequested || classified.code === "publish_declined";
    noteDb.run("UPDATE external_publications SET status=? WHERE id=?", [cancelled ? "cancelled" : "failed", rowId]);
    await flushDatabase();
    if (activePublish) activePublish.settled = true;
    return { ok: false, ...classified };
  } finally {
    await server.closeScratchThread(threadId).catch(() => {});
    if (activePublish?.settled) activePublish = null;
  }
});

ipcMain.handle("atlassian-publish-approval-resolve", async (_, request = {}) => {
  if (!activePublish || activePublish.settled || activePublish.approvalId !== request.approvalId)
    return { ok: false, code: "publish_no_approval", message: "대기 중인 승인 요청이 없습니다." };
  const server = getCodexAppServer(String(request.command || "codex").trim());
  const approved = request.decision === "approved";
  server.resolveApproval(request.approvalId, approved ? { decision: "approved" } : { decision: "declined" });
  activePublish.approvalId = null;
  return { ok: true, decision: approved ? "approved" : "declined" };
});

ipcMain.handle("atlassian-publish-cancel", async (_, request = {}) => {
  if (!activePublish || activePublish.settled || activePublish.requestId !== request.requestId)
    return { ok: false, code: "publish_no_active", message: "진행 중인 게시가 없습니다." };
  const server = getCodexAppServer(String(request.command || "codex").trim());
  if (activePublish.approvalId) {
    server.resolveApproval(activePublish.approvalId, { decision: "declined" });
    activePublish.approvalId = null;
  }
  activePublish.cancelRequested = true;
  return { ok: true, code: "publish_cancel_requested", message: "취소를 요청했습니다." };
});

ipcMain.handle("plantuml-info", async (_, { jarPath } = {}) => {
  try {
    const resolvedJarPath = await resolvePlantUmlJarPath(jarPath);
    const java = await captureCommand("java", ["-version"], 5000);
    return {
      available: java.ok,
      jarPath: resolvedJarPath,
      bundled: path.resolve(resolvedJarPath) === path.resolve(getBundledPlantUmlJarPath()),
      java: java.output || java.error || "",
      message: java.ok ? "PlantUML 로컬 SVG 렌더러를 사용할 수 있습니다." : "Java 실행 환경을 찾을 수 없습니다.",
    };
  } catch (error) {
    return {
      available: false,
      jarPath: "",
      bundled: false,
      java: "",
      message: error.message || "PlantUML 런타임을 확인할 수 없습니다.",
    };
  }
});

ipcMain.handle("plantuml-pick-jar", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "PlantUML JAR", extensions: ["jar"] }],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const picked = path.resolve(result.filePaths[0]);
  if (path.extname(picked).toLowerCase() !== ".jar")
    throw new Error("PlantUML JAR 파일(.jar)만 사용할 수 있습니다.");
  userPickedPlantUmlJars.add(picked);
  return { jarPath: picked };
});

ipcMain.handle("plantuml-render", async (_, { code, jarPath } = {}) => {
  const resolvedJarPath = await resolvePlantUmlJarPath(jarPath);
  if (String(code || "").length > 200_000)
    throw new Error("PlantUML 코드가 너무 깁니다.");
  return new Promise((resolve, reject) => {
    const child = spawn("java", ["-jar", resolvedJarPath, "-pipe", "-tsvg", "-failfast2"], { windowsHide: true });
    const chunks = []; let error = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("PlantUML 렌더링 시간이 초과되었습니다.")); }, 20000);
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => { error += chunk.toString(); });
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      const svg = Buffer.concat(chunks).toString("utf8");
      if (exitCode !== 0 || !/<svg\b/i.test(svg) || /Syntax Error/i.test(svg)) {
        reject(new Error(error.trim() || `PlantUML 렌더링 실패 (종료 코드 ${exitCode})`));
        return;
      }
      resolve(svg);
    });
    child.stdin.end(String(code || ""));
  });
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#f4f6f7",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      // MCP operations can arrive while the note window is covered or minimized.
      // Keep renderer polling/heartbeats alive so the server does not mistake
      // background throttling for a closed application.
      backgroundThrottling: false,
    },
  });
  mainWindow = win;
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    const allowed =
      url.startsWith("http://127.0.0.1:5173") || url.startsWith("file://");
    if (!allowed) {
      event.preventDefault();
      writeRuntimeLog("navigation-blocked", { url: String(url).slice(0, 500) });
    }
  });
  win.webContents.on("will-redirect", (event, url) => {
    const allowed =
      url.startsWith("http://127.0.0.1:5173") || url.startsWith("file://");
    if (!allowed) {
      event.preventDefault();
      writeRuntimeLog("navigation-blocked", { url: String(url).slice(0, 500) });
    }
  });
  const display = screen.getPrimaryDisplay();
  if (
    display.workAreaSize.width >= 1800 &&
    display.workAreaSize.height >= 900
  )
    win.maximize();
  win.on("closed", () => {
    writeRuntimeLog("window-closed");
    if (mainWindow === win) mainWindow = null;
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    writeRuntimeLog("render-process-gone", {
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });
  win.webContents.on("unresponsive", () => {
    writeRuntimeLog("renderer-unresponsive");
  });
  win.webContents.on("responsive", () => {
    writeRuntimeLog("renderer-responsive");
  });
  win.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      writeRuntimeLog("renderer-load-failed", {
        errorCode,
        errorDescription,
        validatedURL,
      });
    },
  );
  if (isDev) win.loadURL("http://127.0.0.1:5173");
  else win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  return win;
}

ipcMain.handle(
  "export-note",
  async (_, { title, content, format = "markdown" }) => {
    const config =
      format === "html"
        ? { ext: "html", name: "HTML" }
        : format === "pdf"
          ? { ext: "pdf", name: "PDF" }
          : format === "docx"
            ? { ext: "docx", name: "Word" }
          : { ext: "md", name: "Markdown" };
    const result = await dialog.showSaveDialog({
      defaultPath: `${title || "Untitled"}.${config.ext}`,
      filters: [{ name: config.name, extensions: [config.ext] }],
    });
    if (result.canceled) return false;
    if (format === "docx") {
      const document = new Document({ sections: [{ children: htmlToDocxChildren(content, title) }] });
      const bytes = await Packer.toBuffer(document);
      await fs.writeFile(result.filePath, bytes);
    } else if (format === "pdf") {
      const printWindow = new BrowserWindow({
        show: false,
        webPreferences: { sandbox: true },
      });
      const documentHtml = `<!doctype html><html><head><meta charset="utf-8"><style>body{font:14px/1.7 Arial,sans-serif;max-width:820px;margin:40px auto;color:#263638}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccd6d7;padding:8px}pre{background:#172426;color:#edf5f4;padding:16px;border-radius:8px;white-space:pre-wrap}img,svg{max-width:100%}</style></head><body><h1>${String(title || "").replace(/[<>]/g, "")}</h1>${content}</body></html>`;
      await printWindow.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(documentHtml)}`,
      );
      const pdf = await printWindow.webContents.printToPDF({
        printBackground: true,
        pageSize: "A4",
      });
      await fs.writeFile(result.filePath, pdf);
      printWindow.destroy();
    } else if (format === "html") {
      await fs.writeFile(
        result.filePath,
        `<!doctype html><meta charset="utf-8"><title>${title || "KsNote"}</title><article>${content}</article>`,
        "utf8",
      );
    } else {
      const turndown = new TurndownService({
        headingStyle: "atx",
        codeBlockStyle: "fenced",
        bulletListMarker: "-",
      });
      turndown.use(gfm);
      turndown.addRule("ksnoteDiagram", {
        filter: (node) => node.nodeName === "DIV" && ["mermaid", "plantuml"].includes(node.getAttribute("data-type")),
        replacement: (_, node) => `\n\n\`\`\`${node.getAttribute("data-type")}\n${node.getAttribute("data-code") || ""}\n\`\`\`\n\n`,
      });
      turndown.addRule("ksnoteAttachment", {
        filter: (node) => node.nodeName === "DIV" && node.getAttribute("data-type") === "attachment",
        replacement: (_, node) => `\n[${node.getAttribute("name") || "첨부파일"}](${node.getAttribute("src") || ""})\n`,
      });
      await fs.writeFile(result.filePath, turndown.turndown(content), "utf8");
    }
    return true;
  },
);

function runCli(command, args, input, { requestId, onChunk } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: app.getPath("documents"),
      shell: process.platform === "win32",
      windowsHide: true,
    });
    if (requestId) aiProcesses.set(requestId, child);
    let stdout = "",
      stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("AI 응답 시간이 초과되었습니다."));
    }, 180000);
    child.stdout.on("data", (d) => {
      const chunk = d.toString();
      if (stdout.length < 4_000_000) stdout += chunk;
      onChunk?.(chunk);
    });
    child.stderr.on("data", (d) => {
      if (stderr.length < 200_000) stderr += d.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (requestId) aiProcesses.delete(requestId);
      code === 0
        ? resolve(stdout.trim())
        : reject(new Error(formatCliError(stderr, command, code)));
    });
    child.stdin.end(input);
  });
}

function formatCliError(stderr, command, code) {
  const raw = String(stderr || "").trim();
  const jsonMessages = Array.from(raw.matchAll(/"message"\s*:\s*"([^"]+)"/g)).map((match) => match[1]);
  const message = jsonMessages.at(-1) || raw.split(/\r?\n/).reverse().find((line) => /(?:ERROR|error:|unauthorized|authentication|login)/i.test(line)) || raw.split(/\r?\n/).filter(Boolean).at(-1);
  if (/requires a newer version of Codex/i.test(raw)) return "현재 모델을 사용하려면 Codex CLI 업데이트가 필요합니다. 터미널에서 `codex update`를 실행한 뒤 다시 시도해 주세요.";
  if (/refresh_token is invalid|unauthorized_client|authorization required|not logged in/i.test(raw)) return "Codex 로그인이 만료되었습니다. 터미널에서 `codex login`으로 다시 로그인해 주세요.";
  if (/forbidden|permission denied|insufficient scope|status.?403/i.test(raw)) return "Atlassian 접근 권한이 없습니다. 사이트 관리자 정책과 페이지 권한을 확인해 주세요.";
  if (/not found|status.?404|page does not exist/i.test(raw)) return "요청한 Jira 또는 Confluence 자료를 찾을 수 없습니다. 링크와 이슈 키를 확인해 주세요.";
  if (/oauth|authorization required|reauthor/i.test(raw)) return "Atlassian OAuth 연결이 필요하거나 만료되었습니다. Rovo 연결을 다시 승인해 주세요.";
  return message?.replace(/^\s*(?:ERROR|error):?\s*/i, "") || `${command} 실행 실패 (${code})`;
}

ipcMain.handle("ai-run", async (_, request) => {
  if (request.mode === "external-write" && request.externalWriteApproval !== true)
    throw new Error("외부 쓰기는 별도 작업 모드에서 명시적으로 승인해야 합니다.");
  const system =
    request.mode === "research"
      ? "Use the configured Atlassian Rovo tools to inspect the Jira or Confluence resources explicitly requested by the user. Read only. Answer in Korean. When you use multiple pages, cite each paragraph with markers like [1], [2] and list every marker under a Sources section as '1. title - url'. Never create, update, or delete external content or local files."
      : request.mode === "ask"
      ? "You answer questions about the supplied note. Answer in Korean, concisely. Do not use tools. Do not modify files."
      : "You are a document editor operating on one explicitly supplied editor target. Return ONLY one JSON object with this exact shape: {\"version\":1,\"operation\":\"replace|insert_before|insert_after\",\"target\":\"note|selection|block|table\",\"blockId\":\"target block id when target=block\",\"expectedRevision\":\"source revision\",\"html\":\"valid HTML fragment\",\"summary\":\"short Korean summary\"}. Obey REQUESTED OPERATION. For insert_before or insert_after, html contains only the new content and must not repeat the existing target. For replace, html contains only the replacement target. Never invent or rewrite content outside the supplied target. Preserve table structure and existing cell style attributes unless explicitly asked to change formatting. Do not use markdown fences, explanations, or tools.";
  const sessionId = request.sessionId || `${request.projectId || "workspace"}:${request.noteId || "note"}:${request.mode || "edit"}`;
  const storedSession = readAiSession(sessionId);
  const currentNoteContent = request.noteContent || request.content || "";
  const noteDelta = commonNoteDelta(
    storedSession?.last_content || "",
    currentNoteContent,
  );
  const useDelta = Boolean(storedSession?.last_content) && request.mode !== "edit";
  const continuityContext = storedSession?.context_summary && !storedSession?.thread_id
    ? `\n\nPREVIOUS SESSION CONTINUITY SUMMARY:\n${storedSession.context_summary}`
    : "";
  const noteContext = request.mode === "edit"
    ? `ACTIVE EDITOR TARGET (${request.editContext?.label || request.target}; ${request.editContext?.nodeType || "unknown"}):\n${request.content || ""}`
    : useDelta
    ? `NOTE UPDATE SINCE PREVIOUS TURN (${noteDelta.kind}):\n${noteDelta.text}`
    : `CURRENT NOTE HTML:\n${request.content}`;
  const diagramFormat = ["mermaid", "plantuml", "drawio"].includes(request.diagramFormat)
    ? request.diagramFormat
    : "auto";
  const diagramFormatLine = request.mode === "edit" && diagramFormat !== "auto"
    ? `\n\nDIAGRAM FORMAT PREFERENCE: ${diagramFormat}. If the edit inserts a diagram block, write it as a ${diagramFormat} block (${diagramFormat === "mermaid" ? "mermaidBlock" : diagramFormat === "plantuml" ? "plantUmlBlock" : "drawioBlock"}). Otherwise ignore this preference.`
    : "";
  const prompt = `${system}${continuityContext}\n\nUSER INSTRUCTION:\n${request.instruction}\n\nTARGET: ${request.target}\n\nREQUESTED OPERATION: ${request.requestedOperation || "replace"}${diagramFormatLine}\n\nSOURCE REVISION: ${request.sourceRevision || ""}\n\n${noteContext}\n\nSELECTED HTML:\n${request.selectionHtml || request.selection || "(none)"}\n\nDETECTED EXTERNAL LINKS:\n${(request.externalLinks || []).join("\n") || "(none)"}`;
  const command = String(request.command || request.provider || "").trim();
  if (!command || /[;&|<>\r\n]/.test(command))
    throw new Error("AI Agent 실행 명령을 확인해 주세요.");
  if (request.model && !/^[A-Za-z0-9._:-]+$/.test(String(request.model)))
    throw new Error("AI 모델 이름을 확인해 주세요.");
  const sendToRenderer = (channel, payload) => {
    try {
      if (_?.sender && !_.sender.isDestroyed())
        _.sender.send(channel, payload);
    } catch {}
  };
  if (request.api?.baseUrl && request.api?.providerId) {
    if (request.mode === "research")
      throw new Error("Rovo 조사는 Codex 구독 모델에서만 사용할 수 있습니다.");
    const apiKey = await readApiKey(String(request.api.providerId));
    if (!apiKey)
      throw new Error("공급자 API 키를 설정에서 먼저 연결해 주세요.");
    const apiProvider = String(request.provider || request.api.providerId);
    upsertAiSession({
      id: sessionId,
      projectId: request.projectId,
      noteId: request.noteId,
      mode: request.mode || "edit",
      provider: apiProvider,
      threadId: null,
      title: storedSession?.title || request.instruction.slice(0, 80),
      model: request.model,
      lastRevision: storedSession?.last_revision || "",
      lastContent: storedSession?.last_content || "",
      createdAt: storedSession?.created_at,
    });
    const now = Date.now();
    try {
      const output = await runApiCompletion({
        baseUrl: request.api.baseUrl,
        apiKey,
        model: request.model,
        system,
        prompt,
        effort: request.reasoningEffort,
        requestId: request.requestId,
        onChunk: (chunk) => sendToRenderer("ai-chunk", {
          requestId: request.requestId,
          chunk,
        }),
      });
      upsertAiSession({
        id: sessionId,
        projectId: request.projectId,
        noteId: request.noteId,
        mode: request.mode || "edit",
        provider: apiProvider,
        threadId: null,
        title: storedSession?.title || request.instruction.slice(0, 80),
        model: request.model,
        lastRevision: request.sourceRevision,
        lastContent: currentNoteContent,
        createdAt: storedSession?.created_at,
      });
      noteDb.run(
        "INSERT OR REPLACE INTO ai_turns(id,session_id,instruction,response,status,source_revision,applied_revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
        [request.requestId, sessionId, request.instruction, output, "done", request.sourceRevision || "", "", now, Date.now()],
      );
      await flushDatabase();
      return output;
    } catch (error) {
      noteDb.run(
        "INSERT OR REPLACE INTO ai_turns(id,session_id,instruction,response,status,source_revision,applied_revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
        [request.requestId, sessionId, request.instruction, error.message, "error", request.sourceRevision || "", "", now, Date.now()],
      );
      await flushDatabase();
      throw error;
    }
  }
  if (request.provider === "claude")
    return runCli(
      command,
      [
        "--print",
        "--tools",
        "",
        "--permission-mode",
        "plan",
        ...(request.model ? ["--model", request.model] : []),
      ],
      prompt,
      { requestId: request.requestId, onChunk: (chunk) => sendToRenderer("ai-chunk", { requestId: request.requestId, chunk }) },
    );
  const server = getCodexAppServer(command);
  let threadId = storedSession?.thread_id || null;
  let latestUsage = null;
  upsertAiSession({
    id: sessionId,
    projectId: request.projectId,
    noteId: request.noteId,
    mode: request.mode || "edit",
    provider: "codex",
    threadId,
    title: storedSession?.title || request.instruction.slice(0, 80),
    model: request.model,
    lastRevision: storedSession?.last_revision || "",
    lastContent: storedSession?.last_content || "",
    createdAt: storedSession?.created_at,
  });
  try {
    const output = await server.runTurn({
      contextKey: sessionId,
      existingThreadId: threadId,
      prompt,
      model: request.model,
      effort: request.reasoningEffort,
      developerInstructions: system,
      requestId: request.requestId,
      onThread: (resolvedThreadId) => {
        threadId = resolvedThreadId;
        upsertAiSession({
          id: sessionId,
          projectId: request.projectId,
          noteId: request.noteId,
          mode: request.mode || "edit",
          provider: "codex",
          threadId,
          title: storedSession?.title || request.instruction.slice(0, 80),
          model: request.model,
          lastRevision: storedSession?.last_revision || "",
          lastContent: storedSession?.last_content || "",
          createdAt: storedSession?.created_at,
        });
        flushDatabase().catch(() => {});
      },
      onDelta: (chunk) => sendToRenderer("ai-chunk", {
        requestId: request.requestId,
        chunk,
      }),
      onUsage: (usage) => {
        latestUsage = usage;
        const last = usage?.last || {};
        const total = usage?.total || {};
        noteDb.run(
          "UPDATE ai_sessions SET input_tokens=?,output_tokens=?,total_tokens=?,context_tokens=?,context_window=?,updated_at=? WHERE id=?",
          [
            total.inputTokens || 0,
            total.outputTokens || 0,
            total.totalTokens || 0,
            last.inputTokens || 0,
            usage?.modelContextWindow || 0,
            Date.now(),
            sessionId,
          ],
        );
        sendToRenderer("ai-session-usage", { sessionId, usage });
      },
    });
    const now = Date.now();
    upsertAiSession({
      id: sessionId,
      projectId: request.projectId,
      noteId: request.noteId,
      mode: request.mode || "edit",
      provider: "codex",
      threadId,
      title: storedSession?.title || request.instruction.slice(0, 80),
      model: request.model,
      lastRevision: request.sourceRevision,
      lastContent: currentNoteContent,
      createdAt: storedSession?.created_at,
    });
    noteDb.run(
      "INSERT OR REPLACE INTO ai_turns(id,session_id,instruction,response,status,source_revision,applied_revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
      [request.requestId, sessionId, request.instruction, output, "done", request.sourceRevision || "", "", now, now],
    );
    const contextWindow = latestUsage?.modelContextWindow || 0;
    const contextTokens = latestUsage?.last?.inputTokens || 0;
    if (threadId && contextWindow > 0 && contextTokens / contextWindow >= 0.5) {
      try {
        const compacted = await server.compactAndFork(
          sessionId,
          threadId,
          request.model,
        );
        threadId = null;
        noteDb.run(
          "UPDATE ai_sessions SET thread_id=NULL,previous_thread_id=?,context_summary=?,input_tokens=0,output_tokens=0,total_tokens=0,context_tokens=0,context_window=0,compacted_at=?,updated_at=? WHERE id=?",
          [compacted.previousThreadId, compacted.summary, Date.now(), Date.now(), sessionId],
        );
        sendToRenderer("ai-session-compacted", {
          sessionId,
          threadId,
          previousThreadId: compacted.previousThreadId,
          automatic: true,
        });
      } catch (error) {
        sendToRenderer("ai-session-compaction-error", {
          sessionId,
          message: error.message,
        });
      }
    }
    await flushDatabase();
    return output;
  } catch (error) {
    const now = Date.now();
    noteDb.run(
      "INSERT OR REPLACE INTO ai_turns(id,session_id,instruction,response,status,source_revision,applied_revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
      [request.requestId, sessionId, request.instruction, error.message, "error", request.sourceRevision || "", "", now, now],
    );
    await flushDatabase();
    throw error;
  }
});

ipcMain.handle("ai-cancel", async (_, requestId) => {
  const apiController = apiControllers.get(requestId);
  if (apiController) {
    apiController.abort();
    apiControllers.delete(requestId);
    return true;
  }
  const child = aiProcesses.get(requestId);
  if (child) {
    child.kill();
    aiProcesses.delete(requestId);
    return true;
  }
  return codexAppServer?.interrupt(requestId) || false;
});

const hasSingleInstanceLock =
  isMcpMode || app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  writeRuntimeLog("second-instance-exit");
  app.quit();
} else if (isMcpMode) {
  app.whenReady().then(async () => {
    process.env.KSNOTE_DB_PATH ||= path.join(app.getPath("userData"), "ksnote.db");
    await ensureMcpDirectories();
    await import(pathToFileURL(getMcpServerScriptPath()).href);
  }).catch((error) => {
    console.error("KsNote MCP mode failed:", error);
    app.exit(1);
  });
} else {
  app.on("second-instance", () => {
    writeRuntimeLog("second-instance-focus");
    const win = mainWindow || BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  app.whenReady().then(async () => {
    await initializeStorage();
    createWindow();
    writeRuntimeLog("app-ready");
    getCodexAppServer().start().catch(() => {});
    if (app.isPackaged) {
      try {
        const { autoUpdater } = require("electron-updater");
        autoUpdater.checkForUpdatesAndNotify().catch((error) => {
          writeRuntimeLog("update-check-failed", {
            message: error?.message || String(error),
          });
        });
      } catch (error) {
        writeRuntimeLog("updater-unavailable", {
          message: error?.message || String(error),
        });
      }
    }
  }).catch((error) => {
    writeRuntimeLog("startup-failed", {
      message: error?.message || String(error),
      stack: error?.stack || "",
    });
    dialog.showErrorBox(
      "KsNote 시작 실패",
      `앱을 시작하지 못했습니다.\n\n${error?.message || String(error)}\n\n로그: ${path.join(app.getPath("userData"), "logs", "runtime.jsonl")}`,
    );
    app.exit(1);
  });
}
app.on("child-process-gone", (_event, details) => {
  writeRuntimeLog("child-process-gone", {
    type: details.type,
    reason: details.reason,
    exitCode: details.exitCode,
    serviceName: details.serviceName || "",
    name: details.name || "",
  });
});
app.on("before-quit", (event) => {
  if (!codexAppServer || codexAppServer.status === "stopped") {
    writeRuntimeLog("before-quit");
    return;
  }
  if (!app.__ksnoteQuitting) {
    event.preventDefault();
    app.__ksnoteQuitting = true;
    writeRuntimeLog("before-quit");
    Promise.resolve()
      .then(() => codexAppServer.stop())
      .catch((error) => {
        writeRuntimeLog("before-quit-stop-failed", {
          message: error?.message || String(error),
        });
      })
      .finally(() => {
        app.quit();
      });
  }
});
app.on("window-all-closed", () => {
  if (isMcpMode) return;
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (isMcpMode) return;
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
