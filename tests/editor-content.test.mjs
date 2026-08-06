import assert from "node:assert/strict";
import test from "node:test";
import { Schema } from "@tiptap/pm/model";
import { Selection, TextSelection } from "@tiptap/pm/state";

import {
  calloutBlock,
  editableDiagramBlock,
  editableDiagramWithTrailingParagraph,
  normalizeCalloutVariant,
} from "../src/editor-content.mjs";

test("builds editable info and warning callout blocks", () => {
  assert.deepEqual(calloutBlock("info"), {
    type: "calloutBlock",
    attrs: { variant: "info" },
    content: [{ type: "paragraph" }],
  });
  assert.deepEqual(calloutBlock("warn"), {
    type: "calloutBlock",
    attrs: { variant: "warning" },
    content: [{ type: "paragraph" }],
  });
  assert.equal(normalizeCalloutVariant("warning"), "warning");
  assert.equal(normalizeCalloutVariant("unknown"), "info");
});

test("callout insertion rejects unsupported variants", () => {
  assert.throws(() => calloutBlock("success"), /Unsupported callout variant/);
});

test("callout JSON keeps the insertion caret inside an editable paragraph", () => {
  const schema = new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { group: "block", content: "text*" },
      calloutBlock: {
        group: "block",
        content: "block+",
        attrs: { variant: { default: "info" } },
      },
      text: { group: "inline" },
    },
  });
  const doc = schema.nodeFromJSON({
    type: "doc",
    content: [calloutBlock("info"), { type: "paragraph" }],
  });
  const selection = TextSelection.create(doc, 2);

  assert.doesNotThrow(() => doc.check());
  assert.equal(selection.$from.node(1).type.name, "calloutBlock");
  assert.equal(selection.$from.parent.type.name, "paragraph");
});

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

test("builds a Mermaid block followed by an editable paragraph", () => {
  assert.deepEqual(
    editableDiagramWithTrailingParagraph("mermaidBlock", {
      code: "flowchart LR\nA-->B",
    }),
    [
      {
        type: "mermaidBlock",
        attrs: { code: "flowchart LR\nA-->B" },
      },
      { type: "paragraph" },
    ],
  );
});

test("Mermaid insertion end resolves inside the trailing paragraph", () => {
  const schema = new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { group: "block", content: "text*" },
      mermaidBlock: {
        group: "block",
        atom: true,
        attrs: { code: { default: "" } },
      },
      text: { group: "inline" },
    },
  });
  const doc = schema.nodeFromJSON({
    type: "doc",
    content: editableDiagramWithTrailingParagraph("mermaidBlock", {
      code: "flowchart LR\nA-->B",
    }),
  });
  const selection = Selection.near(doc.resolve(doc.content.size), -1);

  assert.ok(selection instanceof TextSelection);
  assert.equal(selection.$from.parent.type.name, "paragraph");
});

test("diagram insertion rejects non-diagram node types", () => {
  assert.throws(
    () => editableDiagramBlock("imageGenerationBlock"),
    /Unsupported diagram block type/,
  );
});
