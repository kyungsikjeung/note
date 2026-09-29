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
const mermaidCacheSource = await readFile(
  new URL("../src/mermaid-render-cache.mjs", import.meta.url),
  "utf8",
);
const mainSource = await readFile(
  new URL("../electron/main.cjs", import.meta.url),
  "utf8",
);
const appSource = await readFile(
  new URL("../src/main.jsx", import.meta.url),
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

test("Mermaid paste inserts an explicit trailing editable paragraph", () => {
  assert.match(
    editorSource,
    /editableDiagramWithTrailingParagraph\("mermaidBlock",\s*\{\s*code: mermaidPaste\.code/,
  );
  assert.match(
    mermaidCacheSource,
    /export const MERMAID_RENDER_DEBOUNCE_MS = 2\d\d;/,
  );
});

test("editor and preview share the code-keyed Mermaid render cache", () => {
  assert.match(editorSource, /const sharedMermaidRenders =/);
  assert.match(editorSource, /sharedMermaidRenders\.peek\(code\)/);
  assert.match(editorSource, /sharedMermaidRenders\.pending\(code\)/);
  assert.match(editorSource, /sharedMermaidRenders\.render\(code\)/);
  assert.doesNotMatch(editorSource, /const mermaidCache = useRef/);
  assert.doesNotMatch(editorSource, /const mermaidPending = useRef/);
});

test("diagram blocks default to preview and copy rendered PNG images", () => {
  assert.equal(
    editorSource.match(/\[mode, setMode\] = useState\("preview"\)/g)?.length,
    2,
  );
  assert.match(editorSource, /const copySvgImageToClipboard = async \(svg\)/);
  assert.match(
    editorSource,
    /new window\.ClipboardItem\(\{ "image\/png": svgToPngBlob\(svg\) \}\)/,
  );
  assert.match(editorSource, /<DiagramImageCopyButton svg=\{svg\} \/>/);
  assert.match(editorSource, /<DiagramImageCopyButton svg=\{svgOutput\} \/>/);
  assert.match(editorSource, /"이미지 복사"/);
});

test("AI panel offers an automatic diagram format choice in edit mode", () => {
  assert.match(
    editorSource,
    /\[aiDiagramFormat, setAiDiagramFormat\] = useState\("auto"\)/,
  );
  assert.match(editorSource, /aria-label="다이어그램 형식 선택"/);
  assert.match(editorSource, /<option value="auto">자동 형식<\/option>/);
  assert.match(
    editorSource,
    /diagramFormat: aiMode === "edit" \? aiDiagramFormat : "auto"/,
  );
  assert.match(mainSource, /DIAGRAM FORMAT PREFERENCE/);
  assert.match(
    mainSource,
    /\["mermaid", "plantuml", "drawio"\]\.includes\(request\.diagramFormat\)/,
  );
});

test("approved operations on other pages apply in the background", () => {  assert.match(appSource, /isBackgroundApplicableMcpOperation/);
  assert.match(
    appSource,
    /if \(format === "drawio"\) return false;/,
  );
  assert.match(
    appSource,
    /if \(await applyOperationInBackground\(operation, targetNote\)\) return;/,
  );
  assert.match(appSource, /background: true/);
  assert.match(appSource, /findDiagramBlock\(nextContent, claimed\.target\?\.blockId\)/);
  assert.match(appSource, /data-render-status="verified"/);
});

test("completion toasts offer target navigation and source view", () => {  assert.match(appSource, /toast-goto/);
  assert.match(appSource, /대상 이동/);
  assert.match(appSource, /toast-source/);
  assert.match(appSource, /소스 보기/);
  assert.match(appSource, /source-view-pre/);
  assert.match(appSource, /onGoToTarget/);
  assert.match(appSource, /onShowSource/);
  assert.match(editorSource, /targetNoteId: noteId/);
});

test("click targets insert at the anchored block offset", () => {  assert.match(
    editorSource,
    /resolveBlockOffset\(\s*editor\.state\.doc,\s*target\.blockId,\s*target\.offset,/,
  );
  assert.match(
    editorSource,
    /resolveBlockOffset\(\s*editor\.state\.doc,\s*target\.toBlockId,\s*target\.toOffset,/,
  );
  assert.match(editorSource, /from "\.\/block-anchor\.mjs"/);
});

test("history restores apply as full-content replacements", () => {
  assert.match(
    editorSource,
    /claimed\.type === "history_restore"/,
  );
  assert.match(
    editorSource,
    /editor\.chain\(\)\.focus\(\)\.setContent\(claimed\.content\)\.run\(\)/,
  );
  assert.match(appSource, /claimed\.type === "history_restore"/);
  assert.match(appSource, /복원된 스냅샷/);
});
