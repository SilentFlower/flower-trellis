import path from "node:path";
import fs from "node:fs";
import { copyPath, rmrf } from "./fs-utils.js";
import { listCanonicalTreeFiles } from "../plugin/integrity/canonical-tree.js";
import { PKG_ROOT } from "./paths.js";

/** flower 自有启动更新 hook 脚本名。 */
export const FLOWER_UPDATE_HOOK = "flower_update_hook.py";

/** flower 自有启动更新 hook 在目标项目内的相对路径。 */
export const FLOWER_UPDATE_HOOK_REL = `.trellis/scripts/${FLOWER_UPDATE_HOOK}`;

/** Flower 自有 SessionStart 分段脚本。 */
export const FLOWER_SESSION_HOOK = "flower_session_start.py";

/** SessionStart 分段脚本在目标项目中的位置。 */
export const FLOWER_SESSION_HOOK_REL = `.trellis/scripts/${FLOWER_SESSION_HOOK}`;

/** Flower 独立静默活动 hook。 */
export const FLOWER_TELEMETRY_HOOK = "flower_telemetry_hook.py";

/** 活动 hook 在项目内的受管位置。 */
export const FLOWER_TELEMETRY_HOOK_REL = `.trellis/scripts/${FLOWER_TELEMETRY_HOOK}`;

/** Flower 原生确认事件入口。 */
export const FLOWER_CONFIRMATION_HOOK = "flower_confirmation_hook.py";

/** 原生确认 Hook 的受管路径。 */
export const FLOWER_CONFIRMATION_HOOK_REL = `.trellis/scripts/${FLOWER_CONFIRMATION_HOOK}`;

/** 确认运行时随项目分发的完整资产，目录由 Plugin 树投影管理。 */
export const FLOWER_CONFIRMATION_ASSETS = Object.freeze([
  FLOWER_CONFIRMATION_HOOK,
  "flower_confirmation.py",
  "flower_tui_lifetime.py",
  "flower_confirmation_runtime",
]);

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
  const assets = [FLOWER_UPDATE_HOOK, FLOWER_SESSION_HOOK, FLOWER_TELEMETRY_HOOK, ...FLOWER_CONFIRMATION_ASSETS];
  for (const asset of assets) {
    const source = path.join(PKG_ROOT, "src", "assets", asset);
    const destination = path.join(target, ".trellis", "scripts", asset);
    if (fs.statSync(source).isDirectory()) {
      rmrf(destination);
      for (const file of listCanonicalTreeFiles(source, { ignoreVolatile: true })) {
        copyPath(file.absolutePath, path.join(destination, file.path));
      }
    } else {
      copyPath(source, destination);
    }
  }
  return {
    installed: assets.map((asset) => `script:${asset}`),
    paths: assets.map((asset) => `.trellis/scripts/${asset}`),
  };
}
