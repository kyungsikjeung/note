import assert from "node:assert/strict";
import test from "node:test";
import { Schema } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import {
  getActiveBlockContext,
  resolveAIEditRange,
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

const schema = new Schema({ nodes: {
  doc: { content: "paragraph+" },
  paragraph: { content: "text*", attrs: { blockId: { default: null } } },
  text: {},
} });
const p = (id, text) => schema.node("paragraph", { blockId: id }, schema.text(text));
const docOf = (...blocks) => schema.node("doc", null, blocks);
const capture = (doc, from, to = from) => {
  const state = { doc, selection: TextSelection.create(doc, from, to) };
  const target = getActiveBlockContext({ state });
  return { ...target, originalSlice: doc.slice(target.range.from, target.range.to), originalHtml: "original" };
};

test("AI selection capture resolves both endpoints without an undefined $to", () => {
  const doc = docOf(p("a", "Hello"), p("b", "World"));
  const target = capture(doc, 2, 11);
  assert.equal(target.target, "selection");
  assert.equal(target.blockId, "a");
  assert.equal(target.blockOffset, 1);
  assert.equal(target.toBlockId, "b");
  assert.equal(target.toBlockOffset, 3);
  assert.deepEqual(resolveAIEditRange(doc, target, "original"), { from: 2, to: 11 });
});

test("AI can edit an unchanged block after unrelated content shifts its position", () => {
  const doc = docOf(p("a", "Hello"), p("b", "World"));
  const target = capture(doc, 9);
  const updated = docOf(p("a", "Longer unrelated paragraph"), p("b", "World"));
  const resolved = resolveAIEditRange(updated, target, "changed");
  assert.equal(updated.nodeAt(resolved.from).attrs.blockId, "b");
  assert.equal(target.originalSlice.eq(updated.slice(resolved.from, resolved.to)), true);
});

test("AI refuses to overwrite a changed block or selection", () => {
  const doc = docOf(p("a", "Hello"), p("b", "World"));
  const updated = docOf(p("a", "HELLO"), p("b", "World"));
  for (const target of [capture(doc, 2), capture(doc, 2, 4)])
    assert.throws(() => resolveAIEditRange(updated, target, "changed"), /변경되거나 삭제/);
});

test("AI refuses a deleted selection end instead of falling back to stale positions", () => {
  const doc = docOf(p("a", "Hello"), p("b", "World"));
  const target = capture(doc, 2, 11);
  const updated = docOf(p("a", "Hello"), p("different", "World"));
  assert.throws(() => resolveAIEditRange(updated, target, "changed"), /변경되거나 삭제/);
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
