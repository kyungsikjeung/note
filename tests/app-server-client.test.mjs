import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CodexAppServerClient } from "../electron/codex-app-server-client.cjs";

const helper = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "helpers",
  "mock-app-server.cjs",
);

const startClient = async (args = []) => {
  const client = new CodexAppServerClient({
    command: process.execPath,
    serverArgs: [helper, ...args],
    approvalTimeoutMs: 5000,
  });
  await client.start();
  return client;
};

test("stop rejects pending requests immediately and clears server-bound state", async () => {
  const client = await startClient();
  try {
    const pending = client.request("mock/wait", {}, 60000);
    const rejected = assert.rejects(pending, /중지/);
    await client.request("mock/getLog");
    client.contextThreads.set("note", "old-thread");
    await client.stop();
    assert.equal(client.pending.size, 0);
    assert.equal(client.contextThreads.size, 0);
    await rejected;
  } finally {
    await client.stop();
  }
});

test("late exit and stream errors from the old child do not break a restarted client", async () => {
  const client = await startClient();
  const oldChild = client.child;
  try {
    await client.stop();
    await client.start();
    const newChild = client.child;
    oldChild.emit("close", 1);
    oldChild.stdin.emit("error", new Error("old pipe closed"));
    assert.equal(client.child, newChild);
    assert.equal(client.status, "ready");
    assert.ok(await client.request("mock/getLog"));
  } finally {
    await client.stop();
  }
});

test("failed request serialization clears its timer and pending entry", async () => {
  const client = await startClient();
  try {
    const circular = {};
    circular.self = circular;
    await assert.rejects(client.request("mock/wait", circular), /circular/i);
    assert.equal(client.pending.size, 0);
  } finally {
    await client.stop();
  }
});

test("status list forwards detail and tool call sends server shape", async () => {
  const client = await startClient();
  try {
    const status = await client.mcpServerStatusList("toolsAndAuthOnly");
    assert.equal(status.data[0].name, "atlassian");
    const log = await client.request("mock/getLog", {});
    assert.equal(log.statusParams.detail, "toolsAndAuthOnly");
    const result = await client.mcpServerToolCall({
      server: "atlassian",
      threadId: "thread_mock1",
      tool: "createConfluencePage",
      args: { title: "T" },
    });
    assert.equal(result.pageId, "987");
    const after = await client.request("mock/getLog", {});
    assert.deepEqual(after.toolCalls[0], {
      server: "atlassian",
      threadId: "thread_mock1",
      tool: "createConfluencePage",
      arguments: { title: "T" },
    });
  } finally {
    await client.stop();
  }
});

test("server approval requests surface to UI and carry the decision", async () => {
  const client = await startClient(["--with-approval"]);
  try {
    const seen = new Promise((resolve) => client.once("approval", resolve));
    const callPromise = client.mcpServerToolCall({
      server: "atlassian",
      threadId: "thread_mock1",
      tool: "createConfluencePage",
      args: {},
    });
    const approval = await seen;
    assert.equal(approval.method, "item/commandExecution/requestApproval");
    assert.equal(client.resolveApproval(approval.approvalId, { decision: "approved" }), true);
    const result = await callPromise;
    assert.equal(result.pageId, "987");
    const log = await client.request("mock/getLog", {});
    assert.deepEqual(log.approvalResponse, { decision: "approved" });
  } finally {
    await client.stop();
  }
});

test("scratch threads open and close", async () => {
  const client = await startClient();
  try {
    assert.equal(await client.openScratchThread(), "thread_mock1");
    assert.equal(await client.closeScratchThread("thread_mock1"), true);
  } finally {
    await client.stop();
  }
});
