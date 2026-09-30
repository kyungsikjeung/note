import assert from "node:assert/strict";
import test from "node:test";
import { findBlockById, findDiagramBlock, findHeadingSection, listEmptyDiagramBlocks, listHeadings, listTaskItems, sliceTextLines } from "../mcp/note-html.mjs";

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

test("findBlockById locates any block by its stable id", () => {
  const html = '<h1 data-block-id="a">T</h1><p data-block-id="b">AB</p>';
  assert.deepEqual(findBlockById(html, "b"), {
    blockId: "b",
    tag: "p",
    start: html.indexOf("<p"),
    end: html.length,
    html: '<p data-block-id="b">AB</p>',
  });
  assert.equal(findBlockById(html, "z"), null);
  assert.equal(findBlockById(html, ""), null);
});

test("findBlockById balances nested same-tag blocks", () => {
  const html = '<ul data-block-id="c"><li>1<ul><li>2</li></ul></li></ul><p>tail</p>';
  const found = findBlockById(html, "c");
  assert.equal(found.tag, "ul");
  assert.equal(found.html, '<ul data-block-id="c"><li>1<ul><li>2</li></ul></li></ul>');
  assert.equal(found.end, found.html.length);
});

test("listTaskItems reads task state in document order", () => {
  const html = '<ul data-type="taskList"><li data-type="taskItem" data-checked="true" data-priority="high">Done</li><li data-type="taskItem">Todo<ul><li data-type="taskItem" data-assignee="kim">Sub</li></ul></li></ul>';
  const tasks = listTaskItems(html);
  assert.equal(tasks.length, 3);
  assert.deepEqual(
    tasks.map((task) => [task.index, task.checked, task.text]),
    [[0, true, "Done"], [1, false, "TodoSub"], [2, false, "Sub"]],
  );
  assert.equal(tasks[0].priority, "high");
  assert.equal(tasks[2].assignee, "kim");
});

test("listTaskItems ignores plain list items", () => {
  const html = '<ul><li>plain</li></ul><p>text</p>';
  assert.deepEqual(listTaskItems(html), []);
});

test("listHeadings reads heading order and levels", () => {
  const html = '<h1 data-block-id="a">Top</h1><p>x</p><h2 data-block-id="b">Sub <strong>bold</strong></h2>';
  const headings = listHeadings(html);
  assert.deepEqual(
    headings.map((heading) => [heading.level, heading.text]),
    [[1, "Top"], [2, "Sub bold"]],
  );
  assert.equal(headings[0].start, 0);
});

test("findHeadingSection prefers exact matches and stops at peer headings", () => {
  const html = '<h1>A</h1><p>a1</p><h2>B</h2><p>b1</p><h2>C</h2><p>c1</p><h1>D</h1>';
  const section = findHeadingSection(html, "b");
  assert.equal(section.heading, "B");
  assert.equal(section.level, 2);
  assert.match(section.html, /<h2>B<\/h2>/);
  assert.match(section.html, /b1/);
  assert.doesNotMatch(section.html, /c1/);
  const top = findHeadingSection(html, "A");
  assert.match(top.html, /c1/);
  assert.doesNotMatch(top.html, /<h1>D<\/h1>/);
  assert.equal(findHeadingSection(html, "missing"), null);
  assert.equal(findHeadingSection(html, ""), null);
});

test("sliceTextLines clamps 1-based ranges", () => {
  assert.deepEqual(sliceTextLines("a\nb\nc\nd", 2, 3), {
    fromLine: 2,
    toLine: 3,
    totalLines: 4,
    text: "b\nc",
  });
  const clamped = sliceTextLines("a\nb", 9, 99);
  assert.equal(clamped.fromLine, 2);
  assert.equal(clamped.toLine, 2);
  assert.equal(clamped.text, "b");
});
