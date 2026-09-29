import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHistoryList,
  resolveRestoreSnapshot,
} from "../mcp/history.mjs";

const revisions = [
  { id: 3, title: "현재", content: "<p>v3</p>", created_at: 3000 },
  { id: 2, title: "중간", content: "<p>v2</p>", created_at: 2000 },
  { id: 1, title: "최초", content: "<p>v1</p>", created_at: 1000 },
];

const operations = [
  {
    id: "mcp-2",
    type: "diagram_insert",
    status: "completed",
    createdAt: 2500,
    updatedAt: 2600,
    appliedRevision: "rabc",
  },
  {
    id: "mcp-1",
    type: "text_insert",
    status: "error",
    code: "apply_failed",
    createdAt: 1500,
    updatedAt: 1600,
  },
  {
    id: "mcp-0",
    type: "diagram_insert",
    status: "pending",
    createdAt: 500,
    updatedAt: 500,
  },
];

test("history merges revisions and operations newest first", () => {
  const list = buildHistoryList({ revisions, operations });
  assert.equal(list.total, 5);
  assert.equal(list.entries[0].kind, "revision");
  assert.equal(list.entries[0].revisionId, 3);
  assert.equal(list.entries[1].kind, "mcp-operation");
  assert.equal(list.entries[1].operationId, "mcp-2");
});

test("completed operations resolve the pre-apply revision", () => {
  const list = buildHistoryList({ revisions, operations });
  const op = list.entries.find((entry) => entry.operationId === "mcp-2");
  assert.equal(op.restorable, true);
  assert.equal(op.restoreRevisionId, 2);
  const failed = list.entries.find(
    (entry) => entry.operationId === "mcp-1",
  );
  assert.equal(failed.restorable, false);
});

test("pending operations stay out of history", () => {
  const list = buildHistoryList({ revisions, operations });
  assert.ok(
    list.entries.every((entry) => entry.operationId !== "mcp-0"),
  );
});

test("history paginates with total preserved", () => {
  const first = buildHistoryList({ revisions, operations, limit: 2, offset: 0 });
  const second = buildHistoryList({ revisions, operations, limit: 2, offset: 2 });
  assert.equal(first.total, 5);
  assert.equal(first.entries.length, 2);
  assert.equal(second.entries.length, 2);
  assert.notDeepEqual(first.entries, second.entries);
});

test("restore resolves revision snapshots directly", () => {
  const snapshot = resolveRestoreSnapshot({
    revisions,
    operations,
    revisionId: 1,
  });
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.content, "<p>v1</p>");
  assert.equal(snapshot.source, "revision");
});

test("restore resolves the pre-apply snapshot for an operation", () => {
  const snapshot = resolveRestoreSnapshot({
    revisions,
    operations,
    operationId: "mcp-2",
  });
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.revisionId, 2);
  assert.equal(snapshot.content, "<p>v2</p>");
  assert.equal(snapshot.source, "mcp-operation");
  assert.equal(snapshot.sourceOperationId, "mcp-2");
});

test("unrestorable restore targets fail closed", () => {
  assert.equal(
    resolveRestoreSnapshot({ revisions, operations, revisionId: 99 }).code,
    "revision_not_found",
  );
  assert.equal(
    resolveRestoreSnapshot({ revisions, operations, operationId: "nope" }).code,
    "operation_not_found",
  );
  assert.equal(
    resolveRestoreSnapshot({ revisions, operations, operationId: "mcp-1" }).code,
    "operation_not_restorable",
  );
  assert.equal(
    resolveRestoreSnapshot({ revisions, operations }).code,
    "restore_target_required",
  );
});
