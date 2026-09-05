import { queueLegacyTelemetry } from "./telemetry-queue.js";

// 对外保留旧模块入口；队列只依赖 context，避免兼容入口反向形成循环。
export {
  FLOWER_TELEMETRY_ENDPOINT, telemetryStatePath, readTelemetryState,
  setTelemetryEnabled, buildTelemetryPayload,
} from "./telemetry-context.js";

/** 将兼容安装快照入队；网络由独立 sender 执行。
 * @param {string} target 项目根目录
 * @param {string} event v1 事件
 * @param {object} options 本地采集依赖
 * @returns {Promise<{status:string}>} 入队结果
 */
export async function reportTelemetry(target, event, options = {}) {
  try { return queueLegacyTelemetry(target, event, options); }
  catch { return { status: "failed" }; }
}
