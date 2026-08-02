import assert from "node:assert/strict";
import test from "node:test";
import {
  buildKsNoteTargetRef,
  parseKsNoteTargetRef,
} from "../mcp/target-ref.mjs";

test("page-only references do not inherit a cursor", () => {
  const ref = buildKsNoteTargetRef({ pageId: "note-한글" });
  assert.equal(ref, "ksnote://page/note-%ED%95%9C%EA%B8%80");
  assert.deepEqual(parseKsNoteTargetRef(ref), {
    pageId: "note-한글",
    blockId: undefined,
    offset: undefined,
    toBlockId: undefined,
    toOffset: undefined,
    from: undefined,
    to: undefined,
    revision: undefined,
    operation: undefined,
    explicit: true,
  });
});

test("click targets preserve stable block and revision metadata", () => {
  const ref = buildKsNoteTargetRef({
    pageId: "n1",
    blockId: "block-123",
    offset: 7,
    from: 42,
    to: 42,
    revision: "rabc",
    operation: "insert",
  });
  assert.deepEqual(parseKsNoteTargetRef(ref), {
    pageId: "n1",
    blockId: "block-123",
    offset: 7,
    toBlockId: undefined,
    toOffset: undefined,
    from: 42,
    to: 42,
    revision: "rabc",
    operation: "insert",
    explicit: true,
  });
});

test("selection targets preserve both block anchors", () => {
  const ref = buildKsNoteTargetRef({
    pageId: "n2",
    blockId: "a",
    offset: 2,
    toBlockId: "b",
    toOffset: 4,
    from: 10,
    to: 30,
    operation: "replace-selection",
  });
  const parsed = parseKsNoteTargetRef(ref);
  assert.equal(parsed.blockId, "a");
  assert.equal(parsed.toBlockId, "b");
  assert.equal(parsed.operation, "replace-selection");
});

test("invalid references are rejected", () => {
  assert.equal(parseKsNoteTargetRef("https://example.com/page/n1"), null);
});
