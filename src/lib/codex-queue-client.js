/**
 * 连接已经运行的 Codex managed daemon，被动读取精确线程并操作原生队列。
 * @module codex-queue-client
 */
import { EventEmitter } from "node:events";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { realpathSync, lstatSync, openSync, readSync, closeSync } from "node:fs";
import path from "node:path";
import { WebSocket } from "ws";

import { confirmationId, confirmationWakeId, formalConfirmationWake } from "./confirmation-protocol.js";

/** 单连接 JSON-RPC 客户端；不启动 daemon、不选择其它线程。
 * @extends EventEmitter
 */
export class CodexQueueClient extends EventEmitter {
  /** 创建客户端，连接在 connect 中显式建立。
   * @param {object} options 项目、会话及环境
   */
  constructor({ project, sessionId, env = process.env, platform = process.platform, timeoutMs = 5000 }) {
    super();
    if (platform !== "linux") throw new Error("后台确认目前只验证 Linux/WSL 的共享服务");
    this.project = realpathSync(project);
    this.sessionId = confirmationId(sessionId);
    this.socketPath = path.join(env.CODEX_HOME || path.join(homedir(), ".codex"), "app-server-control", "app-server-control.sock");
    this.timeoutMs = timeoutMs;
    this.pending = new Map();
    this.sequence = 0;
    this.humanRevision = 0;
    this.latestHuman = null;
    this.seen = new Set();
    this.failure = null;
    this.socket = null;
    this.closing = false;
    this.poll = null;
    this.polling = false;
    this.lastCompleted = null;
    this.sessions = realpathSync(env.CODEX_HOME || path.join(homedir(), ".codex"));
    this.rollout = null;
  }

  /** 连接已有 Unix socket 并完成原生协议初始化。
   * @returns {Promise<void>}
   */
  async connect() {
    this.socket = new WebSocket("ws://localhost/", {
      createConnection: () => createConnection({ path: this.socketPath }),
      handshakeTimeout: this.timeoutMs,
      maxPayload: 16 * 1024 * 1024,
    });
    const disconnected = cause => {
      if (this.closing || this.failure) return;
      this.failure = new Error(`Codex 连接断开：${cause.message || cause}`);
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(this.failure); }
      this.pending.clear();
      this.emit("disconnect", this.failure);
    };
    this.socket.on("error", disconnected);
    this.socket.on("close", () => disconnected(new Error("原生连接已关闭")));
    this.socket.on("message", bytes => {
      let packet;
      try { packet = JSON.parse(bytes.toString()); }
      catch { disconnected(new Error("原生消息不是有效 JSON")); this.socket.terminate(); return; }
      if (packet.id !== undefined && !packet.method) {
        const pending = this.pending.get(packet.id);
        if (!pending) return;
        this.pending.delete(packet.id);
        clearTimeout(pending.timer);
        if (packet.error) {
          const error = new Error(`Codex ${pending.method} 失败：${packet.error.message}`);
          error.rpcCode = packet.error.code;
          pending.reject(error);
        } else pending.resolve(packet.result);
      } else if (packet.method && packet.params?.threadId === this.sessionId) {
        const item = packet.params.item;
        if (["item/started", "item/completed"].includes(packet.method) && item?.type === "userMessage") {
          const internal = confirmationWakeId(item);
          if (!internal && !this.seen.has(item.id)) {
            this.seen.add(item.id);
            if (this.seen.size > 4096) this.seen.delete(this.seen.values().next().value);
            this.latestHuman = item.id;
            this.humanRevision += 1;
            this.emit("human", { id: item.id, turnId: packet.params.turnId });
          }
          if (internal) this.emit("wake", { requestId: internal, turnId: packet.params.turnId });
        }
        this.emit("notification", packet);
      } else if (packet.id !== undefined && packet.method) {
        // 此观察连接不承担审批；意外服务器请求明确拒绝，不能替用户同意。
        this.socket.send(JSON.stringify({ id: packet.id, error: { code: -32601, message: "观察连接不提供此方法" } }));
      }
    });
    await new Promise((resolve, reject) => {
      this.socket.once("open", resolve);
      this.socket.once("error", reject);
    });
    if (this.failure) throw this.failure;
    await this.rpc("initialize", { clientInfo: { name: "flower_confirmation", version: "1" }, capabilities: { experimentalApi: true } });
    this.socket.send(JSON.stringify({ method: "initialized" }));
  }

  /** 调用已核对协议的方法；超时不隐式重试写操作。
   * @param {string} method 方法
   * @param {object} params 参数
   * @returns {Promise<object>} 原生回执
   */
  rpc(method, params) {
    if (this.failure || this.socket?.readyState !== WebSocket.OPEN) return Promise.reject(this.failure || new Error("Codex 尚未连接"));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex ${method} 回执超时，结果未知`)); }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.socket.send(JSON.stringify({ id, method, params }), error => {
        if (!error || !this.pending.delete(id)) return;
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  /** 被动观察精确会话，不调用 resume，不占有新的原生订阅。
   * @returns {Promise<object>} 首次快照
   */
  async subscribe() {
    if (this.poll) return this.snapshot();
    const initial = await this.snapshot();
    this.latestHuman = initial.humanId;
    this.poll = setInterval(async () => {
      if (this.polling || this.closing || this.failure) return;
      this.polling = true;
      try {
        const snapshot = await this.snapshot();
        if (snapshot.humanId !== this.latestHuman) {
          this.latestHuman = snapshot.humanId;
          this.humanRevision += 1;
          this.emit("human", { id: snapshot.humanId, turnId: snapshot.turn?.id });
        }
        if (snapshot.wake) this.emit("wake", snapshot.wake);
        if (snapshot.turn && snapshot.turn.status !== "inProgress" && snapshot.turn.id !== this.lastCompleted) {
          this.lastCompleted = snapshot.turn.id;
          this.emit("notification", { method: "turn/completed", params: { turn: snapshot.turn } });
        }
      } catch (error) {
        if (!this.closing && !this.failure) { this.failure = error; this.emit("disconnect", error); }
      } finally { this.polling = false; }
    }, 250);
    return initial;
  }

  /** 验证线程身份和实际目录，拒绝跨项目投递。
   * @param {object} thread 原生线程
   * @returns {void}
   */
  verifyThread(thread) {
    if (thread?.id !== this.sessionId || realpathSync(thread.cwd) !== this.project) throw new Error("Codex 目标会话或项目目录不匹配");
    if (thread.archived || thread.status?.type === "systemError") throw new Error("Codex 目标线程处于错误状态");
  }

  /** 读取宿主返回的精确本地记录，避免建立原生 thread 订阅。
   * @returns {Promise<object>} 人工基线、原回合与精确提醒
   */
  async snapshot() {
    const thread = (await this.rpc("thread/read", { threadId: this.sessionId, includeTurns: false })).thread;
    this.verifyThread(thread);
    const record = this.readRollout(thread.path);
    if (!record.humanId) throw new Error("Codex 会话没有可核验的人工消息基线");
    this.seen.add(record.humanId);
    return { humanId: record.humanId, turn: record.turn, status: thread.status,
      wake: record.wake?.turnId === record.turn?.id ? record.wake : null };
  }

  /** 只读有界 rollout 并核对原生会话、消息来源和最终展示；未变化时复用解析结果。
   * @param {string} file 原生 thread/read 返回的路径
   * @returns {object} 记录快照
   */
  readRollout(file) {
    if (typeof file !== "string" || !path.basename(file).endsWith(`-${this.sessionId}.jsonl`)) throw new Error("Codex 未提供精确会话记录路径");
    const info = lstatSync(file);
    const relative = path.relative(path.join(this.sessions, "sessions"), realpathSync(file));
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
      || !info.isFile() || info.isSymbolicLink() || info.size > 128 * 1024 * 1024) throw new Error("Codex 会话记录不可核验或超出预算");
    if (this.rollout?.file === file && this.rollout.size === info.size && this.rollout.modified === info.mtimeMs
      && this.rollout.inode === info.ino) return this.rollout;
    const previous = this.rollout?.file === file && this.rollout.inode === info.ino && info.size > this.rollout.size ? this.rollout : null;
    let verified = previous?.verified || false;
    let humanId = previous?.humanId || null;
    let turn = previous?.turn || null;
    let wake = previous?.wake || null;
    const displays = new Map(previous?.displays || []);
    let offset = previous?.offset || 0;
    const rows = [];
    const fd = openSync(file, "r");
    try {
      const chunk = Buffer.alloc(65536);
      let rest = Buffer.alloc(0);
      let position = offset;
      while (position < info.size) {
        const count = readSync(fd, chunk, 0, Math.min(chunk.length, info.size - position), position);
        if (!count) throw new Error("Codex 会话记录在读取期间截断");
        position += count;
        rest = Buffer.concat([rest, chunk.subarray(0, count)]);
        let newline;
        while ((newline = rest.indexOf(10)) >= 0) {
          if (newline > 2 * 1024 * 1024) throw new Error("Codex 单条记录超出预算");
          rows.push(rest.subarray(0, newline).toString("utf8"));
          offset += newline + 1;
          rest = rest.subarray(newline + 1);
        }
        if (rest.length > 2 * 1024 * 1024) throw new Error("Codex 单条记录超出预算");
      }
    } finally { closeSync(fd); }
    for (const line of rows) {
      if (!line.trim()) continue;
      const entry = JSON.parse(line);
      if (entry.type === "session_meta") {
        if (entry.payload?.id !== this.sessionId) throw new Error("Codex 会话记录标识不符");
        verified = true;
      }
      if (entry.type !== "event_msg") continue;
      const event = entry.payload;
      if (event?.thread_id && event.thread_id !== this.sessionId) throw new Error("Codex 记录中混入其他会话事件");
      if (["task_started", "turn_started"].includes(event?.type)) turn = { id: event.turn_id, status: "inProgress" };
      if (["task_complete", "turn_complete"].includes(event?.type) && event.turn_id === turn?.id) turn = { id: turn.id, status: "completed" };
      if (event?.type === "turn_aborted" && (!event.turn_id || event.turn_id === turn?.id)) turn = { id: turn?.id, status: "interrupted" };
      // 回滚会改变真实消息基线；不能沿用回滚前解析结果授予旧动作。
      if (event?.type === "thread_rolled_back") { humanId = null; turn = null; wake = null; displays.clear(); }
      if (event?.type !== "item_completed") continue;
      const item = event.item;
      if (item?.type === "UserMessage") {
        const internal = confirmationWakeId({ type: "userMessage", content: item.content, clientId: item.client_id });
        if (internal) wake = { requestId: internal, turnId: event.turn_id };
        else humanId = confirmationId(item.id);
      }
      if (item?.type === "AgentMessage" && item.phase === "final_answer") {
        const content = item.content.map(part => { if (part.type !== "Text" || typeof part.text !== "string") throw new Error("Codex 最终正文结构不可核验"); return part.text; }).join("");
        displays.set(event.turn_id, (displays.get(event.turn_id) || "") + content);
        while (displays.size > 8) displays.delete(displays.keys().next().value);
      }
    }
    if (!verified) throw new Error("Codex 缺少原生会话身份记录");
    this.rollout = { file, size: info.size, modified: info.mtimeMs, inode: info.ino, offset, verified, humanId, turn, wake, displays };
    return this.rollout;
  }

  /** 读取精确原回合的完整最终展示。
   * @param {string} turnId 展示回合
   * @returns {Promise<string>} 原生最终正文
   */
  async assistantText(turnId) {
    await this.snapshot();
    const text = this.rollout.displays.get(turnId);
    if (typeof text !== "string") throw new Error("Codex 原始最终展示不存在");
    return text;
  }

  /** 将内部唤醒投递到同一线程，原生 idle 队列可能立即启动回合。
   * @param {string} requestId 请求标识
   * @returns {Promise<object>} 队列项
   */
  async add(requestId) {
    const response = await this.rpc("thread/queue/add", {
      threadId: this.sessionId, clientUserMessageId: requestId, input: [{ type: "text", text: formalConfirmationWake(requestId) }],
    });
    if (!response.queuedSubmission?.id) throw new Error("Codex 队列未返回有效回执，结果未知");
    return response.queuedSubmission;
  }

  /** 撤回精确队列项；已启动的回合不能通过删除队列撤销。
   * @param {string} queueId 队列标识
   * @returns {Promise<string>} deleted 或 not_pending（已启动或已撤回）
   */
  async remove(queueId) {
    try { await this.rpc("thread/queue/delete", { threadId: this.sessionId, queuedSubmissionId: queueId }); return "deleted"; }
    catch (error) {
      if (error.rpcCode === -32600 && /queued submission not found/i.test(error.message)) return "not_pending";
      throw error;
    }
  }

  /** 关闭自有连接并清理挂起 RPC，不影响 daemon 或其它客户端。
   * @returns {void}
   */
  close() {
    this.closing = true;
    clearInterval(this.poll);
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error("观察连接已关闭")); }
    this.pending.clear();
    this.socket?.terminate();
  }
}
