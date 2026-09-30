import assert from "node:assert/strict";
import test from "node:test";
import * as schema from "../mcp/patch-schema.mjs";
const { validateAIPatch } = schema;

test("block patch requires the selected stable block id", () => {
  assert.equal(validateAIPatch({ version: 1, operation: "replace", target: "block", html: "<p>x</p>" }, { blockId: "b1" }).ok, false);
  assert.equal(validateAIPatch({ version: 1, operation: "replace", target: "block", blockId: "b1", html: "<p>x</p>" }, { blockId: "b1" }).ok, true);
  assert.equal(validateAIPatch({ version: 1, operation: "replace", target: "block", blockId: "b2", html: "<p>x</p>" }, { blockId: "b1" }).code, "patch_block_mismatch");
});

const context = { target: "block", operation: "replace", blockId: "b1", sourceRevision: "r1" };
const valid = { version: 1, operation: "replace", target: "block", blockId: "b1", expectedRevision: "r1", html: "<p>x</p>" };

test("patches must match the captured target, operation, and revision", () => {
  assert.equal(validateAIPatch(valid, context).ok, true);
  for (const patch of [
    { ...valid, target: "note" },
    { ...valid, operation: "insert_after" },
    { ...valid, expectedRevision: undefined },
    { ...valid, expectedRevision: "old" },
    { ...valid, blockId: 123 },
  ]) assert.equal(validateAIPatch(patch, context).ok, false);
});

test("AI response parsing accepts JSON fences but never falls back to raw content", () => {
  assert.deepEqual(schema.parseAIPatch(JSON.stringify(valid), context), valid);
  assert.deepEqual(schema.parseAIPatch(`\u0060\u0060\u0060json\n${JSON.stringify(valid)}\n\u0060\u0060\u0060`, context), valid);
  for (const raw of [
    "<p>legacy output</p>", "{broken", "null", "[]", "",
    JSON.stringify({ ...valid, blockId: "other" }),
    JSON.stringify({ ...valid, version: 2 }),
  ]) assert.throws(() => schema.parseAIPatch(raw, context));
});
