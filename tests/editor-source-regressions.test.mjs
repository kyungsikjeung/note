import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const editorSource = await readFile(
  new URL("../src/RichDocumentEditor.jsx", import.meta.url),
  "utf8",
);

test("palette commands have a defined table-state guard", () => {
  assert.match(
    editorSource,
    /const inTable = editor\.isActive\("table"\);/,
  );
  assert.match(
    editorSource,
    /editor\.state\.selection instanceof TextSelection/,
  );
  assert.match(editorSource, /if \(inTable && !hasSelectedText\)/);
  assert.match(editorSource, /restoreSelection\(editor\.chain\(\)\.focus\(\)\)\s*\.setColor/);
  assert.match(editorSource, /restoreSelection\(editor\.chain\(\)\.focus\(\)\)\s*\.toggleHighlight/);
});

test("Mermaid paste inserts a trailing editable paragraph", () => {
  assert.match(
    editorSource,
    /editableDiagramBlock\("mermaidBlock",\s*\{\s*code: mermaidPaste\.code/,
  );
  assert.match(editorSource, /\.createParagraphNear\(\)/);
});

test("Mermaid rendering coalesces rapid preview updates", () => {
  assert.match(editorSource, /const MERMAID_RENDER_DEBOUNCE_MS = \d+;/);
  assert.match(editorSource, /const mermaidCache = useRef\(new Map\(\)\);/);
  assert.match(editorSource, /const mermaidPending = useRef\(new Map\(\)\);/);
});
