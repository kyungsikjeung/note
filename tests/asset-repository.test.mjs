import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import {
  assetMime,
  buildAssetRow,
  deleteAssetRow,
  ensureAssetTable,
  fnv1a,
  getAssetRow,
  needsReindex,
  readAssetRows,
  upsertAssetRow,
} from "../electron/asset-repository.cjs";

const require = createRequire(import.meta.url);

const openTestDb = async () => {
  const initSqlJs = require("sql.js");
  const SQL = await initSqlJs({
    locateFile: () =>
      require.resolve("sql.js/dist/sql-wasm.wasm"),
  });
  return new SQL.Database();
};

test("mime mapping covers images, video, and documents", () => {
  assert.equal(assetMime("a.png"), "image/png");
  assert.equal(assetMime("a.JPG"), "image/jpeg");
  assert.equal(assetMime("a.svg"), "image/svg+xml");
  assert.equal(assetMime("a.mp4"), "video/mp4");
  assert.equal(assetMime("a.pdf"), "application/pdf");
  assert.equal(assetMime("a.bin"), "application/octet-stream");
});

test("row builder hashes bytes and strips paths", () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const row = buildAssetRow({ name: "dir/a.png", size: 3, mtime: 7, bytes });
  assert.equal(row.name, "a.png");
  assert.equal(row.mime, "image/png");
  assert.equal(row.hash, fnv1a(bytes));
  assert.equal(buildAssetRow({ name: "" }), null);
  const noBytes = buildAssetRow({ name: "a.png", size: 3, mtime: 7 });
  assert.equal(noBytes.hash, "");
});

test("reindex triggers only on size or mtime drift", () => {
  const existing = { size: 3, mtime: 7 };
  assert.equal(needsReindex(null, existing), true);
  assert.equal(needsReindex(existing, { size: 3, mtime: 7 }), false);
  assert.equal(needsReindex(existing, { size: 4, mtime: 7 }), true);
  assert.equal(needsReindex(existing, { size: 3, mtime: 8 }), true);
});

test("asset table round-trips rows and reports legacy DBs", async () => {
  const db = await openTestDb();
  assert.deepEqual(readAssetRows(db), { indexed: false, rows: [] });
  ensureAssetTable(db);
  assert.deepEqual(readAssetRows(db), { indexed: true, rows: [] });
  upsertAssetRow(db, buildAssetRow({
    name: "a.png",
    size: 3,
    mtime: 7,
    bytes: new Uint8Array([1, 2, 3]),
  }));
  const listed = readAssetRows(db);
  assert.equal(listed.indexed, true);
  assert.equal(listed.rows.length, 1);
  assert.equal(listed.rows[0].name, "a.png");
  assert.equal(getAssetRow(db, "a.png").size, 3);
  assert.equal(getAssetRow(db, "missing"), null);
  upsertAssetRow(db, buildAssetRow({ name: "a.png", size: 9, mtime: 8 }));
  assert.equal(getAssetRow(db, "a.png").size, 9);
  deleteAssetRow(db, "a.png");
  assert.equal(getAssetRow(db, "a.png"), null);
  db.close();
});
