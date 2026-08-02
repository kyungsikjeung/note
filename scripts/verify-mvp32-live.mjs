#!/usr/bin/env node
import process from "node:process";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const option = (name, fallback = "") => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const cdpPort = Number(option("--cdp-port", "9222"));
const dbPath = option("--db-path");
const packageDir = option("--package-dir");
if (!dbPath) {
  console.error("Usage: node scripts/verify-mvp32-live.mjs --db-path <ksnote.db> [--cdp-port 9222]");
  process.exit(2);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (probe, message, timeoutMs = 30000) => {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await probe();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await wait(250);
  }
  throw new Error(`${message}${lastError ? `: ${lastError.message}` : ""}`);
};

const targets = await waitFor(async () => {
  const response = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
  if (!response.ok) return null;
  return response.json();
}, "Electron CDP target를 찾지 못했습니다");
const pageTarget = targets.find(
  (target) =>
    target.type === "page" &&
    (/127\.0\.0\.1:5173/.test(target.url) ||
      /^file:/i.test(target.url) ||
      target.title === "KsNote"),
);
if (!pageTarget?.webSocketDebuggerUrl)
  throw new Error("KsNote renderer CDP target가 없습니다.");

const socket = new WebSocket(pageTarget.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let requestId = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});
const cdp = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++requestId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const response = await cdp("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails)
    throw new Error(response.exceptionDetails.text || "Renderer evaluation failed");
  return response.result?.value;
};
await cdp("Runtime.enable");

const client = new Client({ name: "ksnote-mvp32-live", version: "0.1.0" });
const transport = new StdioClientTransport({
  command: packageDir ? path.join(packageDir, "KsNote.exe") : process.execPath,
  args: [
    packageDir
      ? path.join(packageDir, "resources", "app.asar", "mcp", "ksnote-server.mjs")
      : path.join(process.cwd(), "mcp", "ksnote-server.mjs"),
  ],
  cwd: packageDir || process.cwd(),
  env: {
    ...process.env,
    KSNOTE_DB_PATH: dbPath,
    ...(packageDir ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
  },
  stderr: "pipe",
});
const call = async (name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  const payload =
    result.structuredContent ||
    JSON.parse(result.content?.find((item) => item.type === "text")?.text || "{}");
  if (result.isError) throw new Error(payload.message || `${name} failed`);
  return payload;
};
const waitOperation = (operationId, timeoutMs = 70000) =>
  waitFor(async () => {
    const result = await call("operation_get", { operationId });
    return ["completed", "error", "expired"].includes(result.operation?.status)
      ? result.operation
      : null;
  }, `operation ${operationId}이 종료되지 않았습니다`, timeoutMs);
const click = (selector) =>
  evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return false; node.click(); return true; })()`);

const report = {
  runtime: packageDir ? "packaged" : "source",
  cleanup: {},
  approval: {},
  mermaid: {},
  drawio: {},
  undo: {},
};
try {
  await client.connect(transport);
  await waitFor(
    () => evaluate("document.querySelector('.rich-document') ? true : false"),
    "KsNote 편집기가 준비되지 않았습니다",
  );
  const rejectedStaleOperations = await evaluate(`(async () => {
    const operations = await window.ksnoteMcp.pending({});
    const stale = operations.filter((item) => item.status === "pending");
    for (const operation of stale)
      await window.ksnoteMcp.reject({ id: operation.id, noteId: operation.noteId });
    return stale.length;
  })()`);
  report.cleanup = { rejectedStaleOperations };
  await wait(500);
  const before = await waitFor(async () => {
    const result = await call("note_get", { pageId: "n1" }).catch(() => null);
    return result?.note || null;
  }, "격리된 라이브 테스트 DB의 n1 페이지를 읽지 못했습니다");

  const mermaidMarker = `MVP32_APPROVAL_${Date.now()}`;
  const queuedMermaid = await call("diagram_insert", {
    targetRef: "ksnote://page/n1",
    format: "mermaid",
    title: "MVP 3.2 승인 회귀",
    code: `flowchart LR\n  A[${mermaidMarker}] --> B[승인 후 적용]`,
    operation: "append",
    expectedRevision: before.revision,
  });
  if (queuedMermaid.status !== "awaiting_approval" || !queuedMermaid.approvalRequired)
    throw new Error("diagram_insert가 승인 대기 상태를 반환하지 않았습니다.");
  await waitFor(
    () => evaluate("document.querySelector('.mcp-review-dialog') ? true : false"),
    "MCP 승인 모달이 표시되지 않았습니다",
  );
  const persistedBeforeApproval = await call("note_get", { pageId: "n1" });
  if (persistedBeforeApproval.note.content.includes(mermaidMarker))
    throw new Error("사용자 승인 전에 Mermaid 변경이 저장되었습니다.");
  const mermaidRenderedInReview = await waitFor(
    () => evaluate("document.querySelector('.mcp-review-diagram svg') ? true : false"),
    "승인 모달의 Mermaid 미리보기가 렌더링되지 않았습니다",
  );
  await click(".mcp-review-dialog footer button.primary");
  const mermaidOperation = await waitOperation(queuedMermaid.operationId);
  if (mermaidOperation.status !== "completed" || mermaidOperation.renderVerified !== true)
    throw new Error(`Mermaid 적용 실패: ${mermaidOperation.message || mermaidOperation.errorCode}`);
  const afterMermaid = await call("note_get", { pageId: "n1" });
  if (!afterMermaid.note.content.includes(mermaidMarker))
    throw new Error("승인한 Mermaid가 정확한 페이지에 저장되지 않았습니다.");
  report.approval = {
    status: "passed",
    persistedBeforeApproval: false,
    reviewRendered: Boolean(mermaidRenderedInReview),
  };
  report.mermaid = {
    status: mermaidOperation.status,
    renderVerified: mermaidOperation.renderVerified,
    appliedRevision: mermaidOperation.appliedRevision,
  };

  await waitFor(
    () => evaluate("document.querySelector('.toast-undo') ? true : false"),
    "MCP 완료 Undo 버튼이 표시되지 않았습니다",
    5000,
  );
  await click(".toast-undo");
  const afterUndo = await waitFor(async () => {
    const result = await call("note_get", { pageId: "n1" });
    return !result.note.content.includes(mermaidMarker) ? result.note : null;
  }, "Undo 후 Mermaid 변경이 복구되지 않았습니다", 10000);
  report.undo = {
    status: "passed",
    restoredRevision: afterUndo.revision,
  };

  const drawioMarker = `MVP32_DRAWIO_${Date.now()}`;
  const drawioCode = `<mxfile><diagram name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" value="${drawioMarker}" vertex="1" parent="1"><mxGeometry x="80" y="80" width="160" height="60" as="geometry"/></mxCell><mxCell id="b" value="Preview" vertex="1" parent="1"><mxGeometry x="340" y="80" width="140" height="60" as="geometry"/></mxCell><mxCell id="e" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>`;
  const beforeDrawio = await call("note_get", { pageId: "n1" });
  const queuedDrawio = await call("diagram_insert", {
    targetRef: "ksnote://page/n1",
    format: "drawio",
    title: "MVP 3.2 draw.io Preview",
    code: drawioCode,
    operation: "append",
    expectedRevision: beforeDrawio.note.revision,
  });
  await waitFor(
    () => evaluate("document.querySelector('.mcp-review-dialog') ? true : false"),
    "draw.io 승인 모달이 표시되지 않았습니다",
  );
  const reviewPreview = await waitFor(
    () => evaluate("document.querySelector('.mcp-review-diagram img') ? true : false"),
    "draw.io 승인 미리보기가 렌더링되지 않았습니다",
    30000,
  );
  await click(".mcp-review-dialog footer button.primary");
  const drawioOperation = await waitOperation(queuedDrawio.operationId, 70000);
  if (drawioOperation.status !== "completed" || drawioOperation.renderVerified !== true)
    throw new Error(`draw.io 적용 실패: ${drawioOperation.message || drawioOperation.errorCode}`);
  await waitFor(
    () => evaluate("(() => { const blocks = [...document.querySelectorAll('.drawio-block')]; const block = blocks.at(-1); const button = block && [...block.querySelectorAll('button')].find((item) => item.textContent.trim() === 'Preview'); if (!button) return false; button.click(); return true; })()"),
    "draw.io Preview 전환 버튼을 찾지 못했습니다",
  );
  const blockPreview = await waitFor(
    () => evaluate("document.querySelector('.drawio-block .drawio-preview img') ? true : false"),
    "draw.io 블록 Preview가 SVG 이미지를 표시하지 않았습니다",
    30000,
  );
  const beforeViewer = await call("note_get", { pageId: "n1" });
  await click(".drawio-block .drawio-preview-open");
  await waitFor(
    () => evaluate("document.querySelector('.drawio-viewer[role=\"dialog\"]') ? true : false"),
    "draw.io 전체화면 뷰어가 열리지 않았습니다",
  );
  const initialZoom = await evaluate("document.querySelector('.drawio-viewer nav output')?.textContent || ''");
  await click('.drawio-viewer button[title="확대"]');
  const buttonZoom = await waitFor(
    async () => {
      const value = await evaluate("document.querySelector('.drawio-viewer nav output')?.textContent || ''");
      return value && value !== initialZoom ? value : null;
    },
    "draw.io 확대 버튼이 배율을 변경하지 않았습니다",
  );
  await waitFor(
    () => evaluate("document.querySelector('.drawio-viewer-viewport.can-pan') ? true : false"),
    "확대된 draw.io 뷰어가 드래그 이동 상태로 전환되지 않았습니다",
  );
  const transformBeforePan = await evaluate("document.querySelector('.drawio-viewer-viewport img')?.style.transform || ''");
  await evaluate(`(() => {
    const viewport = document.querySelector('.drawio-viewer-viewport');
    if (!viewport) return false;
    viewport.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 71, button: 0, clientX: 500, clientY: 400 }));
    viewport.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 71, button: 0, clientX: 560, clientY: 440 }));
    viewport.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 71, button: 0, clientX: 560, clientY: 440 }));
    return true;
  })()`);
  const transformAfterPan = await waitFor(
    async () => {
      const value = await evaluate("document.querySelector('.drawio-viewer-viewport img')?.style.transform || ''");
      return value && value !== transformBeforePan ? value : null;
    },
    "draw.io 확대 화면의 드래그 이동이 반영되지 않았습니다",
  );
  await evaluate(`(() => {
    const viewport = document.querySelector('.drawio-viewer-viewport');
    if (!viewport) return false;
    viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120, clientX: 600, clientY: 420 }));
    return true;
  })()`);
  const wheelZoom = await waitFor(
    async () => {
      const value = await evaluate("document.querySelector('.drawio-viewer nav output')?.textContent || ''");
      return value && value !== buttonZoom ? value : null;
    },
    "draw.io 마우스 휠 확대가 배율을 변경하지 않았습니다",
  );
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true");
  await waitFor(
    () => evaluate("document.querySelector('.drawio-viewer') ? false : true"),
    "Esc 입력 후 draw.io 전체화면 뷰어가 닫히지 않았습니다",
  );
  await click(".drawio-block .drawio-preview-open");
  const reopenedZoom = await waitFor(
    async () => {
      const value = await evaluate("document.querySelector('.drawio-viewer nav output')?.textContent || ''");
      return value === wheelZoom ? value : null;
    },
    "draw.io 뷰어가 세션 확대 배율을 유지하지 않았습니다",
  );
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true");
  await waitFor(
    () => evaluate("document.querySelector('.drawio-viewer') ? false : true"),
    "재개한 draw.io 뷰어가 Esc로 닫히지 않았습니다",
  );
  const afterViewer = await call("note_get", { pageId: "n1" });
  if (
    afterViewer.note.revision !== beforeViewer.note.revision ||
    afterViewer.note.content !== beforeViewer.note.content
  )
    throw new Error("draw.io 뷰어 조작이 원본 노트나 revision을 변경했습니다.");
  report.drawio = {
    status: drawioOperation.status,
    reviewPreview: Boolean(reviewPreview),
    blockPreview: Boolean(blockPreview),
    renderVerified: drawioOperation.renderVerified,
    fullscreenViewer: true,
    buttonZoom,
    wheelZoom,
    panMoved: Boolean(transformAfterPan),
    escClose: true,
    sessionZoom: reopenedZoom,
    sourceUnchanged: true,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  socket.close();
  await Promise.race([client.close(), wait(750)]).catch(() => {});
}
