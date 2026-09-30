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

test("history restores apply as full-content replacements", () => {  assert.match(
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

test("model management, search picker, and API routing are wired", () => {  assert.match(appSource, /setSettingsTab\("models"\)/);
  assert.match(appSource, /공급자 연결/);
  assert.match(appSource, /ksnoteModels\?\.fetchRemote/);
  assert.match(appSource, /ksnoteModels\?\.saveKey/);
  assert.match(editorSource, /ai-model-picker/);
  assert.match(editorSource, /모델 검색/);
  assert.match(editorSource, /Reasoning effort 선택/);
  assert.match(editorSource, /reasoningEffort/);
  assert.match(editorSource, /selectedModel\?\.rawId \|\| selectedModel\?\.id/);
  assert.match(mainSource, /runApiCompletion/);
  assert.match(mainSource, /\/chat\/completions/);
  assert.match(mainSource, /effort: request\.reasoningEffort/);
});

test("note_patch replaces one block by stable id", () => {
  assert.match(
    editorSource,
    /resolveBlockNode\(editor\.state\.doc, claimed\.blockId\)/,
  );
  assert.match(
    editorSource,
    /\.insertContentAt\(patchTarget\.pos, claimed\.html \|\| ""\)/,
  );
  assert.match(appSource, /claimed\.type === "note_patch"/);
  assert.match(appSource, /findBlockById\(nextContent, claimed\.blockId\)/);
  assert.match(appSource, /교체된 블록 소스/);
});

test("note_move applies data-level and guards the editor", () => {
  assert.match(appSource, /item\.type === "note_move"/);
  assert.match(appSource, /targetProjectId/);
  assert.match(
    editorSource,
    /editorSupportedTypes = new Set\(\[/,
  );
});

test("task tools query and update by task index", () => {
  assert.match(appSource, /item\.type === "task_update"/);
  assert.match(appSource, /li\[data-type="taskItem"\], li\[data-checked\]/);
  assert.match(appSource, /data-checked", patch\.checked \? "true" : "false"/);
});

test("task_query prefers the materialized index with scan fallback", async () => {
  const serverSource = await readFile(
    new URL("../mcp/ksnote-server.mjs", import.meta.url),
    "utf8",
  );
  assert.match(serverSource, /readTaskIndex\(paths\)/);
  assert.match(serverSource, /isIndexFresh\(index, updatedAt\)/);
  assert.match(serverSource, /source: "index"/);
  assert.match(serverSource, /source: "scan"/);
  const mainSource = await readFile(
    new URL("../electron/main.cjs", import.meta.url),
    "utf8",
  );
  assert.match(mainSource, /refreshTaskIndex\(data, now\)/);
  assert.match(mainSource, /task-index\.json/);
});

test("AI edits re-resolve the target block by stable id", () => {
  assert.match(
    editorSource,
    /aiTargetRef\.current = \{[\s\S]*?blockId: editContext\.blockId/,
  );
  assert.match(
    editorSource,
    /resolveBlockNode\(editor\.state\.doc, target\.blockId\)/,
  );
  assert.match(
    editorSource,
    /resolveBlockOffset\(\s*editor\.state\.doc,\s*target\.toBlockId,\s*target\.toOffset/,
  );
});

test("research mode offers structured Rovo read queries", () => {
  assert.match(editorSource, /from "\.\/atlassian\/rovo-read\.mjs"/);
  assert.match(editorSource, /buildRovoStatusInstruction\(\)/);
  assert.match(editorSource, /buildRovoPageInstruction\(entry\)/);
  assert.match(editorSource, /buildRovoIssueInstruction\(entry\)/);
  assert.match(editorSource, /buildRovoSearchInstruction\(aiPrompt\)/);
  assert.match(editorSource, /parseRovoPayload\(rawOutput\)/);
  assert.match(editorSource, /rovoToQuoteHtml\(rovo, queriedAt\)/);
  assert.match(editorSource, /ai-rovo-card/);
});

test("publish dialog previews ADF and routes approvals", () => {
  assert.match(appSource, /ksnotePublish\?\.discover/);
  assert.match(appSource, /convertNoteToAdf\(note\.content/);
  assert.match(appSource, /validateAdf\(conversion\.document\)/);
  assert.match(appSource, /ksnotePublish\?\.publish\(/);
  assert.match(appSource, /onApproval\?/);
  assert.match(appSource, /publish-modal/);
  assert.match(mainSource, /atlassian-publish-approval/);
  assert.match(mainSource, /atlassian-publish-page/);
  assert.match(mainSource, /external_publications/);
  assert.match(mainSource, /mcpServerToolCall/);
});

test("research answers carry per-paragraph citations", () => {
  assert.match(mainSource, /cite each paragraph with markers like \[1\], \[2\]/);
  assert.match(editorSource, /extractCitedSources\(rawOutput\)/);
  assert.match(editorSource, /linkCitationMarkers\(output, cited\)/);
  assert.match(editorSource, /aiResult\.cited\?\.length/);
});

test("write actions route to the separated publish dialog", () => {
  assert.match(editorSource, /ksnote-open-publish/);
  assert.match(editorSource, /게시\(쓰기 모드\)/);
  assert.match(appSource, /ksnote-open-publish/);
  assert.match(appSource, /openPublishRef/);
});

test("approval dialog shows a before-after diff", () => {
  assert.match(appSource, /from "\.\.\/mcp\/operation-diff\.mjs"/);
  assert.match(appSource, /buildOperationDiff\(mcpApproval/);
  assert.match(appSource, /mcp-review-diff/);
  assert.match(appSource, /diff\.beforeLabel/);
  assert.match(appSource, /diff\.afterHtml/);
});

test("asset reads prefer the repository index", async () => {
  const serverSource = await readFile(
    new URL("../mcp/ksnote-server.mjs", import.meta.url),
    "utf8",
  );
  assert.match(serverSource, /readAssetIndex\(paths\)/);
  assert.match(serverSource, /index\.indexed \? index\.rows/);
  assert.match(mainSource, /ensureAssetTable\(noteDb\)/);
  assert.match(mainSource, /indexAssetDirectory\(\)/);
  assert.match(mainSource, /indexSingleAsset\(assetPath, assetName\)/);
});

test("save status is visible with failure feedback", () => {
  assert.match(appSource, /save-status/);
  assert.match(appSource, /저장됨/);
  assert.match(appSource, /저장 중…/);
  assert.match(appSource, /저장 실패/);
  assert.match(appSource, /setSaveError/);
});

test("confirmations stay inside the app", () => {
  assert.doesNotMatch(editorSource, /window\.confirm\(/);
  assert.match(editorSource, /confirmAsync\(/);
  assert.match(editorSource, /editor-confirm/);
  assert.match(editorSource, /resolveConfirm\(false\)/);
  assert.match(editorSource, /confirmRequest/);
});

test("AI results expand for long answers", () => {
  assert.match(editorSource, /ai-response expanded/);
  assert.match(editorSource, /setAiExpanded/);
  assert.match(editorSource, /펼치기/);
});

test("toasts stay readable", () => {
  assert.match(appSource, /\? 8000 : 4500/);
  assert.doesNotMatch(appSource, /\? 8000 : 2600/);
});

test("MCP server deploys over Streamable HTTP with auth", async () => {
  const serverSource = await readFile(
    new URL("../mcp/ksnote-server.mjs", import.meta.url),
    "utf8",
  );
  assert.match(serverSource, /KSNOTE_MCP_TRANSPORT/);
  assert.match(serverSource, /StreamableHTTPServerTransport/);
  assert.match(serverSource, /sessionIdGenerator: undefined/);
  assert.match(serverSource, /KSNOTE_MCP_TOKEN/);
  assert.match(serverSource, /\/health/);
  assert.match(serverSource, /KSNOTE_MCP_ALLOWED_HOSTS/);
});
