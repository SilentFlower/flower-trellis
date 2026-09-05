import crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import { flowerVersion, trellisVersion } from "./versions.js";
import { queueTelemetryEvent } from "./telemetry-queue.js";

const ERROR_GROUPS = {
  precondition: ["PLUGIN_USAGE_ERROR", "PLUGIN_SOURCE_NOT_FOUND", "PLUGIN_SCHEMA_INVALID", "PLUGIN_STATE_CORRUPT", "PLUGIN_PLATFORM_SELECTION_REQUIRED", "PLUGIN_PLATFORM_UNKNOWN", "PLUGIN_SOURCE_CONFIG_INVALID", "PLUGIN_DEPENDENCY_MISSING"],
  network: ["PLUGIN_REMOTE_REQUEST_FAILED", "PLUGIN_REMOTE_RATE_LIMITED", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND"],
  permission: ["PLUGIN_AUTH_REQUIRED", "PLUGIN_AUTH_FAILED", "PLUGIN_AUTH_SCOPE_INVALID", "PLUGIN_UNSAFE_PATH", "PLUGIN_CAPABILITY_APPROVAL_REQUIRED", "EACCES", "EPERM"],
  conflict: ["PLUGIN_CONTENT_CONFLICT", "PLUGIN_TARGET_DRIFT", "PLUGIN_DEPENDENCY_CONFLICT", "PLUGIN_DEPENDENCY_CYCLE", "PLUGIN_EXTERNAL_VERSION_REUSED", "PLUGIN_INTEGRITY_MISMATCH"],
  upstream: ["FLOWER_UPSTREAM_FAILED"],
  io: ["PLUGIN_IO_ERROR", "PLUGIN_TRANSACTION_FAILED", "PLUGIN_TRANSACTION_REPAIR_REQUIRED", "UPDATE_COMPENSATION_INCOMPLETE", "ENOENT", "ENOSPC", "EROFS"],
};

/** 从结构化错误码取得有限分类，不读取 message/path/stack。
 * @param {unknown} error 异常
 * @returns {object} 分类
 */
export function classifyTelemetryError(error) {
  const category = Object.entries(ERROR_GROUPS).find(([, codes]) => codes.includes(error?.code))?.[0] || "unknown";
  const stage = error?.code === "UPDATE_COMPENSATION_INCOMPLETE" ? "recover"
    : ({ precondition: "prepare", network: "resolve", permission: "authorize", conflict: "apply", upstream: "upstream", io: "apply" })[category] || "unknown";
  return { error_category: category, failure_stage: stage };
}

/** 标记已开始真实执行，帮助/预览/未确认退出不会产生终态。
 * @param {object} ctx 命令上下文
 * @returns {void}
 */
export function beginTelemetryOperation(ctx) {
  const operation = ctx.telemetryOperation;
  if (operation && !operation.suppressed && !operation.started) { operation.started = performance.now(); }
}

/** 在 Plugin 把异常转换为退出码前保留有限分类。
 * @param {object} ctx 命令上下文
 * @param {unknown} error 错误
 * @returns {void}
 */
export function noteTelemetryError(ctx, error) {
  if (ctx.telemetryOperation) {
    ctx.telemetryOperation.error = classifyTelemetryError(error);
    ctx.telemetryOperation.cancelled = error?.telemetryCancelled === true || error?.name === "ExitPromptError" || error?.code === "FLOWER_OPERATION_CANCELLED";
  }
}

/** 至多一次记录终态，并在完成菜单前冻结耗时。
 * @param {object} ctx 命令上下文
 * @param {string} name 期望的外部操作
 * @param {string} outcome 终态
 * @returns {void}
 */
export function completeTelemetryOperation(ctx, name, outcome = "success") {
  const operation = ctx.telemetryOperation;
  if (!operation || operation.name !== name || !operation.started || operation.completed) return;
  operation.completed = true;
  queueTelemetryEvent(operation.target, { event_id: operation.id, event: "operation_completed", operation: name, outcome,
    ...(outcome === "failure" ? operation.error || classifyTelemetryError(null) : { error_category: null, failure_stage: null }),
    duration_ms: Math.max(0, Math.round(performance.now() - operation.started)), duration_kind: "elapsed" }, operation.options);
}

/** 建立外部操作边界；嵌套调用共享上下文，子进程可仅抑制采集。
 * @param {object} ctx 命令上下文
 * @param {string} name 操作
 * @param {Function} execute 实际命令
 * @param {object} options 遥测依赖
 * @returns {Promise<unknown>} 原命令返回值
 */
export async function observeTelemetryOperation(ctx, name, execute, options = {}) {
  if (ctx.telemetryOperation || (options.env || process.env).FLOWER_TELEMETRY_PARENT_OPERATION) return execute(ctx);
  const operation = { id: crypto.randomUUID(), name, target: ctx.target, started: null, completed: false,
    suppressed: ctx.passthrough?.includes("--dry-run") || ctx.trellisControlMode === "restoring",
    options: { ...options, runtimeVersion: flowerVersion(), bundledVersion: trellisVersion() } };
  const nested = { ...ctx, telemetryOperation: operation };
  try {
    const result = await execute(nested);
    completeTelemetryOperation(nested, name, operation.cancelled ? "cancelled" : typeof result === "number" && result !== 0 ? "failure" : "success");
    return result;
  } catch (error) {
    if (!operation.error || error?.code === "UPDATE_COMPENSATION_INCOMPLETE") noteTelemetryError(nested, error);
    completeTelemetryOperation(nested, name, operation.cancelled ? "cancelled" : "failure");
    throw error;
  }
}
