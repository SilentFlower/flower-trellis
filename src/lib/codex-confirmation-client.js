/** @module codex-confirmation-client 共享服务下的原生输入取消与冻结窗口适配。 */
import { randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { CodexQueueClient } from "./codex-queue-client.js";
import { ConfirmationStore } from "./codex-confirmation.js";
import { confirmationId, formalConfirmationWake } from "./confirmation-protocol.js";
import { captureCodexTui, verifyCodexTui, verifyCodexTuiCoverage, watchCodexTui } from "./codex-tui-lifetime.js";

const ACTIVE = new Set(["prepared", "waiting", "dispatching", "queued"]);

/** 在原生输入进入模型前失效旧代次；内部提醒还必须在领取时核对原生来源。
 * @param {object} payload 原生 Hook 输入
 * @returns {object} 空 Hook 输出
 */
export function recordCodexConfirmationEvent(payload) {
  if (payload.agent_id || !["UserPromptSubmit", "Interrupt"].includes(payload.hook_event_name)) return {};
  const project = realpathSync(payload.cwd);
  if (!existsSync(path.join(project, ".trellis/scripts/confirmation_policy.py"))) return {};
  const sessionId = confirmationId(payload.session_id);
  const store = new ConfirmationStore(project, sessionId, { platform: "codex" });
  store.update(old => {
    const state = old || { version: 2, sessionId, generation: 0, lastHumanMessageId: null, request: null };
    const request = state.request;
    state.native = { version: 2, project, sessionId, at: Date.now(), turnId: payload.turn_id };
    // Hook 没有 clientId。只暂缓精确当前提醒的取消，不能在此授予许可；
    // claim 仍须核对原生 userMessage.clientId，粘贴相同文字会被拒绝。
    const internal = payload.hook_event_name === "UserPromptSubmit"
      && request && ["dispatching", "queued"].includes(request.state)
      && payload.prompt === formalConfirmationWake(request.id);
    if (!internal) {
      state.generation += 1;
      state.lastHumanMessageId = randomUUID();
      if (request && ACTIVE.has(request.state)) {
        request.state = "cancelled";
        request.error = payload.hook_event_name === "Interrupt" ? "turn_interrupted" : "user_replied";
      }
    }
    return state;
  });
  return {};
}

/** 只观察原请求的前台进程，不能在恢复时绑定新窗口。 */
export class CodexConfirmationClient extends CodexQueueClient {
  /** 捕获准备时的原生前台身份。
   * @param {string} turnId 当前展示回合
   * @returns {Promise<object>} 冻结窗口
   */
  async captureWindow(turnId) {
    const native = new ConfirmationStore(this.project, this.sessionId, { platform: "codex" }).read()?.native;
    if (native?.version !== 2 || native.project !== this.project || native.sessionId !== this.sessionId || !turnId || native.turnId !== turnId) {
      throw new Error("当前会话尚未收到确认输入 Hook，重开原生客户端后使用；本次保持人工确认");
    }
    const binding = await captureCodexTui({ client: this, sessionId: this.sessionId, project: this.project });
    await verifyCodexTuiCoverage({ client: this, project: this.project });
    return binding;
  }

  /** 复核请求已经冻结的窗口。
   * @param {object} binding 原窗口身份
   * @returns {Promise<void>} 失效时抛错
   */
  async verifyWindow(binding) {
    await verifyCodexTui({ client: this, sessionId: this.sessionId, project: this.project, binding });
    await verifyCodexTuiCoverage({ client: this, project: this.project });
  }

  /** 打开本次 worker 的临时退出观察。
   * @param {object} binding 原窗口身份
   * @returns {Promise<void>} 观察就绪
   */
  async observeWindow(binding) {
    await this.verifyWindow(binding);
    this.windowObserver = watchCodexTui(binding, { project: this.project });
    const invalidate = error => {
      if (this.closing || this.failure) return;
      this.failure = error;
      this.emit("disconnect", error);
    };
    this.windowObserver.on("invalid", invalidate);
    this.windowObserver.on("exited", () => invalidate(new Error("frontend_exited")));
    await this.windowObserver.ready;
  }

  /** 清理自己的观察与连接，不操作前台或 daemon。
   * @returns {void}
   */
  close() {
    this.windowObserver?.close();
    super.close();
  }
}
