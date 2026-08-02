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
import { findDiagramBlock } from "./note-html.mjs";
import { parseKsNoteTargetRef } from "./target-ref.mjs";

const require = createRequire(import.meta.url);
const OPERATION_TTL_MS = 5 * 60 * 1000;
const HEARTBEAT_STALE_MS = 15 * 1000;

const contentRevision = (value) => {
  let hash = 2166136261;
  const input = String(value || "");
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `r${(hash >>> 0).toString(16)}`;
};

const plainText = (value) =>
  String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
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

const notePayload = (data, note, target = {}) => {
  const project = data.projects.find((item) => item.id === note.projectId);
  return {
    id: note.id,
    title: note.title,
    projectId: note.projectId,
    projectName: project?.name || note.projectId,
    content: note.content || "",
    text: plainText(note.content),
    revision: contentRevision(note.content),
    target: {
      targetRef: target.targetRef || `ksnote://page/${note.id}`,
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

const server = new McpServer(
  {
    name: "ksnote",
    version: "0.1.0",
  },
  {
    instructions:
      "Use this server to read KsNote projects/pages and insert content into an explicit copied target or the current editor target. Explicit targetRef always wins over live cursor state. Call note_get before writes and pass expectedRevision. Choose Mermaid for flows, sequences, state, ERD, and code architecture; PlantUML for UML when configured; draw.io for visually arranged diagrams the user wants to edit manually. After diagram_insert, poll operation_get until completed or error.",
  },
);

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
            revision: contentRevision(note.content),
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
    return jsonText({
      ok: true,
      operation: expired
        ? {
            ...operation,
            status: "expired",
            code: "operation_expired",
            message: "KsNote 앱에서 제한 시간 안에 작업을 적용하지 못했습니다.",
          }
        : operation,
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
            revision: contentRevision(note.content),
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
      "Read a KsNote page by pageId or ksnote:// targetRef. Returns HTML, plain text, revision, and target metadata.",
    inputSchema: {
      pageId: z.string().optional(),
      targetRef: z.string().optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ pageId, targetRef }) => {
    const { data } = await loadState();
    const target = await getTarget(targetRef);
    const note = noteById(data, pageId || target.noteId);
    if (!note)
      return jsonText({
        ok: false,
        code: "note_not_found",
        message: "KsNote 페이지를 찾을 수 없습니다.",
      });
    return jsonText({ ok: true, note: notePayload(data, note, target) });
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
      expectedRevision: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  async ({ targetRef, format, code, title, operation, expectedRevision }) => {
    const { data } = await loadState();
    const heartbeat = await readHeartbeat();
    const target = await getTarget(targetRef);
    const note = noteById(data, target.noteId);
    if (!note)
      return jsonText({
        ok: false,
        code: "note_not_found",
        message: "KsNote 페이지를 찾을 수 없습니다.",
      });
    const currentRevision = contentRevision(note.content);
    const guardedRevision = expectedRevision || target.revision;
    if (guardedRevision && guardedRevision !== currentRevision)
      return jsonText({
        ok: false,
        code: "revision_conflict",
        message: "노트가 마지막 조회 이후 변경되었습니다. note_get으로 다시 읽고 재시도하세요.",
        expectedRevision: guardedRevision,
        currentRevision,
      });
    const validation = validateDiagramSource(format, code);
    if (!validation.ok)
      return jsonText({
        ok: false,
        code: validation.code || "diagram_syntax_invalid",
        format,
        message: validation.message,
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
    const { data } = await loadState();
    const heartbeat = await readHeartbeat();
    const note = noteById(data, parsed.pageId);
    if (!note)
      return jsonText({
        ok: false,
        code: "note_not_found",
        message: "KsNote 페이지를 찾을 수 없습니다.",
      });
    const currentRevision = contentRevision(note.content);
    if (expectedRevision !== currentRevision)
      return jsonText({
        ok: false,
        code: "revision_conflict",
        message: "노트가 마지막 조회 이후 변경되었습니다. note_get으로 다시 읽고 재시도하세요.",
        expectedRevision,
        currentRevision,
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
      expectedRevision: z.string().optional(),
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
    const { data } = await loadState();
    const heartbeat = await readHeartbeat();
    const target = await getTarget(targetRef);
    const note = noteById(data, target.noteId);
    if (!note)
      return jsonText({
        ok: false,
        code: "note_not_found",
        message: "KsNote 페이지를 찾을 수 없습니다.",
      });
    const currentRevision = contentRevision(note.content);
    const guardedRevision = expectedRevision || target.revision;
    if (guardedRevision && guardedRevision !== currentRevision)
      return jsonText({
        ok: false,
        code: "revision_conflict",
        message: "노트가 마지막 조회 이후 변경되었습니다. note_get으로 다시 읽고 재시도하세요.",
        expectedRevision: guardedRevision,
        currentRevision,
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

const main = async () => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("KsNote MCP server running on stdio");
};

main().catch((error) => {
  console.error("KsNote MCP server failed:", error);
  process.exit(1);
});
