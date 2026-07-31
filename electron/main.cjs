const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs/promises");
const { pathToFileURL } = require("url");
const { spawn } = require("child_process");
const TurndownService = require("turndown");
const { gfm } = require("turndown-plugin-gfm");
const initSqlJs = require("sql.js");
const { Document, Packer, Paragraph, HeadingLevel, Table: DocxTable, TableRow: DocxRow, TableCell: DocxCell } = require("docx");
const { CodexAppServerClient } = require("./codex-app-server-client.cjs");

const isDev = !app.isPackaged;
const isMcpMode = process.argv.includes("--ksnote-mcp");
const MCP_OPERATION_TTL_MS = 5 * 60 * 1000;
let noteDb;
let noteDbPath;
const aiProcesses = new Map();
let codexAppServer;

function broadcast(channel, payload) {
  BrowserWindow.getAllWindows().forEach((window) =>
    window.webContents.send(channel, payload),
  );
}

function getMcpDirectory() {
  return path.join(app.getPath("userData"), "mcp");
}

function getMcpOperationDirectory() {
  return path.join(getMcpDirectory(), "operations");
}

function getMcpServerScriptPath() {
  return path.join(__dirname, "..", "mcp", "ksnote-server.mjs");
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
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(tempPath, filePath);
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
  if (codexAppServer && codexAppServer.command !== command) {
    codexAppServer.stop();
    codexAppServer = null;
  }
  if (!codexAppServer) {
    codexAppServer = new CodexAppServerClient({
      command,
      cwd: app.getPath("documents"),
    });
    codexAppServer.on("status", (status) =>
      broadcast("codex-app-status", status),
    );
    codexAppServer.on("notification", ({ method, params }) => {
      if (method === "account/updated" || method === "account/login/completed")
        broadcast("codex-account-event", { method, ...params });
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
}

async function flushDatabase() {
  if (!noteDb || !noteDbPath) return;
  await fs.writeFile(noteDbPath, Buffer.from(noteDb.export()));
}

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
  return true;
});

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
      if (
        operation.status === "pending" &&
        now - (operation.createdAt || now) > MCP_OPERATION_TTL_MS
      ) {
        const expired = {
          ...operation,
          status: "expired",
          code: "operation_expired",
          message: "KsNote 앱에서 제한 시간 안에 작업을 적용하지 못했습니다.",
          completedAt: now,
          updatedAt: now,
        };
        await writeJsonAtomic(filePath, expired);
        continue;
      }
      if (operation.status !== "pending") continue;
      if (noteId && operation.noteId && operation.noteId !== noteId) continue;
      operations.push(operation);
    } catch {}
  }
  return operations.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
});

ipcMain.handle("mcp-operation-claim", async (_, { id, noteId } = {}) => {
  const found = await readMcpOperation(id);
  if (!found) return null;
  const operation = found.operation;
  if (operation.status !== "pending") return operation;
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
  return updateMcpOperation(id, {
    ...result,
    status: result.status || "completed",
    completedAt: Date.now(),
  });
});

ipcMain.handle("mcp-operation-get", async (_, id) => {
  const found = await readMcpOperation(id);
  return found?.operation || null;
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
  const extension = (name?.split(".").pop() || match[1].split("/").pop() || "bin").replace(/[^a-z0-9]/gi, "");
  const assetName = `${Date.now()}-${Math.random().toString(16).slice(2)}.${extension}`;
  const assetDir = path.join(app.getPath("userData"), "assets"); await fs.mkdir(assetDir, { recursive: true });
  const assetPath = path.join(assetDir, assetName); await fs.writeFile(assetPath, Buffer.from(match[2], "base64"));
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
  const system = [
    "You generate one raster image for a local note-taking app.",
    "Use the available image generation tool/skill if it is available in this Codex app-server session.",
    "Save the final selected image as a local file if the tool returns a file.",
    "After the image is generated, respond with ONLY one JSON object: {\"path\":\"absolute local image file path\"}.",
    "Do not include Markdown, explanations, captions, or extra keys.",
  ].join(" ");
  const userPrompt = [
    "Generate exactly one image for this note block.",
    `Project codename: ORBIT-42.`,
    `Image prompt: ${prompt}`,
    "Return only the JSON object with the absolute path to the generated image.",
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
  });
  const generatedPath = parseImageGenerationResult(output);
  if (!generatedPath) throw new Error(`이미지 경로를 찾지 못했습니다: ${output.slice(0, 500)}`);
  if (/^https?:\/\//i.test(generatedPath))
    return { src: generatedPath, path: generatedPath, prompt, raw: output };
  const resolvedPath = /^file:\/\//i.test(generatedPath)
    ? new URL(generatedPath)
    : path.resolve(generatedPath);
  const bytes = await fs.readFile(resolvedPath);
  const extension = path.extname(typeof resolvedPath === "string" ? resolvedPath : resolvedPath.pathname).replace(/^\./, "") || "png";
  const assetDir = path.join(app.getPath("userData"), "assets");
  await fs.mkdir(assetDir, { recursive: true });
  const assetName = `${Date.now()}-${Math.random().toString(16).slice(2)}.${extension}`;
  const assetPath = path.join(assetDir, assetName);
  await fs.writeFile(assetPath, bytes);
  const mime = imageMimeFromPath(assetPath);
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
  if (result.authUrl) await shell.openExternal(result.authUrl);
  return result;
});

ipcMain.handle("codex-model-list", async (_, request = {}) => {
  const server = getCodexAppServer(String(request.command || "codex").trim());
  await server.start();
  return server.modelList();
});

ipcMain.handle("rovo-diagnose", async (_, request) => {
  const command = String(request?.command || "codex").trim();
  if (!command || /[;&|<>\r\n]/.test(command))
    throw new Error("Codex 실행 명령을 확인해 주세요.");
  const result = await captureCommand(command, ["mcp", "get", "atlassian"]);
  const configured =
    result.ok && /enabled:\s*true/i.test(result.output) && /mcp\.atlassian\.com/i.test(result.output);
  return {
    ok: configured,
    configured,
    endpoint: configured ? "https://mcp.atlassian.com/v1/mcp/authv2" : "",
    authenticated: null,
    message: configured
      ? "Rovo MCP 구성됨 · OAuth는 첫 조사 실행에서 확인"
      : "Atlassian MCP가 아직 구성되지 않았습니다.",
  };
});

ipcMain.handle("plantuml-render", async (_, { code, jarPath }) => {
  if (!jarPath) throw new Error("설정 > 편집기에서 PlantUML JAR 경로를 지정하세요.");
  try { await fs.access(jarPath); } catch { throw new Error("PlantUML JAR 파일을 찾을 수 없습니다."); }
  return new Promise((resolve, reject) => {
    const child = spawn("java", ["-jar", jarPath, "-pipe", "-tsvg"], { windowsHide: true });
    const chunks = []; let error = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("PlantUML 렌더링 시간이 초과되었습니다.")); }, 20000);
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => { error += chunk.toString(); });
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("close", (exitCode) => { clearTimeout(timer); exitCode === 0 ? resolve(Buffer.concat(chunks).toString("utf8")) : reject(new Error(error || `PlantUML 종료 코드 ${exitCode}`)); });
    child.stdin.end(code);
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
    },
  });
  if (isDev) win.loadURL("http://127.0.0.1:5173");
  else win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
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
  const system =
    request.mode === "research"
      ? "Use the configured Atlassian Rovo tools to inspect the Jira or Confluence resources explicitly requested by the user. Read only. Answer in Korean. Include source URLs and a Sources section. Never create, update, or delete external content or local files."
      : request.mode === "ask"
      ? "You answer questions about the supplied note. Answer in Korean, concisely. Do not use tools. Do not modify files."
      : "You are a document editor operating on one explicitly supplied editor target. Return ONLY one JSON object with this exact shape: {\"version\":1,\"operation\":\"replace|insert_before|insert_after\",\"target\":\"note|selection|block|table\",\"html\":\"valid HTML fragment\",\"summary\":\"short Korean summary\"}. Obey REQUESTED OPERATION. For insert_before or insert_after, html contains only the new content and must not repeat the existing target. For replace, html contains only the replacement target. Never invent or rewrite content outside the supplied target. Preserve table structure and existing cell style attributes unless explicitly asked to change formatting. Do not use markdown fences, explanations, or tools.";
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
  const prompt = `${system}${continuityContext}\n\nUSER INSTRUCTION:\n${request.instruction}\n\nTARGET: ${request.target}\n\nREQUESTED OPERATION: ${request.requestedOperation || "replace"}\n\nSOURCE REVISION: ${request.sourceRevision || ""}\n\n${noteContext}\n\nSELECTED HTML:\n${request.selectionHtml || request.selection || "(none)"}\n\nDETECTED EXTERNAL LINKS:\n${(request.externalLinks || []).join("\n") || "(none)"}`;
  const command = String(request.command || request.provider || "").trim();
  if (!command || /[;&|<>\r\n]/.test(command))
    throw new Error("AI Agent 실행 명령을 확인해 주세요.");
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
      { requestId: request.requestId, onChunk: (chunk) => _.sender.send("ai-chunk", { requestId: request.requestId, chunk }) },
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
      onDelta: (chunk) => _.sender.send("ai-chunk", {
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
        _.sender.send("ai-session-usage", { sessionId, usage });
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
        _.sender.send("ai-session-compacted", {
          sessionId,
          threadId,
          previousThreadId: compacted.previousThreadId,
          automatic: true,
        });
      } catch (error) {
        _.sender.send("ai-session-compaction-error", {
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
  const child = aiProcesses.get(requestId);
  if (child) {
    child.kill();
    aiProcesses.delete(requestId);
    return true;
  }
  return codexAppServer?.interrupt(requestId) || false;
});

if (isMcpMode) {
  app.whenReady().then(async () => {
    process.env.KSNOTE_DB_PATH ||= path.join(app.getPath("userData"), "ksnote.db");
    await ensureMcpDirectories();
    await import(pathToFileURL(getMcpServerScriptPath()).href);
  }).catch((error) => {
    console.error("KsNote MCP mode failed:", error);
    app.exit(1);
  });
} else {
  app.whenReady().then(async () => {
    await initializeStorage();
    createWindow();
    getCodexAppServer().start().catch(() => {});
  });
}
app.on("before-quit", () => codexAppServer?.stop());
app.on("window-all-closed", () => {
  if (isMcpMode) return;
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (isMcpMode) return;
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
