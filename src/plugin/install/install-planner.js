import fs from "node:fs";
import path from "node:path";
import { PluginPathError } from "../errors.js";
import { assertSafePosixRelativePath } from "../schemas/shared.js";
import {
  PLUGIN_RUNTIME_ERROR_CODES,
  PluginRuntimeError,
} from "../runtime-errors.js";
import { compareUtf8 } from "../stable-order.js";

/**
 * 抛出统一内容冲突错误。
 *
 * @param {string} message 错误说明
 * @param {string} target 目标路径
 * @param {object} [details] 诊断详情
 */
function conflict(message, target, details = {}) {
  throw new PluginRuntimeError(message, {
    code: PLUGIN_RUNTIME_ERROR_CODES.CONTENT_CONFLICT,
    path: target,
    details,
  });
}

/**
 * 校验目标父路径不存在软链或文件前缀。
 *
 * @param {string} projectRoot 项目根
 * @param {string} target POSIX 相对目标
 */
function assertTargetParents(projectRoot, target) {
  const segments = target.split("/");
  let current = projectRoot;
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) throw new PluginPathError(`Plugin 目标父目录不能是软链:${target}`, { path: target });
      if (!stat.isDirectory()) conflict(`Plugin 目标存在文件前缀冲突:${target}`, target, { prefix: current });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
  }
}

/**
 * 合并并校验普通内容 mutation，生成 P1 InstallPlan。
 *
 * @param {import("../contracts.js").ResolvedGraph} graph 已解析图
 * @param {import("../contracts.js").ContentMutation[]} mutations 内容 mutation
 * @param {{projectRoot:string,currentState?:import("../contracts.js").PluginState|null,patchMutations?:import("../contracts.js").PatchMutation[],diagnostics?:import("../contracts.js").PluginDiagnostic[]}} options 规划上下文
 * @returns {import("../contracts.js").InstallPlan} 已预检计划
 */
export function createInstallPlan(graph, mutations, options) {
  const ownership = new Map();
  for (const plugin of options.currentState?.plugins || []) {
    for (const entry of plugin.paths) {
      const previousOwner = ownership.get(entry.path);
      if (previousOwner && previousOwner !== plugin.id) {
        conflict(`Plugin state 存在跨 owner 路径歧义:${entry.path}`, entry.path, {
          owners: [previousOwner, plugin.id].sort(compareUtf8),
        });
      }
      ownership.set(entry.path, plugin.id);
    }
  }

  const byTarget = new Map();
  for (const mutation of mutations) {
    assertSafePosixRelativePath(mutation.target, "Plugin mutation target");
    assertTargetParents(options.projectRoot, mutation.target);
    const previous = byTarget.get(mutation.target);
    if (previous) {
      if (
        previous.owner !== mutation.owner ||
        previous.operation !== mutation.operation ||
        previous.afterHash !== mutation.afterHash
      ) {
        conflict(`多个 Plugin 计划写入同一目标:${mutation.target}`, mutation.target, {
          owners: [previous.owner, mutation.owner].sort(compareUtf8),
        });
      }
      continue;
    }
    const currentOwner = ownership.get(mutation.target);
    if (mutation.operation === "write" && mutation.beforeHash !== null && currentOwner !== mutation.owner) {
      conflict(`目标已存在且不归当前 Plugin 管理:${mutation.target}`, mutation.target, {
        owner: mutation.owner,
        currentOwner: currentOwner || null,
      });
    }
    if (mutation.operation === "remove" && currentOwner !== mutation.owner) {
      conflict(`Plugin 无权删除目标:${mutation.target}`, mutation.target, {
        owner: mutation.owner,
        currentOwner: currentOwner || null,
      });
    }
    byTarget.set(mutation.target, mutation);
  }

  const patchMutations = [...(options.patchMutations || [])].sort((left, right) => (
    compareUtf8(left.target, right.target) || compareUtf8(left.owner, right.owner)
  ));
  const patchTargets = new Map();
  for (const mutation of patchMutations) {
    assertSafePosixRelativePath(mutation.target, "Plugin Patch mutation target");
    assertTargetParents(options.projectRoot, mutation.target);
    if (byTarget.has(mutation.target)) {
      conflict(`Plugin 普通内容与 Patch 写入同一目标:${mutation.target}`, mutation.target, {
        contentOwner: byTarget.get(mutation.target).owner,
        patchOwner: mutation.owner,
      });
    }
    const previous = patchTargets.get(mutation.target);
    if (
      previous &&
      (previous.beforeHash !== mutation.beforeHash || previous.afterHash !== mutation.afterHash)
    ) {
      conflict(`Plugin Patch 对同一目标产生不一致结果:${mutation.target}`, mutation.target, {
        owners: [previous.owner, mutation.owner].sort(compareUtf8),
      });
    }
    if (!previous) patchTargets.set(mutation.target, mutation);
  }

  const targets = [...new Set([...byTarget.keys(), ...patchTargets.keys()])].sort(compareUtf8);
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    const next = targets[index + 1];
    if (next && next.startsWith(`${target}/`)) {
      conflict(`Plugin mutation 存在文件/目录前缀冲突:${target}`, target, { other: next });
    }
  }

  return {
    graph,
    contentMutations: [...byTarget.keys()].sort(compareUtf8).map((target) => byTarget.get(target)),
    patchMutations,
    diagnostics: [...(options.diagnostics || [])],
  };
}
