import fs from "node:fs";
import path from "node:path";
import { PluginIoError } from "../errors.js";
import { PLUGIN_RUNTIME_ERROR_CODES, PluginRuntimeError } from "../runtime-errors.js";
import { isPluginId } from "../schemas/shared.js";

/**
 * 把外部名称规范化为 Flower 本地 ID。
 *
 * @param {unknown} value 外部名称
 * @param {string} label 诊断标签
 * @returns {string} Flower ID
 */
export function normalizeExternalId(value, label) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!isPluginId(normalized)) {
    throw new PluginRuntimeError(`${label} 无法规范化为 Flower ID:${String(value || "")}`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.FORMAT_UNSUPPORTED,
      path: String(value || ""),
    });
  }
  return normalized;
}

/**
 * 读取普通 JSON 文件。
 *
 * @param {string} file JSON 文件
 * @param {string} label 诊断标签
 * @returns {object} JSON 对象
 */
export function readFormatJson(file, label) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new TypeError("入口不是普通文件");
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!value || Array.isArray(value) || typeof value !== "object") throw new TypeError("入口必须是 JSON 对象");
    return value;
  } catch (error) {
    throw new PluginIoError(`无法读取${label}:${file}`, { path: file, cause: error });
  }
}

/**
 * 返回目录中的普通子目录。
 *
 * @param {string} directory 目录
 * @returns {string[]} 稳定子目录名
 */
export function listOrdinaryDirectories(directory) {
  if (!fs.existsSync(directory)) return [];
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new PluginRuntimeError(`外部组件目录必须是普通目录:${directory}`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.FORMAT_UNSUPPORTED,
      path: directory,
    });
  }
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map(({ name }) => name)
    .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
}

/**
 * 返回目录中的普通 Markdown 文件。
 *
 * @param {string} directory 目录
 * @returns {string[]} 稳定文件名
 */
export function listOrdinaryMarkdownFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new PluginRuntimeError(`外部组件目录必须是普通目录:${directory}`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.FORMAT_UNSUPPORTED,
      path: directory,
    });
  }
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
    .map(({ name }) => name)
    .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
}

/**
 * 计算相对入口路径。
 *
 * @param {string} root 检测根
 * @param {string} target 入口文件
 * @returns {string} POSIX 相对路径
 */
export function relativeEntryPath(root, target) {
  return path.relative(root, target).split(path.sep).join("/");
}
