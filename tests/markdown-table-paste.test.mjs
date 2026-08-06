import assert from "node:assert/strict";
import test from "node:test";
import { marked } from "marked";

import { normalizeMarkdownTablePaste } from "../src/markdown-table-paste.mjs";

test("normalizes a titled Markdown table with blank lines between rows", () => {
  const input = [
    "외부 인터페이스",
    "",
    "| 인터페이스 | 형식 | 현재 계약 |",
    "",
    "|---|---|---|",
    "",
    "| 디폴트 팔레트 | CSV | 세션 최초 1회 로드 |",
    "",
    "| 튜닝 팔레트 | XLSX/XLSM | 첫 시트 |",
    "",
    "| 패턴 Export | XLSX | Tuning 출력은 ColorTable=Tuning, ColorTag=<tag> 기록 |",
  ].join("\n");
  const result = normalizeMarkdownTablePaste(input);

  assert.deepEqual(result, {
    markdown: [
      "외부 인터페이스",
      "",
      "| 인터페이스 | 형식 | 현재 계약 |",
      "| --- | --- | --- |",
      "| 디폴트 팔레트 | CSV | 세션 최초 1회 로드 |",
      "| 튜닝 팔레트 | XLSX/XLSM | 첫 시트 |",
      "| 패턴 Export | XLSX | Tuning 출력은 ColorTable=Tuning, ColorTag=&lt;tag&gt; 기록 |",
    ].join("\n"),
    columnCount: 3,
    dataRowCount: 3,
  });
  const html = marked.parse(result.markdown);
  assert.match(html, /<p>외부 인터페이스<\/p>/);
  assert.match(html, /<table>/);
  assert.match(html, /<th>인터페이스<\/th>/);
  assert.match(html, /<td>CSV<\/td>/);
  assert.match(html, /ColorTag=&lt;tag&gt; 기록/);
});

test("preserves escaped and inline-code pipes inside cells", () => {
  const result = normalizeMarkdownTablePaste(
    [
      "| 이름 | 값 |",
      "| --- | --- |",
      "| escaped | A \\| B |",
      "| code | `A | B` |",
    ].join("\n"),
  );

  assert.equal(result.columnCount, 2);
  assert.equal(result.dataRowCount, 2);
  assert.match(result.markdown, /A \\| B/);
  assert.match(result.markdown, /`A \\| B`/);
  const html = marked.parse(result.markdown);
  assert.match(html, /<td>A \| B<\/td>/);
  assert.match(html, /<code>A \| B<\/code>/);
});

test("preserves prose before and after a Markdown table", () => {
  const result = normalizeMarkdownTablePaste(
    [
      "표 설명",
      "",
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "추가 설명",
    ].join("\n"),
  );

  assert.equal(
    result.markdown,
    [
      "표 설명",
      "",
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "추가 설명",
    ].join("\n"),
  );
});

test("does not treat ordinary pipe text or CSV as a Markdown table", () => {
  assert.equal(normalizeMarkdownTablePaste("A | B\n설명 문장"), null);
  assert.equal(normalizeMarkdownTablePaste("A,B\n1,2"), null);
  assert.equal(
    normalizeMarkdownTablePaste("| A | B |\n| not-a-separator | row |"),
    null,
  );
});

test("supports contiguous aligned tables with BOM and CRLF", () => {
  const result = normalizeMarkdownTablePaste(
    "\uFEFF| 왼쪽 | 오른쪽 |\r\n| :--- | ---: |\r\n| 1 | 2 |",
  );
  assert.deepEqual(result, {
    markdown: "| 왼쪽 | 오른쪽 |\n| :--- | ---: |\n| 1 | 2 |",
    columnCount: 2,
    dataRowCount: 1,
  });
});

test("ignores pipe tables inside fenced code", () => {
  assert.equal(
    normalizeMarkdownTablePaste(
      [
        "```markdown",
        "| A | B |",
        "| --- | --- |",
        "| 1 | 2 |",
        "```",
      ].join("\n"),
    ),
    null,
  );
});

test("does not merge a following Markdown table into the first table", () => {
  const result = normalizeMarkdownTablePaste(
    [
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "| C | D |",
      "| --- | --- |",
      "| 3 | 4 |",
    ].join("\n"),
  );
  assert.equal(result.dataRowCount, 1);
  assert.match(result.markdown, /\| C \| D \|\n\| --- \| --- \|/);
});
