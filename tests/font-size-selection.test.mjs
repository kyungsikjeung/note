import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const editorSource = await readFile(
  new URL("../src/RichDocumentEditor.jsx", import.meta.url),
  "utf8",
);
const editorStyles = await readFile(
  new URL("../src/rich-editor.css", import.meta.url),
  "utf8",
);

test("font-size controls use the active TipTap selection", () => {
  assert.match(editorSource, /const FontSize = Extension\.create\(/);
  assert.match(editorSource, /FontSize,/);
  assert.match(
    editorSource,
    /aria-label="글자 크기"[\s\S]*?setMark\("textStyle", \{ fontSize: `\$\{value\}px` \}\)/,
  );
  assert.match(editorSource, /else savedSelection\.current = null;/);
  assert.match(editorSource, /selection\.from < selection\.to/);
  assert.match(editorStyles, /var\(--ks-editor-size, 14px\)/);
});
