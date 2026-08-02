import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createSerializedFileWriter, renameWithRetry, writeFileAtomic } = require("../electron/atomic-write.cjs");

test("rename retries transient Windows file sharing errors", async () => {
  let calls = 0;
  await renameWithRetry("source.tmp", "target.json", async () => {
    calls += 1;
    if (calls < 3) throw Object.assign(new Error("sharing violation"), { code: "EPERM" });
  });
  assert.equal(calls, 3);
});

test("rename does not hide non-transient failures", async () => {
  await assert.rejects(
    renameWithRetry("source.tmp", "target.json", async () => {
      throw Object.assign(new Error("missing source"), { code: "ENOENT" });
    }),
    { code: "ENOENT" },
  );
});

test("atomic writer replaces an existing database snapshot", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ksnote-atomic-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "ksnote.db");
  await fs.writeFile(filePath, "old");
  await writeFileAtomic(filePath, Buffer.from("complete-snapshot"));
  assert.equal(await fs.readFile(filePath, "utf8"), "complete-snapshot");
  assert.deepEqual(await fs.readdir(directory), ["ksnote.db"]);
});

test("serialized writer preserves the order of concurrent snapshots", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ksnote-queue-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "ksnote.db");
  const writeSnapshot = createSerializedFileWriter();
  await Promise.all([
    writeSnapshot(filePath, Buffer.from("snapshot-1")),
    writeSnapshot(filePath, Buffer.from("snapshot-2")),
    writeSnapshot(filePath, Buffer.from("snapshot-3")),
  ]);
  assert.equal(await fs.readFile(filePath, "utf8"), "snapshot-3");
  assert.deepEqual(await fs.readdir(directory), ["ksnote.db"]);
});
