#!/usr/bin/env node
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import initSqlJs from "sql.js";
import * as z from "zod/v4";

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

const parseTargetRef = (targetRef) => {
  const value = String(targetRef || "");
  const match = value.match(/^ksnote:\/\/page\/([^?]+)(?:\?(.*))?$/);
  if (!match) return null;
  const params = new URLSearchParams(match[2] || "");
  const from = Number(params.get("from"));
  const to = Number(params.get("to"));
  return {
    pageId: decodeURIComponent(match[1]),
    from: Number.isFinite(from) ? from : undefined,
    to: Number.isFinite(to) ? to : undefined,
  };
};

const getTarget = async (targetRef) => {
  const parsed = parseTargetRef(targetRef);
  const current = await readCurrentTarget();
  return {
    ...(current || {}),
    ...(parsed || {}),
    noteId: parsed?.pageId || current?.noteId || current?.pageId,
    targetRef: targetRef || current?.targetRef || "",
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
      "Use this server to read KsNote projects/pages and insert content into the current KsNote editor target. Prefer Mermaid unless the user asks for PlantUML or draw.io. Pass expectedRevision when the user wants conflict protection.",
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
        .enum(["insert", "append", "replace-selection"])
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
    if (expectedRevision && expectedRevision !== currentRevision)
      return jsonText({
        ok: false,
        code: "revision_conflict",
        message: "노트가 마지막 조회 이후 변경되었습니다. note_get으로 다시 읽고 재시도하세요.",
        expectedRevision,
        currentRevision,
      });
    const queued = await queueOperation({
      type: "diagram_insert",
      noteId: note.id,
      projectId: note.projectId,
      title: title || "",
      format,
      code,
      operation:
        operation || (target.from !== target.to ? "replace-selection" : "insert"),
      target: {
        targetRef: target.targetRef || `ksnote://page/${note.id}`,
        from: Number.isFinite(target.from) ? target.from : undefined,
        to: Number.isFinite(target.to) ? target.to : undefined,
      },
      expectedRevision,
    });
    return jsonText({
      ok: true,
      status: "queued",
      operationId: queued.id,
      noteId: note.id,
      revision: currentRevision,
      expiresAt: queued.expiresAt,
      appOpen: Boolean(heartbeat.appOpen) && !heartbeat.stale,
      message:
        Boolean(heartbeat.appOpen) && !heartbeat.stale
          ? "KsNote 앱이 operation queue를 처리하고 있습니다. operation_get으로 완료 여부를 확인하세요."
          : "작업을 큐에 넣었습니다. 현재 KsNote 앱 heartbeat가 없으므로 앱을 열어야 적용됩니다.",
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
    if (expectedRevision && expectedRevision !== currentRevision)
      return jsonText({
        ok: false,
        code: "revision_conflict",
        message: "노트가 마지막 조회 이후 변경되었습니다. note_get으로 다시 읽고 재시도하세요.",
        expectedRevision,
        currentRevision,
      });
    const queued = await queueOperation({
      type: "text_insert",
      noteId: note.id,
      projectId: note.projectId,
      text,
      operation:
        operation || (target.from !== target.to ? "replace-selection" : "insert"),
      target: {
        targetRef: target.targetRef || `ksnote://page/${note.id}`,
        from: Number.isFinite(target.from) ? target.from : undefined,
        to: Number.isFinite(target.to) ? target.to : undefined,
      },
      expectedRevision,
    });
    return jsonText({
      ok: true,
      status: "queued",
      operationId: queued.id,
      noteId: note.id,
      revision: currentRevision,
      expiresAt: queued.expiresAt,
      appOpen: Boolean(heartbeat.appOpen) && !heartbeat.stale,
      message:
        Boolean(heartbeat.appOpen) && !heartbeat.stale
          ? "KsNote 앱이 operation queue를 처리하고 있습니다. operation_get으로 완료 여부를 확인하세요."
          : "작업을 큐에 넣었습니다. 현재 KsNote 앱 heartbeat가 없으므로 앱을 열어야 적용됩니다.",
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
