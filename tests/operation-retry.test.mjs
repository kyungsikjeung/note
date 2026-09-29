import assert from "node:assert/strict";
import test from "node:test";
import { operationRetryAdvice } from "../mcp/operation-retry.mjs";

test("retryable failures carry a Korean hint capped at 2 attempts", () => {
  for (const code of [
    "revision_conflict",
    "diagram_syntax_invalid",
    "diagram_render_failed",
    "encoding_suspect",
  ]) {
    const advice = operationRetryAdvice(code);
    assert.equal(advice.retryable, true);
    assert.equal(advice.maxAttempts, 2);
    assert.match(advice.hint, /2회/);
  }
  const expired = operationRetryAdvice("operation_expired");
  assert.equal(expired.retryable, true);
  assert.equal(expired.maxAttempts, 2);
  assert.match(expired.hint, /새 operation/);
});

test("non-retryable failures tell Codex to stop looping", () => {
  for (const code of [
    "note_not_found",
    "diagram_block_not_found",
    "workspace_mismatch",
    "operation_not_found",
    undefined,
  ]) {
    const advice = operationRetryAdvice(code);
    assert.equal(advice.retryable, false);
    assert.equal(advice.maxAttempts, 2);
    assert.equal(advice.hint, undefined);
  }
});
