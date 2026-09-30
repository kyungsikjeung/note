const fs = require("fs/promises");
const path = require("path");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function renameWithRetry(sourcePath, destinationPath, rename = fs.rename) {
  const retryable = new Set(["EBUSY", "EACCES", "EPERM", "ENOTEMPTY"]);
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(sourcePath, destinationPath);
      return;
    } catch (error) {
      if (!retryable.has(error?.code) || attempt >= 11) throw error;
      await wait(Math.min(250, 10 * (2 ** attempt)));
    }
  }
}

function tempFileName(filePath) {
  const unique =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
  return `${filePath}.${unique}.tmp`;
}

async function writeFileAtomic(filePath, data, options) {
  const tempPath = tempFileName(filePath);
  const handle = await fs.open(tempPath, "w");
  try {
    await handle.writeFile(data, options);
    if (typeof handle.sync === "function") await handle.sync();
    await handle.close();
    await renameWithRetry(tempPath, filePath);
  } catch (error) {
    try {
      await handle.close().catch(() => {});
    } catch {}
    throw error;
  } finally {
    await fs.unlink(tempPath).catch(() => {});
  }
}

async function sweepAtomicTempFiles(filePath, { minAgeMs = 60 * 60 * 1000 } = {}) {
  const directory = path.dirname(filePath);
  const base = `${path.basename(filePath)}.`;
  let entries;
  try {
    entries = await fs.readdir(directory);
  } catch {
    return 0;
  }
  let swept = 0;
  for (const entry of entries) {
    if (!entry.startsWith(base) || !entry.endsWith(".tmp")) continue;
    try {
      const tempPath = path.join(directory, entry);
      const stat = await fs.stat(tempPath);
      if (Date.now() - stat.mtimeMs < minAgeMs) continue;
      await fs.unlink(tempPath);
      swept += 1;
    } catch {}
  }
  return swept;
}

function createSerializedFileWriter() {
  let queue = Promise.resolve();
  return (filePath, data, options) => {
    const write = queue.then(() => writeFileAtomic(filePath, data, options));
    queue = write.catch(() => {});
    return write;
  };
}

module.exports = { createSerializedFileWriter, renameWithRetry, sweepAtomicTempFiles, writeFileAtomic };
