#!/usr/bin/env node
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import initSqlJs from "sql.js";
import * as z from "zod/v4";
import { validateDiagramSource } from "./diagram-validation.mjs";
import { buildHistoryList, resolveRestoreSnapshot } from "./history.mjs";
import { findBlockById, findDiagramBlock, findHeadingSection, listTaskItems, sliceTextLines } from "./note-html.mjs";
import { isIndexFresh, queryTaskIndex } from "./task-index.mjs";
import { searchNotes } from "./note-search.mjs";
import { operationRetryAdvice } from "./operation-retry.mjs";
import { parseKsNoteTargetRef } from "./target-ref.mjs";
import {
  contentRevision,
  isRevisionConflict,
  noteRevision,
  resolveGuardedRevision,
} from "./revision.mjs";
import { readAssetRows } from "../electron/asset-repository.cjs";

const require = createRequire(import.meta.url);
const OPERATION_TTL_MS = 5 * 60 * 1000;
const HEARTBEAT_STALE_MS = 15 * 1000;

const plainText = (value) =>
  String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .trim();

const jsonText = (value) => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  structuredContent: value,
});

const encodingDamage = (value) => {
  const text = String(value || "");
  if (!text) return null;
  if (text.includes("\ufffd"))
    return {
      code: "encoding_suspect",
      message: "텍스트에 유니코드 대체 문자(�)가 포함되어 있어 삽입을 중단했습니다.",
    };
  const questionRuns = text.match(/\?{2,}/g) || [];
  const questionCount = questionRuns.reduce((sum, item) => sum + item.length, 0);
  const visibleLength = text.replace(/\s/g, "").length || 1;
  const hasMarkdownStructure = /(^|\n)\s{0,3}(#{1,6}\s|\d+\.\s|-\s)/.test(text);
  if (
    text.length >= 30 &&
    questionRuns.length >= 3 &&
    questionCount / visibleLength > 0.12 &&
    hasMarkdownStructure
  )
    return {
      code: "encoding_suspect",
      message: "텍스트가 인코딩 손상으로 깨진 것처럼 보여 삽입을 중단했습니다. UTF-8 파일 또는 정상 MCP tool 호출로 다시 보내세요.",
    };
  return null;
};

const candidateUserDataDirs = () => {
  const candidates = [];
  if (process.env.KSNOTE_USER_DATA)
    candidates.push(process.env.KSNOTE_USER_DATA);
  if (process.env.KSNOTE_DB_PATH)
    candidates.push(path.dirname(process.env.KSNOTE_DB_PATH));
  if (process.platform === "win32") {
    for (const base of [process.env.APPDATA, process.env.LOCALAPPDATA]) {
      if (!base) continue;
      candidates.push(path.join(base, "ksnote"));
      candidates.push(path.join(base, "KsNote"));
    }
  } else {
    const home = process.env.HOME || "";
    candidates.push(path.join(home, ".config", "ksnote"));
    candidates.push(path.join(home, ".config", "KsNote"));
  }
  return [...new Set(candidates.filter(Boolean))];
};

const resolvePaths = async () => {
  if (process.env.KSNOTE_DB_PATH) {
    const userData = path.dirname(process.env.KSNOTE_DB_PATH);
    return {
      userData,
      dbPath: process.env.KSNOTE_DB_PATH,
      mcpDir: path.join(userData, "mcp"),
      operationsDir: path.join(userData, "mcp", "operations"),
      targetPath: path.join(userData, "mcp", "current-target.json"),
      heartbeatPath: path.join(userData, "mcp", "heartbeat.json"),
    };
  }
  for (const userData of candidateUserDataDirs()) {
    const dbPath = path.join(userData, "ksnote.db");
    try {
      await fs.access(dbPath);
      return {
        userData,
        dbPath,
        mcpDir: path.join(userData, "mcp"),
        operationsDir: path.join(userData, "mcp", "operations"),
        targetPath: path.join(userData, "mcp", "current-target.json"),
        heartbeatPath: path.join(userData, "mcp", "heartbeat.json"),
      };
    } catch {}
  }
  const fallback = candidateUserDataDirs()[0] || process.cwd();
  return {
    userData: fallback,
    dbPath: path.join(fallback, "ksnote.db"),
    mcpDir: path.join(fallback, "mcp"),
    operationsDir: path.join(fallback, "mcp", "operations"),
    targetPath: path.join(fallback, "mcp", "current-target.json"),
    heartbeatPath: path.join(fallback, "mcp", "heartbeat.json"),
  };
};

let sqlModule;
const getSql = async () => {
  if (!sqlModule) {
    sqlModule = await initSqlJs({
      locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm"),
    });
  }
  return sqlModule;
};

const loadState = async () => {
  const paths = await resolvePaths();
  const SQL = await getSql();
  let bytes;
  try {
    bytes = await fs.readFile(paths.dbPath);
  } catch {
    return { paths, data: { projects: [], notes: [] }, updatedAt: 0 };
  }
  const db = new SQL.Database(bytes);
  try {
    const result = db.exec("SELECT json, updated_at FROM app_state WHERE id=1");
    const row = result[0]?.values?.[0];
    return {
      paths,
      data: row?.[0] ? JSON.parse(row[0]) : { projects: [], notes: [] },
      updatedAt: row?.[1] || 0,
    };
  } finally {
    db.close();
  }
};

const readAssetIndex = async (paths) => {
  try {
    const SQL = await getSql();
    const bytes = await fs.readFile(paths.dbPath);
    const db = new SQL.Database(bytes);
    try {
      return readAssetRows(db);
    } finally {
      db.close();
    }
  } catch {
    return { indexed: false, rows: [] };
  }
};

const readCurrentTarget = async () => {
  const paths = await resolvePaths();
  try {
    return JSON.parse(await fs.readFile(paths.targetPath, "utf8"));
  } catch {
    return null;
  }
};

const readHeartbeat = async () => {
  const paths = await resolvePaths();
  try {
    const heartbeat = JSON.parse(await fs.readFile(paths.heartbeatPath, "utf8"));
    const ageMs = Date.now() - (heartbeat.updatedAt || 0);
    return {
      ...heartbeat,
      ageMs,
      stale: ageMs > HEARTBEAT_STALE_MS,
    };
  } catch {
    return {
      appOpen: false,
      stale: true,
      ageMs: null,
    };
  }
};

const workspaceIdForPaths = (paths) => {
  const override = String(process.env.KSNOTE_WORKSPACE_ID || "").trim();
  if (override) return override;
  return path.basename(paths?.userData || "") || "ksnote";
};

const workspaceMismatch = (parsed, paths) => {
  const serving = workspaceIdForPaths(paths);
  if (parsed?.workspaceId && parsed.workspaceId !== serving)
    return {
      ok: false,
      code: "workspace_mismatch",
      message: `targetRef의 작업공간(${parsed.workspaceId})이 현재 MCP 작업공간(${serving})과 다릅니다. 해당 작업공간의 KSNOTE_DB_PATH로 MCP를 실행하거나 workspace 없는 ref를 사용하세요.`,
      refWorkspaceId: parsed.workspaceId,
      servingWorkspaceId: serving,
    };
  return null;
};

const getTarget = async (targetRef) => {
  const parsed = parseKsNoteTargetRef(targetRef);
  const current = await readCurrentTarget();
  if (parsed) {
    const hasSelection =
      Number.isFinite(parsed.from) &&
      Number.isFinite(parsed.to) &&
      parsed.from !== parsed.to;
    return {
      ...parsed,
      noteId: parsed.pageId,
      targetRef,
      operation: parsed.operation || (hasSelection ? "replace-selection" : parsed.blockId ? "insert" : "append"),
    };
  }
  return {
    ...(current || {}),
    noteId: current?.noteId || current?.pageId,
    targetRef: current?.targetRef || "",
  };
};

const noteById = (data, id) => data.notes.find((note) => note.id === id);

const notePayload = (data, note, target = {}, workspaceId) => {
  const project = data.projects.find((item) => item.id === note.projectId);
  return {
    id: note.id,
    title: note.title,
    projectId: note.projectId,
    projectName: project?.name || note.projectId,
    content: note.content || "",
    text: plainText(note.content),
    revision: noteRevision(note),
    workspaceId,
    target: {
      targetRef:
        target.targetRef ||
        `ksnote://page/${note.id}${workspaceId ? `?workspace=${encodeURIComponent(workspaceId)}` : ""}`,
      workspaceId: target.workspaceId || workspaceId,
      blockId: target.blockId,
      offset: target.offset,
      toBlockId: target.toBlockId,
      toOffset: target.toOffset,
      from: target.from,
      to: target.to,
      operation:
        target.operation || (target.from !== target.to ? "replace-selection" : "insert"),
      selectedText: target.text || "",
    },
  };
};

const queueOperation = async (operation) => {
  const paths = await resolvePaths();
  await fs.mkdir(paths.operationsDir, { recursive: true });
  const id = `mcp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const filePath = path.join(paths.operationsDir, `${id}.json`);
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const payload = {
    id,
    status: "pending",
    approvalRequired: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    expiresAt: Date.now() + OPERATION_TTL_MS,
    ...operation,
  };
  await fs.writeFile(tempPath, JSON.stringify(payload, null, 2), "utf8");
  await fs.rename(tempPath, filePath);
  return payload;
};

const readOperation = async (id) => {
  const paths = await resolvePaths();
  const safeId = String(id || "").replace(/[^a-zA-Z0-9_.-]/g, "");
  if (!safeId) return null;
  try {
    return JSON.parse(
      await fs.readFile(path.join(paths.operationsDir, `${safeId}.json`), "utf8"),
    );
  } catch {
    return null;
  }
};

const readRevisionRows = async (paths, noteId) => {
  const SQL = await getSql();
  let bytes;
  try {
    bytes = await fs.readFile(paths.dbPath);
  } catch {
    return [];
  }
  const db = new SQL.Database(bytes);
  try {
    const statement = db.prepare(
      "SELECT id, note_id, title, content, created_at FROM revisions WHERE note_id=? ORDER BY id DESC LIMIT 50",
    );
    statement.bind([String(noteId)]);
    const rows = [];
    while (statement.step()) rows.push(statement.getAsObject());
    statement.free();
    return rows;
  } finally {
    db.close();
  }
};

const readTaskIndex = async (paths) => {
  try {
    return JSON.parse(
      await fs.readFile(path.join(paths.userData, "task-index.json"), "utf8"),
    );
  } catch {
    return null;
  }
};

const listNoteOperations = async (paths, noteId, limit = 200) => {
  let files;
  try {
    files = await fs.readdir(paths.operationsDir);
  } catch {
    return [];
  }
  const operations = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const operation = JSON.parse(
        await fs.readFile(path.join(paths.operationsDir, file), "utf8"),
      );
      if (noteId && operation.noteId !== noteId) continue;
      operations.push(operation);
    } catch {}
  }
  operations.sort(
    (a, b) =>
      Number(b.updatedAt || b.createdAt || 0) -
      Number(a.updatedAt || a.createdAt || 0),
  );
  return operations.slice(0, Math.max(0, Number(limit) || 0));
};

// A single McpServer can only be connected to one transport, so every HTTP
// request builds its own instance. `registerTools` below holds the shared
// tool definitions and runs unchanged for stdio and each HTTP request.
const createServer = () => {
  const server = new McpServer(
    {
      name: "ksnote",
      version: "0.1.0",
    },
    {
      instructions:
        "Use this server to read KsNote projects/pages and insert content into an explicit copied target or the current editor target. Explicit targetRef always wins over live cursor state. Call note_get before writes and pass expectedRevision. Target refs may carry ?workspace=<id> identifying the source workspace; a write whose workspace does not match this server is rejected with workspace_mismatch, so switch to the matching KSNOTE_DB_PATH instead of retrying. Failed operations carry a retry field: when retry.retryable is true, fix the cause using retry.hint and retry the same tool call at most 2 more times; otherwise report the structured error to the user instead of looping. Choose Mermaid for flows, sequences, state, ERD, and code architecture; PlantUML for UML when configured; draw.io for visually arranged diagrams the user wants to edit manually. After diagram_insert, poll operation_get until completed or error.",
    },
  );
  registerTools(server);
  return server;
};

const registerTools = (server) => {
server.registerTool(
  "workspace_get_context",
  {
    title: "Get Current KsNote Context",
    description:
      "Return the currently active KsNote project, page, cursor/selection target, storage paths, and note revision.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => {
    const { data, paths, updatedAt } = await loadState();
    const target = await readCurrentTarget();
    const heartbeat = await readHeartbeat();
    const note = noteById(data, target?.noteId || target?.pageId) || data.notes[0];
    const project = data.projects.find((item) => item.id === note?.projectId);
    return jsonText({
      workspace: "KsNote",
      workspaceId: workspaceIdForPaths(paths),
      dbPath: paths.dbPath,
      mcpDirectory: paths.mcpDir,
      updatedAt,
      app: {
        open: Boolean(heartbeat.appOpen) && !heartbeat.stale,
        heartbeat,
      },
      project: project ? { id: project.id, name: project.name } : null,
      page: note
        ? {
            id: note.id,
            title: note.title,
            revision: noteRevision(note),
          }
        : null,
      target: target || null,
    });
  },
);

server.registerTool(
  "diagram_capabilities",
  {
    title: "Get KsNote Diagram Capabilities",
    description:
      "Return the diagram macros currently supported by KsNote and whether their renderer is ready. Use before automatically choosing Mermaid, PlantUML, or draw.io.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => {
    const heartbeat = await readHeartbeat();
    const reported = heartbeat.diagramCapabilities || {};
    const appOpen = Boolean(heartbeat.appOpen) && !heartbeat.stale;
    return jsonText({
      ok: true,
      formats: [
        { id: "mermaid", available: appOpen && reported.mermaid !== false, local: true, verification: "svg-render", recommendedFor: ["flow", "sequence", "state", "erd", "code-architecture"] },
        { id: "plantuml", available: appOpen && Boolean(reported.plantuml), local: true, bundled: Boolean(reported.plantumlBundled), verification: "java-svg-render", recommendedFor: ["uml", "class", "component", "complex-sequence"] },
        { id: "drawio", available: appOpen && reported.drawio !== false, local: false, requiresNetwork: true, verification: "embed-load-svg-export", recommendedFor: ["manual-layout", "presentation", "editable-visual"] },
      ],
      appOpen,
    });
  },
);

server.registerTool(
  "operation_get",
  {
    title: "Get KsNote MCP Operation",
    description:
      "Read the status/result of a queued KsNote MCP operation by id. Use after diagram_insert to confirm completed, error, or expired.",
    inputSchema: {
      operationId: z.string(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ operationId }) => {
    const operation = await readOperation(operationId);
    if (!operation)
      return jsonText({
        ok: false,
        code: "operation_not_found",
        message: "MCP operation을 찾을 수 없습니다.",
      });
    const expired =
      ["pending", "applying"].includes(operation.status) &&
      Date.now() > (operation.expiresAt || operation.createdAt + OPERATION_TTL_MS);
    const resolved = expired
      ? {
          ...operation,
          status: "expired",
          code: "operation_expired",
          message: "KsNote 앱에서 제한 시간 안에 작업을 적용하지 못했습니다.",
        }
      : operation;
    const failed = resolved.status === "error" || resolved.status === "expired";
    return jsonText({
      ok: true,
      operation: failed
        ? {
            ...resolved,
            retry: operationRetryAdvice(resolved.errorCode ?? resolved.code),
          }
        : resolved,
    });
  },
);

server.registerTool(
  "project_list",
  {
    title: "List KsNote Projects",
    description: "List KsNote projects with their pages.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => {
    const { data } = await loadState();
    return jsonText({
      projects: data.projects.map((project) => ({
        id: project.id,
        name: project.name,
        pages: data.notes
          .filter((note) => note.projectId === project.id && !note.trashed)
          .map((note) => ({
            id: note.id,
            title: note.title,
            revision: noteRevision(note),
          })),
      })),
    });
  },
);

server.registerTool(
  "note_create",
  {
    title: "Create KsNote Page",
    description:
      "Create a new KsNote page in an explicit project. This is a write operation processed by the running KsNote app; poll operation_get for the created pageId.",
    inputSchema: {
      projectId: z.string(),
      title: z.string().min(1),
      content: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  async ({ projectId, title, content }) => {
    const { data } = await loadState();
    const heartbeat = await readHeartbeat();
    const project = data.projects.find((item) => item.id === projectId);
    if (!project)
      return jsonText({
        ok: false,
        code: "project_not_found",
        message: "KsNote 프로젝트를 찾을 수 없습니다.",
      });
    const queued = await queueOperation({
      type: "note_create",
      projectId,
      title: String(title).trim(),
      content: String(content || ""),
    });
    return jsonText({
      ok: true,
      status: "awaiting_approval",
      approvalRequired: true,
      operationId: queued.id,
      expiresAt: queued.expiresAt,
      appOpen: Boolean(heartbeat.appOpen) && !heartbeat.stale,
      message: "페이지 생성 작업을 큐에 넣었습니다. operation_get으로 완료 여부를 확인하세요.",
    });
  },
);

server.registerTool(
  "note_get",
  {
    title: "Get KsNote Page",
    description:
      "Read a KsNote page by pageId or ksnote:// targetRef. Returns HTML, plain text, revision, and target metadata. Narrow the read with blockId (one stable block), heading (that section), or fromLine/toLine (1-based text lines).",
    inputSchema: {
      pageId: z.string().optional(),
      targetRef: z.string().optional(),
      blockId: z.string().optional(),
      heading: z.string().optional(),
      fromLine: z.number().int().min(1).optional(),
      toLine: z.number().int().min(1).optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ pageId, targetRef, blockId, heading, fromLine, toLine }) => {
    const { data, paths } = await loadState();
    const target = await getTarget(targetRef);
    const note = noteById(data, pageId || target.noteId);
    if (!note)
      return jsonText({
        ok: false,
        code: "note_not_found",
        message: "KsNote 페이지를 찾을 수 없습니다.",
      });
    const payload = notePayload(data, note, target, workspaceIdForPaths(paths));
    const wantedBlock = String(blockId || "").trim();
    if (wantedBlock) {
      const block = findBlockById(note.content, wantedBlock);
      if (!block)
        return jsonText({
          ok: false,
          code: "block_not_found",
          message: "지정한 block ID에 해당하는 블록을 찾을 수 없습니다.",
          blockId: wantedBlock,
        });
      return jsonText({
        ok: true,
        note: { ...payload, scope: { kind: "block", blockId: wantedBlock } },
        block: { ...block, text: plainText(block.html).slice(0, 8000) },
      });
    }
    const wantedHeading = String(heading || "").trim();
    if (wantedHeading) {
      const section = findHeadingSection(note.content, wantedHeading);
      if (!section)
        return jsonText({
          ok: false,
          code: "heading_not_found",
          message: "지정한 제목을 찾을 수 없습니다. note_search나 전체 읽기로 제목을 확인하세요.",
          heading: wantedHeading,
        });
      return jsonText({
        ok: true,
        note: { ...payload, scope: { kind: "heading", heading: section.heading } },
        section,
      });
    }
    if (fromLine !== undefined || toLine !== undefined) {
      const slice = sliceTextLines(payload.text, fromLine, toLine);
      return jsonText({
        ok: true,
        note: { ...payload, scope: { kind: "lines", ...slice, text: undefined } },
        lines: slice,
      });
    }
    return jsonText({
      ok: true,
      note: { ...payload, scope: { kind: "full" } },
    });
  },
);

server.registerTool(
  "note_search",
  {
    title: "Search KsNote Pages",
    description:
      "Search KsNote pages across all projects by title and text. Returns ranked matches with score and snippet, plus pagination.",
    inputSchema: {
      query: z.string(),
      projectId: z.string().optional(),
      limit: z.number().int().min(1).max(50).optional(),
      offset: z.number().int().min(0).optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ query, projectId, limit, offset }) => {
    const { data } = await loadState();
    const result = searchNotes(data.notes, { query, projectId, limit, offset });
    if (!result.ok)
      return jsonText({
        ok: false,
        code: result.code,
        message: "검색어를 입력해 주세요.",
      });
    return jsonText({
      ...result,
      results: result.results.map((item) => {
        const note = noteById(data, item.id);
        const project = data.projects.find(
          (entry) => entry.id === item.projectId,
        );
        return {
          ...item,
          projectName: project?.name || item.projectId,
          revision: note ? noteRevision(note) : undefined,
        };
      }),
    });
  },
);

server.registerTool(
  "diagram_insert",
  {
    title: "Insert Diagram Into KsNote",
    description:
      "Queue a Mermaid, PlantUML, or draw.io diagram block for insertion into the current KsNote editor target. Uses expectedRevision for conflict detection.",
    inputSchema: {
      targetRef: z.string().optional(),
      format: z.enum(["mermaid", "plantuml", "drawio"]).default("mermaid"),
      code: z.string(),
      title: z.string().optional(),
      operation: z
        .enum(["insert", "append", "replace-selection", "replace-block"])
        .optional(),
      expectedRevision: z.string(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  async ({ targetRef, format, code, title, operation, expectedRevision }) => {
    const { data, paths } = await loadState();
    const heartbeat = await readHeartbeat();
    const target = await getTarget(targetRef);
    const mismatch = workspaceMismatch(
      parseKsNoteTargetRef(targetRef),
      paths,
    );
    if (mismatch) return jsonText(mismatch);
    const note = noteById(data, target.noteId);
    if (!note)
      return jsonText({
        ok: false,
        code: "note_not_found",
        message: "KsNote 페이지를 찾을 수 없습니다.",
      });
    const currentRevision = contentRevision(note.content);
    const guardedRevision = resolveGuardedRevision({ expectedRevision, targetRevision: target.revision });
    if (isRevisionConflict(guardedRevision, currentRevision))
      return jsonText({
        ok: false,
        code: "revision_conflict",
        message: "노트가 마지막 조회 이후 변경되었습니다. note_get으로 다시 읽고 재시도하세요.",
        expectedRevision: guardedRevision,
        currentRevision,
        retry: operationRetryAdvice("revision_conflict"),
      });
    const validation = validateDiagramSource(format, code);
    if (!validation.ok)
      return jsonText({
        ok: false,
        code: validation.code || "diagram_syntax_invalid",
        format,
        message: validation.message,
        retry: operationRetryAdvice(
          validation.code || "diagram_syntax_invalid",
        ),
      });
    const requestedOperation =
      operation || target.operation || (target.from !== target.to ? "replace-selection" : "insert");
    if (requestedOperation === "replace-block") {
      if (!target.blockId)
        return jsonText({
          ok: false,
          code: "diagram_target_required",
          message: "replace-block에는 안정 block ID가 포함된 명시적 ksnote:// targetRef가 필요합니다.",
        });
      if (!findDiagramBlock(note.content, target.blockId))
        return jsonText({
          ok: false,
          code: "diagram_block_not_found",
          message: "교체할 다이어그램 블록을 찾을 수 없습니다.",
          blockId: target.blockId,
        });
    }
    const appOpen = Boolean(heartbeat.appOpen) && !heartbeat.stale;
    const reportedCapability = heartbeat.diagramCapabilities?.[format];
    if (appOpen && reportedCapability === false)
      return jsonText({
        ok: false,
        code: "diagram_runtime_unavailable",
        format,
        message: `${format} 렌더러가 현재 KsNote 앱에서 준비되지 않았습니다. diagram_capabilities를 확인하세요.`,
      });
    const queued = await queueOperation({
      type: "diagram_insert",
      noteId: note.id,
      projectId: note.projectId,
      title: title || "",
      format,
      code,
      sourceValidation: validation.details,
      operation: requestedOperation,
      target: {
        targetRef: target.targetRef || `ksnote://page/${note.id}`,
        workspaceId: target.workspaceId || workspaceIdForPaths(paths),
        blockId: target.blockId,
        offset: target.offset,
        toBlockId: target.toBlockId,
        toOffset: target.toOffset,
        from: Number.isFinite(target.from) ? target.from : undefined,
        to: Number.isFinite(target.to) ? target.to : undefined,
      },
      expectedRevision: guardedRevision,
    });
    return jsonText({
      ok: true,
      status: "awaiting_approval",
      approvalRequired: true,
      operationId: queued.id,
      noteId: note.id,
      revision: currentRevision,
      sourceValidation: validation.details,
      expiresAt: queued.expiresAt,
      appOpen: Boolean(heartbeat.appOpen) && !heartbeat.stale,
      message:
        Boolean(heartbeat.appOpen) && !heartbeat.stale
          ? "KsNote 앱에서 변경 내용을 검토하고 승인해야 적용됩니다. 승인 후 operation_get으로 완료 여부를 확인하세요."
          : "승인 대기 작업을 큐에 넣었습니다. KsNote 앱을 열어 변경 내용을 검토해 주세요.",
    });
  },
);

server.registerTool(
  "diagram_delete",
  {
    title: "Delete an Exact KsNote Diagram Block",
    description:
      "Delete one Mermaid, PlantUML, or draw.io block identified by an explicit ksnote:// targetRef containing a stable block id. Requires revision matching and is processed by the running KsNote app.",
    inputSchema: {
      targetRef: z.string(),
      expectedRevision: z.string(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  async ({ targetRef, expectedRevision }) => {
    const parsed = parseKsNoteTargetRef(targetRef);
    if (!parsed?.pageId || !parsed.blockId)
      return jsonText({
        ok: false,
        code: "diagram_target_required",
        message: "페이지와 안정 block ID가 포함된 명시적 ksnote:// targetRef가 필요합니다.",
      });
    const { data, paths } = await loadState();
    const mismatch = workspaceMismatch(parsed, paths);
    if (mismatch) return jsonText(mismatch);
    const heartbeat = await readHeartbeat();
    const note = noteById(data, parsed.pageId);
    if (!note)
      return jsonText({
        ok: false,
        code: "note_not_found",
        message: "KsNote 페이지를 찾을 수 없습니다.",
      });
    const currentRevision = contentRevision(note.content);
    const guardedRevision = resolveGuardedRevision({ expectedRevision, targetRevision: parsed.revision });
    if (isRevisionConflict(guardedRevision, currentRevision))
      return jsonText({
        ok: false,
        code: "revision_conflict",
        message: "노트가 마지막 조회 이후 변경되었습니다. note_get으로 다시 읽고 재시도하세요.",
        expectedRevision: guardedRevision,
        currentRevision,
        retry: operationRetryAdvice("revision_conflict"),
      });
    const block = findDiagramBlock(note.content, parsed.blockId);
    if (!block)
      return jsonText({
        ok: false,
        code: "diagram_block_not_found",
        message: "지정한 block ID에 해당하는 다이어그램을 찾을 수 없습니다.",
        blockId: parsed.blockId,
      });
    const queued = await queueOperation({
      type: "diagram_delete",
      noteId: note.id,
      projectId: note.projectId,
      format: block.format,
      code: block.code,
      target: {
        targetRef,
        blockId: block.blockId,
      },
      expectedRevision,
    });
    return jsonText({
      ok: true,
      status: "awaiting_approval",
      approvalRequired: true,
      operationId: queued.id,
      noteId: note.id,
      blockId: block.blockId,
      format: block.format,
      revision: currentRevision,
      expiresAt: queued.expiresAt,
      appOpen: Boolean(heartbeat.appOpen) && !heartbeat.stale,
      message: "정확한 다이어그램 블록 삭제를 큐에 넣었습니다. operation_get으로 완료 여부를 확인하세요.",
    });
  },
);

server.registerTool(
  "text_insert",
  {
    title: "Insert Text Into KsNote",
    description:
      "Queue plain text insertion into a KsNote page or current editor target. Uses expectedRevision for conflict detection.",
    inputSchema: {
      targetRef: z.string().optional(),
      text: z.string(),
      operation: z
        .enum(["insert", "append", "replace-selection"])
        .optional(),
      expectedRevision: z.string(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  async ({ targetRef, text, operation, expectedRevision }) => {
    const damage = encodingDamage(text);
    if (damage)
      return jsonText({
        ok: false,
        ...damage,
      });
    const { data, paths } = await loadState();
    const heartbeat = await readHeartbeat();
    const target = await getTarget(targetRef);
    const mismatch = workspaceMismatch(
      parseKsNoteTargetRef(targetRef),
      paths,
    );
    if (mismatch) return jsonText(mismatch);
    const note = noteById(data, target.noteId);
    if (!note)
      return jsonText({
        ok: false,
        code: "note_not_found",
        message: "KsNote 페이지를 찾을 수 없습니다.",
      });
    const currentRevision = contentRevision(note.content);
    const guardedRevision = resolveGuardedRevision({ expectedRevision, targetRevision: target.revision });
    if (isRevisionConflict(guardedRevision, currentRevision))
      return jsonText({
        ok: false,
        code: "revision_conflict",
        message: "노트가 마지막 조회 이후 변경되었습니다. note_get으로 다시 읽고 재시도하세요.",
        expectedRevision: guardedRevision,
        currentRevision,
        retry: operationRetryAdvice("revision_conflict"),
      });
    const queued = await queueOperation({
      type: "text_insert",
      noteId: note.id,
      projectId: note.projectId,
      text,
      operation:
        operation || target.operation || (target.from !== target.to ? "replace-selection" : "insert"),
      target: {
        targetRef: target.targetRef || `ksnote://page/${note.id}`,
        workspaceId: target.workspaceId || workspaceIdForPaths(paths),
        blockId: target.blockId,
        offset: target.offset,
        toBlockId: target.toBlockId,
        toOffset: target.toOffset,
        from: Number.isFinite(target.from) ? target.from : undefined,
        to: Number.isFinite(target.to) ? target.to : undefined,
      },
      expectedRevision: guardedRevision,
    });
    return jsonText({
      ok: true,
      status: "awaiting_approval",
      approvalRequired: true,
      operationId: queued.id,
      noteId: note.id,
      revision: currentRevision,
      expiresAt: queued.expiresAt,
      appOpen: Boolean(heartbeat.appOpen) && !heartbeat.stale,
      message:
        Boolean(heartbeat.appOpen) && !heartbeat.stale
          ? "KsNote 앱에서 변경 내용을 검토하고 승인해야 적용됩니다. 승인 후 operation_get으로 완료 여부를 확인하세요."
          : "승인 대기 작업을 큐에 넣었습니다. KsNote 앱을 열어 변경 내용을 검토해 주세요.",
    });
  },
);

server.registerTool(
  "note_patch",
  {
    title: "Patch One KsNote Block",
    description:
      "Replace a single block identified by its stable block id with an HTML fragment. Uses expectedRevision for conflict detection.",
    inputSchema: {
      targetRef: z.string().optional(),
      noteId: z.string().optional(),
      blockId: z.string(),
      html: z.string().min(1),
      expectedRevision: z.string(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  async ({ targetRef, noteId, blockId, html, expectedRevision }) => {
    const { data, paths } = await loadState();
    const heartbeat = await readHeartbeat();
    const target = await getTarget(targetRef);
    const mismatch = workspaceMismatch(
      parseKsNoteTargetRef(targetRef),
      paths,
    );
    if (mismatch) return jsonText(mismatch);
    const note = noteById(data, noteId || target.noteId);
    if (!note)
      return jsonText({
        ok: false,
        code: "note_not_found",
        message: "KsNote 페이지를 찾을 수 없습니다.",
      });
    const currentRevision = contentRevision(note.content);
    const guardedRevision = resolveGuardedRevision({ expectedRevision, targetRevision: target.revision });
    if (isRevisionConflict(guardedRevision, currentRevision))
      return jsonText({
        ok: false,
        code: "revision_conflict",
        message: "노트가 마지막 조회 이후 변경되었습니다. note_get으로 다시 읽고 재시도하세요.",
        expectedRevision: guardedRevision,
        currentRevision,
        retry: operationRetryAdvice("revision_conflict"),
      });
    const block = findBlockById(note.content, blockId);
    if (!block)
      return jsonText({
        ok: false,
        code: "patch_block_not_found",
        message: "지정한 block ID에 해당하는 블록을 찾을 수 없습니다.",
        blockId,
      });
    const queued = await queueOperation({
      type: "note_patch",
      noteId: note.id,
      projectId: note.projectId,
      blockId,
      blockTag: block.tag,
      html,
      target: {
        targetRef:
          target.targetRef || `ksnote://page/${note.id}`,
        workspaceId: target.workspaceId || workspaceIdForPaths(paths),
        blockId,
      },
      expectedRevision: guardedRevision,
    });
    return jsonText({
      ok: true,
      status: "awaiting_approval",
      approvalRequired: true,
      operationId: queued.id,
      noteId: note.id,
      blockId,
      revision: currentRevision,
      expiresAt: queued.expiresAt,
      appOpen: Boolean(heartbeat.appOpen) && !heartbeat.stale,
      message:
        "Block patch 작업을 큐에 넣었습니다. KsNote 앱에서 검토하고 승인해야 적용됩니다.",
    });
  },
);

server.registerTool(
  "history_list",
  {
    title: "List KsNote Page History",
    description:
      "List saved revisions and past MCP operations for a KsNote page, newest first. Use to find a restorable snapshot before history_restore.",
    inputSchema: {
      pageId: z.string().optional(),
      targetRef: z.string().optional(),
      limit: z.number().int().min(1).max(50).optional(),
      offset: z.number().int().min(0).optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ pageId, targetRef, limit, offset }) => {
    const { data, paths } = await loadState();
    const target = await getTarget(targetRef);
    const note = noteById(data, pageId || target.noteId);
    if (!note)
      return jsonText({
        ok: false,
        code: "note_not_found",
        message: "KsNote 페이지를 찾을 수 없습니다.",
      });
    const revisions = await readRevisionRows(paths, note.id);
    const operations = await listNoteOperations(paths, note.id);
    return jsonText({
      ok: true,
      noteId: note.id,
      workspaceId: workspaceIdForPaths(paths),
      ...buildHistoryList({ revisions, operations, limit, offset }),
    });
  },
);

server.registerTool(
  "history_restore",
  {
    title: "Restore KsNote Page From History",
    description:
      "Queue a history restore that replaces the page with a saved revision snapshot or the content from before a completed MCP operation. Uses expectedRevision for conflict detection.",
    inputSchema: {
      targetRef: z.string().optional(),
      noteId: z.string().optional(),
      revisionId: z.number().int().optional(),
      operationId: z.string().optional(),
      expectedRevision: z.string(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  async ({ targetRef, noteId, revisionId, operationId, expectedRevision }) => {
    const { data, paths } = await loadState();
    const heartbeat = await readHeartbeat();
    const target = await getTarget(targetRef);
    const mismatch = workspaceMismatch(
      parseKsNoteTargetRef(targetRef),
      paths,
    );
    if (mismatch) return jsonText(mismatch);
    const note = noteById(data, noteId || target.noteId);
    if (!note)
      return jsonText({
        ok: false,
        code: "note_not_found",
        message: "KsNote 페이지를 찾을 수 없습니다.",
      });
    const revisions = await readRevisionRows(paths, note.id);
    const operations = await listNoteOperations(paths, note.id);
    const snapshot = resolveRestoreSnapshot({
      revisions,
      operations,
      revisionId,
      operationId,
    });
    if (!snapshot.ok)
      return jsonText({
        ok: false,
        code: snapshot.code,
        message:
          snapshot.code === "revision_not_found"
            ? "지정한 revision을 찾을 수 없습니다. history_list로 확인하세요."
            : snapshot.code === "operation_not_found"
              ? "지정한 operation을 찾을 수 없습니다."
              : snapshot.code === "operation_not_restorable"
                ? "완료된 operation만 복구 기준이 됩니다."
                : snapshot.code === "restore_snapshot_missing"
                  ? "복구할 이전 스냅샷이 없습니다."
                  : "revisionId 또는 operationId 중 하나를 지정하세요.",
      });
    const currentRevision = contentRevision(note.content);
    const guardedRevision = resolveGuardedRevision({ expectedRevision, targetRevision: target.revision });
    if (isRevisionConflict(guardedRevision, currentRevision))
      return jsonText({
        ok: false,
        code: "revision_conflict",
        message: "노트가 마지막 조회 이후 변경되었습니다. note_get으로 다시 읽고 재시도하세요.",
        expectedRevision: guardedRevision,
        currentRevision,
        retry: operationRetryAdvice("revision_conflict"),
      });
    const queued = await queueOperation({
      type: "history_restore",
      noteId: note.id,
      projectId: note.projectId,
      content: snapshot.content,
      restoreRevisionId: snapshot.revisionId,
      sourceOperationId: snapshot.sourceOperationId,
      target: {
        targetRef:
          target.targetRef || `ksnote://page/${note.id}`,
        workspaceId: target.workspaceId || workspaceIdForPaths(paths),
      },
      expectedRevision: guardedRevision,
    });
    return jsonText({
      ok: true,
      status: "awaiting_approval",
      approvalRequired: true,
      operationId: queued.id,
      noteId: note.id,
      restoreRevisionId: snapshot.revisionId,
      revision: currentRevision,
      expiresAt: queued.expiresAt,
      appOpen: Boolean(heartbeat.appOpen) && !heartbeat.stale,
      message:
        "History 복원 작업을 큐에 넣었습니다. KsNote 앱에서 검토하고 승인해야 적용됩니다.",
    });
  },
);

server.registerTool(
  "note_move",
  {
    title: "Move KsNote Page",
    description:
      "Move a KsNote page to another project. Uses expectedRevision for conflict detection.",
    inputSchema: {
      targetRef: z.string().optional(),
      noteId: z.string().optional(),
      targetProjectId: z.string(),
      expectedRevision: z.string(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  async ({ targetRef, noteId, targetProjectId, expectedRevision }) => {
    const { data, paths } = await loadState();
    const heartbeat = await readHeartbeat();
    const target = await getTarget(targetRef);
    const mismatch = workspaceMismatch(
      parseKsNoteTargetRef(targetRef),
      paths,
    );
    if (mismatch) return jsonText(mismatch);
    const note = noteById(data, noteId || target.noteId);
    if (!note)
      return jsonText({
        ok: false,
        code: "note_not_found",
        message: "KsNote 페이지를 찾을 수 없습니다.",
      });
    const project = data.projects.find((item) => item.id === targetProjectId);
    if (!project)
      return jsonText({
        ok: false,
        code: "project_not_found",
        message: "대상 프로젝트를 찾을 수 없습니다.",
      });
    if (note.projectId === targetProjectId)
      return jsonText({
        ok: false,
        code: "note_already_there",
        message: "페이지가 이미 해당 프로젝트에 있습니다.",
      });
    const currentRevision = contentRevision(note.content);
    const guardedRevision = resolveGuardedRevision({ expectedRevision, targetRevision: target.revision });
    if (isRevisionConflict(guardedRevision, currentRevision))
      return jsonText({
        ok: false,
        code: "revision_conflict",
        message: "노트가 마지막 조회 이후 변경되었습니다. note_get으로 다시 읽고 재시도하세요.",
        expectedRevision: guardedRevision,
        currentRevision,
        retry: operationRetryAdvice("revision_conflict"),
      });
    const queued = await queueOperation({
      type: "note_move",
      noteId: note.id,
      projectId: note.projectId,
      targetProjectId,
      target: {
        targetRef:
          target.targetRef || `ksnote://page/${note.id}`,
        workspaceId: target.workspaceId || workspaceIdForPaths(paths),
      },
      expectedRevision: guardedRevision,
    });
    return jsonText({
      ok: true,
      status: "awaiting_approval",
      approvalRequired: true,
      operationId: queued.id,
      noteId: note.id,
      targetProjectId,
      revision: currentRevision,
      expiresAt: queued.expiresAt,
      appOpen: Boolean(heartbeat.appOpen) && !heartbeat.stale,
      message:
        "페이지 이동 작업을 큐에 넣었습니다. KsNote 앱에서 검토하고 승인해야 적용됩니다.",
    });
  },
);

const TASK_PRIORITIES = new Set(["low", "normal", "high"]);

const ASSET_DATA_LIMIT = 8 * 1024 * 1024;

const assetMime = (name) => {
  const extension = String(name || "").split(".").pop()?.toLowerCase() || "";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  if (extension === "svg") return "image/svg+xml";
  if (extension === "png") return "image/png";
  if (extension === "mp4") return "video/mp4";
  if (extension === "pdf") return "application/pdf";
  return "application/octet-stream";
};

const listAssetFiles = async (paths) => {
  const assetsDir = path.join(paths.userData, "assets");
  let files;
  try {
    files = await fs.readdir(assetsDir);
  } catch {
    return [];
  }
  const entries = [];
  for (const file of files) {
    try {
      const stat = await fs.stat(path.join(assetsDir, file));
      if (!stat.isFile()) continue;
      entries.push({
        name: file,
        size: stat.size,
        mtime: stat.mtimeMs,
        mime: assetMime(file),
      });
    } catch {}
  }
  return entries.sort((a, b) => b.mtime - a.mtime);
};

server.registerTool(
  "task_query",
  {
    title: "Query KsNote Tasks",
    description:
      "List task items across KsNote pages with optional project, page, state, and assignee filters. Task index matches the in-app task overview order.",
    inputSchema: {
      projectId: z.string().optional(),
      noteId: z.string().optional(),
      checked: z.boolean().optional(),
      assignee: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ projectId, noteId, checked, assignee, limit, offset }) => {
    const { data, paths, updatedAt } = await loadState();
    const filters = { projectId, noteId, checked, assignee, limit, offset };
    const index = await readTaskIndex(paths);
    if (isIndexFresh(index, updatedAt)) {
      const queried = queryTaskIndex(index, filters);
      return jsonText({
        ok: true,
        ...queried,
        source: "index",
        tasks: queried.tasks.map((task) => {
          const project = data.projects.find(
            (item) => item.id === task.projectId,
          );
          const note = noteById(data, task.noteId);
          return {
            ...task,
            noteTitle: note?.title || task.noteTitle,
            projectName: project?.name || task.projectId,
          };
        }),
      });
    }
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const wantedAssignee = String(assignee || "").trim().toLowerCase();
    const collected = [];
    for (const note of data.notes) {
      if (!note || note.trashed) continue;
      if (projectId && note.projectId !== projectId) continue;
      if (noteId && note.id !== noteId) continue;
      const project = data.projects.find((item) => item.id === note.projectId);
      for (const task of listTaskItems(note.content)) {
        if (checked !== undefined && task.checked !== checked) continue;
        if (wantedAssignee && task.assignee.toLowerCase() !== wantedAssignee) continue;
        collected.push({
          id: `${note.id}-${task.index}`,
          noteId: note.id,
          noteTitle: note.title,
          projectId: note.projectId,
          projectName: project?.name || note.projectId,
          index: task.index,
          text: task.text,
          checked: task.checked,
          dueDate: task.dueDate,
          assignee: task.assignee,
          priority: task.priority,
        });
      }
    }
    return jsonText({
      ok: true,
      total: collected.length,
      limit: safeLimit,
      offset: safeOffset,
      source: "scan",
      tasks: collected.slice(safeOffset, safeOffset + safeLimit),
    });
  },
);

server.registerTool(
  "task_update",
  {
    title: "Update KsNote Task",
    description:
      "Update one task item by its index within a page (see task_query). Toggles completion or edits due date, assignee, and priority. Uses expectedRevision for conflict detection.",
    inputSchema: {
      targetRef: z.string().optional(),
      noteId: z.string().optional(),
      taskIndex: z.number().int().min(0),
      checked: z.boolean().optional(),
      dueDate: z.string().optional(),
      assignee: z.string().optional(),
      priority: z.enum(["low", "normal", "high"]).optional(),
      expectedRevision: z.string(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  async ({
    targetRef,
    noteId,
    taskIndex,
    checked,
    dueDate,
    assignee,
    priority,
    expectedRevision,
  }) => {
    const { data, paths } = await loadState();
    const heartbeat = await readHeartbeat();
    const target = await getTarget(targetRef);
    const mismatch = workspaceMismatch(
      parseKsNoteTargetRef(targetRef),
      paths,
    );
    if (mismatch) return jsonText(mismatch);
    const note = noteById(data, noteId || target.noteId);
    if (!note)
      return jsonText({
        ok: false,
        code: "note_not_found",
        message: "KsNote 페이지를 찾을 수 없습니다.",
      });
    const patch = {};
    if (checked !== undefined) patch.checked = checked;
    if (dueDate !== undefined) patch.dueDate = String(dueDate);
    if (assignee !== undefined) patch.assignee = String(assignee);
    if (priority !== undefined) {
      if (!TASK_PRIORITIES.has(priority))
        return jsonText({
          ok: false,
          code: "task_priority_invalid",
          message: "priority는 low, normal, high 중 하나여야 합니다.",
        });
      patch.priority = priority;
    }
    if (!Object.keys(patch).length)
      return jsonText({
        ok: false,
        code: "task_patch_empty",
        message: "변경할 항목(checked, dueDate, assignee, priority) 중 하나를 지정하세요.",
      });
    const tasks = listTaskItems(note.content);
    const task = tasks[taskIndex];
    if (!task)
      return jsonText({
        ok: false,
        code: "task_not_found",
        message: "지정한 인덱스의 할 일을 찾을 수 없습니다. task_query로 확인하세요.",
        taskIndex,
      });
    const currentRevision = contentRevision(note.content);
    const guardedRevision = resolveGuardedRevision({ expectedRevision, targetRevision: target.revision });
    if (isRevisionConflict(guardedRevision, currentRevision))
      return jsonText({
        ok: false,
        code: "revision_conflict",
        message: "노트가 마지막 조회 이후 변경되었습니다. note_get으로 다시 읽고 재시도하세요.",
        expectedRevision: guardedRevision,
        currentRevision,
        retry: operationRetryAdvice("revision_conflict"),
      });
    const queued = await queueOperation({
      type: "task_update",
      noteId: note.id,
      projectId: note.projectId,
      taskIndex,
      patch,
      target: {
        targetRef:
          target.targetRef || `ksnote://page/${note.id}`,
        workspaceId: target.workspaceId || workspaceIdForPaths(paths),
      },
      expectedRevision: guardedRevision,
    });
    return jsonText({
      ok: true,
      status: "awaiting_approval",
      approvalRequired: true,
      operationId: queued.id,
      noteId: note.id,
      taskIndex,
      taskId: `${note.id}-${taskIndex}`,
      revision: currentRevision,
      expiresAt: queued.expiresAt,
      appOpen: Boolean(heartbeat.appOpen) && !heartbeat.stale,
      message:
        "할 일 변경 작업을 큐에 넣었습니다. KsNote 앱에서 검토하고 승인해야 적용됩니다.",
    });
  },
);

server.registerTool(
  "asset_get",
  {
    title: "Get KsNote Assets",
    description:
      "List files in the KsNote asset store or read one asset with optional base64 data. Includes the pages referencing each asset. Indexed rows also carry a content hash.",
    inputSchema: {
      name: z.string().optional(),
      includeData: z.boolean().optional(),
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ name, includeData, limit, offset }) => {
    const { data, paths } = await loadState();
    const index = await readAssetIndex(paths);
    const files = index.indexed ? index.rows : await listAssetFiles(paths);
    const withRefs = (entry) => ({
      ...entry,
      referencedBy: data.notes
        .filter((note) => !note.trashed && String(note.content || "").includes(entry.name))
        .map((note) => note.id),
    });
    if (name) {
      const entry = files.find((item) => item.name === name);
      if (!entry)
        return jsonText({
          ok: false,
          code: "asset_not_found",
          message: "에셋 파일을 찾을 수 없습니다.",
        });
      if (!includeData) return jsonText({ ok: true, asset: withRefs(entry) });
      if (entry.size > ASSET_DATA_LIMIT)
        return jsonText({
          ok: false,
          code: "asset_too_large",
          message: `에셋이 너무 큽니다 (${entry.size} bytes, 최대 ${ASSET_DATA_LIMIT} bytes).`,
        });
      const bytes = await fs.readFile(path.join(paths.userData, "assets", entry.name));
      return jsonText({
        ok: true,
        asset: {
          ...withRefs(entry),
          dataUrl: `data:${entry.mime};base64,${bytes.toString("base64")}`,
        },
      });
    }
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
    const safeOffset = Math.max(0, Number(offset) || 0);
    return jsonText({
      ok: true,
      total: files.length,
      limit: safeLimit,
      offset: safeOffset,
      assets: files
        .slice(safeOffset, safeOffset + safeLimit)
        .map(withRefs),
    });
  },
);

};

const main = async () => {
  if (String(process.env.KSNOTE_MCP_TRANSPORT || "stdio").toLowerCase() === "http")
    return startHttpTransport();
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("KsNote MCP server running on stdio");
};

const startHttpTransport = async () => {
  const { default: express } = await import("express");
  const { StreamableHTTPServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/streamableHttp.js"
  );
  const host = process.env.KSNOTE_MCP_HOST || "127.0.0.1";
  const port = Number(process.env.KSNOTE_MCP_PORT) || 3000;
  const token = String(process.env.KSNOTE_MCP_TOKEN || "");
  const allowedHosts = String(process.env.KSNOTE_MCP_ALLOWED_HOSTS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.get("/health", (_, res) => {
    res.json({
      ok: true,
      name: "ksnote",
      version: "0.1.0",
      transport: "streamable-http",
      time: new Date().toISOString(),
    });
  });
  app.use("/mcp", (req, res, next) => {
    if (token) {
      const presented = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (presented !== token) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
    }
    if (allowedHosts.length) {
      const hostHeader = String(req.headers.host || "").split(":")[0].toLowerCase();
      const origin = String(req.headers.origin || "");
      const originHost = (() => {
        try {
          return origin ? new URL(origin).hostname.toLowerCase() : "";
        } catch {
          return "";
        }
      })();
      if (!allowedHosts.includes(hostHeader) || (origin && !allowedHosts.includes(originHost))) {
        res.status(403).json({ error: "forbidden-host" });
        return;
      }
    }
    next();
  });
  const handleMcp = async (req, res) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  };
  app.post("/mcp", handleMcp);
  app.get("/mcp", (_, res) => {
    res.status(405).json({ error: "stateless: use POST /mcp" });
  });
  app.delete("/mcp", (_, res) => {
    res.status(405).json({ error: "stateless: use POST /mcp" });
  });
  await new Promise((resolve) => app.listen(port, host, resolve));
  if (!token && host !== "127.0.0.1" && host !== "localhost")
    console.error("WARNING: KSNOTE_MCP_TOKEN is not set on a non-loopback listener.");
  console.error(`KsNote MCP server running on http://${host}:${port}/mcp`);
};

main().catch((error) => {
  console.error("KsNote MCP server failed:", error);
  process.exit(1);
});
