import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTaskIndex,
  isIndexFresh,
  queryTaskIndex,
} from "../mcp/task-index.mjs";

const notes = [
  {
    id: "n1",
    projectId: "p1",
    title: "Plan",
    content: '<ul data-type="taskList"><li data-type="taskItem" data-checked="false" data-assignee="kim">Do it</li><li data-type="taskItem" data-checked="true">Done</li></ul>',
  },
  {
    id: "n2",
    projectId: "p2",
    title: "Other",
    trashed: true,
    content: '<ul data-type="taskList"><li data-type="taskItem">Ghost</li></ul>',
  },
  {
    id: "n3",
    projectId: "p1",
    title: "Empty",
    content: "<p>no tasks</p>",
  },
];

test("build skips trashed notes and stamps the source revision clock", () => {
  const index = buildTaskIndex(notes, 777);
  assert.equal(index.version, 1);
  assert.equal(index.sourceUpdatedAt, 777);
  assert.deepEqual(
    index.tasks.map((task) => task.id),
    ["n1-0", "n1-1"],
  );
  assert.equal(index.tasks[0].assignee, "kim");
});

test("query filters mirror the scan path", () => {
  const index = buildTaskIndex(notes, 1);
  assert.equal(queryTaskIndex(index, { checked: false }).total, 1);
  assert.equal(
    queryTaskIndex(index, { assignee: "KIM" }).tasks[0].id,
    "n1-0",
  );
  assert.equal(queryTaskIndex(index, { projectId: "p2" }).total, 0);
  assert.equal(queryTaskIndex(index, { noteId: "n1", limit: 1, offset: 1 }).tasks[0].id, "n1-1");
});

test("freshness requires an exact clock match", () => {
  const index = buildTaskIndex(notes, 777);
  assert.equal(isIndexFresh(index, 777), true);
  assert.equal(isIndexFresh(index, 778), false);
  assert.equal(isIndexFresh(null, 777), false);
  assert.equal(isIndexFresh({ tasks: [] }, 777), false);
});
