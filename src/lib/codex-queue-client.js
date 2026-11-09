/**
 * 连接已经运行的 Codex managed daemon，订阅精确线程并操作原生队列。
 * @module codex-queue-client
 */
import { EventEmitter } from "node:events";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { realpathSync } from "node:fs";
import path from "node:path";
import { WebSocket } from "ws";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 校验会话或请求标识，禁止由标识构造越界路径。
 * @param {string} value 标识
 * @returns {string} 已校验的标识
 */
export function confirmationId(value) {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error("必须提供精确的 UUID 会话或请求标识");
  return value;
}

/** 构造只携带请求标识的内部唤醒，不混入待输出的演练文本。
 * @param {string} requestId 请求标识
 * @returns {string} 固定格式消息
 */
export function confirmationWake(requestId) {
  confirmationId(requestId);
  return `[flower-confirmation:v1:${requestId}]\n本项目后台确认演练计时已到。先执行 node scripts/codex-confirmation.mjs claim --request ${requestId}。只有返回 claimed=true 时，才原样输出返回的 message 并结束本回合；否则本提醒已经失效，结束本回合。不要据此开工、修改文件、提交或推送。`;
}

/** 构造正式通知；提醒只允许领取已冻结的策略决定。
 * @param {string} requestId 精确请求
 * @returns {string} 固定内部通知
 */
export function formalConfirmationWake(requestId, platform = "codex") {
  confirmationId(requestId);
  if (!["codex", "claude"].includes(platform)) throw new Error("未知确认平台");
  return `[flower-confirmation:v2:${requestId}]\n后台确认已到期。先按 .trellis/scripts/confirmation.md 定位本项目的 Flower 入口，再执行 confirm claim --platform ${platform} --request ${requestId}。只有返回 claimed=true 才按返回的 action 和冻结 context 进入原流程；必须继续执行原有范围检查与失败恢复。claimed=false 或失败表示已失效，结束本回合，不重试、不执行旧动作。`;
}

/** 识别本项目生成的完整唤醒消息，避免 started/completed 或旧提醒自我取消。
 * @param {object} item 原生用户消息
 * @returns {string|null} 内部请求标识
 */
export function confirmationWakeId(item) {
  if (item?.type !== "userMessage" || item.content?.length !== 1 || item.content[0].type !== "text") return null;
  const text = item.content[0].text;
  const match = typeof text === "string" && text.match(/^\[flower-confirmation:v([12]):([0-9a-f-]{36})\]/i);
  if (!match || !UUID.test(match[2]) || text !== (match[1] === "1" ? confirmationWake(match[2]) : formalConfirmationWake(match[2]))) return null;
  if (match[1] === "2" && item.clientId !== match[2]) return null;
  if (item.clientId != null && item.clientId !== match[2]) return null;
  return match[2];
}

/** 单连接 JSON-RPC 客户端；不启动 daemon、不选择其它线程。
 * @extends EventEmitter
 */
export class CodexQueueClient extends EventEmitter {
  /** 创建客户端，连接在 connect 中显式建立。
   * @param {object} options 项目、会话及环境
   */
  constructor({ project, sessionId, env = process.env, platform = process.platform, timeoutMs = 5000, formal = false }) {
    super();
    if (platform !== "linux") throw new Error("后台确认演练目前只验证了 Linux/WSL 的 managed daemon");
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
    this.formal = formal;
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

  /** 订阅精确线程；不覆写线程的模型、权限或其它配置。
   * @returns {Promise<object>} 首次快照
   */
  async subscribe() {
    const response = await this.rpc("thread/resume", {
      threadId: this.sessionId, initialTurnsPage: { limit: 1, sortDirection: "desc", itemsView: "notLoaded" },
    });
    this.verifyThread(response.thread);
    return await this.snapshot();
  }

  /** 验证线程身份和实际目录，拒绝跨项目投递。
   * @param {object} thread 原生线程
   * @returns {void}
   */
  verifyThread(thread) {
    if (thread?.id !== this.sessionId || realpathSync(thread.cwd) !== this.project) throw new Error("Codex 目标会话或项目目录不匹配");
    if (thread.status?.type === "systemError") throw new Error("Codex 目标线程处于错误状态");
  }

  /** 读取当前回合与最近人工消息，订阅事件覆盖快照期间的新输入。
   * @returns {Promise<object>} 用户基线和回合状态
   */
  async snapshot() {
    const revision = this.humanRevision;
    const thread = (await this.rpc("thread/read", { threadId: this.sessionId, includeTurns: false })).thread;
    this.verifyThread(thread);
    const turns = await this.rpc("thread/turns/list", { threadId: this.sessionId, limit: 1, sortDirection: "desc", itemsView: "notLoaded" });
    let humanId = null;
    let cursor;
    // 只回溯到最近人工输入；超过预算则拒绝，不能用不完整历史默许领取。
    for (let page = 0; page < 100; page += 1) {
      const response = await this.rpc("thread/items/list", { threadId: this.sessionId, limit: 100, sortDirection: "desc", ...(cursor ? { cursor } : {}) });
      const entry = response.data.find(value => value.item?.type === "userMessage" && !confirmationWakeId(value.item));
      if (entry) { humanId = entry.item.id; break; }
      if (!response.nextCursor) break;
      cursor = response.nextCursor;
      if (page === 99) throw new Error("Codex 用户消息历史超出读取预算");
    }
    if (this.humanRevision !== revision) humanId = this.latestHuman;
    if (!humanId) throw new Error("Codex 会话没有可确认的人工消息基线");
    // 将快照基线也纳入去重，防止随后迟到的 completed 通知被当成新回复。
    this.seen.add(humanId);
    return { humanId, turn: turns.data[0] || null, status: thread.status, revision: this.humanRevision };
  }

  /** 读取精确回合的最终展示文本；分页预算不足时拒绝自动模式。
   * @param {string} turnId 已完成的展示回合
   * @returns {Promise<string>} 最终回复正文
   */
  async assistantText(turnId) {
    let cursor;
    const messages = [];
    for (let page = 0; page < 100; page += 1) {
      const response = await this.rpc("thread/items/list", { threadId: this.sessionId, limit: 100, sortDirection: "desc", ...(cursor ? { cursor } : {}) });
      for (const entry of response.data) {
        if (entry.turnId === turnId && entry.item?.type === "agentMessage" && entry.item.phase === "final_answer") messages.unshift(entry.item.text);
      }
      if (!response.nextCursor) return messages.join("\n");
      cursor = response.nextCursor;
    }
    throw new Error("Codex 展示记录超出读取预算");
  }

  /** 将内部唤醒投递到同一线程，原生 idle 队列可能立即启动回合。
   * @param {string} requestId 请求标识
   * @returns {Promise<object>} 队列项
   */
  async add(requestId) {
    const response = await this.rpc("thread/queue/add", {
      threadId: this.sessionId, clientUserMessageId: requestId, input: [{ type: "text", text: this.formal ? formalConfirmationWake(requestId) : confirmationWake(requestId) }],
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
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error("观察连接已关闭")); }
    this.pending.clear();
    this.socket?.terminate();
  }
}
