import assert from "node:assert/strict";
import test from "node:test";
import { buildOperationDiff } from "../mcp/operation-diff.mjs";

const note = [
  '<h1 data-block-id="h1">Title</h1>',
  '<p data-block-id="p1">Hello</p>',
  '<div data-code="flowchart LR&#10;  A --&gt; B" data-block-id="d1" data-type="mermaid"></div>',
  '<ul data-type="taskList"><li data-type="taskItem" data-assignee="kim">Ship it</li></ul>',
].join("");

test("note_patch diffs the targeted block", () => {
  const diff = buildOperationDiff(
    { type: "note_patch", blockId: "p1", html: "<p>Hi</p>" },
    { noteContent: note },
  );
  assert.equal(diff.mode, "replace");
  assert.match(diff.beforeHtml, /Hello/);
  assert.match(diff.afterHtml, /Hi/);
  assert.equal(diff.truncated, false);
});

test("missing blocks fall back to a notice", () => {
  const diff = buildOperationDiff(
    { type: "note_patch", blockId: "gone", html: "<p>Hi</p>" },
    { noteContent: note },
  );
  assert.match(diff.beforeHtml, /찾을 수 없습니다/);
});

test("diagram replace and delete resolve the stored block", () => {
  const replaced = buildOperationDiff(
    {
      type: "diagram_insert",
      operation: "replace-block",
      format: "mermaid",
      code: "flowchart LR\n  X --> Y",
      target: { blockId: "d1" },
    },
    { noteContent: note },
  );
  assert.match(replaced.beforeHtml, /data-type="mermaid"/);
  assert.match(replaced.afterHtml, /X --&gt; Y/);
  const deleted = buildOperationDiff(
    { type: "diagram_delete", target: { blockId: "d1" } },
    { noteContent: note },
  );
  assert.equal(deleted.mode, "delete");
  assert.match(deleted.afterHtml, /삭제됨/);
});

test("task updates render before and after states", () => {
  const diff = buildOperationDiff(
    { type: "task_update", taskIndex: 0, patch: { checked: true } },
    { noteContent: note },
  );
  assert.match(diff.beforeHtml, /☐/);
  assert.match(diff.afterHtml, /☑/);
  assert.match(diff.afterHtml, /kim/);
});

test("history restores truncate long snapshots", () => {
  const big = `<p>${"x".repeat(20000)}</p>`;
  const diff = buildOperationDiff(
    { type: "history_restore", content: big },
    { noteContent: big },
  );
  assert.equal(diff.truncated, true);
  assert.match(diff.afterHtml, /이하 생략/);
});

test("moves and creates use labels instead of content", () => {
  const moved = buildOperationDiff(
    { type: "note_move", projectId: "p1", targetProjectId: "p2" },
    { projectName: "Inbox", targetProjectName: "Archive" },
  );
  assert.equal(moved.mode, "move");
  assert.match(moved.beforeHtml, /Inbox/);
  assert.match(moved.afterHtml, /Archive/);
  const created = buildOperationDiff(
    { type: "note_create", title: "New", content: "" },
    {},
  );
  assert.equal(created.mode, "create");
  assert.match(created.afterHtml, /빈 페이지/);
});
