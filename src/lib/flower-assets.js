import path from "node:path";
import { copyPath } from "./fs-utils.js";
import { PKG_ROOT } from "./paths.js";

/** flower 自有启动更新 hook 脚本名。 */
export const FLOWER_UPDATE_HOOK = "flower_update_hook.py";

/** flower 自有启动更新 hook 在目标项目内的相对路径。 */
export const FLOWER_UPDATE_HOOK_REL = `.trellis/scripts/${FLOWER_UPDATE_HOOK}`;

/**
 * 复制 flower 自有脚本资产。
 *
 * 这些脚本属于 flower-trellis 自身能力,不从 skill-garden 快照同步,避免和
 * `enhancements/<variant>/scripts` 的边界混淆。
 *
 * @param {string} target 目标项目根
 * @returns {{installed:string[],paths:string[]}} 已安装资产和 manifest 路径
 */
export function copyFlowerAssets(target) {
  copyPath(
    path.join(PKG_ROOT, "src", "assets", FLOWER_UPDATE_HOOK),
    path.join(target, ...FLOWER_UPDATE_HOOK_REL.split("/")),
  );
  return {
    installed: [`script:${FLOWER_UPDATE_HOOK}`],
    paths: [FLOWER_UPDATE_HOOK_REL],
  };
}
