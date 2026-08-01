"use strict";
/**
 * Generic MCP client — NDJSON JSON-RPC 2.0 over a child process' STDIO.
 *
 * Deliberately free of any electron import: the same module drives the app's
 * "설정 > MCP 연결 > 연결" button and a plain `node` smoke script pointed at
 * mcp/ksnote-server.mjs.
 *
 * Lifecycle: start() spawns and handshakes (initialize → notifications/initialized),
 * listTools()/callTool() speak requests, and an idle timer stops a server that has
 * not been used for five minutes so a long app session does not leak processes.
 */

const { spawn } = require("child_process");
const { EventEmitter } = require("events");

const PROTOCOL_VERSION = "2025-06-18";
const CLIENT_INFO = { name: "ksnote", title: "KsNote", version: "0.1.0" };
const STDERR_TAIL_LINES = 200;
const IDLE_STOP_MS = 5 * 60 * 1000;
const HANDSHAKE_TIMEOUT_MS = 30000;
const DEFAULT_CALL_TIMEOUT_MS = 60000;
const SHELL_METACHARACTERS = /[;&|<>\r\n]/;

/** Same policy as the command-test handler: nothing that could chain a shell command. */
function assertSafeCommand(command, args) {
  const parts = [String(command == null ? "" : command)].concat(args || []).map(String);
  if (!parts[0].trim()) throw new Error("MCP 서버 실행 명령을 입력해 주세요.");
  if (parts.some((part) => SHELL_METACHARACTERS.test(part))) throw new Error("MCP 서버 실행 명령을 확인해 주세요.");
  return true;
}

/** `-y @scope/pkg "C:\Notes"` → three argv entries; arrays pass through untouched. */
function parseArgs(value) {
  if (Array.isArray(value)) return value.map(String);
  const matched = String(value == null ? "" : value).match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  return matched.map((part) => part.replace(/^"|"$/g, ""));
}

/** `KEY=value` lines (or a plain object) → an env overlay for the child process. */
function parseEnv(value) {
  const out = {};
  if (!value) return out;
  if (typeof value === "object" && !Array.isArray(value)) {
    for (const key of Object.keys(value)) {
      const entry = value[key];
      if (entry != null && String(entry).trim()) out[key] = String(entry);
    }
    return out;
  }
  for (const line of String(value).split(/[\r\n]+/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (match && match[2].trim()) out[match[1]] = match[2].trim().replace(/^"|"$/g, "");
  }
  return out;
}

/**
 * With shell:true node hands the joined string to cmd.exe verbatim, so an argument
 * holding a space (a filesystem root, a database path) would otherwise split apart.
 */
function quoteForShell(part) {
  const value = String(part);
  if (!/\s/.test(value)) return value;
  if (/^".*"$/.test(value)) return value;
  return '"' + value + '"';
}

class McpClient extends EventEmitter {
  constructor(spec) {
    super();
    const config = spec || {};
    this.id = String(config.id || "mcp");
    this.name = String(config.name || this.id);
    this.command = String(config.command || "").trim();
    this.args = parseArgs(config.args);
    this.env = parseEnv(config.env);
    this.child = null;
    this.status = "idle";
    this.serverInfo = null;
    this.protocolVersion = "";
    this.instructions = "";
    this.tools = [];
    this.stderrTail = [];
    this.lastUsedAt = Date.now();
    this.idleTimer = null;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = "";
    this.exitReason = "";
  }

  /** What a running child was spawned with — a change forces a restart. */
  get signature() {
    return JSON.stringify([this.command, this.args, this.env]);
  }

  get connected() {
    return Boolean(this.child) && this.status === "ready";
  }

  stderrTailText(limit) {
    return this.stderrTail.slice(-(limit || STDERR_TAIL_LINES)).join("\n");
  }

  setStatus(status, detail) {
    this.status = status;
    this.emit("status", { id: this.id, status: status, detail: detail || "" });
  }

  touch() {
    this.lastUsedAt = Date.now();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.stop("idle"), IDLE_STOP_MS);
    if (typeof this.idleTimer.unref === "function") this.idleTimer.unref();
  }

  /** Spawn the server process. Returns once the pipes are wired, not after the handshake. */
  start() {
    if (this.child) return this;
    assertSafeCommand(this.command, this.args);
    const useShell = process.platform === "win32";
    const child = spawn(this.command, useShell ? this.args.map(quoteForShell) : this.args, {
      shell: useShell,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: Object.assign({}, process.env, this.env),
    });
    this.child = child;
    this.buffer = "";
    this.stderrTail = [];
    this.exitReason = "";
    this.setStatus("starting");
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.consume(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => this.collectStderr(chunk));
    child.on("error", (error) => this.fail(error.message || String(error)));
    child.on("close", (code, signal) => {
      const stopped = this.exitReason === "stopped";
      const ended = signal ? "서버가 종료되었습니다 (신호 " + signal + ")." : "서버가 종료되었습니다 (종료 코드 " + code + ").";
      const reason = stopped ? "MCP 서버 연결을 종료했습니다." : this.exitReason || ended;
      this.child = null;
      this.setStatus(stopped ? "idle" : "stopped", reason);
      this.rejectAll(new Error(reason));
    });
    this.touch();
    return this;
  }

  collectStderr(chunk) {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (line.trim()) this.stderrTail.push(line);
    }
    if (this.stderrTail.length > STDERR_TAIL_LINES) this.stderrTail = this.stderrTail.slice(-STDERR_TAIL_LINES);
  }

  consume(chunk) {
    this.buffer += chunk;
    let index = this.buffer.indexOf("\n");
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line) this.dispatch(line);
      index = this.buffer.indexOf("\n");
    }
  }

  dispatch(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      // Servers that print a banner on stdout are common enough not to be fatal.
      this.collectStderr("[stdout] " + line.slice(0, 400));
      return;
    }
    if (!message || message.id === undefined || message.id === null) {
      this.emit("notification", message);
      return;
    }
    const entry = this.pending.get(message.id);
    if (!entry) return;
    this.pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(message.error.message || "MCP 오류 " + message.error.code));
    else entry.resolve(message.result);
  }

  fail(message) {
    this.exitReason = message;
    this.setStatus("error", message);
    this.rejectAll(new Error(message));
  }

  rejectAll(error) {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  send(message) {
    if (!this.child || !this.child.stdin.writable) throw new Error("MCP 서버가 실행되고 있지 않습니다.");
    this.child.stdin.write(JSON.stringify(message) + "\n");
  }

  notify(method, params) {
    this.send({ jsonrpc: "2.0", method: method, params: params || {} });
  }

  request(method, params, timeoutMs) {
    this.touch();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(method + " 응답 시간이 초과되었습니다."));
      }, timeoutMs || DEFAULT_CALL_TIMEOUT_MS);
      if (typeof timer.unref === "function") timer.unref();
      this.pending.set(id, { resolve: resolve, reject: reject, timer: timer });
      try {
        this.send({ jsonrpc: "2.0", id: id, method: method, params: params || {} });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  /** initialize → notifications/initialized. A ready client answers from cache. */
  async initialize() {
    if (this.connected) return this.handshake();
    this.start();
    const params = { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO };
    const result = await this.request("initialize", params, HANDSHAKE_TIMEOUT_MS);
    this.serverInfo = (result && result.serverInfo) || { name: this.name };
    this.protocolVersion = (result && result.protocolVersion) || PROTOCOL_VERSION;
    this.instructions = (result && result.instructions) || "";
    this.notify("notifications/initialized");
    this.setStatus("ready");
    return this.handshake();
  }

  handshake() {
    return { serverInfo: this.serverInfo, protocolVersion: this.protocolVersion, instructions: this.instructions };
  }

  async listTools() {
    if (!this.connected) await this.initialize();
    const result = await this.request("tools/list", {}, HANDSHAKE_TIMEOUT_MS);
    const tools = (result && result.tools) || [];
    this.tools = tools.map((tool) => ({
      name: tool.name,
      title: tool.title || (tool.annotations && tool.annotations.title) || tool.name,
      description: tool.description || "",
      inputSchema: tool.inputSchema || null,
      readOnly: Boolean(tool.annotations && tool.annotations.readOnlyHint),
    }));
    return this.tools;
  }

  /** Raw tools/call result — an `isError: true` body is a tool failure, not a transport one. */
  async callTool(name, args, options) {
    if (!name) throw new Error("호출할 도구 이름이 없습니다.");
    if (!this.connected) await this.initialize();
    const config = options || {};
    const params = { name: String(name), arguments: args || {} };
    return this.request("tools/call", params, config.timeoutMs || DEFAULT_CALL_TIMEOUT_MS);
  }

  stop(reason) {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    const child = this.child;
    if (!child) {
      this.setStatus("idle", reason || "");
      return false;
    }
    this.exitReason = reason === "idle" ? "5분 동안 사용하지 않아 서버를 정리했습니다." : "stopped";
    try { child.stdin.end(); } catch {}
    try { child.kill(); } catch {}
    this.child = null;
    this.rejectAll(new Error("MCP 서버 연결이 종료되었습니다."));
    this.setStatus("idle", reason || "");
    return true;
  }
}

/** Text payload of a tools/call result — used for success records and error messages alike. */
function resultText(result) {
  if (!result) return "";
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content
    .map((part) => (part && typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
  if (text) return text;
  if (result.structuredContent) return JSON.stringify(result.structuredContent, null, 2);
  return "";
}

/* ---------------------------------------------------------------- registry */

const registry = new Map();

/** One live client per server id; a changed command line replaces the old process. */
function acquire(spec) {
  const config = spec || {};
  const id = String(config.id || "mcp");
  const candidate = new McpClient(config);
  const existing = registry.get(id);
  if (existing && existing.signature === candidate.signature) return existing;
  if (existing) existing.stop("reconfigured");
  registry.set(id, candidate);
  return candidate;
}

async function connectServer(spec) {
  const client = acquire(spec);
  const info = await client.initialize();
  const tools = await client.listTools();
  return {
    client: client,
    serverInfo: info.serverInfo,
    protocolVersion: info.protocolVersion,
    instructions: info.instructions,
    tools: tools,
  };
}

async function callServerTool(spec, tool, args, options) {
  const client = acquire(spec);
  if (!client.connected) await client.initialize();
  return { client: client, result: await client.callTool(tool, args, options) };
}

/** Live client for a server id, if any — used to attach a stderr tail to a failure. */
function getServer(id) {
  return registry.get(String(id || "")) || null;
}

function disconnectServer(id) {
  const key = String(id || "");
  const client = registry.get(key);
  if (!client) return false;
  client.stop("stopped");
  registry.delete(key);
  return true;
}

function disconnectAll() {
  for (const id of Array.from(registry.keys())) disconnectServer(id);
}

module.exports = {
  McpClient: McpClient,
  PROTOCOL_VERSION: PROTOCOL_VERSION,
  assertSafeCommand: assertSafeCommand,
  parseArgs: parseArgs,
  parseEnv: parseEnv,
  resultText: resultText,
  connectServer: connectServer,
  callServerTool: callServerTool,
  getServer: getServer,
  disconnectServer: disconnectServer,
  disconnectAll: disconnectAll,
};
