import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveBlockNode,
  resolveBlockOffset,
} from "../src/block-anchor.mjs";

const fakeDoc = (blocks) => ({
  descendants: (visit) => {
    let pos = 0;
    for (const block of blocks) {
      visit(
        { attrs: { blockId: block.id }, content: { size: block.size } },
        pos,
      );
      pos += block.size + 2;
    }
  },
});

test("click targets resolve to the anchored block position", () => {
  const doc = fakeDoc([
    { id: "a", size: 10 },
    { id: "b", size: 6 },
  ]);
  assert.equal(resolveBlockOffset(doc, "a", 0), 1);
  assert.equal(resolveBlockOffset(doc, "a", 4), 5);
  assert.equal(resolveBlockOffset(doc, "b", 2), 15);
});

test("block offsets clamp to the block content range", () => {
  const doc = fakeDoc([{ id: "a", size: 5 }]);
  assert.equal(resolveBlockOffset(doc, "a", -3), 1);
  assert.equal(resolveBlockOffset(doc, "a", 99), 6);
  assert.equal(resolveBlockOffset(doc, "a"), 1);
});

test("unknown blocks resolve to undefined or null", () => {
  const doc = fakeDoc([{ id: "a", size: 5 }]);
  assert.equal(resolveBlockOffset(doc, "missing", 0), undefined);
  assert.equal(resolveBlockOffset(doc, "", 0), undefined);
  assert.equal(resolveBlockNode(doc, "missing"), null);
  assert.equal(resolveBlockNode(doc, ""), null);
});

test("block nodes resolve with their document position", () => {
  const doc = fakeDoc([
    { id: "a", size: 10 },
    { id: "b", size: 6 },
  ]);
  const resolved = resolveBlockNode(doc, "b");
  assert.equal(resolved.pos, 12);
  assert.equal(resolved.node.attrs.blockId, "b");
});
