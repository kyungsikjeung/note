import assert from "node:assert/strict";
import test from "node:test";

import {
  LAST_LOCATION_STORAGE_KEY,
  readLastLocation,
  resolveLastLocation,
  saveLastLocation,
} from "../src/last-location.mjs";

const data = {
  projects: [
    { id: "p1", name: "첫 프로젝트" },
    { id: "p2", name: "두 번째 프로젝트" },
  ],
  notes: [
    { id: "n1", projectId: "p1", title: "첫 페이지" },
    { id: "n2", projectId: "p1", title: "두 번째 페이지" },
    { id: "n3", projectId: "p2", title: "마지막 페이지" },
  ],
};

test("resolves the last project page when both IDs are valid", () => {
  assert.deepEqual(resolveLastLocation(data, { projectId: "p2", noteId: "n3" }), {
    projectId: "p2",
    noteId: "n3",
  });
});

test("falls back to a valid page when the saved page was deleted", () => {
  assert.deepEqual(resolveLastLocation(data, { projectId: "p1", noteId: "missing" }), {
    projectId: "p1",
    noteId: "n1",
  });
  assert.deepEqual(resolveLastLocation(data, { projectId: "missing", noteId: "missing" }), {
    projectId: "p1",
    noteId: "n1",
  });
});

test("reads and writes the last location safely", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };

  saveLastLocation(storage, { projectId: "p2", noteId: "n3" });
  assert.equal(values.has(LAST_LOCATION_STORAGE_KEY), true);
  assert.deepEqual(readLastLocation(storage), { projectId: "p2", noteId: "n3" });
  values.set(LAST_LOCATION_STORAGE_KEY, "not-json");
  assert.equal(readLastLocation(storage), null);
});
