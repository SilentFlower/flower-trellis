import path from "node:path";
import { contentSelectionsEqual } from "../content-selection.js";
import { PLUGIN_RUNTIME_ERROR_CODES, PluginRuntimeError } from "../runtime-errors.js";
import { hashDirectoryIfExists, hashFileIfExists } from "./content-hash.js";

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
  for (const entry of applied.paths) {
    const target = path.join(projectRoot, ...entry.path.split("/"));
    const actual = entry.kind === "directory"
      ? hashDirectoryIfExists(target)
      : hashFileIfExists(target);
    if (actual !== entry.hash) {
      throw new PluginRuntimeError(`冻结 Plugin 目标摘要漂移:${entry.path}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.TARGET_DRIFT,
        path: entry.path,
        details: { expected: entry.hash, actual },
      });
    }
  }
  for (const entry of applied.patches) {
    const actual = hashFileIfExists(path.join(projectRoot, ...entry.target.split("/")));
    if (actual !== entry.resultHash) {
      throw new PluginRuntimeError(`冻结 Plugin Patch 目标摘要漂移:${entry.target}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.TARGET_DRIFT,
        path: entry.target,
        details: { expected: entry.resultHash, actual },
      });
    }
  }
}
