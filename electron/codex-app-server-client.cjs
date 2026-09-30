const { EventEmitter } = require("events");
const { spawn, spawnSync } = require("child_process");
const readline = require("readline");

function killProcessTree(child) {
  if (!child || child.killed) return;
  const pid = child.pid;
  if (process.platform === "win32" && Number.isFinite(pid)) {
    try {
      const result = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        timeout: 5000,
      });
      if (!result.error && result.status === 0) return;
    } catch {}
  }
  try {
    child.kill();
  } catch {}
}

const REVIEW_DECISION_METHODS = new Set([
  "execCommandApproval",
  "applyPatchApproval",
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
]);

class CodexAppServerClient extends EventEmitter {
  constructor({ command = "codex", cwd, serverArgs, approvalTimeoutMs } = {}) {
    super();
    this.command = command;
    this.serverArgs = Array.isArray(serverArgs) && serverArgs.length ? serverArgs : ["app-server"];
    this.approvalTimeoutMs =
      Number.isFinite(approvalTimeoutMs) && approvalTimeoutMs > 0 ? approvalTimeoutMs : 120000;
    this.cwd = cwd;
    this.child = null;
    this.reader = null;
    this.startPromise = null;
    this.nextId = 1;
    this.pending = new Map();
    this.pendingApprovals = new Map();
    this.nextApproval = 1;
    this.activeTurns = new Map();
    this.compactionWaiters = new Map();
    this.contextThreads = new Map();
    this.contextThreadPromises = new Map();
    this.status = "stopped";
    this.lastError = "";
  }

  snapshot() {
    return {
      status: this.status,
      command: this.command,
      lastError: this.lastError,
    };
  }

  async start() {
    if (this.status === "ready" && this.child) return this.snapshot();
    if (this.startPromise) return this.startPromise;
    const starting = this._start();
    this.startPromise = starting;
    try {
      return await starting;
    } finally {
      if (this.startPromise === starting) this.startPromise = null;
    }
  }

  async _start() {
    this.status = "starting";
    this.lastError = "";
    this.emit("status", this.snapshot());
    const child = spawn(this.command, this.serverArgs, {
      cwd: this.cwd,
      windowsHide: true,
      shell: process.platform === "win32" && !/\.exe$/i.test(this.command),
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    this.reader = readline.createInterface({ input: child.stdout });
    this.reader.on("line", (line) => {
      if (this.child === child) this._handleLine(line);
    });
    child.stderr.on("data", (data) => this.emit("log", data.toString()));
    child.stdin.on("error", (error) => this._handleExit(error, child));
    child.on("error", (error) => this._handleExit(error, child));
    child.on("close", (code) => this._handleExit(
      new Error(`Codex App Server가 종료되었습니다. (종료 코드 ${code})`),
      child,
    ));

    try {
      await this.request("initialize", {
        clientInfo: {
          name: "ksnote",
          title: "KsNote",
          version: "0.1.0",
        },
        capabilities: {},
      }, 15000, false);
      if (this.child !== child) throw new Error("Codex App Server 연결이 중단되었습니다.");
      this.notify("initialized", {});
      this.status = "ready";
      this.emit("status", this.snapshot());
      return this.snapshot();
    } catch (error) {
      this._handleExit(error, child);
      throw error;
    }
  }

  async request(method, params = {}, timeout = 30000, ensureStarted = true) {
    if (ensureStarted) await this.start();
    if (!this.child?.stdin?.writable)
      throw new Error("Codex App Server에 연결되지 않았습니다.");
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} 요청 시간이 초과되었습니다.`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this._write({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  notify(method, params = {}) {
    this._write({ method, params });
  }

  _write(message) {
    if (!this.child?.stdin?.writable)
      throw new Error("Codex App Server에 연결되지 않았습니다.");
    const child = this.child;
    child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
      if (error) this._handleExit(error, child);
    });
  }

  _handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.emit("log", `App Server JSON 파싱 실패: ${line}`);
      return;
    }
    if (Object.prototype.hasOwnProperty.call(message, "id") && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error)
        pending.reject(new Error(message.error.message || "Codex 요청이 실패했습니다."));
      else pending.resolve(message.result);
      return;
    }
    if (message.method && Object.prototype.hasOwnProperty.call(message, "id")) {
      this._handleServerRequest(message.method, message.id, message.params || {});
      return;
    }
    this._handleNotification(message.method, message.params || {});
  }

  _handleServerRequest(method, id, params) {
    if (method === "item/tool/call") {
      this._write({
        id,
        error: {
          code: -32601,
          message: "KsNote에서 실행할 수 있는 로컬 동적 도구가 없습니다.",
        },
      });
      return;
    }
    if (
      REVIEW_DECISION_METHODS.has(method) ||
      method === "item/permissions/requestApproval" ||
      method === "item/tool/requestUserInput" ||
      method === "mcpServer/elicitation/request"
    ) {
      const approvalId = `approval-${this.nextApproval++}`;
      const timer = setTimeout(() => {
        this.pendingApprovals.delete(approvalId);
        this._respondApprovalDeclined(method, id);
        this.emit("approval-timeout", { approvalId, method });
      }, this.approvalTimeoutMs);
      if (typeof timer.unref === "function") timer.unref();
      this.pendingApprovals.set(approvalId, { method, requestId: id, timer });
      this.emit("approval", { approvalId, method, params });
      return;
    }
    this._write({
      id,
      error: {
        code: -32601,
        message: "KsNote에서 아직 지원하지 않는 승인 요청입니다.",
      },
    });
  }

  _respondApprovalDeclined(method, id) {
    if (REVIEW_DECISION_METHODS.has(method)) {
      this._write({ id, result: { decision: "abort" } });
    } else if (method === "mcpServer/elicitation/request") {
      this._write({ id, result: { action: "decline" } });
    } else {
      this._write({
        id,
        error: { code: -32000, message: "사용자가 승인 요청을 거절했습니다." },
      });
    }
  }

  resolveApproval(approvalId, decision) {
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pendingApprovals.delete(approvalId);
    const approved = decision?.decision === "approved";
    if (!approved) {
      this._respondApprovalDeclined(pending.method, pending.requestId);
      return true;
    }
    if (REVIEW_DECISION_METHODS.has(pending.method)) {
      this._write({ id: pending.requestId, result: { decision: "approved" } });
    } else if (pending.method === "item/permissions/requestApproval") {
      this._write({
        id: pending.requestId,
        result: { permissions: decision?.permissions || {}, scope: "turn" },
      });
    } else if (pending.method === "item/tool/requestUserInput") {
      this._write({
        id: pending.requestId,
        result: { answers: decision?.answers || {} },
      });
    } else if (pending.method === "mcpServer/elicitation/request") {
      this._write({
        id: pending.requestId,
        result: { action: "accept", content: decision?.content ?? null },
      });
    } else {
      this._respondApprovalDeclined(pending.method, pending.requestId);
    }
    return true;
  }

  _handleNotification(method, params) {
    if (method === "item/agentMessage/delta") {
      const active = this.activeTurns.get(params.threadId);
      if (active) {
        active.output += params.delta || "";
        active.onDelta?.(params.delta || "");
      }
    } else if (method === "thread/tokenUsage/updated") {
      const active = this.activeTurns.get(params.threadId);
      active?.onUsage?.(params.tokenUsage);
    } else if (method === "thread/compacted") {
      const waiter = this.compactionWaiters.get(params.threadId);
      if (waiter) {
        clearTimeout(waiter.timer);
        this.compactionWaiters.delete(params.threadId);
        waiter.resolve(params);
      }
    } else if (method === "turn/completed") {
      const active = this.activeTurns.get(params.threadId);
      if (active) {
        clearTimeout(active.timer);
        this.activeTurns.delete(params.threadId);
        const status = params.turn?.status;
        if (status === "completed") active.resolve(active.output.trim());
        else active.reject(new Error(
          params.turn?.error?.message ||
          (status === "interrupted" ? "AI 요청을 취소했습니다." : "Codex 실행이 완료되지 않았습니다."),
        ));
      }
    }
    this.emit("notification", { method, params });
  }

  _handleExit(error, child = this.child) {
    // A stopped process can emit close/error after its replacement is ready.
    if (!child || this.child !== child) return;
    this.lastError = error?.message || "Codex App Server 연결이 종료되었습니다.";
    this.status = "error";
    try { this.reader?.close(); } catch {}
    killProcessTree(this.child);
    this.reader = null;
    this.child = null;
    this._clearPending(new Error(this.lastError));
    this.emit("status", this.snapshot());
  }

  _clearPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const active of this.activeTurns.values()) {
      clearTimeout(active.timer);
      active.reject(error);
    }
    this.activeTurns.clear();
    for (const waiter of this.compactionWaiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.compactionWaiters.clear();
    for (const [approvalId, pending] of this.pendingApprovals) {
      clearTimeout(pending.timer);
      this.emit("approval-timeout", { approvalId, method: pending.method });
    }
    this.pendingApprovals.clear();
    this.contextThreads.clear();
    this.contextThreadPromises.clear();
  }

  async accountRead() {
    return this.request("account/read", {});
  }

  async loginChatgpt() {
    return this.request("account/login/start", { type: "chatgpt" });
  }

  async modelList() {
    return this.request("model/list", { limit: 100, includeHidden: false });
  }

  async mcpServerStatusList(detail) {
    const params = detail ? { detail } : {};
    return this.request("mcpServerStatus/list", params);
  }

  async openScratchThread() {
    const started = await this.request("thread/start", {
      approvalPolicy: "never",
      sandbox: "read-only",
      ephemeral: true,
    }, 90000);
    const threadId = started?.thread?.id;
    if (!threadId) throw new Error("게시용 스레드를 시작하지 못했습니다.");
    return threadId;
  }

  async closeScratchThread(threadId) {
    if (!threadId) return false;
    try {
      await this.request("thread/archive", { threadId });
      return true;
    } catch {
      return false;
    }
  }

  async mcpServerToolCall({ server, threadId, tool, args, timeoutMs = 180000 }) {
    if (!server || !threadId || !tool)
      throw new Error("MCP 도구 호출에 server, threadId, tool이 필요합니다.");
    return this.request("mcpServer/tool/call", {
      server,
      threadId,
      tool,
      arguments: args ?? {},
    }, timeoutMs);
  }

  async getOrCreateThread({
    contextKey,
    existingThreadId,
    model,
    cwd,
    approvalPolicy,
    sandbox,
    developerInstructions,
    onThread,
  }) {
    const hasKey = Boolean(contextKey);
    if (hasKey) {
      const cached = this.contextThreads.get(contextKey);
      if (cached) return cached;
      const inflight = this.contextThreadPromises.get(contextKey);
      if (inflight) return inflight;
    }
    const creation = (async () => {
      // Re-check after awaiting: another caller may have populated while we waited.
      if (hasKey) {
        const cached = this.contextThreads.get(contextKey);
        if (cached) return cached;
      }
      let started;
      if (existingThreadId) {
        try {
          started = await this.request("thread/resume", {
            threadId: existingThreadId,
          model,
          cwd: cwd || null,
          approvalPolicy,
          sandbox,
          developerInstructions: developerInstructions || null,
        }, 90000);
        } catch {
          started = null;
        }
      }
      if (!started) {
        started = await this.request("thread/start", {
          model,
          cwd: cwd || null,
          approvalPolicy,
          sandbox,
          developerInstructions: developerInstructions || null,
          ephemeral: false,
        }, 90000);
      }
      const threadId = started.thread.id;
      if (hasKey) this.contextThreads.set(contextKey, threadId);
      onThread?.(threadId, Boolean(existingThreadId && threadId === existingThreadId));
      return threadId;
    })();
    if (hasKey) this.contextThreadPromises.set(contextKey, creation);
    try {
      return await creation;
    } finally {
      if (hasKey && this.contextThreadPromises.get(contextKey) === creation)
        this.contextThreadPromises.delete(contextKey);
    }
  }

  async runTurn({
    contextKey,
    existingThreadId,
    prompt,
    model,
    developerInstructions,
    requestId,
    effort,
    onDelta,
    onUsage,
    onThread,
    sandbox = "read-only",
    approvalPolicy = "never",
    timeoutMs = 180000,
    cwd,
  }) {
    await this.start();
    const modelResult = await this.modelList();
    const models = modelResult.data || [];
    const resolvedModelInfo = models.find(
      (item) => (item.model || item.id) === model,
    ) || models.find((item) => item.isDefault) || models[0];
    const resolvedModel =
      resolvedModelInfo?.model || resolvedModelInfo?.id || null;
    const resolvedEffort =
      effort && effort !== "auto"
        ? effort
        : resolvedModelInfo?.defaultReasoningEffort || "medium";
    const effectiveCwd = cwd || this.cwd || null;
    const threadId = await this.getOrCreateThread({
      contextKey,
      existingThreadId,
      model: resolvedModel,
      cwd: effectiveCwd,
      approvalPolicy,
      sandbox,
      developerInstructions,
      onThread,
    });
    if (this.activeTurns.has(threadId))
      throw new Error("이 노트에서 다른 AI 요청이 실행 중입니다.");

    return new Promise(async (resolve, reject) => {
      const active = {
        requestId,
        threadId,
        turnId: null,
        output: "",
        onDelta,
        onUsage,
        resolve,
        reject,
        timer: null,
        interruptRequested: false,
        settled: false,
      };
      const timer = setTimeout(() => {
        const current = this.activeTurns.get(threadId);
        if (current !== active) return;
        active.settled = true;
        this.activeTurns.delete(threadId);
        if (active.turnId) {
          this.request("turn/interrupt", {
            threadId,
            turnId: active.turnId,
          }).catch(() => {});
        } else {
          active.interruptRequested = true;
        }
        reject(new Error("AI 응답 시간이 초과되었습니다."));
      }, timeoutMs);
      if (typeof timer.unref === "function") timer.unref();
      active.timer = timer;
      this.activeTurns.set(threadId, active);
      try {
        const result = await this.request("turn/start", {
          threadId,
          input: [{ type: "text", text: prompt }],
          ...(resolvedModel ? { model: resolvedModel } : {}),
          effort: resolvedEffort,
        }, 60000);
        if (active.settled || this.activeTurns.get(threadId) !== active) {
          const orphanTurnId = result?.turn?.id;
          if (orphanTurnId) {
            this.request("turn/interrupt", {
              threadId,
              turnId: orphanTurnId,
            }).catch(() => {});
          }
          return;
        }
        active.turnId = result.turn.id;
        if (active.interruptRequested) {
          try {
            await this.request("turn/interrupt", {
              threadId,
              turnId: active.turnId,
            });
          } catch {}
        }
      } catch (error) {
        if (active.settled) return;
        clearTimeout(timer);
        if (this.activeTurns.get(threadId) === active)
          this.activeTurns.delete(threadId);
        active.settled = true;
        reject(error);
      }
    });
  }

  async interrupt(requestId) {
    const active = Array.from(this.activeTurns.values())
      .find((turn) => turn.requestId === requestId);
    if (!active) return false;
    if (!active.turnId) {
      active.interruptRequested = true;
      return true;
    }
    await this.request("turn/interrupt", {
      threadId: active.threadId,
      turnId: active.turnId,
    });
    return true;
  }

  forgetThread(contextKey) {
    this.contextThreads.delete(contextKey);
    this.contextThreadPromises.delete(contextKey);
  }

  async renameThread(threadId, name) {
    if (!threadId) return false;
    await this.request("thread/name/set", { threadId, name });
    return true;
  }

  async deleteThread(contextKey, threadId) {
    let permanentlyDeleted = false;
    if (threadId) {
      try {
        await this.request("thread/delete", { threadId });
        permanentlyDeleted = true;
      } catch (error) {
        if (!/agent_jobs|database|no such table/i.test(error.message)) throw error;
        try {
          await this.request("thread/archive", { threadId });
        } catch (archiveError) {
          if (!/no rollout found|not found/i.test(archiveError.message))
            throw archiveError;
        }
      }
    }
    this.forgetThread(contextKey);
    return { deleted: true, permanentlyDeleted };
  }

  async compactAndFork(contextKey, threadId, model) {
    if (!threadId) throw new Error("압축할 대화 컨텍스트가 없습니다.");
    const summary = await this.runTurn({
      contextKey,
      existingThreadId: threadId,
      model,
      requestId: `compact-${Date.now()}`,
      developerInstructions:
        "Do not use tools. Summarize the conversation for continuation in a fresh AI thread. Preserve user goals, decisions, constraints, document state, unresolved questions, and next actions. Answer in Korean with concise structured plain text.",
      prompt:
        "이 대화를 새 컨텍스트에서 정확히 이어갈 수 있도록 연속성 요약을 작성하세요. 설명이나 인사 없이 요약 본문만 반환하세요.",
    });
    this.forgetThread(contextKey);
    return {
      threadId: null,
      previousThreadId: threadId,
      summary,
    };
  }

  async stop() {
    const child = this.child;
    this.child = null;
    this.startPromise = null;
    this.status = "stopped";
    this.lastError = "";
    try { this.reader?.close(); } catch {}
    this.reader = null;
    this._clearPending(new Error("Codex App Server 연결을 중지했습니다."));
    if (child) {
      try { child.stdin.end(); } catch {}
      killProcessTree(child);
      await new Promise((resolve) => {
        if (child.killed || child.exitCode !== null) return resolve();
        const timer = setTimeout(resolve, 3000);
        if (typeof timer.unref === "function") timer.unref();
        child.once("close", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      killProcessTree(child);
    }
    this.emit("status", this.snapshot());
  }
}

module.exports = { CodexAppServerClient, killProcessTree };
