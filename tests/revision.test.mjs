import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  contentRevision,
  isRevisionConflict,
  noteRevision,
  resolveGuardedRevision,
} from "../mcp/revision.mjs";

test("contentRevision keeps the legacy FNV-1a format", () => {
  assert.equal(contentRevision(""), "r811c9dc5");
  assert.match(contentRevision("<p>hello</p>"), /^r[0-9a-f]+$/);
  assert.equal(contentRevision("<p>hello</p>"), contentRevision("<p>hello</p>"));
  assert.notEqual(contentRevision("<p>a</p>"), contentRevision("<p>b</p>"));
});

test("contentRevision coerces empty values like the inline copies did", () => {
  assert.equal(contentRevision(undefined), contentRevision(""));
  assert.equal(contentRevision(null), contentRevision(""));
  assert.equal(noteRevision(null), contentRevision(""));
  assert.equal(noteRevision({ content: "<p>x</p>" }), contentRevision("<p>x</p>"));
});

test("guarded revision prefers expectedRevision over live target", () => {
  assert.equal(
    resolveGuardedRevision({ expectedRevision: "r1", targetRevision: "r2" }),
    "r1",
  );
  assert.equal(
    resolveGuardedRevision({ expectedRevision: "", targetRevision: "r2" }),
    "r2",
  );
  assert.equal(resolveGuardedRevision({}), undefined);
});

test("conflict detection matches the server guard semantics", () => {
  assert.equal(isRevisionConflict("r1", "r1"), false);
  assert.equal(isRevisionConflict("r1", "r2"), true);
  assert.equal(isRevisionConflict(undefined, "r2"), false);
  assert.equal(isRevisionConflict("", "r2"), false);
});

test("S3: revision hash lives only in mcp/revision.mjs", async () => {
  const [serverSource, mainSource, editorSource] = await Promise.all(
    [
      "../mcp/ksnote-server.mjs",
      "../src/main.jsx",
      "../src/RichDocumentEditor.jsx",
    ].map((relative) => readFile(new URL(relative, import.meta.url), "utf8")),
  );
  for (const [name, source] of [
    ["ksnote-server.mjs", serverSource],
    ["main.jsx", mainSource],
    ["RichDocumentEditor.jsx", editorSource],
  ]) {
    assert.match(source, /from ["'].*revision\.mjs["']/, `${name} must import the shared module`);
    assert.doesNotMatch(
      source,
      /const contentRevision = \(value\) =>/,
      `${name} must not keep its own copy`,
    );
  }
  assert.doesNotMatch(serverSource, /2166136261/, "hash constant must not be duplicated");
});

test("S3: every revision guard uses the shared conflict predicate", async () => {
  const consumers = [
    "../mcp/ksnote-server.mjs",
    "../src/main.jsx",
    "../src/RichDocumentEditor.jsx",
  ];
  for (const relative of consumers) {
    const source = await readFile(new URL(relative, import.meta.url), "utf8");
    const name = relative.split("/").pop();
    assert.doesNotMatch(
      source,
      /expectedRevision\s*!==|!==\s*contentRevision/,
      `${name} must not re-implement the conflict comparison`,
    );
    assert.doesNotMatch(
      source,
      /expectedRevision\s*&&\s*\n?\s*claimed\.expectedRevision\s*!==/,
      `${name} must not hand-roll the guard condition`,
    );
  }
});

test("S3: the shared module keeps a stable, dependency-free surface", async () => {
  const source = await readFile(new URL("../mcp/revision.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bimport\b|require\(/, "revision.mjs must stay dependency-free");
  assert.doesNotMatch(source, /\bexport default\b/, "shared modules use named exports only");
  const exported = [...source.matchAll(/export const (\w+)/g)].map((match) => match[1]);
  assert.deepEqual(exported, [
    "contentRevision",
    "noteRevision",
    "resolveGuardedRevision",
    "isRevisionConflict",
  ]);
});
