import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeMermaidPaste,
  validateDiagramSource,
} from "../mcp/diagram-validation.mjs";

const drawIo = (edge = '<mxCell id="e1" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry" /></mxCell>') => `<mxfile>
  <diagram name="Page-1">
    <mxGraphModel><root>
      <mxCell id="0" />
      <mxCell id="1" parent="0" />
      <mxCell id="a" value="Codex" vertex="1" parent="1"><mxGeometry x="20" y="20" width="120" height="60" as="geometry" /></mxCell>
      <mxCell id="b" value="KsNote" vertex="1" parent="1"><mxGeometry x="220" y="20" width="120" height="60" as="geometry" /></mxCell>
      ${edge}
    </root></mxGraphModel>
  </diagram>
</mxfile>`;

test("accepts supported Mermaid and PlantUML declarations", () => {
  assert.equal(validateDiagramSource("mermaid", "sequenceDiagram\nA->>B: hello").ok, true);
  assert.equal(validateDiagramSource("plantuml", "@startuml\nA -> B\n@enduml").ok, true);
});

test("rejects empty, fenced, and unsupported diagram sources", () => {
  assert.equal(validateDiagramSource("mermaid", "").code, "diagram_empty");
  assert.equal(validateDiagramSource("mermaid", "```mermaid\nflowchart LR\nA-->B\n```").code, "diagram_code_fence");
  assert.equal(validateDiagramSource("mermaid", "A --> B").code, "mermaid_declaration_invalid");
});

test("normalizes Mermaid copied from nested GPT code fences", () => {
  const source = "flowchart TB\nA[시작] --> B[완료]";
  const nested = [
    "````mermaid",
    "```mermaid",
    source,
    "```",
    "````",
  ].join("\n");
  assert.deepEqual(normalizeMermaidPaste(nested), {
    code: source,
    fenceRemoved: true,
  });
});

test("normalizes standard and dangling Mermaid fences", () => {
  const source = "sequenceDiagram\nA->>B: hello";
  assert.deepEqual(
    normalizeMermaidPaste(["```mermaid", source, "```"].join("\n")),
    { code: source, fenceRemoved: true },
  );
  assert.deepEqual(
    normalizeMermaidPaste([source, "```"].join("\n")),
    { code: source, fenceRemoved: true },
  );
  assert.deepEqual(
    normalizeMermaidPaste(["```mermaid", source].join("\n")),
    { code: source, fenceRemoved: true },
  );
  assert.deepEqual(
    normalizeMermaidPaste(`\uFEFF\`\`\`mermaid\r\n${source.replaceAll("\n", "\r\n")}\r\n\`\`\``),
    { code: source, fenceRemoved: true },
  );
  assert.deepEqual(normalizeMermaidPaste(source), {
    code: source,
    fenceRemoved: false,
  });
});

test("does not reinterpret non-Mermaid fenced code as a diagram", () => {
  assert.equal(
    normalizeMermaidPaste(
      ["```javascript", "flowchart TB", "A --> B", "```"].join("\n"),
    ),
    null,
  );
  assert.equal(
    normalizeMermaidPaste(
      ["```markdown", "flowchart TB", "A --> B", "```"].join("\n"),
    ),
    null,
  );
  assert.equal(normalizeMermaidPaste("설명 텍스트\n```"), null);
});

test("validates draw.io graph cells and connected edges", () => {
  const result = validateDiagramSource("drawio", drawIo());
  assert.equal(result.ok, true);
  assert.deepEqual(result.details, { pages: 1, cells: 5, vertices: 2, edges: 1 });
});

test("rejects draw.io edges with missing endpoints", () => {
  const result = validateDiagramSource(
    "drawio",
    drawIo('<mxCell id="e1" edge="1" parent="1" source="a" target="missing"><mxGeometry relative="1" as="geometry" /></mxCell>'),
  );
  assert.equal(result.code, "drawio_edge_endpoint_missing");
});

test("rejects unsafe and empty draw.io documents", () => {
  assert.equal(
    validateDiagramSource("drawio", `<!DOCTYPE mxfile><mxfile><diagram><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>`).code,
    "drawio_unsafe_xml",
  );
  assert.equal(
    validateDiagramSource("drawio", `<mxfile><diagram><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>`).code,
    "drawio_no_vertices",
  );
});
