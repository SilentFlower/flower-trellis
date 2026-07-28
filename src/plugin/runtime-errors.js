import { PluginError } from "./errors.js";

/** Flower Plugin Runtime 稳定错误码。 */
export const PLUGIN_RUNTIME_ERROR_CODES = Object.freeze({
  SOURCE_DUPLICATE: "PLUGIN_SOURCE_DUPLICATE",
  SOURCE_NOT_FOUND: "PLUGIN_SOURCE_NOT_FOUND",
  SOURCE_AMBIGUOUS: "PLUGIN_SOURCE_AMBIGUOUS",
  DEPENDENCY_MISSING: "PLUGIN_DEPENDENCY_MISSING",
  DEPENDENCY_CONFLICT: "PLUGIN_DEPENDENCY_CONFLICT",
  DEPENDENCY_CYCLE: "PLUGIN_DEPENDENCY_CYCLE",
  PLATFORM_SELECTION_REQUIRED: "PLUGIN_PLATFORM_SELECTION_REQUIRED",
  PLATFORM_UNKNOWN: "PLUGIN_PLATFORM_UNKNOWN",
  CONTENT_CONFLICT: "PLUGIN_CONTENT_CONFLICT",
  TARGET_DRIFT: "PLUGIN_TARGET_DRIFT",
  TRANSACTION_FAILED: "PLUGIN_TRANSACTION_FAILED",
  TRANSACTION_REPAIR_REQUIRED: "PLUGIN_TRANSACTION_REPAIR_REQUIRED",
  USAGE_ERROR: "PLUGIN_USAGE_ERROR",
  VERIFY_FAILED: "PLUGIN_VERIFY_FAILED",
});

/**
 * Plugin Runtime 解析、规划与事务错误。
 */
export class PluginRuntimeError extends PluginError {
  /**
   * 创建带稳定 Runtime 错误码的异常。
   *
   * @param {string} message 中文错误说明
   * @param {{code:string,path?:string,issues?:Array<{code:string,path:string,message:string}>,cause?:unknown,details?:object}} options 错误元数据
   */
  constructor(message, options) {
    super(message, options);
    this.details = options.details || {};
  }
}
