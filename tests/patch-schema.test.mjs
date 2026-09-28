import assert from "node:assert/strict";
import test from "node:test";
import { validateAIPatch } from "../mcp/patch-schema.mjs";

test("block patch requires the selected stable block id", () => {
  assert.equal(validateAIPatch({ version: 1, operation: "replace", target: "block", html: "<p>x</p>" }, { blockId: "b1" }).ok, false);
  assert.equal(validateAIPatch({ version: 1, operation: "replace", target: "block", blockId: "b1", html: "<p>x</p>" }, { blockId: "b1" }).ok, true);
  assert.equal(validateAIPatch({ version: 1, operation: "replace", target: "block", blockId: "b2", html: "<p>x</p>" }, { blockId: "b1" }).code, "patch_block_mismatch");
});
