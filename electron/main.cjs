const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs/promises");
const { spawn } = require("child_process");
const TurndownService = require("turndown");
const { gfm } = require("turndown-plugin-gfm");
const initSqlJs = require("sql.js");
const { Document, Packer, Paragraph, HeadingLevel, Table: DocxTable, TableRow: DocxRow, TableCell: DocxCell } = require("docx");

const isDev = !app.isPackaged;
let noteDb;
let noteDbPath;
const aiProcesses = new Map();

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
  await flushDatabase();
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

ipcMain.handle("asset-save", async (_, { name, dataUrl }) => {
  const match = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("지원하지 않는 파일 데이터입니다.");
  const extension = (name?.split(".").pop() || match[1].split("/").pop() || "bin").replace(/[^a-z0-9]/gi, "");
  const assetName = `${Date.now()}-${Math.random().toString(16).slice(2)}.${extension}`;
  const assetDir = path.join(app.getPath("userData"), "assets"); await fs.mkdir(assetDir, { recursive: true });
  const assetPath = path.join(assetDir, assetName); await fs.writeFile(assetPath, Buffer.from(match[2], "base64"));
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
  return message?.replace(/^\s*(?:ERROR|error):?\s*/i, "") || `${command} 실행 실패 (${code})`;
}

ipcMain.handle("ai-run", async (_, request) => {
  const system =
    request.mode === "research"
      ? "Use the configured Atlassian Rovo tools to inspect the Jira or Confluence resources explicitly requested by the user. Read only. Answer in Korean. Include source URLs and a Sources section. Never create, update, or delete external content or local files."
      : request.mode === "ask"
      ? "You answer questions about the supplied note. Answer in Korean, concisely. Do not use tools. Do not modify files."
      : "You are a document editor. Return ONLY the complete replacement HTML for the requested target. Preserve unrelated content and valid semantic HTML. Do not use markdown fences, explanations, or tools.";
  const prompt = `${system}\n\nUSER INSTRUCTION:\n${request.instruction}\n\nTARGET: ${request.target}\n\nNOTE HTML:\n${request.content}\n\nSELECTED TEXT:\n${request.selection || "(none)"}`;
  const command = String(request.command || request.provider || "").trim();
  if (!command || /[;&|<>\r\n]/.test(command))
    throw new Error("AI Agent 실행 명령을 확인해 주세요.");
  if (request.provider === "claude")
    return runCli(
      command,
      ["--print", "--tools", "", "--permission-mode", "plan"],
      prompt,
      { requestId: request.requestId, onChunk: (chunk) => _.sender.send("ai-chunk", { requestId: request.requestId, chunk }) },
    );
  const codexArgs = [
      "exec",
      ...(request.mode === "research" ? [] : ["--ignore-user-config"]),
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--ephemeral",
      "--color",
      "never",
      "-",
    ];
  return runCli(
    command,
    codexArgs,
    prompt,
    { requestId: request.requestId, onChunk: (chunk) => _.sender.send("ai-chunk", { requestId: request.requestId, chunk }) },
  );
});

ipcMain.handle("ai-cancel", (_, requestId) => {
  const child = aiProcesses.get(requestId);
  if (!child) return false;
  child.kill();
  aiProcesses.delete(requestId);
  return true;
});

app.whenReady().then(async () => { await initializeStorage(); createWindow(); });
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
