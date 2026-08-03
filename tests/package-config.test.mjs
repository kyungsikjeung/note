import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import viteConfig from "../vite.config.mjs";
import packageJson from "../package.json" with { type: "json" };

const electronMain = await readFile(
  new URL("../electron/main.cjs", import.meta.url),
  "utf8",
);

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

test("desktop runtime prevents competing app instances", () => {
  assert.match(electronMain, /app\.requestSingleInstanceLock\(\)/);
  assert.match(electronMain, /app\.on\("second-instance"/);
});

test("desktop runtime records startup and renderer failures", () => {
  assert.match(electronMain, /"render-process-gone"/);
  assert.match(electronMain, /"child-process-gone"/);
  assert.match(electronMain, /"startup-failed"/);
  assert.match(electronMain, /"unhandled-rejection"/);
  assert.match(electronMain, /runtime\.jsonl/);
});
