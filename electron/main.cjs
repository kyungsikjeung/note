const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs/promises");
const { spawn } = require("child_process");
const TurndownService = require("turndown");
const { gfm } = require("turndown-plugin-gfm");
const nodeFs = require("fs");
const os = require("os");
const { openStore, applyPendingWrite } = require("../lib/ksnote-store.cjs");
const { Document, Packer, Paragraph, HeadingLevel, Table: DocxTable, TableRow: DocxRow, TableCell: DocxCell } = require("docx");

const isDev = !app.isPackaged;
const MCP_SERVER_PATH = path.join(__dirname, "..", "mcp", "ksnote-server.mjs");
let store;
let dbFilePath = "";
let lastPendingCount = -1;

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
  dbFilePath = path.join(app.getPath("userData"), "ksnote.db");
  store = await openStore(dbFilePath);
  watchExternalChanges(dbFilePath);
}

const mcpLogPath = () => path.join(app.getPath("userData"), "logs", "mcp-server.log");

const broadcast = (channel, payload) => {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload);
};

/** Push the approval queue to the UI whenever the MCP server enqueues or we resolve one. */
function notifyPendingChanged(force) {
  if (!store) return [];
  const pending = store.listPendingWrites("pending");
  if (force || pending.length !== lastPendingCount) {
    lastPendingCount = pending.length;
    broadcast("mcp-pending-changed", pending);
  }
  return pending;
}

/** Writes made by another process (MCP server, second window) land in every open editor. */
function watchExternalChanges(dbPath) {
  nodeFs.watchFile(dbPath, { interval: 1500 }, async () => {
    if (!store || !store.hasExternalChange()) return;
    try {
      if (!(await store.reload())) return;
      notifyPendingChanged(false);
      const state = store.loadState();
      if (!state) return;
      broadcast("storage-external-change", state);
    } catch (error) {
      console.error("외부 변경을 반영하지 못했습니다.", error);
    }
  });
}

ipcMain.handle("storage-load", async () => store.loadState());

ipcMain.handle("storage-save", async (_, data) => {
  await store.saveState(data);
  return true;
});

ipcMain.handle("revision-list", (_, noteId) => store.listRevisions(noteId, { limit: 50 }));

ipcMain.handle("revision-get", (_, id) => store.getRevision(id));

/** AI 변경 revision 자동 저장: the renderer snapshots the note BEFORE applying a patch. */
ipcMain.handle("revision-snapshot", async (_, request) => store.snapshotRevision(request));

ipcMain.handle("ai-audit-append", async (_, entry) => store.appendAiAudit(entry));

ipcMain.handle("ai-audit-list", async (_, options) => {
  if (store.hasExternalChange()) await store.reload();
  return store.listAiAudit(options);
});

ipcMain.handle("asset-save", async (_, { name, dataUrl }) => {
  const match = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("지원하지 않는 파일 데이터입니다.");
  const extension = (name?.split(".").pop() || match[1].split("/").pop() || "bin").replace(/[^a-z0-9]/gi, "");
  const assetName = `${Date.now()}-${Math.random().toString(16).slice(2)}.${extension}`;
  const assetDir = path.join(app.getPath("userData"), "assets"); await fs.mkdir(assetDir, { recursive: true });
  const assetPath = path.join(assetDir, assetName); await fs.writeFile(assetPath, Buffer.from(match[2], "base64"));
  await store.saveAsset({ id: assetName, name: name || assetName, path: assetPath, createdAt: Date.now() });
  return { path: assetPath, name: assetName };
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

/* ---------------------------------------------------------------- MCP 서버 연동 */

ipcMain.handle("mcp-set-context", async (_, context) => {
  if (!store) return false;
  await store.saveContext(context || {});
  return true;
});

ipcMain.handle("mcp-pending-list", async () => {
  if (!store) return [];
  if (store.hasExternalChange()) await store.reload();
  const pending = store.listPendingWrites("pending");
  lastPendingCount = pending.length;
  return pending;
});

/** Approving applies the queued change (snapshotting a revision first); rejecting drops it. */
ipcMain.handle("mcp-pending-resolve", async (_, request) => {
  const { id, approve } = request || {};
  if (!store || !id) throw new Error("처리할 변경을 찾지 못했습니다.");
  try {
    if (approve) await applyPendingWrite(store, id);
    else await store.resolvePendingWrite(id, "rejected", null);
  } catch (error) {
    await store.resolvePendingWrite(id, "rejected", error.message).catch(() => {});
    notifyPendingChanged(true);
    return { ok: false, error: error.message, pending: store.listPendingWrites("pending") };
  }
  const pending = notifyPendingChanged(true);
  return { ok: true, pending, state: store.loadState() };
});

ipcMain.handle("mcp-read-log", async (_, count) => {
  const logPath = mcpLogPath();
  const wanted = Math.min(Math.max(Number(count) || 100, 1), 500);
  try {
    const text = await fs.readFile(logPath, "utf8");
    return { path: logPath, lines: text.split(/\r?\n/).filter(Boolean).slice(-wanted) };
  } catch {
    return { path: logPath, lines: [], error: "아직 MCP 서버 로그가 없습니다. Codex 에서 한 번 호출하면 생성됩니다." };
  }
});

function runNodeScript(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      windowsHide: true,
      env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: "1" }),
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("MCP 서버 응답 시간이 초과되었습니다."));
    }, 15000);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim().split(/\r?\n/).pop() || ("종료 코드 " + code)));
    });
  });
}

ipcMain.handle("mcp-server-info", async () => {
  const info = { serverPath: MCP_SERVER_PATH, dbPath: dbFilePath, logPath: mcpLogPath(), exists: nodeFs.existsSync(MCP_SERVER_PATH), ok: false, tools: [] };
  if (!info.exists) return Object.assign(info, { error: "mcp/ksnote-server.mjs 를 찾을 수 없습니다." });
  try {
    const described = JSON.parse(await runNodeScript([MCP_SERVER_PATH, "--describe", "--db", dbFilePath]));
    return Object.assign(info, {
      ok: true,
      name: described.name,
      version: described.version,
      protocolVersion: described.protocolVersion,
      tools: described.tools || [],
      logPath: described.logFile || info.logPath,
    });
  } catch (error) {
    return Object.assign(info, { error: error.message });
  }
});

/** [mcp_servers.ksnote] block for ~/.codex/config.toml (paths JSON-escaped, valid TOML). */
function codexConfigBlock(serverPath, dbPath) {
  const args = [serverPath, "--db", dbPath].map((value) => JSON.stringify(value)).join(", ");
  return [
    "[mcp_servers.ksnote]",
    "# KsNote MCP server — generated by KsNote (설정 > MCP 연결)",
    'command = "node"',
    "args = [" + args + "]",
    "",
  ].join("\n");
}

/** Replace only our own section so the user's other MCP servers survive. */
function mergeCodexConfig(existing, block) {
  const lines = existing.split(/\r?\n/);
  const start = lines.findIndex((line) => /^\s*\[mcp_servers\.ksnote\]\s*$/.test(line));
  if (start < 0) {
    const head = existing.trim() ? existing.replace(/\s*$/, "") + "\n\n" : "";
    return { text: head + block, merged: false };
  }
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s*\[/.test(lines[index])) {
      end = index;
      break;
    }
  }
  const next = lines.slice(0, start).concat(block.split("\n")).concat(lines.slice(end));
  return { text: next.join("\n").replace(/\n{3,}/g, "\n\n"), merged: true };
}

ipcMain.handle("mcp-write-codex-config", async () => {
  const configDir = path.join(os.homedir(), ".codex");
  const configPath = path.join(configDir, "config.toml");
  await fs.mkdir(configDir, { recursive: true });
  let existing = "";
  let hadFile = false;
  try {
    existing = await fs.readFile(configPath, "utf8");
    hadFile = true;
  } catch {}
  const result = mergeCodexConfig(existing, codexConfigBlock(MCP_SERVER_PATH, dbFilePath));
  let backupPath = "";
  if (hadFile) {
    backupPath = configPath + ".bak";
    await fs.writeFile(backupPath, existing, "utf8");
  }
  await fs.writeFile(configPath, result.text.replace(/\s*$/, "") + "\n", "utf8");
  return { path: configPath, merged: result.merged, backupPath, command: 'codex mcp add ksnote -- node "' + MCP_SERVER_PATH + '" --db "' + dbFilePath + '"' };
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

function runCli(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: app.getPath("documents"),
      shell: process.platform === "win32",
      windowsHide: true,
    });
    let stdout = "",
      stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("AI 응답 시간이 초과되었습니다."));
    }, 180000);
    child.stdout.on("data", (d) => {
      if (stdout.length < 4_000_000) stdout += d.toString();
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
  return message?.replace(/^\s*(?:ERROR|error):?\s*/i, "") || `${command} 실행 실패 (${code})`;
}

/** Prompt for callers that predate the renderer-side ksnote-patch@1 prompt. */
function legacyPrompt(request) {
  const system =
    request.mode === "ask"
      ? "You answer questions about the supplied note. Answer in Korean, concisely. Do not use tools. Do not modify files."
      : "You are a document editor. Return ONLY the complete replacement HTML for the requested target. Preserve unrelated content and valid semantic HTML. Do not use markdown fences, explanations, or tools.";
  return `${system}\n\nUSER INSTRUCTION:\n${request.instruction}\n\nTARGET: ${request.target}\n\nNOTE HTML:\n${request.content}\n\nSELECTED TEXT:\n${request.selection || "(none)"}`;
}

/**
 * Sanitized command, argv and prompt shared by ai-run (blocking) and ai-start
 * (streaming). The prompt is provider independent: the renderer builds one
 * ksnote-patch@1 prompt and both CLIs receive it verbatim.
 */
function prepareAiRun(request) {
  const req = request || {};
  const command = String(req.command || req.provider || "").trim();
  if (!command || /[;&|<>\r\n]/.test(command))
    throw new Error("AI Agent 실행 명령을 확인해 주세요.");
  const args =
    req.provider === "claude"
      ? ["--print", "--tools", "", "--permission-mode", "plan"]
      : ["exec", "--ignore-user-config", "--skip-git-repo-check", "--sandbox", "read-only", "--ephemeral", "--color", "never", "-"];
  return { command, args, prompt: req.prompt ? String(req.prompt) : legacyPrompt(req) };
}

const aiJobs = new Map();

/** On Windows the CLI runs under cmd.exe, so kill the tree or the child outlives us. */
function killTree(child) {
  if (!child) return;
  if (process.platform === "win32" && child.pid) {
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      return;
    } catch {}
  }
  try { child.kill(); } catch {}
}

/** Legacy blocking call — kept working so nothing breaks if a caller misses ai-start. */
ipcMain.handle("ai-run", async (_, request) => {
  const job = prepareAiRun(request);
  return runCli(job.command, job.args, job.prompt);
});

/** 응답 스트리밍: chunks go out on ai-stream, the result on ai-done / ai-error. */
ipcMain.handle("ai-start", async (event, request) => {
  const job = prepareAiRun(request);
  const jobId = "ai-" + Date.now().toString(36) + "-" + Math.random().toString(16).slice(2, 8);
  const sender = event.sender;
  const send = (channel, payload) => { if (!sender.isDestroyed()) sender.send(channel, payload); };
  const child = spawn(job.command, job.args, {
    cwd: app.getPath("documents"),
    shell: process.platform === "win32",
    windowsHide: true,
  });
  const entry = { child, cancelled: false, timedOut: false };
  aiJobs.set(jobId, entry);
  let output = "";
  let stderr = "";
  const timer = setTimeout(() => { entry.timedOut = true; killTree(child); }, 180000);
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    if (output.length < 4_000_000) output += text;
    send("ai-stream", { jobId, chunk: text });
  });
  child.stderr.on("data", (chunk) => { if (stderr.length < 200_000) stderr += chunk.toString(); });
  child.on("error", (error) => {
    clearTimeout(timer);
    aiJobs.delete(jobId);
    send("ai-error", { jobId, message: error.message });
  });
  child.on("close", (code) => {
    clearTimeout(timer);
    aiJobs.delete(jobId);
    if (entry.cancelled) send("ai-error", { jobId, message: "취소되었습니다.", cancelled: true });
    else if (entry.timedOut) send("ai-error", { jobId, message: "AI 응답 시간이 초과되었습니다." });
    else if (code === 0) send("ai-done", { jobId, output: output.trim(), code });
    else send("ai-error", { jobId, message: formatCliError(stderr, job.command, code) });
  });
  child.stdin.end(job.prompt);
  return { jobId };
});

/** 실행 중 취소 — the run still lands in the audit log, with status "cancelled". */
ipcMain.handle("ai-cancel", async (_, request) => {
  const entry = aiJobs.get(String((request || {}).jobId || ""));
  if (!entry) return false;
  entry.cancelled = true;
  killTree(entry.child);
  return true;
});

/** Run one short command and report whether it exited cleanly. */
function probeCommand(command, args, timeoutMs) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { windowsHide: true, shell: process.platform === "win32" });
    } catch (error) {
      resolve({ ok: false, output: String(error.message || error) });
      return;
    }
    let output = "";
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      killTree(child);
      resolve({ ok, output: output.trim().slice(0, 400) });
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.on("error", (error) => { output += String(error.message || error); finish(false); });
    child.on("close", (code) => finish(code === 0));
  });
}

/** CLI 설치 및 로그인 자동 진단 — shown as a status line in the AI dock. */
ipcMain.handle("ai-diagnose", async (_, request) => {
  const req = request || {};
  const provider = String(req.provider || "codex");
  const command = String(req.command || provider).trim();
  const base = { provider, command, installed: false, loggedIn: false, version: "" };
  if (!command || /[;&|<>\r\n]/.test(command)) return { ...base, hint: "AI Agent 실행 명령을 확인해 주세요." };
  const version = await probeCommand(command, ["--version"], 8000);
  if (!version.ok) return { ...base, hint: command + " CLI 를 찾지 못했습니다. 설치한 뒤 PATH 를 확인해 주세요." };
  const versionText = (version.output.split(/\r?\n/).find(Boolean) || "").slice(0, 80);
  if (provider === "codex") {
    const status = await probeCommand(command, ["login", "status"], 10000);
    const loggedIn = status.ok && !/not logged in|logged out|login required|unauthorized/i.test(status.output);
    return { ...base, installed: true, version: versionText, loggedIn, hint: loggedIn ? "" : "터미널에서 " + command + " login 을 실행해 주세요." };
  }
  // Claude Code has no cheap non-interactive auth probe: a `--print` ping would
  // burn a real model turn every time the dock opens. Heuristic instead — the CLI
  // keeps OAuth credentials under the home directory and API-key users export
  // ANTHROPIC_API_KEY; either signal counts as "likely logged in".
  const credentialFiles = [path.join(os.homedir(), ".claude", ".credentials.json"), path.join(os.homedir(), ".claude.json")];
  const loggedIn = Boolean(process.env.ANTHROPIC_API_KEY) || credentialFiles.some((file) => nodeFs.existsSync(file));
  return {
    ...base,
    installed: true,
    version: versionText,
    loggedIn,
    heuristic: true,
    hint: loggedIn ? "" : "터미널에서 " + command + " login 으로 로그인해 주세요.",
  };
});

app.whenReady().then(async () => { await initializeStorage(); createWindow(); });
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
