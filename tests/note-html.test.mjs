import assert from "node:assert/strict";
import test from "node:test";
import { findDiagramBlock, listEmptyDiagramBlocks } from "../mcp/note-html.mjs";

test("findDiagramBlock returns an exact diagram block", () => {
  const html = '<p data-block-id="p1">hello</p><div data-code="flowchart LR\n A--&gt;B" data-block-id="d1" data-type="mermaid"></div>';
  assert.deepEqual(findDiagramBlock(html, "d1"), {
    blockId: "d1",
    format: "mermaid",
    code: "flowchart LR\n A--&gt;B",
    start: html.indexOf("<div"),
    end: html.length,
    html: html.slice(html.indexOf("<div")),
  });
});

test("findDiagramBlock does not accept a non-diagram block", () => {
  assert.equal(findDiagramBlock('<div data-block-id="x" data-type="attachment"></div>', "x"), null);
});

test("listEmptyDiagramBlocks finds only empty diagram sources", () => {
  const html = [
    '<div data-block-id="a" data-code="" data-type="mermaid"></div>',
    '<div data-block-id="b" data-code="@startuml&#10;@enduml" data-type="plantuml"></div>',
    '<div data-block-id="c" data-code="   " data-type="drawio"></div>',
  ].join("");
  assert.deepEqual(listEmptyDiagramBlocks(html), [
    { blockId: "a", format: "mermaid" },
    { blockId: "c", format: "drawio" },
  ]);
});
