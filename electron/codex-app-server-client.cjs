const { EventEmitter } = require("events");
const { spawn } = require("child_process");
const readline = require("readline");

class CodexAppServerClient extends EventEmitter {
  constructor({ command = "codex", cwd } = {}) {
    super();
    this.command = command;
    this.cwd = cwd;
    this.child = null;
    this.reader = null;
    this.startPromise = null;
    this.nextId = 1;
    this.pending = new Map();
    this.activeTurns = new Map();
    this.compactionWaiters = new Map();
    this.contextThreads = new Map();
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
    this.startPromise = this._start();
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async _start() {
    this.status = "starting";
    this.lastError = "";
    this.emit("status", this.snapshot());
    const child = spawn(this.command, ["app-server"], {
      cwd: this.cwd,
      windowsHide: true,
      shell: process.platform === "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    this.reader = readline.createInterface({ input: child.stdout });
    this.reader.on("line", (line) => this._handleLine(line));
    child.stderr.on("data", (data) => this.emit("log", data.toString()));
    child.on("error", (error) => this._handleExit(error));
    child.on("close", (code) => this._handleExit(
      new Error(`Codex App Server가 종료되었습니다. (종료 코드 ${code})`),
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
      this.notify("initialized", {});
      this.status = "ready";
      this.emit("status", this.snapshot());
      return this.snapshot();
    } catch (error) {
      this._handleExit(error);
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
      this._write({ id, method, params });
    });
  }

  notify(method, params = {}) {
    this._write({ method, params });
  }

  _write(message) {
    if (!this.child?.stdin?.writable)
      throw new Error("Codex App Server에 연결되지 않았습니다.");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
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
      this._write({
        id: message.id,
        error: {
          code: -32601,
          message: "KsNote에서 아직 지원하지 않는 승인 요청입니다.",
        },
      });
      return;
    }
    this._handleNotification(message.method, message.params || {});
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

  _handleExit(error) {
    if (!this.child && this.status === "stopped") return;
    this.lastError = error?.message || "Codex App Server 연결이 종료되었습니다.";
    this.status = "error";
    try { this.reader?.close(); } catch {}
    try { this.child?.kill(); } catch {}
    this.reader = null;
    this.child = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(this.lastError));
    }
    this.pending.clear();
    for (const active of this.activeTurns.values()) {
      clearTimeout(active.timer);
      active.reject(new Error(this.lastError));
    }
    this.activeTurns.clear();
    for (const waiter of this.compactionWaiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(this.lastError));
    }
    this.compactionWaiters.clear();
    this.contextThreads.clear();
    this.emit("status", this.snapshot());
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

  async runTurn({
    contextKey,
    existingThreadId,
    prompt,
    model,
    developerInstructions,
    requestId,
    onDelta,
    onUsage,
    onThread,
    sandbox = "read-only",
    approvalPolicy = "never",
    timeoutMs = 180000,
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
      resolvedModelInfo?.defaultReasoningEffort || "medium";
    let threadId = this.contextThreads.get(contextKey);
    if (!threadId) {
      let started;
      if (existingThreadId) {
        try {
          started = await this.request("thread/resume", {
            threadId: existingThreadId,
          model: resolvedModel,
          cwd: this.cwd || null,
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
          model: resolvedModel,
          cwd: this.cwd || null,
          approvalPolicy,
          sandbox,
          developerInstructions: developerInstructions || null,
          ephemeral: false,
        }, 90000);
      }
      threadId = started.thread.id;
      this.contextThreads.set(contextKey, threadId);
      onThread?.(threadId, Boolean(existingThreadId && threadId === existingThreadId));
    }
    if (this.activeTurns.has(threadId))
      throw new Error("이 노트에서 다른 AI 요청이 실행 중입니다.");

    return new Promise(async (resolve, reject) => {
      const timer = setTimeout(() => {
        this.activeTurns.delete(threadId);
        reject(new Error("AI 응답 시간이 초과되었습니다."));
      }, timeoutMs);
      const active = {
        requestId,
        threadId,
        turnId: null,
        output: "",
        onDelta,
        onUsage,
        resolve,
        reject,
        timer,
      };
      this.activeTurns.set(threadId, active);
      try {
        const result = await this.request("turn/start", {
          threadId,
          input: [{ type: "text", text: prompt }],
          ...(resolvedModel ? { model: resolvedModel } : {}),
          effort: resolvedEffort,
        }, 60000);
        active.turnId = result.turn.id;
      } catch (error) {
        clearTimeout(timer);
        this.activeTurns.delete(threadId);
        reject(error);
      }
    });
  }

  async interrupt(requestId) {
    const active = Array.from(this.activeTurns.values())
      .find((turn) => turn.requestId === requestId);
    if (!active?.turnId) return false;
    await this.request("turn/interrupt", {
      threadId: active.threadId,
      turnId: active.turnId,
    });
    return true;
  }

  forgetThread(contextKey) {
    this.contextThreads.delete(contextKey);
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
    if (!this.child) return;
    const child = this.child;
    this.child = null;
    this.status = "stopped";
    try { this.reader?.close(); } catch {}
    try { child.stdin.end(); } catch {}
    setTimeout(() => {
      try { if (!child.killed) child.kill(); } catch {}
    }, 1000).unref();
    this.emit("status", this.snapshot());
  }
}

module.exports = { CodexAppServerClient };
