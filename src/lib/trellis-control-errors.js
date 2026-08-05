import { PluginError } from "../plugin/errors.js";

/** Trellis 项目级控制稳定错误码。 */
export const TRELLIS_CONTROL_ERROR_CODES = Object.freeze({
  USAGE_ERROR: "TRELLIS_CONTROL_USAGE_ERROR",
  CONFLICT: "TRELLIS_CONTROL_CONFLICT",
  STATE_CORRUPT: "TRELLIS_CONTROL_STATE_CORRUPT",
  TRANSACTION_FAILED: "TRELLIS_CONTROL_TRANSACTION_FAILED",
  REPAIR_REQUIRED: "TRELLIS_CONTROL_REPAIR_REQUIRED",
});

/**
 * Trellis 项目级关闭、恢复与漂移检查错误。
 */
export class TrellisControlError extends PluginError {
  /**
   * 创建带稳定错误码和诊断详情的异常。
   *
   * @param {string} message 中文错误说明
   * @param {{code:string,path?:string,cause?:unknown,details?:object}} options 错误元数据
   */
  constructor(message, options) {
    super(message, options);
    this.details = options.details || {};
  }
}
