/** @module confirmation-protocol 两平台共用的请求标识和原生通知正文。 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 校验精确 UUID，禁止由标识构造越界路径。
 * @param {string} value 会话、请求或运行标识
 * @returns {string} 已校验标识
 */
export function confirmationId(value) {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error("必须提供精确的 UUID 会话或请求标识");
  return value;
}

/** 生成只携带请求标识的提醒；通知本身不能批准动作。
 * @param {string} requestId 精确请求
 * @param {string} platform 原生平台
 * @returns {string} 领取指引
 */
export function formalConfirmationWake(requestId, platform = "codex") {
  confirmationId(requestId);
  if (!["codex", "claude"].includes(platform)) throw new Error("未知确认平台");
  return `[flower-confirmation:v2:${requestId}]\n后台确认已到期。先按 .trellis/scripts/confirmation.md 定位本项目的 Flower 入口，再执行 confirm claim --platform ${platform} --request ${requestId}。只有返回 claimed=true 才按返回的 action 和冻结 context 进入原流程；必须继续执行原有范围检查与失败恢复。claimed=false 或失败表示已失效，结束本回合，不重试、不执行旧动作。`;
}

/** 核对完整内部正文及原生 clientId，人工粘贴不能冒充队列消息。
 * @param {object} item 原生消息条目
 * @returns {string|null} 精确请求编号
 */
export function confirmationWakeId(item) {
  if (item?.type !== "userMessage" || item.content?.length !== 1 || item.content[0].type !== "text") return null;
  const text = item.content[0].text;
  const match = typeof text === "string" && text.match(/^\[flower-confirmation:v2:([0-9a-f-]{36})\]/i);
  if (!match || !UUID.test(match[1]) || item.clientId !== match[1] || text !== formalConfirmationWake(match[1])) return null;
  return match[1];
}
