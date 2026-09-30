const REVISION_TABLE_DDL =
  "CREATE TABLE IF NOT EXISTS revisions (id INTEGER PRIMARY KEY AUTOINCREMENT, note_id TEXT NOT NULL, title TEXT, content TEXT NOT NULL, created_at INTEGER NOT NULL)";

const REVISION_KEEP_PER_NOTE = 50;

const ensureRevisionTable = (db) => {
  db.run(REVISION_TABLE_DDL);
};

const snapshotChangedNotes = (db, previousNotes, nextNotes, now) => {
  if (!Array.isArray(previousNotes)) return 0;
  const timestamp = Number.isFinite(now) ? now : Date.now();
  const previousById = new Map(
    previousNotes
      .filter((note) => note && note.id)
      .map((note) => [note.id, note]),
  );
  const insert = db.prepare(
    "INSERT INTO revisions(note_id,title,content,created_at) VALUES(?,?,?,?)",
  );
  let inserted = 0;
  try {
    for (const note of nextNotes || []) {
      if (!note?.id) continue;
      const old = previousById.get(note.id);
      if (old && old.content !== note.content) {
        insert.run([old.id, old.title || "", old.content || "", timestamp]);
        inserted += 1;
      }
    }
  } finally {
    insert.free();
  }
  return inserted;
};

const pruneRevisions = (db, keep = REVISION_KEEP_PER_NOTE) => {
  const limit = Math.max(1, Number(keep) || REVISION_KEEP_PER_NOTE);
  db.run(
    "DELETE FROM revisions WHERE id IN (SELECT id FROM revisions r WHERE (SELECT COUNT(*) FROM revisions newer WHERE newer.note_id=r.note_id AND newer.id>=r.id)>?)",
    [limit],
  );
};

const listRevisions = (db, noteId, { withContent = false, limit = 50 } = {}) => {
  const columns = withContent
    ? "id, note_id, title, content, created_at"
    : "id, title, created_at";
  const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));
  const statement = db.prepare(
    `SELECT ${columns} FROM revisions WHERE note_id=? ORDER BY id DESC LIMIT ${safeLimit}`,
  );
  statement.bind([String(noteId)]);
  const rows = [];
  try {
    while (statement.step()) rows.push(statement.getAsObject());
  } finally {
    statement.free();
  }
  return rows;
};

const getRevisionContent = (db, id) => {
  const statement = db.prepare("SELECT content FROM revisions WHERE id=?");
  statement.bind([Number(id)]);
  try {
    return statement.step() ? statement.getAsObject() : null;
  } finally {
    statement.free();
  }
};

module.exports = {
  REVISION_TABLE_DDL,
  REVISION_KEEP_PER_NOTE,
  ensureRevisionTable,
  snapshotChangedNotes,
  pruneRevisions,
  listRevisions,
  getRevisionContent,
};
