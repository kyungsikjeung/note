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
const appSource = await readFile(
  new URL("../src/main.jsx", import.meta.url),
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

test("ctrl+wheel adjusts prefs font size inside the editor only", () => {
  assert.match(appSource, /document\.addEventListener\("wheel", onWheel, \{ passive: false \}\)/);
  assert.match(
    appSource,
    /\(\!event\.ctrlKey && \!event\.metaKey\) \|\| \!event\.target\?\.closest\?\.\("\.mori-rich-content"\)/,
  );
  assert.match(appSource, /event\.preventDefault\(\);/);
  assert.match(appSource, /const delta = event\.deltaY > 0 \? -1 : 1;/);
  assert.match(
    appSource,
    /Math\.min\(24, Math\.max\(11, \(Number\(prev\.fontSize\) \|\| 14\) \+ delta\)\)/,
  );
  assert.match(appSource, /return \{ \.\.\.prev, fontSize: next \};/);
  assert.match(
    appSource,
    /document\.removeEventListener\("wheel", onWheel\)/,
  );
  assert.match(appSource, /min="11"/);
  assert.match(appSource, /max="24"/);
  assert.match(
    appSource,
    /Math\.min\(\s*24,\s*Math\.max\(11, Number\(e\.target\.value\) \|\| 14\),?\s*\)/,
  );
  assert.match(appSource, /\["편집기 글자 크기", "Ctrl \+ 휠"\]/);
});
