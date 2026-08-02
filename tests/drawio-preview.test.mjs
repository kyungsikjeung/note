import assert from "node:assert/strict";
import test from "node:test";
import {
  clampDrawioZoom,
  isDrawioSvgDataUrl,
  normalizeDrawioView,
  stepDrawioZoom,
} from "../mcp/drawio-preview.mjs";

test("draw.io view mode accepts Editor, XML, and Preview states", () => {
  assert.equal(normalizeDrawioView("edit"), "edit");
  assert.equal(normalizeDrawioView("SOURCE"), "source");
  assert.equal(normalizeDrawioView(" preview "), "preview");
  assert.equal(normalizeDrawioView("unknown"), "edit");
});

test("draw.io preview only accepts SVG data URLs", () => {
  assert.equal(
    isDrawioSvgDataUrl("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="),
    true,
  );
  assert.equal(
    isDrawioSvgDataUrl("data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C/svg%3E"),
    true,
  );
  assert.equal(isDrawioSvgDataUrl("data:image/png;base64,AAAA"), false);
  assert.equal(isDrawioSvgDataUrl("<svg></svg>"), false);
});

test("draw.io viewer zoom remains within 25% and 400%", () => {
  assert.equal(clampDrawioZoom(0.1), 0.25);
  assert.equal(clampDrawioZoom(1.5), 1.5);
  assert.equal(clampDrawioZoom(8), 4);
  assert.equal(clampDrawioZoom("invalid"), 1);
  assert.equal(stepDrawioZoom(1, 1), 1.25);
  assert.equal(stepDrawioZoom(1, -1), 0.75);
  assert.equal(stepDrawioZoom(4, 1), 4);
});
