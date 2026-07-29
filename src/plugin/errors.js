/** Flower Plugin 稳定错误码。 */
export const PLUGIN_ERROR_CODES = Object.freeze({
  SCHEMA_INVALID: "PLUGIN_SCHEMA_INVALID",
  UNSAFE_PATH: "PLUGIN_UNSAFE_PATH",
  INTEGRITY_MISMATCH: "PLUGIN_INTEGRITY_MISMATCH",
  STATE_CORRUPT: "PLUGIN_STATE_CORRUPT",
  IO_ERROR: "PLUGIN_IO_ERROR",
});

/**
 * Flower Plugin 公共错误基类。
 */
export class PluginError extends Error {
  /**
   * 创建带稳定错误码和结构化 issue 的错误。
   *
   * @param {string} message 面向调用方的错误说明
   * @param {{code?:string,path?:string,issues?:Array<{code:string,path:string,message:string}>,cause?:unknown}} [options] 错误元数据
   */
  constructor(message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = options.code || PLUGIN_ERROR_CODES.IO_ERROR;
    this.path = options.path || "";
    this.issues = Array.isArray(options.issues) ? options.issues : [];
  }
}

/**
 * Plugin 或项目文件不符合 schema 时抛出的错误。
 */
export class PluginSchemaError extends PluginError {
  /**
   * 创建 schema 校验错误。
   *
   * @param {string} message 错误说明
   * @param {{path?:string,issues?:Array<{code:string,path:string,message:string}>,cause?:unknown}} [options] schema 错误元数据
   */
  constructor(message, options = {}) {
    super(message, { ...options, code: PLUGIN_ERROR_CODES.SCHEMA_INVALID });
  }
}

/**
 * Plugin 路径不安全或逃逸受管边界时抛出的错误。
 */
export class PluginPathError extends PluginError {
  /**
   * 创建路径安全错误。
   *
   * @param {string} message 错误说明
   * @param {{path?:string,cause?:unknown}} [options] 路径错误元数据
   */
  constructor(message, options = {}) {
    super(message, { ...options, code: PLUGIN_ERROR_CODES.UNSAFE_PATH });
  }
}

/**
 * Plugin 内容摘要不匹配时抛出的错误。
 */
export class PluginIntegrityError extends PluginError {
  /**
   * 创建完整性错误。
   *
   * @param {string} message 错误说明
   * @param {{path?:string,cause?:unknown}} [options] 完整性错误元数据
   */
  constructor(message, options = {}) {
    super(message, { ...options, code: PLUGIN_ERROR_CODES.INTEGRITY_MISMATCH });
  }
}

/**
 * `.flower/` 状态损坏或版本不可识别时抛出的错误。
 */
export class PluginStateError extends PluginError {
  /**
   * 创建状态损坏错误。
   *
   * @param {string} message 错误说明
   * @param {{path?:string,issues?:Array<{code:string,path:string,message:string}>,cause?:unknown}} [options] 状态错误元数据
   */
  constructor(message, options = {}) {
    super(message, { ...options, code: PLUGIN_ERROR_CODES.STATE_CORRUPT });
  }
}

/**
 * Project Store 文件系统操作失败时抛出的错误。
 */
export class PluginIoError extends PluginError {
  /**
   * 创建 I/O 错误。
   *
   * @param {string} message 错误说明
   * @param {{path?:string,cause?:unknown}} [options] I/O 错误元数据
   */
  constructor(message, options = {}) {
    super(message, { ...options, code: PLUGIN_ERROR_CODES.IO_ERROR });
  }
}
