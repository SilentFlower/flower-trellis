import { PluginSchemaError } from "../errors.js";

/**
 * 判断值是否为 JSON 普通对象。
 *
 * @param {unknown} value 待判断值
 * @returns {boolean} 是否为普通对象
 */
function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * 递归规范化 JSON 值并拒绝 JSON 之外的运行时类型。
 *
 * @param {unknown} value 原始值
 * @param {WeakSet<object>} ancestors 当前递归祖先
 * @param {string} pointer JSON Pointer
 * @returns {unknown} 键顺序稳定的 JSON 值
 */
function canonicalize(value, ancestors, pointer) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new PluginSchemaError("Canonical JSON 不允许非有限数字", {
        issues: [{ code: "json.non-finite-number", path: pointer, message: "数字必须是有限值" }],
      });
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      throw new PluginSchemaError("Canonical JSON 不允许循环引用", {
        issues: [{ code: "json.circular", path: pointer, message: "检测到循环引用" }],
      });
    }
    ancestors.add(value);
    try {
      return value.map((entry, index) => canonicalize(entry, ancestors, `${pointer}/${index}`));
    } finally {
      ancestors.delete(value);
    }
  }
  if (isPlainObject(value)) {
    const object = /** @type {Record<string, unknown>} */ (value);
    if (ancestors.has(object)) {
      throw new PluginSchemaError("Canonical JSON 不允许循环引用", {
        issues: [{ code: "json.circular", path: pointer, message: "检测到循环引用" }],
      });
    }
    ancestors.add(object);
    try {
      const result = {};
      for (const key of Object.keys(object).sort()) {
        const escaped = key.replaceAll("~", "~0").replaceAll("/", "~1");
        result[key] = canonicalize(object[key], ancestors, `${pointer}/${escaped}`);
      }
      return result;
    } finally {
      ancestors.delete(object);
    }
  }
  throw new PluginSchemaError("Canonical JSON 包含不支持的值", {
    issues: [{
      code: "json.unsupported-value",
      path: pointer,
      message: `不支持的值类型:${typeof value}`,
    }],
  });
}

/**
 * 生成稳定、两空格缩进且以换行结尾的 JSON。
 *
 * @param {unknown} value JSON 值
 * @returns {string} canonical JSON 字节串
 */
export function stringifyCanonicalJson(value) {
  return `${JSON.stringify(canonicalize(value, new WeakSet(), ""), null, 2)}\n`;
}
