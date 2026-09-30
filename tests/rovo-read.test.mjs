import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRovoIssueInstruction,
  buildRovoPageInstruction,
  buildRovoSearchInstruction,
  buildRovoStatusInstruction,
  extractCitedSources,
  linkCitationMarkers,
  normalizeRovoPayload,
  parseRovoPayload,
  rovoToQuoteHtml,
} from "../src/atlassian/rovo-read.mjs";

test("status instruction stays read-only and demands JSON", () => {
  const instruction = buildRovoStatusInstruction();
  assert.match(instruction, /읽기 전용/);
  assert.match(instruction, /"rovoKind":"status"/);
  assert.match(instruction, /jiraProjects/);
  assert.match(instruction, /confluenceSpaces/);
  assert.match(instruction, /수정하지 마/);
});

test("page and issue instructions carry the detected target", () => {
  const page = buildRovoPageInstruction({
    type: "confluence",
    site: "https://example.atlassian.net",
    pageId: "123",
    source: "https://example.atlassian.net/wiki/spaces/X/pages/123",
  });
  assert.match(page, /123/);
  assert.match(page, /"rovoKind":"confluence-page"/);
  assert.match(page, /작성자/);
  const issue = buildRovoIssueInstruction({
    type: "jira",
    issueKey: "ABC-1",
    source: "https://example.atlassian.net/browse/ABC-1",
  });
  assert.match(issue, /ABC-1/);
  assert.match(issue, /"rovoKind":"jira-issue"/);
  assert.match(issue, /담당자/);
  const search = buildRovoSearchInstruction("배포 계획");
  assert.match(search, /배포 계획/);
  assert.match(search, /"rovoKind":"search"/);
});

test("payload parsing accepts fenced JSON and rejects prose", () => {
  const parsed = parseRovoPayload(
    '```json\n{"rovoKind":"status","user":{},"sites":[]}\n```',
  );
  assert.equal(parsed.ok, true);
  assert.equal(parsed.kind, "status");
  assert.equal(parseRovoPayload("그냥 설명 문장입니다.").ok, false);
  assert.equal(
    parseRovoPayload('{"rovoKind":"unknown-thing"}').code,
    "rovo_unknown_kind",
  );
});

test("normalizers cap counts and text lengths", () => {
  const normalized = normalizeRovoPayload(
    parseRovoPayload(
      JSON.stringify({
        rovoKind: "search",
        query: "x",
        results: Array.from({ length: 30 }, (_, index) => ({
          type: "confluence",
          title: `t${index}`,
          url: "https://example.atlassian.net/x",
          excerpt: "y".repeat(5000),
        })),
      }),
    ),
  );
  assert.equal(normalized.results.length, 10);
  assert.ok(normalized.results[0].excerpt.length <= 600);
  const issue = normalizeRovoPayload(
    parseRovoPayload(
      JSON.stringify({
        rovoKind: "jira-issue",
        key: "ABC-1",
        comments: ["a", "b", "c", "d", "e", "f", "g"],
      }),
    ),
  );
  assert.equal(issue.comments.length, 5);
});

test("cited sources parse numbered source lists", () => {
  const cited = extractCitedSources(
    "첫 문단 내용 [1].\n두 번째 문단 [2].\n\nSources\n1. 요구사항 - https://example.atlassian.net/wiki/1\n2. https://example.atlassian.net/browse/ABC-1",
  );
  assert.equal(cited.length, 2);
  assert.equal(cited[0].n, 1);
  assert.equal(cited[0].title, "요구사항");
  assert.equal(cited[0].url, "https://example.atlassian.net/wiki/1");
  assert.equal(extractCitedSources("출처 없는 답변입니다.").length, 0);
});

test("citation markers link without touching anchors", () => {
  const cited = [{ n: 1, title: "요구사항", url: "https://example.atlassian.net/wiki/1" }];
  const html = linkCitationMarkers("<p>내용 [1]과 [9].</p>", cited);
  assert.match(html, /<a href="https:\/\/example\.atlassian\.net\/wiki\/1">\[1\]<\/a>/);
  assert.match(html, /\[9\]/);
  const anchored = linkCitationMarkers('<p><a href="https://x">[1] 기존</a></p>', cited);
  assert.doesNotMatch(anchored, /<a[^>]*><a/);
});

test("quote html escapes hostile markup", () => {
  const html = rovoToQuoteHtml(
    {
      kind: "confluence-page",
      title: '<script>alert("x")</script>',
      space: "S",
      author: "A",
      updated: "어제",
      excerpt: "본문",
      url: "https://example.atlassian.net/wiki/1",
    },
    "2026-09-29",
  );
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /blockquote/);
  assert.match(html, /2026-09-29/);
});
