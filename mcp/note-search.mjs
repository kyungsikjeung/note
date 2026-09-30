const TITLE_WEIGHT = 10;
const SNIPPET_RADIUS = 60;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

const plainText = (value) =>
  String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .trim();

const countOccurrences = (haystack, needle) => {
  if (!needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index >= 0) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
};

const buildSnippet = (text, needle) => {
  const source = String(text || "");
  if (!source) return "";
  const lower = source.toLowerCase();
  const at = needle ? lower.indexOf(needle.toLowerCase()) : -1;
  const center = at >= 0 ? at : 0;
  const start = Math.max(0, center - SNIPPET_RADIUS);
  const end = Math.min(
    source.length,
    (at >= 0 ? at + needle.length : 0) + SNIPPET_RADIUS,
  );
  const prefix = start > 0 ? "…" : "";
  const suffix = end < source.length ? "…" : "";
  return `${prefix}${source.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`;
};

export const searchNotes = (
  notes = [],
  { query, projectId, limit, offset } = {},
) => {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle)
    return { ok: false, code: "search_query_required" };
  const safeLimit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number.isFinite(Number(limit)) ? Number(limit) : DEFAULT_LIMIT),
  );
  const safeOffset = Math.max(
    0,
    Number.isFinite(Number(offset)) ? Number(offset) : 0,
  );
  const ranked = [];
  for (const note of notes) {
    if (!note || note.trashed) continue;
    if (projectId && note.projectId !== projectId) continue;
    const title = String(note.title || "");
    const text = plainText(note.content);
    const titleHits = countOccurrences(title.toLowerCase(), needle);
    const bodyHits = countOccurrences(text.toLowerCase(), needle);
    if (!titleHits && !bodyHits) continue;
    ranked.push({
      note,
      title,
      text,
      score: titleHits * TITLE_WEIGHT + bodyHits,
    });
  }
  ranked.sort((a, b) => b.score - a.score);
  const results = ranked
    .slice(safeOffset, safeOffset + safeLimit)
    .map(({ note, title, text, score }) => ({
      id: note.id,
      title,
      projectId: note.projectId,
      score,
      snippet: buildSnippet(text, needle),
    }));
  return {
    ok: true,
    query: String(query).trim(),
    total: ranked.length,
    limit: safeLimit,
    offset: safeOffset,
    results,
  };
};
