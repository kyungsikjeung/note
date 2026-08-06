import assert from "node:assert/strict";
import test from "node:test";

import {
  createMermaidRenderCache,
  MERMAID_RENDER_DEBOUNCE_MS,
  scopeMermaidSvg,
} from "../src/mermaid-render-cache.mjs";

test("Mermaid rendering debounce stays within the requested range", () => {
  assert.ok(MERMAID_RENDER_DEBOUNCE_MS >= 200);
  assert.ok(MERMAID_RENDER_DEBOUNCE_MS <= 300);
});

test("same Mermaid code shares pending and cached render results", async () => {
  let renderCount = 0;
  const cache = createMermaidRenderCache(async (code, id) => {
    renderCount += 1;
    await Promise.resolve();
    return `<svg id="svg-${id}"><text>${code}</text></svg>`;
  });

  const first = cache.render("flowchart LR\nA-->B");
  const second = cache.render("flowchart LR\nA-->B");
  assert.equal(first, second);

  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(renderCount, 1);
  assert.deepEqual(firstResult, secondResult);
  assert.deepEqual(cache.peek("flowchart LR\nA-->B"), firstResult);

  await cache.render("flowchart LR\nA-->B");
  assert.equal(renderCount, 1);
  await cache.render("flowchart LR\nB-->C");
  assert.equal(renderCount, 2);
});

test("Mermaid syntax errors are cached instead of rerendered", async () => {
  let renderCount = 0;
  const cache = createMermaidRenderCache(async () => {
    renderCount += 1;
    throw new Error("bad syntax");
  });

  const first = await cache.render("not-a-diagram");
  const second = await cache.render("not-a-diagram");

  assert.equal(renderCount, 1);
  assert.equal(first.ok, false);
  assert.equal(first.error, "bad syntax");
  assert.deepEqual(second, first);
});

test("Mermaid cache evicts the least recently used code", async () => {
  const cache = createMermaidRenderCache(
    async (code) => `<svg><text>${code}</text></svg>`,
    { maxEntries: 2 },
  );

  await cache.render("A");
  await cache.render("B");
  cache.peek("A");
  await cache.render("C");

  assert.equal(cache.cacheSize, 2);
  assert.equal(cache.peek("B"), null);
  assert.equal(cache.peek("A")?.ok, true);
  assert.equal(cache.peek("C")?.ok, true);
});

test("shared Mermaid SVG gets consumer-scoped IDs without rerendering", () => {
  const svg = [
    '<svg id="diagram">',
    '<style>#edge.path{marker-end:url(#arrow)}</style>',
    '<defs><marker id="arrow"><path /></marker></defs>',
    '<path id="edge" marker-end="url(#arrow)" aria-labelledby="edge" />',
    '<use href="#edge" xlink:href="#edge" />',
    '<text>#edge remains visible</text>',
    "</svg>",
  ].join("");
  const editorSvg = scopeMermaidSvg(svg, "editor-one");
  const previewSvg = scopeMermaidSvg(svg, "preview-one");

  assert.notEqual(editorSvg, previewSvg);
  assert.match(editorSvg, /id="ks-editor-one-1-arrow"/);
  assert.match(editorSvg, /url\(#ks-editor-one-1-arrow\)/);
  assert.match(editorSvg, /href="#ks-editor-one-2-edge"/);
  assert.match(editorSvg, /xlink:href="#ks-editor-one-2-edge"/);
  assert.match(editorSvg, /aria-labelledby="ks-editor-one-2-edge"/);
  assert.match(editorSvg, /#ks-editor-one-2-edge\.path/);
  assert.match(editorSvg, /<text>#edge remains visible<\/text>/);
  assert.doesNotMatch(previewSvg, /ks-editor-one/);
});
