/** @module confirmation-uninstall 使用既有 Patch Engine 仅移除本功能拥有的原生 Hook。 */
import path from "node:path";
import { existsSync } from "node:fs";
import { PKG_ROOT } from "./paths.js";
import { preparePatchPlan } from "./patch-engine.js";
import { flowerPatchAdapters } from "./platform-patch-adapters.js";

/**
 * 只读规划当前仍存在的确认 Hook 清理；平台目录消失时不重建。
 * @param {string} target 项目根目录
 * @returns {object} Patch Engine 原生计划
 */
export function prepareConfirmationHookRemoval(target) {
  const root = path.join(PKG_ROOT, "src", "uninstall-patches");
  if (!existsSync(path.join(root, "patches/confirmation/patch.json"))) throw new Error("原生确认卸载 Patch 缺失，不能跳过清理");
  return preparePatchPlan(target, [{ id: "flower-confirmation-cleanup", patchesDir: path.join(root, "patches"), bundlesDir: path.join(root, "bundles") }], { adapters: flowerPatchAdapters() });
}
