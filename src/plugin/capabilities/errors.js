import { PluginError } from "../errors.js";

/** Flower Plugin capability 稳定错误码。 */
export const PLUGIN_CAPABILITY_ERROR_CODES = Object.freeze({
  DENIED: "PLUGIN_CAPABILITY_DENIED",
  APPROVAL_REQUIRED: "PLUGIN_CAPABILITY_APPROVAL_REQUIRED",
  PATCH_POLICY_INVALID: "PLUGIN_PATCH_POLICY_INVALID",
  MUTATION_CONFLICT: "PLUGIN_MUTATION_CONFLICT",
});

/**
 * Plugin capability 协商、批准与 Patch policy 错误。
 */
export class PluginCapabilityError extends PluginError {
  /**
   * 创建 capability 错误。
   *
   * @param {string} message 中文错误说明
   * @param {{code:string,path?:string,cause?:unknown,details?:object}} options 错误元数据
   */
  constructor(message, options) {
    super(message, options);
    this.details = options.details || {};
  }
}
