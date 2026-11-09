/**
 * Claude 普通 TUI 的原生事件适配；后台完成只负责唤醒，许可仍由共享状态领取。
 * @module claude-confirmation-client
 */
import { EventEmitter } from "node:events";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { ConfirmationStore } from "./codex-confirmation.js";
import { confirmationId, formalConfirmationWake } from "./codex-queue-client.js";

const ACTIVE = new Set(["prepared", "waiting", "dispatching", "queued"]);

/** 提取完整原生任务通知中的精确任务 ID；正文仍须结合 transcript origin 核验。 */
function taskNotice(text) {
  if (typeof text !== "string" || !text.startsWith("<task-notification>\n") || !text.endsWith("\n</task-notification>")) return null;
  const matches = [...text.matchAll(/<task-id>([A-Za-z0-9_-]{1,100})<\/task-id>/g)];
  return matches.length === 1 ? matches[0][1] : null;
}

/**
 * 保存本机实际验证的 Hook 载荷；不把后台通知误记为新的人工决定。
 * @param {object} payload 原生 Hook 输入
 * @returns {object} 原生 Hook 的可选上下文输出
 */
export function recordClaudeConfirmationEvent(payload) {
  if (!["UserPromptSubmit", "Stop", "SessionEnd"].includes(payload.hook_event_name)) return {};
  const project = realpathSync(payload.cwd);
  if (!existsSync(path.join(project, ".trellis/scripts/confirmation_policy.py"))) return {};
  const sessionId = confirmationId(payload.session_id);
  const store = new ConfirmationStore(project, sessionId, { platform: "claude" });
  let reminder = null;
  store.update(old => {
    const state = old || { version: 2, sessionId, generation: 0, lastHumanMessageId: null, request: null };
    const native = state.native || { version: 1, project, sessionId, tasks: {} };
    if (native.project !== project || native.sessionId !== sessionId) throw new Error("Claude 事件会话或项目不符");
    if (typeof payload.transcript_path !== "string" || path.basename(payload.transcript_path) !== `${sessionId}.jsonl`) throw new Error("Claude 缺少精确会话记录路径");
    native.transcript = payload.transcript_path;
    native.at = Date.now();
    const request = state.request;
    if (payload.hook_event_name === "UserPromptSubmit") {
      const promptId = confirmationId(payload.prompt_id);
      const taskId = taskNotice(payload.prompt);
      const owned = taskId && native.tasks[taskId];
      native.turn = { id: promptId, status: "inProgress" };
      native.ended = false;
      // Hook 本身没有 origin 字段。此处仅暂认精确原生任务；claim 必须再查 transcript，
      // 因而人工粘贴同形通知也会通过 origin=human 被识别并取消，不能冒充后台事件。
      if (owned) {
        native.notification = { taskId, requestId: owned, promptId };
        reminder = formalConfirmationWake(owned, "claude");
      } else if (native.humanId !== promptId) {
        native.humanId = promptId;
        state.lastHumanMessageId = promptId;
        state.generation += 1;
        if (request && ACTIVE.has(request.state)) { request.state = "cancelled"; request.error = "user_replied"; }
      }
    } else if (payload.hook_event_name === "Stop") {
      const promptId = confirmationId(payload.prompt_id);
      native.turn = { id: promptId, status: "completed" };
      if (typeof payload.last_assistant_message !== "string" || Buffer.byteLength(payload.last_assistant_message) > 512 * 1024) throw new Error("Claude 最终展示正文不可核验");
      native.display = { turnId: promptId, text: payload.last_assistant_message, at: native.at };
      for (const task of payload.background_tasks || []) {
        if (!request || task.type !== "shell" || typeof task.command !== "string") continue;
        // 原生 command 保留 shell 引号，不能用未引用的子串匹配参数，否则合法工具命令会丢失绑定。
        const tokens = task.command.match(/"[^"]*"|'[^']*'|\S+/g)?.map(token => /^(['"]).*\1$/.test(token) ? token.slice(1, -1) : token) || [];
        const start = tokens.findIndex((token, index) => token === "confirm" && tokens[index + 1] === "wait");
        const flag = tokens.indexOf("--request", start + 2);
        if (start < 1 || flag < 0 || tokens[flag + 1] !== request.id) continue;
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(task.id)) throw new Error("Claude 原生任务 ID 无效");
        native.tasks[task.id] = request.id;
        request.nativeTaskId = task.id;
      }
      const ids = Object.keys(native.tasks);
      for (const id of ids.slice(0, -8)) delete native.tasks[id];
    } else {
      native.ended = true;
      state.generation += 1;
      if (request && ACTIVE.has(request.state)) { request.state = "cancelled"; request.error = "session_ended"; }
    }
    state.native = native;
    return state;
  });
  return reminder ? { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: reminder } } : {};
}

/** Claude 精确会话客户端；只观察自己安装的原生事件与当前会话记录。 */
export class ClaudeConfirmationClient extends EventEmitter {
  /**
   * @param {object} options 项目、精确会话及平台
   */
  constructor({ project, sessionId, platform = process.platform }) {
    super();
    if (platform !== "linux") throw new Error("Claude 后台确认目前只验证 Linux/WSL");
    this.store = new ConfirmationStore(project, sessionId, { platform: "claude" });
    this.project = this.store.project;
    this.sessionId = sessionId;
    this.deliveryOnExit = true;
    this.failure = null;
    this.poll = null;
    this.lastHuman = null;
    this.lastCompleted = null;
  }

  /** 核对原生 Hook 已建立的会话；不自行猜测 transcript。
   * @returns {Promise<void>}
   */
  async connect() {
    const native = this.store.read()?.native;
    if (native?.version !== 1 || native.project !== this.project || native.sessionId !== this.sessionId || native.ended) throw new Error("Claude 原生确认 Hook 不可用或会话已退出，保持人工确认");
    await this.snapshot();
  }

  /** 订阅后台事件；定时观察仅发生于后台进程，不占住主对话工具调用。
   * @returns {Promise<object>} 初始快照
   */
  async subscribe() {
    const snapshot = await this.snapshot();
    this.lastHuman = snapshot.humanId;
    this.poll = setInterval(() => {
      try {
      const native = this.store.read()?.native;
      if (!native) return;
      if (native.ended) { this.failure = new Error("Claude 原生会话已退出"); return; }
      if (native.humanId !== this.lastHuman) {
        this.lastHuman = native.humanId;
        this.emit("human", { id: native.humanId, turnId: native.turn?.id });
      }
      if (native.turn?.status === "completed" && native.turn.id !== this.lastCompleted) {
        this.lastCompleted = native.turn.id;
        this.emit("notification", { method: "turn/completed", params: { turn: native.turn } });
      }
      } catch (error) { this.failure = error; }
    }, 50);
    return snapshot;
  }

  /** 读取有界会话 JSONL，核对真实 human/task-notification 来源，拒绝模拟通知。
   * @returns {Promise<object>} 精确人工基线与回合
   */
  async snapshot() {
    const native = this.store.read()?.native;
    if (!native || native.ended) throw new Error("Claude 会话状态不可用");
    const file = native.transcript;
    const info = lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024 * 1024) throw new Error("Claude 会话记录不可核验或超过预算");
    const text = readFileSync(file, "utf8");
    if (Buffer.byteLength(text) > 16 * 1024 * 1024) throw new Error("Claude 会话记录超过预算");
    const rows = text.split("\n");
    if (!text.endsWith("\n")) rows.pop();
    let humanId = null;
    let notification = null;
    for (const line of rows) {
      if (!line.trim()) continue;
      const entry = JSON.parse(line);
      if (entry.type !== "user" || entry.isSidechain || entry.sessionId !== this.sessionId) continue;
      if (entry.origin?.kind === "human" && entry.turnOrigin === "human") humanId = confirmationId(entry.promptId);
      else if (entry.origin?.kind === "task-notification" && entry.turnOrigin === "task_notification") {
        const taskId = taskNotice(entry.message?.content);
        if (taskId && native.tasks[taskId]) notification = { taskId, requestId: native.tasks[taskId], promptId: entry.promptId };
      } else if (typeof entry.message?.content === "string" && !entry.isCompactSummary) throw new Error("Claude 消息来源字段不可核验，保持人工确认");
    }
    if (!humanId) throw new Error("Claude 缺少真实人工输入基线；关闭记录的会话保持人工确认");
    return { humanId, turn: native.turn, notification };
  }

  /** 核对原始展示回合的最终正文。
   * @param {string} turnId 展示回合
   * @returns {Promise<string>} 已完成展示
   */
  async assistantText(turnId) {
    const display = this.store.read()?.native?.display;
    if (display?.turnId !== turnId) throw new Error("Claude 最终展示回合不符");
    return display.text;
  }

  /** 在状态先落盘后结束后台任务，让 Claude 自己发出完成通知。
   * @param {string} requestId 精确请求
   * @returns {Promise<object>} 原生任务绑定
   */
  async add(requestId) {
    const request = this.store.read()?.request;
    if (request?.id !== requestId || !request.nativeTaskId) throw new Error("Claude 未绑定本次原生后台任务");
    return { id: request.nativeTaskId };
  }

  /** Claude 的已完成通知不能撤回；共享状态取消仍阻止领取。
   * @param {string} queueId 精确任务
   * @returns {Promise<string>} 真实撤回边界
   */
  async remove(queueId) { return queueId ? "not_retractable" : "not_pending"; }

  /** 清理自有监听，不终止用户 CLI。
   * @returns {void}
   */
  close() { clearInterval(this.poll); }
}
