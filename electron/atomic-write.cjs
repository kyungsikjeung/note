const fs = require("fs/promises");

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

async function writeFileAtomic(filePath, data, options) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    await fs.writeFile(tempPath, data, options);
    await renameWithRetry(tempPath, filePath);
  } finally {
    await fs.unlink(tempPath).catch(() => {});
  }
}

function createSerializedFileWriter() {
  let queue = Promise.resolve();
  return (filePath, data, options) => {
    const write = queue.then(() => writeFileAtomic(filePath, data, options));
    queue = write.catch(() => {});
    return write;
  };
}

module.exports = { createSerializedFileWriter, renameWithRetry, writeFileAtomic };
