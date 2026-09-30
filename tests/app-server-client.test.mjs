import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import vm from "node:vm";
import { CodexAppServerClient } from "../electron/codex-app-server-client.cjs";

const helper = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "helpers",
  "mock-app-server.cjs",
);

const loadWindowsClient = (spawn, timers = {}) => {
  const require = createRequire(import.meta.url);
  const module = { exports: {} };
  vm.runInNewContext(
    readFileSync(new URL("../electron/codex-app-server-client.cjs", import.meta.url), "utf8"),
    {
      module,
      require: (name) => name === "child_process" ? { spawn } : require(name),
      process: { platform: "win32" },
      setTimeout,
      clearTimeout,
      ...timers,
    },
  );
  return module.exports;
};

test("Windows tree termination stays asynchronous and shares concurrent requests", async () => {
  let calls = 0;
  let directKills = 0;
  const killer = new EventEmitter();
  const { killProcessTree } = loadWindowsClient(() => { calls += 1; return killer; });
  const child = { pid: 123, kill() { directKills += 1; } };
  let completed = false;
  const stopping = killProcessTree(child);
  stopping.then(() => { completed = true; });
  assert.equal(killProcessTree(child), stopping);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(completed, false);
  assert.equal(calls, 1);
  assert.equal(directKills, 0);
  killer.emit("close", 0);
  await stopping;
  assert.equal(completed, true);
  assert.equal(directKills, 0);
});

test("Windows taskkill timeout falls back once without rejecting fire-and-forget callers", async () => {
  let directKills = 0;
  let killerKills = 0;
  const killer = new EventEmitter();
  killer.kill = () => { killerKills += 1; };
  const { killProcessTree } = loadWindowsClient(() => killer, {
    setTimeout: (callback, ms) => {
      assert.equal(ms, 5000);
      return setTimeout(callback, 10);
    },
  });
  await killProcessTree({ pid: 123, kill() { directKills += 1; } });
  killer.emit("error", new Error("late taskkill error"));
  killer.emit("close", 1);
  assert.equal(directKills, 1);
  assert.equal(killerKills, 1);
});

test("stop waits for child exit even when a kill signal was already sent", async () => {
  const killer = new EventEmitter();
  const { CodexAppServerClient: WindowsClient } = loadWindowsClient(() => killer);
  const client = new WindowsClient();
  const child = new EventEmitter();
  Object.assign(child, {
    pid: 123, killed: false, exitCode: null, signalCode: null,
    stdin: { end() {} },
    kill() { this.killed = true; },
  });
  client.child = child;
  client.status = "ready";
  let completed = false;
  const stopping = client.stop().then(() => { completed = true; });
  killer.emit("error", new Error("taskkill unavailable"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(child.killed, true);
  assert.equal(completed, false);
  child.signalCode = "SIGTERM";
  child.emit("close", null);
  await stopping;
  assert.equal(completed, true);
});

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
