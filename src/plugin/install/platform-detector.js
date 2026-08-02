import fs from "node:fs";
import path from "node:path";
import { ENHANCEMENT_SKILL_TARGETS } from "../../constants.js";
import {
  PLUGIN_RUNTIME_ERROR_CODES,
  PluginRuntimeError,
} from "../runtime-errors.js";
import { compareUtf8 } from "../stable-order.js";

/**
 * 返回 Runtime 支持的逻辑平台 ID。
 *
 * @returns {string[]} 稳定平台列表
 */
export function listPluginPlatforms() {
  return [...new Set(ENHANCEMENT_SKILL_TARGETS.flatMap((descriptor) => descriptor.platforms || [descriptor.platform]))]
    .sort(compareUtf8);
}

/**
 * 判断物理 Skill target 中的单个逻辑平台是否已经启用。
 *
 * @param {string} projectRoot 项目根
 * @param {{root:string,detectPaths?:Record<string,string>}} descriptor Skill target 描述
 * @param {string} platform 逻辑平台 ID
 * @returns {boolean} 是否存在平台原生检测证据
 */
function isPlatformDetected(projectRoot, descriptor, platform) {
  const detectPath = descriptor.detectPaths?.[platform] || descriptor.root;
  return fs.existsSync(path.join(projectRoot, ...detectPath.split("/")));
}

/**
 * 检测或校验 Plugin 投影平台，并按物理 Skill root 去重。
 *
 * @param {string} projectRoot 项目根
 * @param {string[]} [explicitPlatforms] 用户显式平台
 * @returns {{platforms:string[],targets:Array<{root:string,source:string,platforms:string[]}>}} 平台选择
 */
export function detectPluginPlatforms(projectRoot, explicitPlatforms = []) {
  const descriptors = ENHANCEMENT_SKILL_TARGETS.map((descriptor) => ({
    ...descriptor,
    platforms: descriptor.platforms || [descriptor.platform],
  }));
  const supported = new Set(listPluginPlatforms());
  const requested = [...new Set(explicitPlatforms)].sort(compareUtf8);
  const unknown = requested.filter((platform) => !supported.has(platform));
  if (unknown.length > 0) {
    throw new PluginRuntimeError(`未知 Plugin 平台:${unknown.join(", ")}`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.PLATFORM_UNKNOWN,
      path: unknown[0],
      details: { unknown, supported: [...supported].sort(compareUtf8) },
    });
  }

  const selected = requested.length > 0
    ? requested
    : descriptors
      .flatMap((descriptor) => descriptor.platforms.filter((platform) => (
        isPlatformDetected(projectRoot, descriptor, platform)
      )))
      .sort(compareUtf8);
  if (selected.length === 0) {
    throw new PluginRuntimeError("未检测到受支持平台，请使用 --platform 显式选择", {
      code: PLUGIN_RUNTIME_ERROR_CODES.PLATFORM_SELECTION_REQUIRED,
      path: projectRoot,
      details: { supported: [...supported].sort(compareUtf8) },
    });
  }

  const selectedSet = new Set(selected);
  const targets = descriptors
    .map((descriptor) => ({
      root: descriptor.root,
      source: descriptor.source,
      platforms: descriptor.platforms.filter((platform) => selectedSet.has(platform)).sort(compareUtf8),
    }))
    .filter(({ platforms }) => platforms.length > 0)
    .sort((left, right) => compareUtf8(left.root, right.root));
  return { platforms: [...new Set(selected)].sort(compareUtf8), targets };
}
