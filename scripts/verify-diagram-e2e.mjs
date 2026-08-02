#!/usr/bin/env node
import process from "node:process";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const option = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
};

const pageId = option("--page-id");
if (!pageId) {
  console.error("Usage: node scripts/verify-diagram-e2e.mjs --page-id <KsNote page id> [--package-dir <win-unpacked>]");
  process.exit(2);
}

const packageDir = option("--package-dir");
const serverCommand = packageDir ? path.join(packageDir, "KsNote.exe") : process.execPath;
const serverScript = packageDir
  ? path.join(packageDir, "resources", "app.asar", "mcp", "ksnote-server.mjs")
  : "mcp/ksnote-server.mjs";

const client = new Client({ name: "ksnote-diagram-e2e", version: "0.1.0" });
const transport = new StdioClientTransport({
  command: serverCommand,
  args: [serverScript],
  cwd: packageDir || process.cwd(),
  env: {
    ...process.env,
    ...(packageDir ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
  },
  stderr: "pipe",
});

const call = async (name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    const detail = result.content?.map((item) => item.text || "").filter(Boolean).join("\n") || "unknown MCP error";
    throw new Error(`${name} failed: ${detail}`);
  }
  return result.structuredContent || JSON.parse(result.content?.[0]?.text || "{}");
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitOperation = async (operationId, timeoutMs = 70000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await call("operation_get", { operationId });
    const operation = result.operation;
    if (["completed", "error", "expired"].includes(operation?.status)) return operation;
    await wait(400);
  }
  throw new Error(`operation timeout: ${operationId}`);
};

const waitForRevision = async (expectedRevision, timeoutMs = 10000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await call("note_get", { pageId });
    if (result.note?.revision === expectedRevision) return result.note;
    await wait(250);
  }
  throw new Error(`SQLite revision did not reach ${expectedRevision}`);
};

const scenarios = [
  {
    id: "mermaid-code-architecture",
    format: "mermaid",
    title: "KsNote MCP 코드 아키텍처",
    code: `flowchart LR
  User[사용자 요청] --> Codex[Codex 세션]
  Codex --> MCP[KsNote MCP Server]
  MCP --> Queue[Operation Queue]
  Queue --> IPC[Electron IPC]
  IPC --> Editor[TipTap Editor]
  Editor --> Validator[실제 SVG 렌더 검증]
  Validator --> SQLite[(SQLite)]
  SQLite --> Result[operation_get completed]`,
  },
  {
    id: "mermaid-sequence",
    format: "mermaid",
    title: "MCP 명령 처리 시퀀스",
    code: `sequenceDiagram
  actor User as 사용자
  participant Codex
  participant MCP as KsNote MCP
  participant App as KsNote App
  participant DB as SQLite
  User->>Codex: 현재 페이지 아키텍처 정리
  Codex->>MCP: note_get + diagram_insert
  MCP->>App: operation queue
  App->>App: Mermaid SVG 렌더 검증
  App->>DB: 검증된 블록 저장
  App-->>MCP: completed + renderVerified
  MCP-->>Codex: operation_get 결과`,
  },
  {
    id: "plantuml-component",
    format: "plantuml",
    title: "KsNote 컴포넌트 구조",
    code: `@startuml
skinparam componentStyle rectangle
actor User
component Codex
component "KsNote MCP" as MCP
component "Electron Main" as Main
component "Rich Editor" as Editor
database SQLite
User --> Codex
Codex --> MCP : tool call
MCP --> Main : operation JSON
Main --> Editor : IPC polling
Editor --> SQLite : verified diagram
@enduml`,
  },
  {
    id: "drawio-connected-architecture",
    format: "drawio",
    title: "KsNote 편집 가능한 MCP 아키텍처",
    code: `<mxfile>
  <diagram name="MCP Architecture">
    <mxGraphModel dx="1200" dy="700" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" page="1" pageWidth="1169" pageHeight="827">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="user" value="사용자" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1"><mxGeometry x="40" y="180" width="120" height="60" as="geometry" /></mxCell>
        <mxCell id="codex" value="Codex" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;" vertex="1" parent="1"><mxGeometry x="220" y="180" width="120" height="60" as="geometry" /></mxCell>
        <mxCell id="mcp" value="KsNote MCP" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;" vertex="1" parent="1"><mxGeometry x="400" y="180" width="140" height="60" as="geometry" /></mxCell>
        <mxCell id="app" value="KsNote App" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#e1d5e7;strokeColor=#9673a6;" vertex="1" parent="1"><mxGeometry x="600" y="180" width="140" height="60" as="geometry" /></mxCell>
        <mxCell id="db" value="SQLite" style="shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;fillColor=#f8cecc;strokeColor=#b85450;" vertex="1" parent="1"><mxGeometry x="800" y="175" width="100" height="70" as="geometry" /></mxCell>
        <mxCell id="e1" value="요청" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;endArrow=block;endFill=1;" edge="1" parent="1" source="user" target="codex"><mxGeometry relative="1" as="geometry" /></mxCell>
        <mxCell id="e2" value="tool call" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;endArrow=block;endFill=1;" edge="1" parent="1" source="codex" target="mcp"><mxGeometry relative="1" as="geometry" /></mxCell>
        <mxCell id="e3" value="operation" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;endArrow=block;endFill=1;" edge="1" parent="1" source="mcp" target="app"><mxGeometry relative="1" as="geometry" /></mxCell>
        <mxCell id="e4" value="verified save" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;endArrow=block;endFill=1;" edge="1" parent="1" source="app" target="db"><mxGeometry relative="1" as="geometry" /></mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`,
  },
];

const report = {
  pageId,
  transport: packageDir ? "packaged-electron-node" : "source-node",
  serverCommand,
  serverScript,
  startedAt: new Date().toISOString(),
  capabilities: null,
  scenarios: [],
  negativeChecks: [],
};

try {
  await client.connect(transport);
  const capabilities = await call("diagram_capabilities");
  report.capabilities = capabilities;
  if (!capabilities.appOpen) throw new Error("KsNote app is not open");
  for (const scenario of scenarios) {
    const available = capabilities.formats?.find((item) => item.id === scenario.format)?.available;
    if (!available) throw new Error(`${scenario.format} renderer is not available`);
    const before = (await call("note_get", { pageId })).note;
    const queued = await call("diagram_insert", {
      targetRef: `ksnote://page/${pageId}`,
      format: scenario.format,
      title: scenario.title,
      code: scenario.code,
      operation: "append",
      expectedRevision: before.revision,
    });
    if (!queued.ok || !queued.operationId)
      throw new Error(`${scenario.id} was not queued: ${queued.message || queued.code}`);
    const operation = await waitOperation(queued.operationId);
    if (operation.status !== "completed" || operation.renderVerified !== true)
      throw new Error(`${scenario.id} render failed: ${operation.errorCode || operation.message || operation.status}`);
    if (!operation.renderBytes || operation.renderBytes < 100)
      throw new Error(`${scenario.id} did not return meaningful render evidence`);
    const note = await waitForRevision(operation.appliedRevision);
    if (!note.content.includes(`data-mcp-operation-id="${operation.id}"`))
      throw new Error(`${scenario.id} operation provenance was not persisted`);
    if (!note.content.includes('data-render-status="verified"'))
      throw new Error(`${scenario.id} verified render status was not persisted`);
    report.scenarios.push({
      id: scenario.id,
      format: scenario.format,
      operationId: operation.id,
      status: operation.status,
      renderVerified: operation.renderVerified,
      renderedAs: operation.renderedAs,
      renderBytes: operation.renderBytes,
      vertices: operation.vertices,
      edges: operation.edges,
      appliedRevision: operation.appliedRevision,
    });
  }

  const beforeInvalidMermaid = (await call("note_get", { pageId })).note;
  const invalidMermaid = await call("diagram_insert", {
    targetRef: `ksnote://page/${pageId}`,
    format: "mermaid",
    code: "flowchart TD\n  A[시작 --> B[완료]",
    operation: "append",
    expectedRevision: beforeInvalidMermaid.revision,
  });
  if (!invalidMermaid.operationId) throw new Error("invalid Mermaid did not reach runtime verification");
  const invalidOperation = await waitOperation(invalidMermaid.operationId);
  if (invalidOperation.status !== "error" || invalidOperation.renderVerified !== false)
    throw new Error("invalid Mermaid was not rejected by the real renderer");
  const afterInvalidMermaid = (await call("note_get", { pageId })).note;
  if (afterInvalidMermaid.revision !== beforeInvalidMermaid.revision)
    throw new Error("invalid Mermaid changed the persisted page");
  report.negativeChecks.push({
    id: "invalid-mermaid-fail-closed",
    operationId: invalidOperation.id,
    status: invalidOperation.status,
    code: invalidOperation.errorCode,
    persistedRevisionUnchanged: true,
  });

  const invalidDrawIo = await call("diagram_insert", {
    targetRef: `ksnote://page/${pageId}`,
    format: "drawio",
    code: scenarios[3].code.replace('target="db"', 'target="missing"'),
    operation: "append",
    expectedRevision: afterInvalidMermaid.revision,
  });
  if (invalidDrawIo.ok !== false || invalidDrawIo.code !== "drawio_edge_endpoint_missing")
    throw new Error("invalid draw.io edge was not rejected before queueing");
  report.negativeChecks.push({
    id: "invalid-drawio-edge-fail-closed",
    status: "rejected",
    code: invalidDrawIo.code,
  });

  const revisionConflict = await call("diagram_insert", {
    targetRef: `ksnote://page/${pageId}`,
    format: "mermaid",
    code: "flowchart LR\n  A --> B",
    operation: "append",
    expectedRevision: "r-stale-e2e",
  });
  if (revisionConflict.ok !== false || revisionConflict.code !== "revision_conflict")
    throw new Error("stale revision was not rejected");
  report.negativeChecks.push({
    id: "revision-conflict",
    status: "rejected",
    code: revisionConflict.code,
  });

  report.completedAt = new Date().toISOString();
  report.ok = true;
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  report.completedAt = new Date().toISOString();
  report.ok = false;
  report.error = error.stack || error.message || String(error);
  process.stderr.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await Promise.race([client.close(), wait(750)]);
}
