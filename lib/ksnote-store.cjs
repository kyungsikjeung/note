"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const initSqlJs = require("sql.js");
const { markdownToHtml } = require("./ksnote-markdown.cjs");

const SCHEMA_VERSION = "1";
const LOCK_STALE_MS = 10000;
const LOCK_TIMEOUT_MS = 5000;
const LOCK_RETRY_MS = 40;
const REVISIONS_PER_NOTE = 50;

const VOID_TAGS = new Set(["hr", "img", "br", "input", "col", "source", "area"]);
const TASK_ITEM = /<li\b([^>]*)>([\s\S]*?)<\/li>/gi;
const ATTR_PATTERN = /\bNAME\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.source;
const CLOSE_PATTERN = /<(\/?)TAG\b([^>]*)>/gi.source;

let sqlPromise;
const loadSql = () => {
  if (!sqlPromise) sqlPromise = initSqlJs({ locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm") });
  return sqlPromise;
};

const decodeEntities = (value) => String(value || "")
  .replace(/&nbsp;/gi, " ")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">")
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/gi, "'")
  .replace(/&apos;/gi, "'")
  .replace(/&amp;/gi, "&");

const plainText = (html) => decodeEntities(
  String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|pre|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, ""),
).replace(/[ \t\u00a0]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

const attribute = (attrs, name) => {
  const match = new RegExp(ATTR_PATTERN.replace("NAME", name), "i").exec(attrs || "");
  if (!match) return "";
  return decodeEntities(match[2] !== undefined ? match[2] : match[3] !== undefined ? match[3] : match[4] || "");
};

const hashBytes = (bytes) => crypto.createHash("sha1").update(bytes).digest("hex");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findCloseIndex(html, tag, from) {
  const pattern = new RegExp(CLOSE_PATTERN.replace("TAG", tag), "gi");
  pattern.lastIndex = from;
  let depth = 1;
  let match;
  while ((match = pattern.exec(html))) {
    if (match[1] === "/") {
      depth -= 1;
      if (depth === 0) return pattern.lastIndex;
    } else if (!/\/\s*$/.test(match[2] || "")) {
      depth += 1;
    }
  }
  return -1;
}

/** Split note HTML into top-level blocks without a DOM (runs in plain Node). */
function parseBlocks(html) {
  const source = String(html || "");
  const openTag = /<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
  const blocks = [];
  let cursor = 0;
  while (cursor < source.length) {
    openTag.lastIndex = cursor;
    const match = openTag.exec(source);
    if (!match) break;
    const tag = match[1].toLowerCase();
    const attrs = match[2] || "";
    const leading = source.slice(cursor, match.index).trim();
    if (leading) blocks.push({ tag: "text", type: "text", attrs: "", html: leading, text: plainText(leading), blockId: "" });
    const closed = VOID_TAGS.has(tag) || /\/\s*$/.test(attrs);
    let end = closed ? openTag.lastIndex : findCloseIndex(source, tag, openTag.lastIndex);
    if (end < 0) end = source.length;
    const outer = source.slice(match.index, end);
    const dataType = attribute(attrs, "data-type");
    blocks.push({
      tag,
      type: dataType || tag,
      attrs,
      html: outer,
      text: plainText(outer),
      blockId: attribute(attrs, "data-block-id") || attribute(attrs, "data-id"),
    });
    cursor = end;
  }
  const tail = source.slice(cursor).trim();
  if (tail) blocks.push({ tag: "text", type: "text", attrs: "", html: tail, text: plainText(tail), blockId: "" });
  return blocks;
}

/** Checkbox / TipTap taskList items inside a block. */
function parseTasks(block) {
  const tasks = [];
  TASK_ITEM.lastIndex = 0;
  let match;
  while ((match = TASK_ITEM.exec(block.html))) {
    const attrs = match[1] || "";
    const inner = match[2] || "";
    const checkedAttr = attribute(attrs, "data-checked");
    const isTaskItem = attribute(attrs, "data-type") === "taskItem" || checkedAttr !== "";
    const hasCheckbox = /<input\b[^>]*type\s*=\s*["']?checkbox/i.test(inner);
    if (!isTaskItem && !hasCheckbox) continue;
    const checked = checkedAttr ? checkedAttr === "true" : /<input\b[^>]*\bchecked\b/i.test(inner);
    tasks.push({
      text: plainText(inner),
      checked: checked ? 1 : 0,
      due: attribute(attrs, "data-due") || attribute(attrs, "data-due-date"),
      assignee: attribute(attrs, "data-assignee"),
      priority: attribute(attrs, "data-priority"),
    });
  }
  return tasks;
}

class KsNoteStore {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.lockPath = dbPath + ".lock";
    this.db = null;
    this.lastKnownHash = "";
    this.lastKnownMtime = 0;
  }

  async open() {
    const SQL = await loadSql();
    let bytes;
    try { bytes = await fsp.readFile(this.dbPath); } catch { bytes = null; }
    this.db = bytes && bytes.length ? new SQL.Database(bytes) : new SQL.Database();
    if (bytes && bytes.length) {
      this.lastKnownHash = hashBytes(bytes);
      this.lastKnownMtime = this.getFileMtime();
    }
    this.migrateSchema();
    await this.flush();
    return this;
  }

  /** Re-read a file that another process wrote. */
  async reload() {
    const SQL = await loadSql();
    let bytes;
    try { bytes = await fsp.readFile(this.dbPath); } catch { return false; }
    if (!bytes.length) return false;
    const digest = hashBytes(bytes);
    if (digest === this.lastKnownHash) return false;
    try { if (this.db) this.db.close(); } catch {}
    this.db = new SQL.Database(bytes);
    this.lastKnownHash = digest;
    this.lastKnownMtime = this.getFileMtime();
    this.migrateSchema();
    return true;
  }

  close() {
    try { if (this.db) this.db.close(); } catch {}
    this.db = null;
  }

  migrateSchema() {
    const db = this.db;
    db.run("CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL, updated_at INTEGER NOT NULL)");
    db.run("CREATE TABLE IF NOT EXISTS revisions (id INTEGER PRIMARY KEY AUTOINCREMENT, note_id TEXT NOT NULL, title TEXT, content TEXT NOT NULL, created_at INTEGER NOT NULL)");
    db.run("CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT, position INTEGER)");
    db.run("CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, title TEXT, content TEXT, trashed INTEGER, position INTEGER, updated_at INTEGER)");
    db.run("CREATE TABLE IF NOT EXISTS blocks (note_id TEXT, block_index INTEGER, block_id TEXT, type TEXT, text TEXT, html TEXT, PRIMARY KEY(note_id, block_index))");
    db.run("CREATE TABLE IF NOT EXISTS tasks (note_id TEXT, block_index INTEGER, text TEXT, checked INTEGER, due TEXT, assignee TEXT, priority TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, name TEXT, path TEXT, created_at INTEGER)");
    db.run("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS pending_writes (id TEXT PRIMARY KEY, tool TEXT NOT NULL, payload_json TEXT NOT NULL, diff TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, resolved_at INTEGER, error TEXT)");
    db.run("CREATE INDEX IF NOT EXISTS idx_notes_project ON notes(project_id)");
    db.run("CREATE INDEX IF NOT EXISTS idx_blocks_note ON blocks(note_id)");
    db.run("CREATE INDEX IF NOT EXISTS idx_tasks_note ON tasks(note_id)");
    db.run("CREATE INDEX IF NOT EXISTS idx_revisions_note ON revisions(note_id, id DESC)");
    db.run("CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_writes(status, created_at)");
    db.run("INSERT INTO meta(key,value) VALUES('schema_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [SCHEMA_VERSION]);
  }

  rows(sql, params) {
    const statement = this.db.prepare(sql);
    if (params && params.length) statement.bind(params);
    const out = [];
    while (statement.step()) out.push(statement.getAsObject());
    statement.free();
    return out;
  }

  row(sql, params) {
    return this.rows(sql, params)[0] || null;
  }

  loadState() {
    const found = this.row("SELECT json FROM app_state WHERE id=1");
    if (!found || !found.json) return null;
    try { return JSON.parse(found.json); } catch { return null; }
  }

  getMeta(key) {
    const found = this.row("SELECT value FROM meta WHERE key=?", [key]);
    return found ? found.value : null;
  }

  setMeta(key, value) {
    this.db.run("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [key, String(value)]);
  }

  listProjects() {
    return this.rows("SELECT id,name,position FROM projects ORDER BY position ASC, id ASC");
  }

  getProject(id) {
    return this.row("SELECT id,name,position FROM projects WHERE id=?", [id]);
  }

  listNotes(options) {
    const opts = options || {};
    const includeTrashed = opts.includeTrashed === true;
    const where = [];
    const params = [];
    if (opts.projectId) { where.push("project_id=?"); params.push(opts.projectId); }
    if (!includeTrashed) where.push("COALESCE(trashed,0)=0");
    let sql = "SELECT id,project_id,parent_id,title,trashed,position,updated_at FROM notes";
    if (where.length) sql += " WHERE " + where.join(" AND ");
    sql += " ORDER BY position ASC, updated_at DESC";
    if (opts.limit > 0) { sql += " LIMIT ? OFFSET ?"; params.push(opts.limit, opts.offset || 0); }
    return this.rows(sql, params);
  }

  getNote(id) {
    return this.row("SELECT id,project_id,parent_id,title,content,trashed,position,updated_at FROM notes WHERE id=?", [id]);
  }

  searchNotes(query, options) {
    const opts = options || {};
    const limit = opts.limit > 0 ? opts.limit : 20;
    const offset = opts.offset || 0;
    const needle = String(query || "").trim().toLowerCase();
    if (!needle) return [];
    const where = [];
    const params = [];
    if (opts.projectId) { where.push("project_id=?"); params.push(opts.projectId); }
    if (opts.includeTrashed !== true) where.push("COALESCE(trashed,0)=0");
    let sql = "SELECT id,project_id,title,content,updated_at FROM notes";
    if (where.length) sql += " WHERE " + where.join(" AND ");
    const occurrences = (haystack) => {
      let total = 0;
      let index = haystack.indexOf(needle);
      while (index >= 0) { total += 1; index = haystack.indexOf(needle, index + needle.length); }
      return total;
    };
    return this.rows(sql, params)
      .map((note) => {
        const body = plainText(note.content);
        const lower = body.toLowerCase();
        const score = occurrences(String(note.title || "").toLowerCase()) * 3 + occurrences(lower);
        if (!score) return null;
        const hit = lower.indexOf(needle);
        const start = hit < 0 ? 0 : Math.max(0, hit - 60);
        const head = start > 0 ? "..." : "";
        const tail = start + 160 < body.length ? "..." : "";
        return {
          id: note.id,
          projectId: note.project_id,
          title: note.title,
          score,
          snippet: head + body.slice(start, start + 160).replace(/\s+/g, " ").trim() + tail,
          updatedAt: note.updated_at,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(offset, offset + limit);
  }

  listBlocks(noteId) {
    return this.rows("SELECT note_id,block_index,block_id,type,text,html FROM blocks WHERE note_id=? ORDER BY block_index ASC", [noteId]);
  }

  queryTasks(options) {
    const opts = options || {};
    const where = [];
    const params = [];
    if (opts.noteId) { where.push("t.note_id=?"); params.push(opts.noteId); }
    if (opts.projectId) { where.push("n.project_id=?"); params.push(opts.projectId); }
    if (opts.checked === true || opts.checked === false) { where.push("t.checked=?"); params.push(opts.checked ? 1 : 0); }
    let sql = "SELECT t.note_id,t.block_index,t.text,t.checked,t.due,t.assignee,t.priority,n.title AS note_title,n.project_id FROM tasks t LEFT JOIN notes n ON n.id=t.note_id";
    if (where.length) sql += " WHERE " + where.join(" AND ");
    sql += " ORDER BY t.note_id ASC, t.block_index ASC";
    if (opts.limit > 0) { sql += " LIMIT ? OFFSET ?"; params.push(opts.limit, opts.offset || 0); }
    return this.rows(sql, params);
  }

  listAssets(options) {
    const opts = options || {};
    let sql = "SELECT id,name,path,created_at FROM assets ORDER BY created_at DESC";
    const params = [];
    if (opts.limit > 0) { sql += " LIMIT ? OFFSET ?"; params.push(opts.limit, opts.offset || 0); }
    return this.rows(sql, params);
  }

  getAsset(id) {
    return this.row("SELECT id,name,path,created_at FROM assets WHERE id=?", [id]);
  }

  listRevisions(noteId, options) {
    const opts = options || {};
    const limit = opts.limit > 0 ? opts.limit : REVISIONS_PER_NOTE;
    return this.rows("SELECT id,note_id,title,created_at FROM revisions WHERE note_id=? ORDER BY id DESC LIMIT ? OFFSET ?", [noteId, limit, opts.offset || 0]);
  }

  getRevision(id) {
    return this.row("SELECT id,note_id,title,content,created_at FROM revisions WHERE id=?", [id]);
  }

  async saveState(state) {
    const parsed = typeof state === "string" ? JSON.parse(state) : state;
    return this.withWriteLock(() => this.writeState(parsed));
  }

  /** Unlocked state write. Callers must already hold the write lock (see saveState). */
  writeState(parsed) {
    const now = Date.now();
    const previous = this.loadState();
    if (previous && previous.notes) this.recordRevisions(previous.notes, parsed.notes || [], now);
    this.db.run(
      "INSERT INTO app_state(id,json,updated_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at",
      [JSON.stringify(parsed), now],
    );
    this.db.run("DELETE FROM revisions WHERE id IN (SELECT id FROM revisions r WHERE (SELECT COUNT(*) FROM revisions newer WHERE newer.note_id=r.note_id AND newer.id>=r.id)>" + REVISIONS_PER_NOTE + ")");
    this.rebuildProjections(parsed);
    if (!previous && !this.getMeta("migrated_from_localstorage")) {
      this.setMeta("migrated_from_localstorage", String(now));
      this.setMeta("migration_source", "localStorage:mori-data");
    }
    this.setMeta("last_state_write", String(now));
    return true;
  }

  /** Editor context (current note + selection) published for MCP clients. */
  async saveContext(context) {
    return this.withWriteLock(() => {
      this.setMeta("current_context", JSON.stringify(context || {}));
      return true;
    });
  }

  /** Latest revision id of a note, or 0 when the note has no revision yet. */
  currentRevision(noteId) {
    const found = this.row("SELECT id FROM revisions WHERE note_id=? ORDER BY id DESC LIMIT 1", [noteId]);
    return found ? Number(found.id) : 0;
  }

  /* ---------------------------------------------------------------- approval queue */

  /** Queue a write for user approval instead of mutating notes directly. */
  async enqueuePendingWrite(request) {
    const record = request || {};
    const id = "pw-" + Date.now().toString(36) + "-" + crypto.randomBytes(4).toString("hex");
    const createdAt = Date.now();
    return this.withWriteLock(() => {
      this.db.run(
        "INSERT INTO pending_writes(id,tool,payload_json,diff,status,created_at) VALUES(?,?,?,?,'pending',?)",
        [id, String(record.tool || ""), JSON.stringify(record.payload || {}), String(record.diff || ""), createdAt],
      );
      return { id, tool: record.tool, payload: record.payload || {}, diff: record.diff || "", status: "pending", createdAt };
    });
  }

  mapPendingWrite(row) {
    let payload = {};
    try { payload = JSON.parse(row.payload_json); } catch {}
    return {
      id: row.id,
      tool: row.tool,
      payload,
      diff: row.diff || "",
      status: row.status,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
      error: row.error,
    };
  }

  listPendingWrites(status) {
    const where = status ? " WHERE status=?" : "";
    const params = status ? [status] : [];
    return this.rows("SELECT id,tool,payload_json,diff,status,created_at,resolved_at,error FROM pending_writes" + where + " ORDER BY created_at ASC", params)
      .map((row) => this.mapPendingWrite(row));
  }

  getPendingWrite(id) {
    const row = this.row("SELECT id,tool,payload_json,diff,status,created_at,resolved_at,error FROM pending_writes WHERE id=?", [id]);
    return row ? this.mapPendingWrite(row) : null;
  }

  async resolvePendingWrite(id, status, error) {
    return this.withWriteLock(() => {
      this.db.run("UPDATE pending_writes SET status=?, resolved_at=?, error=? WHERE id=?", [status, Date.now(), error || null, id]);
      return this.getPendingWrite(id);
    });
  }

  async saveAsset(asset) {
    const record = asset || {};
    const filePath = String(record.path || record.filePath || "");
    const assetId = record.id || record.name || path.basename(filePath);
    const createdAt = record.createdAt || record.created_at || Date.now();
    return this.withWriteLock(() => {
      this.db.run(
        "INSERT INTO assets(id,name,path,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, path=excluded.path",
        [assetId, record.name || assetId, filePath, createdAt],
      );
      return { id: assetId, name: record.name || assetId, path: filePath, created_at: createdAt };
    });
  }

  recordRevisions(previousNotes, nextNotes, now) {
    const nextById = new Map((nextNotes || []).map((note) => [note.id, note]));
    const insert = this.db.prepare("INSERT INTO revisions(note_id,title,content,created_at) VALUES(?,?,?,?)");
    for (const old of previousNotes) {
      const next = nextById.get(old.id);
      if (next && old.content !== next.content) insert.run([old.id, old.title || "", old.content || "", now]);
    }
    insert.free();
  }

  /** Normalized projections are derived data: rebuilt wholesale from the state JSON. */
  rebuildProjections(state) {
    const db = this.db;
    db.run("DELETE FROM projects");
    db.run("DELETE FROM notes");
    db.run("DELETE FROM blocks");
    db.run("DELETE FROM tasks");
    const insertProject = db.prepare("INSERT OR REPLACE INTO projects(id,name,position) VALUES(?,?,?)");
    ((state && state.projects) || []).forEach((project, index) => {
      const position = project.position !== undefined ? project.position : project.order !== undefined ? project.order : index;
      insertProject.run([String(project.id), project.name || "", position]);
    });
    insertProject.free();
    const insertNote = db.prepare("INSERT OR REPLACE INTO notes(id,project_id,parent_id,title,content,trashed,position,updated_at) VALUES(?,?,?,?,?,?,?,?)");
    const insertBlock = db.prepare("INSERT OR REPLACE INTO blocks(note_id,block_index,block_id,type,text,html) VALUES(?,?,?,?,?,?)");
    const insertTask = db.prepare("INSERT INTO tasks(note_id,block_index,text,checked,due,assignee,priority) VALUES(?,?,?,?,?,?,?)");
    ((state && state.notes) || []).forEach((note, index) => {
      const noteId = String(note.id);
      const position = note.order !== undefined ? note.order : note.position !== undefined ? note.position : index;
      insertNote.run([
        noteId,
        note.projectId || note.project_id || null,
        note.parentId || note.parent_id || null,
        note.title || "",
        note.content || "",
        note.trashed ? 1 : 0,
        position,
        note.updatedAt || note.updated_at || 0,
      ]);
      parseBlocks(note.content).forEach((block, blockIndex) => {
        insertBlock.run([noteId, blockIndex, block.blockId || "", block.type, block.text, block.html]);
        for (const task of parseTasks(block)) {
          insertTask.run([noteId, blockIndex, task.text, task.checked, task.due, task.assignee, task.priority]);
        }
      });
    });
    insertNote.free();
    insertBlock.free();
    insertTask.free();
  }

  getFileMtime() {
    try { return fs.statSync(this.dbPath).mtimeMs; } catch { return 0; }
  }

  /** True when the file on disk carries bytes we did not write ourselves. */
  hasExternalChange(lastSeen) {
    const seen = lastSeen === undefined ? this.lastKnownMtime : lastSeen;
    const mtime = this.getFileMtime();
    if (!mtime) return false;
    if (mtime === seen && mtime === this.lastKnownMtime) return false;
    let bytes;
    try { bytes = fs.readFileSync(this.dbPath); } catch { return false; }
    if (!bytes.length) return false;
    if (hashBytes(bytes) === this.lastKnownHash) {
      this.lastKnownMtime = mtime;
      return false;
    }
    return true;
  }

  /** Atomic write (tmp + rename) that records our own mtime/hash for the watcher. */
  async flush() {
    if (!this.db || !this.dbPath) return false;
    const bytes = Buffer.from(this.db.export());
    const tmpPath = this.dbPath + "." + process.pid + ".tmp";
    await fsp.mkdir(path.dirname(this.dbPath), { recursive: true });
    await fsp.writeFile(tmpPath, bytes);
    await fsp.rename(tmpPath, this.dbPath);
    this.lastKnownHash = hashBytes(bytes);
    this.lastKnownMtime = this.getFileMtime();
    return true;
  }

  async acquireLock() {
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    for (;;) {
      let handle;
      try {
        handle = await fsp.open(this.lockPath, "wx");
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        let stale = false;
        try {
          const stat = await fsp.stat(this.lockPath);
          stale = Date.now() - stat.mtimeMs > LOCK_STALE_MS;
        } catch { continue; }
        if (stale) {
          await fsp.unlink(this.lockPath).catch(() => {});
          continue;
        }
        if (Date.now() > deadline) throw new Error("저장소가 다른 프로세스에서 사용 중입니다: " + this.lockPath);
        await sleep(LOCK_RETRY_MS);
        continue;
      }
      try { await handle.writeFile(String(process.pid)); } finally { await handle.close(); }
      return;
    }
  }

  async releaseLock() {
    await fsp.unlink(this.lockPath).catch(() => {});
  }

  /** Every mutation runs here: lock, pick up foreign writes, mutate, flush. */
  async withWriteLock(mutate) {
    await this.acquireLock();
    try {
      if (this.hasExternalChange()) await this.reload();
      const result = await mutate();
      await this.flush();
      return result;
    } finally {
      await this.releaseLock();
    }
  }
}

/* -------------------------------------------------------------------- pending write application */

/** Rewrite a task item's attributes so the checkbox state matches `checked`. */
function withCheckedState(attrs, inner, checked) {
  const flag = checked ? "true" : "false";
  let nextAttrs = /data-checked\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i.test(attrs)
    ? attrs.replace(/data-checked\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, 'data-checked="' + flag + '"')
    : attrs + ' data-checked="' + flag + '"';
  if (!/data-type\s*=/i.test(nextAttrs)) nextAttrs = nextAttrs + ' data-type="taskItem"';
  const nextInner = inner.replace(/<input\b([^>]*)>/i, (_, inputAttrs) => {
    const cleaned = inputAttrs.replace(/\s+checked(=("[^"]*"|'[^']*'|[^\s>]+))?/i, "");
    return "<input" + cleaned + (checked ? " checked" : "") + ">";
  });
  return { attrs: nextAttrs, inner: nextInner };
}

/** Apply minimal block ops to note HTML. Shared by the diff preview and the approval. */
function applyBlockOps(content, ops) {
  const blocks = parseBlocks(content).map((block) => block.html);
  const ordered = (ops || []).slice().sort((a, b) => Number(b.blockIndex) - Number(a.blockIndex));
  for (const op of ordered) {
    const at = Number(op.blockIndex);
    if (!Number.isInteger(at)) throw new Error("blockIndex 는 정수여야 합니다: " + op.blockIndex);
    if (op.op === "insert_after") {
      if (at < -1 || at >= blocks.length) throw new Error("blockIndex 범위를 벗어났습니다: " + at);
      blocks.splice(at + 1, 0, markdownToHtml(op.markdown || ""));
      continue;
    }
    if (at < 0 || at >= blocks.length) throw new Error("blockIndex 범위를 벗어났습니다: " + at);
    if (op.op === "replace_block") blocks[at] = markdownToHtml(op.markdown || "");
    else if (op.op === "delete_block") blocks.splice(at, 1);
    else throw new Error("지원하지 않는 op 입니다: " + op.op);
  }
  return blocks.join("");
}

/** Toggle one task item, matched by its text (optionally narrowed to one block). */
function applyTaskUpdate(content, payload) {
  const blocks = parseBlocks(content).map((block) => block.html);
  const needle = String(payload.taskText || "").trim().toLowerCase();
  if (!needle) throw new Error("taskText 가 비어 있습니다.");
  const scope = Number.isInteger(payload.blockIndex) ? [payload.blockIndex] : blocks.map((_, index) => index);
  let hit = false;
  for (const at of scope) {
    if (at < 0 || at >= blocks.length) continue;
    blocks[at] = blocks[at].replace(/<li\b([^>]*)>([\s\S]*?)<\/li>/gi, (whole, attrs, inner) => {
      if (hit || plainText(inner).trim().toLowerCase() !== needle) return whole;
      hit = true;
      const next = withCheckedState(attrs, inner, payload.checked === true);
      return "<li" + next.attrs + ">" + next.inner + "</li>";
    });
    if (hit) break;
  }
  if (!hit) throw new Error("할 일을 찾지 못했습니다: " + payload.taskText);
  return blocks.join("");
}

/** The note content a pending write would produce, without touching the store. */
function previewPendingContent(store, tool, payload, note) {
  if (tool === "note_patch") return applyBlockOps(note.content, payload.ops || []);
  if (tool === "task_update") return applyTaskUpdate(note.content, payload);
  if (tool === "history_restore") {
    const revision = store.getRevision(payload.revisionId);
    if (!revision || String(revision.note_id) !== String(payload.noteId)) throw new Error("복원할 revision 을 찾지 못했습니다: " + payload.revisionId);
    return revision.content || "";
  }
  return note.content;
}

/** Produce the next app state for an approved write. Throws when the target vanished. */
function applyPendingOperation(store, state, record) {
  const payload = record.payload || {};
  const notes = (state.notes || []).slice();
  const now = Date.now();
  if (record.tool === "note_create") {
    if (!(state.projects || []).some((project) => String(project.id) === String(payload.projectId))) {
      throw new Error("프로젝트를 찾지 못했습니다: " + payload.projectId);
    }
    notes.push({
      id: payload.noteId || "note-" + now.toString(36) + "-" + crypto.randomBytes(3).toString("hex"),
      projectId: payload.projectId,
      parentId: payload.parentId || null,
      title: payload.title || "제목 없음",
      content: markdownToHtml(payload.markdown || ""),
      updatedAt: now,
      source: "mcp",
    });
    return Object.assign({}, state, { notes });
  }
  const index = notes.findIndex((note) => String(note.id) === String(payload.noteId));
  if (index < 0) throw new Error("노트를 찾지 못했습니다: " + payload.noteId);
  const note = Object.assign({}, notes[index], { updatedAt: now });
  if (record.tool === "note_move") {
    if (!(state.projects || []).some((project) => String(project.id) === String(payload.targetProjectId))) {
      throw new Error("프로젝트를 찾지 못했습니다: " + payload.targetProjectId);
    }
    note.projectId = payload.targetProjectId;
    note.parentId = payload.parentId === undefined ? note.parentId || null : payload.parentId || null;
  } else if (record.tool === "note_patch" || record.tool === "task_update" || record.tool === "history_restore") {
    note.content = previewPendingContent(store, record.tool, payload, notes[index]);
  } else {
    throw new Error("알 수 없는 쓰기 도구입니다: " + record.tool);
  }
  notes[index] = note;
  return Object.assign({}, state, { notes });
}

/**
 * Approve one queued write: snapshot the note into `revisions` (writeState does it),
 * apply the change to the state JSON and mark the queue row applied — all under one lock.
 */
async function applyPendingWrite(store, write) {
  const requested = typeof write === "string" ? { id: write } : write || {};
  if (!requested.id) throw new Error("변경 id 가 필요합니다.");
  return store.withWriteLock(() => {
    const record = store.getPendingWrite(requested.id);
    if (!record) throw new Error("승인 대기 중인 변경을 찾지 못했습니다: " + requested.id);
    if (record.status !== "pending") throw new Error("이미 처리된 변경입니다: " + record.status);
    const state = store.loadState();
    if (!state) throw new Error("저장된 노트 상태가 없습니다.");
    const next = applyPendingOperation(store, state, record);
    store.writeState(next);
    store.db.run("UPDATE pending_writes SET status='applied', resolved_at=?, error=NULL WHERE id=?", [Date.now(), record.id]);
    return { id: record.id, tool: record.tool, payload: record.payload, status: "applied" };
  });
}

async function openStore(dbPath) {
  return new KsNoteStore(dbPath).open();
}

module.exports = {
  KsNoteStore,
  openStore,
  parseBlocks,
  parseTasks,
  plainText,
  applyBlockOps,
  applyTaskUpdate,
  previewPendingContent,
  applyPendingWrite,
  SCHEMA_VERSION,
};
