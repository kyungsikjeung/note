#!/usr/bin/env node
import process from "node:process";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const cliArgs = process.argv.slice(2);
const packageIndex = cliArgs.indexOf("--package-dir");
const packageDir = packageIndex >= 0 ? cliArgs[packageIndex + 1] : "";
if (packageIndex >= 0) cliArgs.splice(packageIndex, 2);
const [toolName, rawArgs = "{}"] = cliArgs;
if (!toolName) {
  console.error("Usage: node scripts/ksnote-mcp-call.mjs <tool> '<json args>' [--package-dir <win-unpacked>]");
  process.exit(2);
}

let args;
try {
  const jsonArgs = rawArgs.startsWith("base64:")
    ? Buffer.from(rawArgs.slice("base64:".length), "base64").toString("utf8")
    : rawArgs;
  args = JSON.parse(jsonArgs);
} catch (error) {
  console.error(`Invalid JSON arguments: ${error.message}`);
  process.exit(2);
}

const client = new Client({ name: "ksnote-local-verifier", version: "0.1.0" });
const serverCommand = packageDir ? path.join(packageDir, "KsNote.exe") : process.execPath;
const serverScript = packageDir
  ? path.join(packageDir, "resources", "app.asar", "mcp", "ksnote-server.mjs")
  : "mcp/ksnote-server.mjs";
const transport = new StdioClientTransport({
  command: serverCommand,
  args: [serverScript],
  cwd: packageDir || process.cwd(),
  env: {
    ...process.env,
    ...(packageDir ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
  },
  stderr: "pipe",
});

try {
  await client.connect(transport);
  const result = toolName === "tools/list"
    ? await client.listTools()
    : await client.callTool({ name: toolName, arguments: args });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await Promise.race([
    client.close(),
    new Promise((resolve) => setTimeout(resolve, 750)),
  ]);
}
process.exit(0);
