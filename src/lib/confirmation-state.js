import { randomUUID } from "node:crypto";

/**
 * 创建仅属于当前前台进程的确认状态机；方案与策略由 snapshot 统一核验。
 * @param {object} options 快照、可信展示、审计及可替换的计时器。
 * @param {Function} options.snapshot 返回 enabled/seconds/revision/display/kind/action/contextKey 的当前材料快照。
 * @param {Function} options.display 完整展示快照，输出排空后才完成。
 * @param {Function} [options.audit] 接收不含正文和控制凭据的状态事件。
 * @param {Function} [options.onAuditError] 审计首次失败时的诊断回调，不影响输入或清理。
 * @param {string} [options.instanceId] 本次进程身份，默认随机生成。
 * @param {number} [options.maxWaitSeconds] 宿主实际可覆盖的等待预算。
 * @param {Function} [options.setTimer] 计时器创建函数。
 * @param {Function} [options.clearTimer] 计时器取消函数。
 * @returns {object} 绑定、准备、等待、领取与取消接口。
 */
export function createConfirmationState({ snapshot, display, audit = () => {}, onAuditError = () => {}, instanceId = randomUUID(),
  maxWaitSeconds = 86400, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const requests = new Map();
  let contextKey = null;
  let closed = false;
  let inputEpoch = 0;
  let auditFailed = false;
  const pending = new Set(["prepared", "waiting", "timeout_ready"]);

  /** 审计失败即撤销所有未领取决定，但不能阻断人工输入和退出清理。 */
  function record(request, event, extra = {}) {
    if (auditFailed) return false;
    try {
      audit({ instance_id: instanceId, request_id: request?.id, kind: request?.snapshot.kind, event, ...extra });
      return true;
    } catch {
      auditFailed = true;
      cancelAll("audit_failed");
      try { onAuditError(); } catch { /* 诊断失败也不能阻断人工路径。 */ }
      return false;
    }
  }

  /** 审计不可用时，本实例不再授予新的自动许可。 */
  function requireAudit() {
    if (auditFailed) throw new Error("确认审计不可用，保持人工确认");
  }

  /**
   * 审计原生工具发现，不把未成功审计的就绪状态作为自动确认依据。
   * @returns {boolean} 是否仍可记录本实例的决定。
   */
  function auditReady() {
    return record(null, "tool_ready");
  }

  /** 将当前请求转换为短工具结果；它不是可重放的执行授权。 */
  function result(request, source, reason) {
    return { request_id: request.id, source, decision: source === "policy_timeout" ? "continue" : "stop",
      ...(reason ? { reason } : {}) };
  }

  /** 校验调用属于已绑定的当前主会话，不从任务唯一回退猜测所有者。 */
  function requireOwner(owner) {
    if (closed || !contextKey || owner !== contextKey) throw new Error("确认入口未绑定当前主会话，保持人工确认");
  }

  /**
   * 撤销单个尚未领取的请求。
   * @param {string} id 请求标识。
   * @param {string} reason 撤销原因。
   * @returns {boolean} 是否发生状态变更。
   */
  function cancel(id, reason = "cancelled") {
    const request = requests.get(id);
    if (!request || !pending.has(request.state)) return false;
    clearTimer(request.timer);
    request.state = "cancelled";
    request.snapshot.display = "";
    request.result = result(request, "cancelled", reason);
    request.resolve?.(request.result);
    record(request, "cancelled", { reason });
    return true;
  }

  /**
   * 在转发真实终端输入之前撤销所有未开始的决定。
   * @param {string} reason 人工介入、窗口退出或材料变化原因。
   * @returns {void}
   */
  function cancelAll(reason = "human_input") {
    inputEpoch += 1;
    for (const request of requests.values()) cancel(request.id, reason);
  }

  /**
   * 由原生 SessionStart 绑定主会话；切换会话时先撤销旧许可。
   * @param {string} owner 平台已核验的会话上下文键。
   * @returns {object} 不含凭据的绑定状态。
   */
  function bind(owner) {
    if (closed || typeof owner !== "string" || !owner || owner.length > 512) throw new Error("确认会话身份无效");
    if (contextKey !== owner) cancelAll("session_changed");
    contextKey = owner;
    return describe();
  }

  /**
   * 冻结当前材料但不启动计时；一次只保留一份活动确认。
   * @param {object} spec 当前流程的材料路径、问题标识或 Git 计划。
   * @param {string} owner 当前主会话键。
   * @returns {Promise<object>} 请求标识、等待时长及默认动作。
   */
  async function prepare(spec, owner) {
    requireOwner(owner);
    requireAudit();
    const startedEpoch = inputEpoch;
    const current = await snapshot(spec, owner);
    requireOwner(owner);
    requireAudit();
    if (startedEpoch !== inputEpoch) throw new Error("准备材料期间已有人工介入或会话变化，保持人工确认");
    if (!current.enabled || !Number.isSafeInteger(current.seconds) || current.seconds <= 0
      || current.seconds > maxWaitSeconds || current.contextKey !== owner || typeof current.revision !== "string"
      || typeof current.display !== "string" || !current.display.trim()) {
      throw new Error("本次策略、材料或等待预算无效，保持人工确认");
    }
    const existing = [...requests.values()].find(request => request.owner === owner && request.snapshot.revision === current.revision);
    if (existing) {
      if (!pending.has(existing.state)) throw new Error("当前材料的决定已撤销、已领取或已完成，不能重复准备");
      return { request_id: existing.id, seconds: current.seconds, action: current.action, source: "project_policy" };
    }
    cancelAll("replaced");
    requireAudit();
    const request = { id: randomUUID(), spec: structuredClone(spec), snapshot: current, owner, state: "prepared" };
    requests.set(request.id, request);
    record(request, "prepared", { revision: current.revision, material: current.material });
    requireAudit();
    return { request_id: request.id, seconds: current.seconds, action: current.action, source: "project_policy" };
  }

  /**
   * 完整展示被冻结方案，展示排空并再次核验后才开始等待。
   * @param {string} id 请求标识。
   * @returns {Promise<object>} 超时或取消结果；重复调用复用同一等待。
   */
  async function wait(id) {
    const request = requests.get(id);
    if (closed || !request || request.owner !== contextKey) throw new Error("确认请求不属于当前入口");
    if (auditFailed) cancel(id, "audit_failed");
    if (request.promise) return request.promise;
    if (request.state !== "prepared") return request.result || result(request, "cancelled", "invalid_state");
    request.promise = new Promise((resolve) => { request.resolve = resolve; });
    // 展示期间用户也可以取消；不能在异步展示完成后重新激活已撤销请求。
    void (async () => {
      try {
        const current = await snapshot(request.spec, request.owner);
        if (current.revision !== request.snapshot.revision || !current.enabled || current.contextKey !== request.owner) return cancel(id, "material_changed");
        if (request.state !== "prepared") return;
        await display({ ...request.snapshot, request_id: id });
        if (request.state !== "prepared" || closed) return;
        const displayed = await snapshot(request.spec, request.owner);
        if (displayed.revision !== request.snapshot.revision || !displayed.enabled || displayed.contextKey !== request.owner) return cancel(id, "material_changed");
        if (request.state !== "prepared" || closed) return;
        request.state = "waiting";
        if (!record(request, "waiting", { seconds: request.snapshot.seconds })) return;
        request.timer = setTimer(() => {
          if (closed || request.state !== "waiting") return;
          request.state = "timeout_ready";
          if (!record(request, "timeout_ready")) return;
          request.snapshot.display = "";
          request.result = result(request, "policy_timeout");
          request.resolve(request.result);
        }, request.snapshot.seconds * 1000);
      } catch {
        cancel(id, "validation_or_display_failed");
      }
    })();
    return request.promise;
  }

  /**
   * 执行前重新核对材料和所有者，并且只允许领取一次。
   * @param {string} id 请求标识。
   * @param {string} owner 当前主会话键。
   * @returns {Promise<object>} 本次动作的唯一领取结果。
   */
  async function claim(id, owner) {
    requireOwner(owner);
    requireAudit();
    const request = requests.get(id);
    if (!request || request.owner !== owner || request.state !== "timeout_ready") throw new Error("确认许可不存在、已撤销或已领取");
    const current = await snapshot(request.spec, owner);
    // 给已经排队的终端输入一个完整IO轮次，再进入不可重复的领取边界。
    await new Promise(resolve => setImmediate(resolve));
    requireOwner(owner);
    requireAudit();
    if (request.state !== "timeout_ready" || !current.enabled || current.contextKey !== owner || current.revision !== request.snapshot.revision) {
      cancel(id, "material_changed_or_cancelled");
      throw new Error("确认材料或许可已变化，请重新展示并确认");
    }
    // 先确认可审计再跨过执行边界；记录失败仍属于可以撤销的未领取请求。
    if (!record(request, "claimed", { source: "policy_timeout" })) requireAudit();
    request.state = "claimed";
    return { request_id: id, instance_id: instanceId, source: "policy_timeout", action: current.action,
      kind: current.kind, revision: current.revision };
  }

  /**
   * 记录已开始动作的真实结果，不把副作用伪装成已撤销。
   * @param {string} id 请求标识。
   * @param {string} owner 当前主会话键。
   * @param {string} outcome completed/interrupted/needs_verification。
   * @returns {object} 动作结果。
   */
  function finish(id, owner, outcome) {
    requireOwner(owner);
    const request = requests.get(id);
    if (!request || request.owner !== owner || request.state !== "claimed"
      || !["completed", "interrupted", "needs_verification"].includes(outcome)) throw new Error("动作完成状态无效");
    request.state = "finished";
    const recorded = record(request, "finished", { outcome });
    return { request_id: id, outcome, ...(!recorded ? { audit_ok: false } : {}) };
  }

  /**
   * 关闭当前入口并撤销所有可继续的许可。
   * @returns {void}
   */
  function close() {
    closed = true;
    cancelAll("session_closed");
    for (const request of requests.values()) if (request.state === "claimed") {
      request.state = "finished";
      record(request, "finished", { outcome: "needs_verification" });
    }
    contextKey = null;
  }

  /**
   * 返回不含正文、控制凭据或可重放许可的入口状态。
   * @returns {object} 当前实例状态。
   */
  function describe() {
    return { instance_id: instanceId, bound: Boolean(contextKey), closed, audit_ok: !auditFailed };
  }

  return { bind, prepare, wait, claim, cancel, cancelAll, finish, close, describe, auditReady };
}
