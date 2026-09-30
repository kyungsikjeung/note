const ASSET_TABLE_DDL =
  "CREATE TABLE IF NOT EXISTS assets (name TEXT PRIMARY KEY, size INTEGER NOT NULL, mime TEXT NOT NULL, mtime INTEGER NOT NULL, hash TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)";

const assetMime = (name) => {
  const extension = String(name || "").split(".").pop()?.toLowerCase() || "";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  if (extension === "svg") return "image/svg+xml";
  if (extension === "png") return "image/png";
  if (extension === "mp4") return "video/mp4";
  if (extension === "pdf") return "application/pdf";
  return "application/octet-stream";
};

const fnv1a = (bytes) => {
  let hash = 2166136261;
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(0);
  for (let index = 0; index < view.length; index += 1) {
    hash ^= view[index];
    hash = Math.imul(hash, 16777619);
  }
  return `fnv:${(hash >>> 0).toString(16)}`;
};

const safeName = (name) => String(name || "").split(/[\\/]/).pop() || "";

const buildAssetRow = ({ name, size, mtime, bytes, now } = {}) => {
  const clean = safeName(name);
  if (!clean) return null;
  const timestamp = Number.isFinite(now) ? now : Date.now();
  return {
    name: clean,
    size: Math.max(0, Number(size) || 0),
    mime: assetMime(clean),
    mtime: Math.max(0, Number(mtime) || 0),
    hash: bytes ? fnv1a(bytes) : "",
    created_at: timestamp,
    updated_at: timestamp,
  };
};

const needsReindex = (existing, file) => {
  if (!existing) return true;
  return (
    Number(existing.size) !== Number(file.size) ||
    Number(existing.mtime) !== Number(file.mtime)
  );
};

const ensureAssetTable = (db) => {
  db.run(ASSET_TABLE_DDL);
};

const readAssetRows = (db) => {
  let table = true;
  try {
    db.exec("SELECT name FROM assets LIMIT 1");
  } catch {
    table = false;
  }
  if (!table) return { indexed: false, rows: [] };
  const result = db.exec(
    "SELECT name, size, mime, mtime, hash FROM assets ORDER BY mtime DESC",
  );
  const rows = (result[0]?.values || []).map((value) => ({
    name: value[0],
    size: value[1],
    mime: value[2],
    mtime: value[3],
    hash: value[4] || "",
  }));
  return { indexed: true, rows };
};

const getAssetRow = (db, name) => {
  const clean = safeName(name);
  if (!clean) return null;
  try {
    const statement = db.prepare(
      "SELECT name, size, mime, mtime, hash FROM assets WHERE name=? LIMIT 1",
    );
    statement.bind([clean]);
    const row = statement.step() ? statement.get() : null;
    statement.free();
    if (!row) return null;
    return { name: row[0], size: row[1], mime: row[2], mtime: row[3], hash: row[4] || "" };
  } catch {
    return null;
  }
};

const upsertAssetRow = (db, row) => {
  if (!row?.name) return false;
  ensureAssetTable(db);
  const now = Date.now();
  db.run(
    "INSERT INTO assets(name,size,mime,mtime,hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?) " +
      "ON CONFLICT(name) DO UPDATE SET size=excluded.size, mime=excluded.mime, mtime=excluded.mtime, hash=excluded.hash, updated_at=excluded.updated_at",
    [row.name, row.size, row.mime, row.mtime, row.hash || "", row.created_at || now, now],
  );
  return true;
};

const deleteAssetRow = (db, name) => {
  const clean = safeName(name);
  if (!clean) return false;
  try {
    db.run("DELETE FROM assets WHERE name=?", [clean]);
    return true;
  } catch {
    return false;
  }
};

module.exports = {
  ASSET_TABLE_DDL,
  assetMime,
  fnv1a,
  buildAssetRow,
  needsReindex,
  ensureAssetTable,
  readAssetRows,
  getAssetRow,
  upsertAssetRow,
  deleteAssetRow,
};
