import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const editorSource = await readFile(
  new URL("../src/RichDocumentEditor.jsx", import.meta.url),
  "utf8",
);
const calloutStyles = await readFile(
  new URL("../src/callout-block.css", import.meta.url),
  "utf8",
);

test("Info and Warning macros serialize as editable callout blocks", () => {
  assert.match(editorSource, /name: "calloutBlock"/);
  assert.match(editorSource, /content: "block\+"/);
  assert.match(editorSource, /command: "\/info"/);
  assert.match(editorSource, /command: "\/warn"/);
  assert.match(editorSource, /insertContent\(\[calloutBlock\(item\.id\)/);
  assert.match(editorSource, /setTextSelection\(current\.from \+ 1\)/);
  assert.match(
    editorSource,
    /updateAttributes\("calloutBlock", \{ variant \}\)/,
  );
  assert.match(calloutStyles, /data-type="callout"/);
  assert.match(calloutStyles, /data-variant="warning"/);
  assert.match(
    editorSource,
    /paragraph\.closest\('aside\[data-type="callout"\]'\)/,
  );
});

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
