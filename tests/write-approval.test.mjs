import assert from "node:assert/strict";
import test from "node:test";
import {
  isApprovedMcpOperation,
  isMcpWriteOperation,
  requiresMcpUserApproval,
} from "../mcp/write-approval.mjs";

test("MCP note mutations require explicit user approval", () => {
  for (const type of [
    "note_create",
    "diagram_insert",
    "diagram_delete",
    "text_insert",
  ])
    assert.equal(requiresMcpUserApproval({ type, status: "pending" }), true);
  assert.equal(
    requiresMcpUserApproval({ type: "note_get", status: "pending" }),
    false,
  );
});

test("only an approved write operation may be claimed for apply", () => {
  assert.equal(
    isApprovedMcpOperation({ type: "diagram_insert", status: "approved" }),
    true,
  );
  assert.equal(
    isApprovedMcpOperation({ type: "diagram_insert", status: "pending" }),
    false,
  );
  assert.equal(isMcpWriteOperation({ type: "workspace_get_context" }), false);
});
