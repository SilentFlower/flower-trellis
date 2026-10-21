import path from "node:path";
import { contentSelectionsEqual } from "../content-selection.js";
import { PLUGIN_RUNTIME_ERROR_CODES, PluginRuntimeError } from "../runtime-errors.js";
import { hashDirectoryIfExists, hashFileIfExists } from "./content-hash.js";

/**
 * 汇总受管内容漂移，同次检查中相同文件或目录只计算一次摘要。
 *
 * @param {string} projectRoot 项目根
 * @param {import("../contracts.js").PluginStateEntry} applied 安装记录
 * @param {Map<string,object>} [cache] 本次只读检查的摘要缓存
 * @param {{throwReadErrors?:boolean}} [options] 冻结校验是否保留原读取异常
 * @returns {import("../contracts.js").PluginDiagnostic[]} 内容诊断
 */
export function inspectPluginContent(projectRoot, applied, cache = new Map(), options = {}) {
  const diagnostics = [];
  const targets = new Map();
  for (const entry of applied.paths) {
    const key = `${entry.kind}:${entry.path}`;
    const target = targets.get(key) || { path: entry.path, kind: entry.kind, hashes: [], patch: false };
    if (!target.hashes.includes(entry.hash)) target.hashes.push(entry.hash);
    targets.set(key, target);
  }
  for (const entry of applied.patches) {
    const key = `patch:${entry.target}`;
    const target = targets.get(key) || { path: entry.target, kind: "file", hashes: [], patch: true };
    if (!target.hashes.includes(entry.resultHash)) target.hashes.push(entry.resultHash);
    targets.set(key, target);
  }
  for (const target of targets.values()) {
    const absolute = path.join(projectRoot, ...target.path.split("/"));
    const key = `${target.kind}:${absolute}`;
    if (!cache.has(key)) {
      try {
        cache.set(key, { actual: target.kind === "directory" ? hashDirectoryIfExists(absolute) : hashFileIfExists(absolute) });
      } catch (error) {
        cache.set(key, { error });
      }
    }
    const { actual, error } = cache.get(key);
    if (error && options.throwReadErrors) throw error;
    const label = target.patch ? "Plugin Patch 目标" : "Plugin 目标";
    if (error || target.hashes.some((expected) => expected !== actual)) {
      diagnostics.push({
        code: `verify.${target.patch ? "patch-" : ""}target-${error ? "invalid" : "drift"}`,
        path: target.path,
        message: error ? error.message : `${label}摘要漂移:${target.path}`,
        severity: "error",
        details: { expected: target.hashes.length === 1 ? target.hashes[0] : target.hashes, actual: actual ?? null },
      });
    }
  }
  return diagnostics;
}

/**
 * 校验 Plugin 的 lock/state 对应关系与当前目标摘要。
 *
 * @param {string} projectRoot 项目根
 * @param {import("../contracts.js").ResolvedPlugin} locked 锁定记录
 * @param {import("../contracts.js").PluginStateEntry} applied 安装记录
 * @returns {void}
 */
export function assertPluginStateMatches(projectRoot, locked, applied) {
  if (
    applied.version !== locked.version ||
    !contentSelectionsEqual(applied.contentSelection, locked.contentSelection)
  ) {
    throw new PluginRuntimeError(`冻结 Plugin 的 lock/state 不一致:${locked.id}`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.TARGET_DRIFT,
      path: locked.id,
    });
  }
  const [diagnostic] = inspectPluginContent(projectRoot, applied, new Map(), { throwReadErrors: true });
  if (diagnostic) {
    throw new PluginRuntimeError(`冻结 ${diagnostic.message}`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.TARGET_DRIFT,
      path: diagnostic.path,
      details: diagnostic.details,
    });
  }
}
