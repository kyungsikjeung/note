import assert from "node:assert/strict";
import test from "node:test";

import viteConfig from "../vite.config.mjs";
import packageJson from "../package.json" with { type: "json" };

test("packaged renderer uses file-safe relative asset URLs", () => {
  assert.equal(viteConfig.base, "./");
});

test("package includes MCP runtime and bundled PlantUML resource", () => {
  assert.deepEqual(packageJson.build.files, [
    "dist/**/*",
    "electron/**/*",
    "mcp/**/*",
    "package.json",
  ]);
  assert.deepEqual(packageJson.build.extraResources, [
    {
      from: "build-resources/plantuml/plantuml.jar",
      to: "plantuml/plantuml.jar",
    },
  ]);
});
