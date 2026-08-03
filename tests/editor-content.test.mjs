import assert from "node:assert/strict";
import test from "node:test";

import { editableDiagramBlock } from "../src/editor-content.mjs";

test("builds a Mermaid atom for cursor-safe insertion", () => {
  assert.deepEqual(
    editableDiagramBlock("mermaidBlock", {
      code: "erDiagram\n  A ||--o{ B : contains",
    }),
    {
      type: "mermaidBlock",
      attrs: { code: "erDiagram\n  A ||--o{ B : contains" },
    },
  );
});

test("builds every editable diagram atom", () => {
  assert.deepEqual(editableDiagramBlock("plantUmlBlock"), {
    type: "plantUmlBlock",
  });
  assert.deepEqual(
    editableDiagramBlock("drawIoBlock", { view: "edit" }),
    { type: "drawIoBlock", attrs: { view: "edit" } },
  );
});

test("diagram insertion rejects non-diagram node types", () => {
  assert.throws(
    () => editableDiagramBlock("imageGenerationBlock"),
    /Unsupported diagram block type/,
  );
});
