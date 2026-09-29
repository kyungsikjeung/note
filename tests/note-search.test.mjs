import assert from "node:assert/strict";
import test from "node:test";
import { searchNotes } from "../mcp/note-search.mjs";

const notes = [
  {
    id: "n1",
    projectId: "p1",
    title: "Mermaid 아키텍처 다이어그램",
    content: "<h1>제목</h1><p>Mermaid 렌더 검증과 아키텍처 정리</p>",
  },
  {
    id: "n2",
    projectId: "p1",
    title: "회의록",
    content: "<p>아키텍처 논의와 Mermaid, Mermaid 언급</p>",
  },
  {
    id: "n3",
    projectId: "p2",
    title: "다른 프로젝트 노트",
    content: "<p>Mermaid 한 번</p>",
  },
  {
    id: "n4",
    projectId: "p1",
    title: "삭제된 노트",
    trashed: true,
    content: "<p>Mermaid Mermaid Mermaid</p>",
  },
];

test("title matches outrank body-only matches", () => {
  const result = searchNotes(notes, { query: "Mermaid" });
  assert.equal(result.ok, true);
  assert.equal(result.total, 3);
  assert.equal(result.results[0].id, "n1");
  assert.ok(result.results[0].score > result.results[1].score);
});

test("results carry score and text snippets", () => {
  const result = searchNotes(notes, { query: "아키텍처" });
  assert.equal(result.total, 2);
  for (const item of result.results) {
    assert.ok(item.score > 0);
    assert.match(item.snippet, /아키텍처/);
  }
});

test("trashed notes never match", () => {
  const result = searchNotes(notes, { query: "삭제된" });
  assert.equal(result.total, 0);
  assert.deepEqual(result.results, []);
});

test("project scope and pagination slice the ranking", () => {
  const scoped = searchNotes(notes, { query: "Mermaid", projectId: "p2" });
  assert.equal(scoped.total, 1);
  assert.equal(scoped.results[0].id, "n3");
  const first = searchNotes(notes, { query: "Mermaid", limit: 1, offset: 0 });
  const second = searchNotes(notes, { query: "Mermaid", limit: 1, offset: 1 });
  assert.equal(first.results[0].id, "n1");
  assert.equal(second.results[0].id, "n2");
  assert.equal(first.total, 3);
});

test("empty queries are rejected", () => {
  assert.equal(searchNotes(notes, { query: "  " }).ok, false);
  assert.equal(searchNotes(notes, {}).code, "search_query_required");
});
