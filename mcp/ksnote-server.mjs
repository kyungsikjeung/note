#!/usr/bin/env node
/**
 * KsNote MCP server — STDIO transport, hand-rolled JSON-RPC 2.0 (no extra npm deps).
 *
 *   node mcp/ksnote-server.mjs [--db <path to ksnote.db>] [--describe]
 *
 * Reads go straight against the SQLite store; writes are never applied here — they are
 * queued in `pending_writes` and must be approved inside the KsNote app.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const storeLib = require("../lib/ksnote-store.cjs");
const markdownLib = require("../lib/ksnote-markdown.cjs");

const { openStore, parseBlocks, applyBlockOps, applyTaskUpdate, previewPendingContent } = storeLib;
const { blocksToMarkdown, unifiedDiff, additionDiff } = markdownLib;

const SERVER_NAME = "ksnote";
const SERVER_VERSION = "0.1.0";
const PREFERRED_PROTOCOL = "2025-06-18";
const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;

const INSTRUCTIONS = [
  "KsNote 는 로컬 우선 노트 앱입니다. 이 서버는 사용자의 KsNote SQLite 저장소를 직접 읽고, 쓰기는 승인 큐에 넣습니다.",
  "",
  "읽기 순서 권장: workspace_get_context 로 현재 열려 있는 노트와 선택 영역을 먼저 확인하고,",
  "note_search 로 후보를 찾은 뒤 note_get 으로 본문을 가져옵니다. 긴 노트는 note_get 의 blockRange/heading 으로 필요한 부분만 읽으세요.",
  "note_get 의 format 은 markdown(요약·재작성용) · blocks(부분 수정용, blockIndex 확인) · html(원본) 중에서 고릅니다.",
  "",
  "쓰기 도구(note_create · note_patch · note_move · task_update · history_restore)는 노트를 직접 바꾸지 않습니다.",
  "호출하면 diff 와 함께 pending_writes 에 등록되고 status: pending_approval 을 돌려줍니다.",
  "사용자가 KsNote 앱의 'MCP 쓰기 요청' 배너에서 승인해야 실제로 반영되며, 승인 시점에 이전 내용이 revision 으로 보존됩니다.",
  "note_patch 와 history_restore 는 expected_revision 이 필요합니다. history_list 의 최신 revision id(없으면 0)를 넘기세요.",
  "값이 다르면 revision_conflict 오류가 돌아오니, 노트를 다시 읽고 새 revision 으로 재시도하세요.",
  "",
  "모든 목록 도구는 { items, total, nextOffset } 형태입니다. nextOffset 이 null 이면 마지막 페이지입니다.",
].join("\n");

/* ------------------------------------------------------------------ bootstrap */

function parseArgv(argv) {
  const options = { db: "", describe: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--db" || arg === "--database") options.db = argv[++index] || "";
    else if (arg.startsWith("--db=")) options.db = arg.slice(5);
    else if (arg === "--describe") options.describe = true;
  }
  return options;
}

function defaultDbPath() {
  const home = os.homedir();
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "ksnote", "ksnote.db");
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "ksnote", "ksnote.db");
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "ksnote", "ksnote.db");
}

function resolveDbPath(options) {
  const chosen = options.db || process.env.KSNOTE_DB || defaultDbPath();
  return path.resolve(chosen);
}

/** JSON-lines log next to the database (userData/logs) — stdout stays pure JSON-RPC. */
function createLogger(dbPath) {
  let logFile = null;
  for (const dir of [path.join(path.dirname(dbPath), "logs"), path.join(os.tmpdir(), "ksnote", "logs")]) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      logFile = path.join(dir, "mcp-server.log");
      break;
    } catch {}
  }
  const write = (entry) => {
    const line = JSON.stringify(Object.assign({ ts: new Date().toISOString(), pid: process.pid }, entry));
    process.stderr.write(line + "\n");
    if (logFile) {
      try { fs.appendFileSync(logFile, line + "\n"); } catch {}
    }
  };
  return {
    file: logFile,
    info: (event, detail) => write(Object.assign({ level: "info", event }, detail)),
    error: (event, detail) => write(Object.assign({ level: "error", event }, detail)),
  };
}

/* ------------------------------------------------------------------ tool helpers */

/** Tool failure carrying a machine-readable body (used for revision conflicts). */
class ToolFailure extends Error {
  constructor(body) {
    super(body && body.message ? body.message : body && body.code ? body.code : "tool_error");
    this.body = body;
  }
}

const clampLimit = (value) => {
  const limit = Number(value);
  if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
};

const clampOffset = (value) => {
  const offset = Number(value);
  if (!Number.isFinite(offset) || offset <= 0) return 0;
  return Math.floor(offset);
};

/** Every list tool answers with the same { items, total, nextOffset } shape. */
function paginate(rows, args) {
  const limit = clampLimit(args && args.limit);
  const offset = clampOffset(args && args.offset);
  const items = rows.slice(offset, offset + limit);
  const nextOffset = offset + items.length < rows.length ? offset + items.length : null;
  return { items, total: rows.length, nextOffset };
}

const requireString = (args, name) => {
  const value = args && args[name];
  if (typeof value !== "string" || !value.trim()) throw new ToolFailure({ code: "invalid_argument", message: name + " 는 필수 문자열입니다." });
  return value;
};

const HEADING_LEVEL = (type) => {
  const match = /^h([1-6])$/i.exec(String(type || ""));
  return match ? Number(match[1]) : 0;
};

const listSchema = (properties, required) => ({
  type: "object",
  properties: Object.assign(
    {
      limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT, description: "페이지 크기 (기본 20, 최대 200)" },
      offset: { type: "integer", minimum: 0, description: "건너뛸 항목 수 (nextOffset 을 그대로 넘기세요)" },
    },
    properties || {},
  ),
  required: required || [],
  additionalProperties: false,
});

const pageSchema = (itemSchema) => ({
  type: "object",
  properties: {
    items: { type: "array", items: itemSchema },
    total: { type: "integer" },
    nextOffset: { type: ["integer", "null"] },
  },
  required: ["items", "total", "nextOffset"],
});

const PENDING_RESULT_SCHEMA = {
  type: "object",
  properties: {
    status: { type: "string" },
    changeId: { type: "string" },
    tool: { type: "string" },
    summary: { type: "string" },
    diff: { type: "string" },
    approval: { type: "string" },
  },
  required: ["status", "changeId", "diff"],
};

const APPROVAL_NOTICE = "KsNote 앱 상단의 'MCP 쓰기 요청' 배너에서 사용자가 승인해야 노트에 반영됩니다. 승인 시 이전 내용은 revision 으로 보존됩니다.";

/* ------------------------------------------------------------------ shared state */

let store = null;
let log = null;

/** Pick up writes made by the Electron app (or another MCP process) before answering. */
async function refresh() {
  if (store && store.hasExternalChange()) await store.reload();
}

const noteSummary = (row) => ({
  noteId: row.id,
  title: row.title || "",
  projectId: row.project_id || null,
  parentId: row.parent_id || null,
  updatedAt: row.updated_at || 0,
});

function mustGetNote(noteId) {
  const note = store.getNote(noteId);
  if (!note) throw new ToolFailure({ code: "note_not_found", message: "노트를 찾지 못했습니다: " + noteId });
  return note;
}

/** Blocks selected by an explicit index range or by a heading section. */
function selectBlocks(blocks, args) {
  if (args && typeof args.heading === "string" && args.heading.trim()) {
    const needle = args.heading.trim().toLowerCase();
    const startIndex = blocks.findIndex((block) => HEADING_LEVEL(block.type) > 0 && String(block.text || "").trim().toLowerCase().includes(needle));
    if (startIndex < 0) throw new ToolFailure({ code: "heading_not_found", message: "제목을 찾지 못했습니다: " + args.heading });
    const level = HEADING_LEVEL(blocks[startIndex].type);
    let endIndex = blocks.length;
    for (let index = startIndex + 1; index < blocks.length; index += 1) {
      const candidate = HEADING_LEVEL(blocks[index].type);
      if (candidate > 0 && candidate <= level) {
        endIndex = index;
        break;
      }
    }
    return { blocks: blocks.slice(startIndex, endIndex), start: startIndex, end: endIndex };
  }
  if (args && args.blockRange && typeof args.blockRange === "object") {
    const start = clampOffset(args.blockRange.start);
    const end = Number.isFinite(Number(args.blockRange.end)) ? Math.max(start, Math.floor(Number(args.blockRange.end))) : blocks.length;
    return { blocks: blocks.slice(start, end), start, end: Math.min(end, blocks.length) };
  }
  return { blocks, start: 0, end: blocks.length };
}

/* ------------------------------------------------------------------ read tools */

const READ_TOOLS = [
  {
    name: "workspace_get_context",
    title: "현재 작업 맥락",
    description: "KsNote 에서 지금 열려 있는 노트와 선택 영역, 워크스페이스 규모, 최근 노트 10건을 돌려준다. 다른 도구를 쓰기 전에 먼저 호출해 사용자가 보고 있는 문서를 파악하는 용도.",
    readOnly: true,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: {
      type: "object",
      properties: {
        workspace: {
          type: "object",
          properties: { projectCount: { type: "integer" }, noteCount: { type: "integer" }, openTaskCount: { type: "integer" } },
          required: ["projectCount", "noteCount", "openTaskCount"],
        },
        currentContext: { type: ["object", "null"] },
        recentNotes: { type: "array" },
      },
      required: ["workspace", "recentNotes"],
    },
    async run() {
      await refresh();
      const projects = store.listProjects();
      const notes = store.listNotes({});
      const openTasks = store.queryTasks({ checked: false });
      let currentContext = null;
      const raw = store.getMeta("current_context");
      if (raw) {
        try { currentContext = JSON.parse(raw); } catch { currentContext = null; }
      }
      const recentNotes = notes
        .slice()
        .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
        .slice(0, 10)
        .map(noteSummary);
      return {
        workspace: { projectCount: projects.length, noteCount: notes.length, openTaskCount: openTasks.length },
        currentContext,
        recentNotes,
      };
    },
  },
  {
    name: "project_list",
    title: "프로젝트 목록",
    description: "프로젝트(노트 폴더) 목록과 각 프로젝트의 노트 수를 페이지 단위로 돌려준다. note_search 나 note_create 에 넘길 projectId 를 찾을 때 사용.",
    readOnly: true,
    inputSchema: listSchema({}),
    outputSchema: pageSchema({ type: "object" }),
    async run(args) {
      await refresh();
      const notes = store.listNotes({});
      const counts = new Map();
      for (const note of notes) counts.set(note.project_id, (counts.get(note.project_id) || 0) + 1);
      const rows = store.listProjects().map((project) => ({
        projectId: project.id,
        name: project.name || "",
        noteCount: counts.get(project.id) || 0,
      }));
      return paginate(rows, args);
    },
  },
  {
    name: "note_search",
    title: "노트 검색",
    description: "제목과 본문을 대소문자 구분 없이 검색해 score 순으로 돌려준다. 각 항목에 snippet 이 있으므로 본문 전체를 읽기 전에 후보를 좁히는 용도로 먼저 쓴다.",
    readOnly: true,
    inputSchema: listSchema({
      query: { type: "string", description: "검색어 (제목 일치는 가중치 3배)" },
      projectId: { type: "string", description: "특정 프로젝트로 한정" },
    }, ["query"]),
    outputSchema: pageSchema({ type: "object" }),
    async run(args) {
      await refresh();
      const query = requireString(args, "query");
      const rows = store.searchNotes(query, { projectId: args.projectId, limit: 1000, offset: 0 }).map((row) => ({
        noteId: row.id,
        title: row.title || "",
        projectId: row.projectId || null,
        score: row.score,
        snippet: row.snippet,
        updatedAt: row.updatedAt || 0,
      }));
      return paginate(rows, args);
    },
  },
  {
    name: "task_query",
    title: "할 일 조회",
    description: "노트 안의 체크리스트 항목을 프로젝트·노트·완료여부로 걸러 돌려준다. 미완료 할 일 정리나 주간 리포트 작성에 사용하고, 반환되는 text 를 task_update 의 taskText 로 그대로 넘길 수 있다.",
    readOnly: true,
    inputSchema: listSchema({
      projectId: { type: "string" },
      noteId: { type: "string" },
      checked: { type: "boolean", description: "true 면 완료 항목만, false 면 미완료만" },
    }),
    outputSchema: pageSchema({ type: "object" }),
    async run(args) {
      await refresh();
      const rows = store
        .queryTasks({ projectId: args.projectId, noteId: args.noteId, checked: typeof args.checked === "boolean" ? args.checked : undefined })
        .map((row) => ({
          noteId: row.note_id,
          noteTitle: row.note_title || "",
          projectId: row.project_id || null,
          blockIndex: row.block_index,
          text: row.text,
          checked: !!row.checked,
          due: row.due || "",
          assignee: row.assignee || "",
          priority: row.priority || "",
        }));
      return paginate(rows, args);
    },
  },
  {
    name: "note_get",
    title: "노트 읽기",
    description: "노트 본문을 html · markdown · blocks 중 한 형식으로 읽는다. 긴 노트는 blockRange 나 heading 으로 필요한 구간만 읽는다. note_patch 에 넘길 blockIndex 는 format 을 blocks 로 두고 확인한다. 응답의 revision 은 그대로 expected_revision 으로 쓸 수 있다.",
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        noteId: { type: "string" },
        format: { type: "string", enum: ["html", "markdown", "blocks"], description: "기본 markdown" },
        blockRange: {
          type: "object",
          properties: { start: { type: "integer", minimum: 0 }, end: { type: "integer", minimum: 0 } },
          description: "start 포함, end 제외의 블록 인덱스 구간",
          additionalProperties: false,
        },
        heading: { type: "string", description: "이 제목이 있는 섹션만 읽는다(같거나 상위 레벨의 다음 제목 전까지)" },
      },
      required: ["noteId"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        noteId: { type: "string" },
        title: { type: "string" },
        projectId: { type: ["string", "null"] },
        format: { type: "string" },
        revision: { type: "integer" },
        blockCount: { type: "integer" },
        range: { type: "object" },
        content: { type: "string" },
        blocks: { type: "array" },
      },
      required: ["noteId", "title", "format", "revision"],
    },
    async run(args) {
      await refresh();
      const noteId = requireString(args, "noteId");
      const note = mustGetNote(noteId);
      const format = args.format || "markdown";
      const allBlocks = store.listBlocks(noteId);
      const selection = selectBlocks(allBlocks, args);
      const result = {
        noteId: note.id,
        title: note.title || "",
        projectId: note.project_id || null,
        parentId: note.parent_id || null,
        updatedAt: note.updated_at || 0,
        trashed: !!note.trashed,
        format,
        revision: store.currentRevision(noteId),
        blockCount: allBlocks.length,
        range: { start: selection.start, end: selection.end },
      };
      if (format === "blocks") {
        result.blocks = selection.blocks.map((block) => ({
          blockIndex: block.block_index,
          blockId: block.block_id || "",
          type: block.type,
          text: block.text,
          html: block.html,
        }));
        return result;
      }
      if (format === "html") {
        result.content = selection.blocks.length === allBlocks.length ? note.content || "" : selection.blocks.map((block) => block.html).join("");
        return result;
      }
      result.content = blocksToMarkdown(selection.blocks);
      return result;
    },
  },
  {
    name: "asset_get",
    title: "첨부파일 조회",
    description: "첨부파일(이미지 등)의 메타데이터와 실제 파일 경로를 돌려준다. exists 가 false 면 파일이 사라진 상태이므로 사용자에게 알린다.",
    readOnly: true,
    inputSchema: { type: "object", properties: { assetId: { type: "string" } }, required: ["assetId"], additionalProperties: false },
    outputSchema: {
      type: "object",
      properties: { assetId: { type: "string" }, name: { type: "string" }, path: { type: "string" }, exists: { type: "boolean" }, createdAt: { type: "integer" } },
      required: ["assetId", "path", "exists"],
    },
    async run(args) {
      await refresh();
      const assetId = requireString(args, "assetId");
      const asset = store.getAsset(assetId);
      if (!asset) throw new ToolFailure({ code: "asset_not_found", message: "첨부파일을 찾지 못했습니다: " + assetId });
      const absolute = asset.path ? path.resolve(asset.path) : "";
      return {
        assetId: asset.id,
        name: asset.name || "",
        path: absolute,
        exists: absolute ? fs.existsSync(absolute) : false,
        createdAt: asset.created_at || 0,
      };
    },
  },
  {
    name: "history_list",
    title: "변경 이력",
    description: "노트의 revision 목록을 최신순으로 돌려준다. currentRevision 이 note_patch · history_restore 의 expected_revision 값이며, 이력이 없으면 0 이다.",
    readOnly: true,
    inputSchema: listSchema({ noteId: { type: "string" } }, ["noteId"]),
    outputSchema: pageSchema({ type: "object" }),
    async run(args) {
      await refresh();
      const noteId = requireString(args, "noteId");
      mustGetNote(noteId);
      const rows = store.listRevisions(noteId, { limit: 1000, offset: 0 }).map((row) => ({
        revisionId: row.id,
        noteId: row.note_id,
        title: row.title || "",
        createdAt: row.created_at || 0,
      }));
      const page = paginate(rows, args);
      page.currentRevision = store.currentRevision(noteId);
      return page;
    },
  },
];

/* ------------------------------------------------------------------ write tools (approval gated) */

/** Optimistic concurrency: the caller must have seen the note at its latest revision. */
function assertRevision(noteId, expected) {
  const current = store.currentRevision(noteId);
  const wanted = expected === null || expected === undefined || expected === "" ? NaN : Number(expected);
  if (!Number.isFinite(wanted)) {
    throw new ToolFailure({
      code: "expected_revision_required",
      message: "expected_revision 이 필요합니다. history_list 의 currentRevision (이력이 없으면 0) 을 넘기세요.",
      currentRevision: current,
    });
  }
  if (wanted !== current) {
    throw new ToolFailure({
      code: "revision_conflict",
      message: "노트가 그 사이에 변경되어 요청을 큐에 넣지 않았습니다.",
      expectedRevision: wanted,
      currentRevision: current,
      hint: "note_get 으로 최신 내용을 다시 읽고 history_list 의 currentRevision 으로 재시도하세요.",
    });
  }
  return current;
}

const noteMarkdown = (noteId) => blocksToMarkdown(store.listBlocks(noteId));
const htmlMarkdown = (html) => blocksToMarkdown(parseBlocks(html));

/** Turn store-level validation errors into tool errors instead of crashing the server. */
function guard(action) {
  try {
    return action();
  } catch (error) {
    if (error instanceof ToolFailure) throw error;
    throw new ToolFailure({ code: "invalid_argument", message: error.message });
  }
}

async function queueWrite(tool, payload, diff, summary) {
  const pending = await store.enqueuePendingWrite({ tool, payload: Object.assign({ summary }, payload), diff });
  log.info("write_queued", { tool, changeId: pending.id });
  return { status: "pending_approval", changeId: pending.id, tool, summary, diff, approval: APPROVAL_NOTICE };
}

const writeAnnotations = (destructive) => ({
  readOnlyHint: false,
  destructiveHint: !!destructive,
  idempotentHint: false,
  openWorldHint: false,
});

const WRITE_TOOLS = [
  {
    name: "note_create",
    title: "노트 생성 요청",
    description: "새 노트 생성을 승인 큐에 넣는다. 사용 시점: 사용자가 새 문서를 만들어 달라고 했을 때. 선행 조건: project_list 로 확인한 projectId. 부작용: 승인 시 프로젝트에 노트가 추가된다. 승인 조건: KsNote 앱에서 사용자가 diff 를 보고 승인해야 반영된다.",
    readOnly: false,
    destructive: false,
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        title: { type: "string" },
        markdown: { type: "string", description: "본문 마크다운 (제목·목록·표·코드펜스 지원)" },
        parentId: { type: "string", description: "하위 노트로 만들 때 상위 노트 id" },
      },
      required: ["projectId", "title"],
      additionalProperties: false,
    },
    outputSchema: PENDING_RESULT_SCHEMA,
    async run(args) {
      await refresh();
      const projectId = requireString(args, "projectId");
      const title = requireString(args, "title");
      const project = store.getProject(projectId);
      if (!project) throw new ToolFailure({ code: "project_not_found", message: "프로젝트를 찾지 못했습니다: " + projectId });
      if (args.parentId && !store.getNote(args.parentId)) throw new ToolFailure({ code: "note_not_found", message: "상위 노트를 찾지 못했습니다: " + args.parentId });
      const markdown = typeof args.markdown === "string" ? args.markdown : "";
      const noteId = "note-" + Date.now().toString(36) + "-" + Math.random().toString(16).slice(2, 8);
      const diff = additionDiff(markdown, { to: title });
      return queueWrite(
        "note_create",
        { projectId, title, markdown, parentId: args.parentId || null, noteId },
        diff,
        "새 노트 추가: " + title + " (" + (project.name || projectId) + ")",
      );
    },
  },
  {
    name: "note_patch",
    title: "노트 부분 수정 요청",
    description: "블록 단위 수정(replace_block · insert_after · delete_block)을 승인 큐에 넣는다. 사용 시점: 노트의 일부만 고칠 때. 선행 조건: note_get(format blocks)으로 blockIndex 를, history_list 로 expected_revision 을 확인해야 한다. 부작용: 승인 시 해당 블록이 교체·삽입·삭제되고 이전 내용은 revision 으로 보존된다. 승인 조건: 사용자가 KsNote 에서 diff 를 승인해야 반영된다.",
    readOnly: false,
    destructive: true,
    inputSchema: {
      type: "object",
      properties: {
        noteId: { type: "string" },
        expected_revision: { type: "integer", description: "history_list 의 currentRevision (이력이 없으면 0)" },
        ops: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              op: { type: "string", enum: ["replace_block", "insert_after", "delete_block"] },
              blockIndex: { type: "integer", description: "note_get(format blocks) 의 blockIndex. insert_after 는 -1 로 맨 앞 삽입" },
              markdown: { type: "string", description: "replace_block · insert_after 에서 새 블록의 마크다운" },
            },
            required: ["op", "blockIndex"],
            additionalProperties: false,
          },
        },
      },
      required: ["noteId", "expected_revision", "ops"],
      additionalProperties: false,
    },
    outputSchema: PENDING_RESULT_SCHEMA,
    async run(args) {
      await refresh();
      const noteId = requireString(args, "noteId");
      const note = mustGetNote(noteId);
      assertRevision(noteId, args.expected_revision);
      if (!Array.isArray(args.ops) || !args.ops.length) throw new ToolFailure({ code: "invalid_argument", message: "ops 는 비어 있을 수 없습니다." });
      const nextHtml = guard(() => applyBlockOps(note.content, args.ops));
      const diff = unifiedDiff(noteMarkdown(noteId), htmlMarkdown(nextHtml), { from: note.title || noteId, to: note.title || noteId });
      return queueWrite(
        "note_patch",
        { noteId, ops: args.ops, expectedRevision: Number(args.expected_revision) },
        diff,
        "노트 수정: " + (note.title || noteId) + " (" + args.ops.length + "개 블록 작업)",
      );
    },
  },
  {
    name: "note_move",
    title: "노트 이동 요청",
    description: "노트를 다른 프로젝트(또는 다른 상위 노트) 아래로 옮기는 요청을 승인 큐에 넣는다. 사용 시점: 문서 정리·재분류. 선행 조건: project_list 로 targetProjectId 확인. 부작용: 승인 시 노트의 소속 프로젝트가 바뀐다(본문은 그대로). 승인 조건: 사용자가 KsNote 에서 승인해야 반영된다.",
    readOnly: false,
    destructive: false,
    inputSchema: {
      type: "object",
      properties: {
        noteId: { type: "string" },
        targetProjectId: { type: "string" },
        parentId: { type: ["string", "null"], description: "상위 노트 id (최상위로 옮기려면 null)" },
      },
      required: ["noteId", "targetProjectId"],
      additionalProperties: false,
    },
    outputSchema: PENDING_RESULT_SCHEMA,
    async run(args) {
      await refresh();
      const noteId = requireString(args, "noteId");
      const targetProjectId = requireString(args, "targetProjectId");
      const note = mustGetNote(noteId);
      const target = store.getProject(targetProjectId);
      if (!target) throw new ToolFailure({ code: "project_not_found", message: "프로젝트를 찾지 못했습니다: " + targetProjectId });
      const source = store.getProject(note.project_id);
      const before = ["프로젝트: " + ((source && source.name) || note.project_id || "(없음)"), "상위 노트: " + (note.parent_id || "(없음)")].join("\n");
      const after = ["프로젝트: " + (target.name || targetProjectId), "상위 노트: " + (args.parentId || "(없음)")].join("\n");
      return queueWrite(
        "note_move",
        { noteId, targetProjectId, parentId: args.parentId === undefined ? null : args.parentId },
        unifiedDiff(before, after, { from: note.title || noteId, to: note.title || noteId }),
        "노트 이동: " + (note.title || noteId) + " → " + (target.name || targetProjectId),
      );
    },
  },
  {
    name: "task_update",
    title: "할 일 상태 변경 요청",
    description: "노트 안 체크리스트 항목의 완료 여부 변경을 승인 큐에 넣는다. 사용 시점: 사용자가 할 일을 완료/미완료로 바꿔 달라고 할 때. 선행 조건: task_query 로 taskText(가능하면 blockIndex 도) 확인. 부작용: 승인 시 해당 항목의 체크 상태만 바뀐다. 승인 조건: 사용자가 KsNote 에서 승인해야 반영된다.",
    readOnly: false,
    destructive: false,
    inputSchema: {
      type: "object",
      properties: {
        noteId: { type: "string" },
        blockIndex: { type: "integer", description: "같은 문구가 여러 번 나올 때 대상을 좁히는 블록 인덱스" },
        taskText: { type: "string", description: "task_query 가 돌려준 text 와 정확히 같은 문구" },
        checked: { type: "boolean" },
      },
      required: ["noteId", "taskText", "checked"],
      additionalProperties: false,
    },
    outputSchema: PENDING_RESULT_SCHEMA,
    async run(args) {
      await refresh();
      const noteId = requireString(args, "noteId");
      const taskText = requireString(args, "taskText");
      const note = mustGetNote(noteId);
      if (typeof args.checked !== "boolean") throw new ToolFailure({ code: "invalid_argument", message: "checked 는 boolean 이어야 합니다." });
      const payload = { noteId, taskText, checked: args.checked, blockIndex: Number.isInteger(args.blockIndex) ? args.blockIndex : undefined };
      const nextHtml = guard(() => applyTaskUpdate(note.content, payload));
      const diff = unifiedDiff(noteMarkdown(noteId), htmlMarkdown(nextHtml), { from: note.title || noteId, to: note.title || noteId });
      return queueWrite("task_update", payload, diff, "할 일 " + (args.checked ? "완료" : "미완료") + ": " + taskText);
    },
  },
  {
    name: "history_restore",
    title: "이전 버전 복원 요청",
    description: "노트를 지정한 revision 의 내용으로 되돌리는 요청을 승인 큐에 넣는다. 사용 시점: 잘못된 편집을 되돌릴 때. 선행 조건: history_list 로 revisionId 와 expected_revision(currentRevision) 확인. 부작용: 승인 시 본문 전체가 그 시점 내용으로 교체되고, 교체 직전 내용이 다시 revision 으로 남는다. 승인 조건: 사용자가 KsNote 에서 승인해야 반영된다.",
    readOnly: false,
    destructive: true,
    inputSchema: {
      type: "object",
      properties: {
        noteId: { type: "string" },
        revisionId: { type: "integer" },
        expected_revision: { type: "integer", description: "history_list 의 currentRevision" },
      },
      required: ["noteId", "revisionId", "expected_revision"],
      additionalProperties: false,
    },
    outputSchema: PENDING_RESULT_SCHEMA,
    async run(args) {
      await refresh();
      const noteId = requireString(args, "noteId");
      const note = mustGetNote(noteId);
      assertRevision(noteId, args.expected_revision);
      const revision = store.getRevision(args.revisionId);
      if (!revision || String(revision.note_id) !== String(noteId)) {
        throw new ToolFailure({ code: "revision_not_found", message: "이 노트의 revision 이 아닙니다: " + args.revisionId });
      }
      const nextHtml = guard(() => previewPendingContent(store, "history_restore", { noteId, revisionId: args.revisionId }, note));
      const diff = unifiedDiff(noteMarkdown(noteId), htmlMarkdown(nextHtml), { from: "현재", to: "revision " + args.revisionId });
      return queueWrite(
        "history_restore",
        { noteId, revisionId: Number(args.revisionId), expectedRevision: Number(args.expected_revision) },
        diff,
        "이전 버전 복원: " + (note.title || noteId) + " → revision " + args.revisionId,
      );
    },
  },
];

const TOOLS = READ_TOOLS.concat(WRITE_TOOLS);
const TOOL_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

/* ------------------------------------------------------------------ JSON-RPC plumbing */

const toolDescriptor = (tool) => ({
  name: tool.name,
  title: tool.title,
  description: tool.description,
  inputSchema: tool.inputSchema,
  outputSchema: tool.outputSchema,
  annotations: tool.readOnly
    ? { title: tool.title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    : Object.assign({ title: tool.title }, writeAnnotations(tool.destructive)),
});

const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");
const respond = (id, result) => send({ jsonrpc: "2.0", id, result });
const respondError = (id, code, message, data) => send({ jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } });

const failureResult = (body) => ({
  content: [{ type: "text", text: JSON.stringify(body, null, 2) }],
  isError: true,
});

async function callTool(params) {
  const name = params && params.name;
  const tool = TOOL_BY_NAME.get(name);
  if (!tool) return failureResult({ code: "unknown_tool", message: "알 수 없는 도구입니다: " + name });
  const started = Date.now();
  try {
    const structured = await tool.run((params && params.arguments) || {});
    log.info("tool_call", { tool: name, ms: Date.now() - started });
    return { content: [{ type: "text", text: JSON.stringify(structured, null, 2) }], structuredContent: structured };
  } catch (error) {
    const body = error instanceof ToolFailure ? error.body : { code: "internal_error", message: error.message };
    log.error("tool_failed", { tool: name, ms: Date.now() - started, code: body.code, message: body.message, stack: error.stack });
    return failureResult(body);
  }
}

async function handleMessage(message) {
  const id = message.id;
  const method = message.method;
  const isRequest = id !== undefined && id !== null;
  if (method === "initialize") {
    const requested = (message.params && message.params.protocolVersion) || PREFERRED_PROTOCOL;
    const protocolVersion = SUPPORTED_PROTOCOLS.includes(requested) ? requested : PREFERRED_PROTOCOL;
    log.info("initialize", { protocolVersion, client: (message.params && message.params.clientInfo) || null });
    respond(id, {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: SERVER_NAME, title: "KsNote", version: SERVER_VERSION },
      instructions: INSTRUCTIONS,
    });
    return;
  }
  if (!isRequest) {
    log.info("notification", { method });
    return;
  }
  if (method === "ping") {
    respond(id, {});
    return;
  }
  if (method === "tools/list") {
    respond(id, { tools: TOOLS.map(toolDescriptor) });
    return;
  }
  if (method === "tools/call") {
    respond(id, await callTool(message.params || {}));
    return;
  }
  log.error("unknown_method", { method });
  respondError(id, -32601, "지원하지 않는 메서드입니다: " + method);
}

async function handleLine(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    log.error("parse_error", { message: error.message, line: line.slice(0, 200) });
    respondError(null, -32700, "JSON 파싱에 실패했습니다.");
    return;
  }
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    respondError(null, -32600, "지원하지 않는 요청 형식입니다.");
    return;
  }
  const started = Date.now();
  try {
    await handleMessage(message);
    log.info("request", { method: message.method, ms: Date.now() - started });
  } catch (error) {
    log.error("request_failed", { method: message.method, message: error.message, stack: error.stack });
    if (message.id !== undefined && message.id !== null) respondError(message.id, -32603, error.message);
  }
}

/* ------------------------------------------------------------------ entry point */

const describeDocument = (dbPath, logFile) => ({
  name: SERVER_NAME,
  version: SERVER_VERSION,
  protocolVersion: PREFERRED_PROTOCOL,
  serverPath: fileURLToPath(import.meta.url),
  dbPath,
  logFile,
  tools: TOOLS.map((tool) => ({ name: tool.name, title: tool.title, description: tool.description, readOnly: !!tool.readOnly })),
});

async function main() {
  const options = parseArgv(process.argv.slice(2));
  const dbPath = resolveDbPath(options);
  log = createLogger(dbPath);
  if (options.describe) {
    process.stdout.write(JSON.stringify(describeDocument(dbPath, log.file), null, 2) + "\n");
    return;
  }
  try {
    store = await openStore(dbPath);
  } catch (error) {
    log.error("store_open_failed", { dbPath, message: error.message, stack: error.stack });
    process.exitCode = 1;
    return;
  }
  log.info("server_started", { dbPath, logFile: log.file, tools: TOOLS.length, node: process.version });

  let queue = Promise.resolve();
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) queue = queue.then(() => handleLine(line)).catch((error) => log.error("dispatch_failed", { message: error.message, stack: error.stack }));
      index = buffer.indexOf("\n");
    }
  });
  process.stdin.on("end", () => {
    log.info("server_stopped", {});
    try { store.close(); } catch {}
    process.exit(0);
  });
  process.on("uncaughtException", (error) => log.error("uncaught_exception", { message: error.message, stack: error.stack }));
  process.on("unhandledRejection", (error) => log.error("unhandled_rejection", { message: String(error && error.message ? error.message : error) }));
}

main().catch((error) => {
  const line = JSON.stringify({ ts: new Date().toISOString(), level: "error", event: "fatal", message: error.message, stack: error.stack });
  process.stderr.write(line + "\n");
  process.exitCode = 1;
});
