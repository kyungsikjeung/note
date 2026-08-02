#!/usr/bin/env node
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { findDiagramBlock } from "../mcp/note-html.mjs";

const option = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
};

const pageId = option("--page-id");
const blockId = option("--block-id");
const sourceOperationId = option("--source-operation-id");
if (!pageId || !blockId || !sourceOperationId) {
  console.error("Usage: node scripts/restore-diagram-from-operation.mjs --page-id <id> --block-id <id> --source-operation-id <id>");
  process.exit(2);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const client = new Client({ name: "ksnote-diagram-recovery", version: "0.1.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["mcp/ksnote-server.mjs"],
  cwd: process.cwd(),
  env: { ...process.env },
  stderr: "pipe",
});

const call = async (name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  return result.structuredContent || JSON.parse(result.content?.[0]?.text || "{}");
};

const waitOperation = async (operationId, timeoutMs = 70000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await call("operation_get", { operationId });
    if (["completed", "error", "expired"].includes(result.operation?.status))
      return result.operation;
    await wait(350);
  }
  throw new Error(`operation timeout: ${operationId}`);
};

try {
  await client.connect(transport);
  const source = (await call("operation_get", { operationId: sourceOperationId })).operation;
  if (source?.status !== "completed" || source?.type !== "diagram_insert" || !source.code)
    throw new Error("The source operation is not a completed diagram insertion with recoverable code.");
  const before = (await call("note_get", { pageId })).note;
  const existing = findDiagramBlock(before.content, blockId);
  if (!existing) throw new Error(`diagram block not found: ${blockId}`);
  const queued = await call("diagram_insert", {
    targetRef: `ksnote://page/${encodeURIComponent(pageId)}?block=${encodeURIComponent(blockId)}`,
    format: source.format,
    title: source.title || "",
    code: source.code,
    operation: "replace-block",
    expectedRevision: before.revision,
  });
  if (!queued.ok || !queued.operationId)
    throw new Error(queued.message || queued.code || "diagram recovery was not queued");
  const operation = await waitOperation(queued.operationId);
  if (operation.status !== "completed" || operation.renderVerified !== true)
    throw new Error(operation.message || operation.errorCode || "diagram recovery render failed");
  await wait(500);
  const after = (await call("note_get", { pageId })).note;
  const restored = findDiagramBlock(after.content, blockId);
  if (!restored?.code.trim()) throw new Error("restored diagram code was not persisted");
  if (!restored.html.includes(`data-mcp-operation-id="${operation.id}"`))
    throw new Error("restored diagram provenance was not persisted");
  process.stdout.write(`${JSON.stringify({
    ok: true,
    pageId,
    blockId,
    format: restored.format,
    sourceOperationId,
    recoveryOperationId: operation.id,
    renderVerified: operation.renderVerified,
    renderedAs: operation.renderedAs,
    renderBytes: operation.renderBytes,
    appliedRevision: operation.appliedRevision,
    persistedRevision: after.revision,
  }, null, 2)}\n`);
} catch (error) {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
} finally {
  await Promise.race([client.close(), wait(750)]);
}
