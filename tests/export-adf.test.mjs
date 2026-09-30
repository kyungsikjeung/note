import assert from "node:assert/strict";
import test from "node:test";
import { convertNoteToAdf, validateAdf } from "../src/atlassian/export-adf.mjs";

test("headings, paragraphs, and marks convert", () => {
  const result = convertNoteToAdf(
    '<h2 data-block-id="a">제목</h2><p data-block-id="b">굵은 <strong>강조</strong>와 <a href="https://example.com">링크</a></p>',
    { sourceRevision: "r1" },
  );
  assert.deepEqual(result.document, {
    version: 1,
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "제목" }],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "굵은 " },
          { type: "text", text: "강조", marks: [{ type: "strong" }] },
          { type: "text", text: "와 " },
          {
            type: "text",
            text: "링크",
            marks: [{ type: "link", attrs: { href: "https://example.com" } }],
          },
        ],
      },
    ],
  });
  assert.equal(result.sourceRevision, "r1");
  assert.deepEqual(validateAdf(result.document), { ok: true });
});

test("lists and code blocks convert", () => {
  const result = convertNoteToAdf(
    '<ul><li>one</li><li>two</li></ul><ol><li>first</li></ol><pre><code class="language-js">const a = 1;</code></pre>',
  );
  assert.equal(result.document.content[0].type, "bulletList");
  assert.equal(result.document.content[0].content.length, 2);
  assert.equal(result.document.content[1].type, "orderedList");
  assert.deepEqual(result.document.content[2], {
    type: "codeBlock",
    attrs: { language: "js" },
    content: [{ type: "text", text: "const a = 1;" }],
  });
});

test("tables map widths, spans, and clamp to range", () => {
  const result = convertNoteToAdf(
    '<table><colgroup><col style="width: 3000px"><col></colgroup><tr><th>H1</th><th>H2</th></tr><tr><td colspan="2">Wide</td></tr></table>',
  );
  const table = result.document.content[0];
  assert.equal(table.type, "table");
  assert.equal(table.attrs.width, 1800);
  assert.deepEqual(table.content[1].content[0].attrs.colspan, 2);
  assert.ok(table.content[0].content[0].attrs.colwidth.every((width) => width > 0));
  assert.ok(result.warnings.some((warning) => warning.code === "table-width-clamped"));
  assert.deepEqual(validateAdf(result.document), { ok: true });
});

test("jira target warns about table widths", () => {
  const result = convertNoteToAdf("<table><tr><td>A</td></tr></table>", {
    target: "jira",
  });
  assert.ok(result.warnings.some((warning) => warning.code === "table-width-jira"));
});

test("public images become cards, local images are omitted", () => {
  const result = convertNoteToAdf(
    '<p><img src="https://example.com/a.png" alt="a"></p><p><img src="file:///tmp/b.png"></p>',
  );
  assert.deepEqual(result.document.content[0], {
    type: "blockCard",
    attrs: { url: "https://example.com/a.png" },
  });
  assert.equal(result.omittedAssets.length, 1);
  assert.ok(result.omittedAssets[0].src.includes("/tmp/b.png"));
  assert.ok(result.warnings.some((warning) => warning.code === "image-omitted"));
});

test("diagram blocks become code blocks", () => {
  const result = convertNoteToAdf(
    '<div data-type="mermaid" data-code="flowchart LR&#10;  A --&gt; B"></div><div data-type="plantuml" data-code="@startuml&#10;A -&gt; B"></div>',
  );
  assert.deepEqual(result.document.content[0], {
    type: "codeBlock",
    attrs: { language: "mermaid" },
    content: [{ type: "text", text: "flowchart LR\n  A --> B" }],
  });
  assert.equal(result.document.content[1].attrs.language, "plantuml");
});

test("content hash is deterministic", () => {
  const html = "<p>same</p>";
  assert.equal(
    convertNoteToAdf(html).contentHash,
    convertNoteToAdf(html).contentHash,
  );
  assert.notEqual(
    convertNoteToAdf(html).contentHash,
    convertNoteToAdf("<p>other</p>").contentHash,
  );
});

test("validateAdf rejects malformed documents", () => {
  assert.equal(validateAdf(null).ok, false);
  assert.equal(validateAdf({ version: 1, type: "doc", content: [{ type: 42 }] }).ok, false);
  assert.equal(
    validateAdf({
      version: 1,
      type: "doc",
      content: [{ type: "table", attrs: { width: 50 }, content: [] }],
    }).code,
    "adf_table_width_invalid",
  );
});
