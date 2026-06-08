import fs from "node:fs";
import path from "node:path";

/**
 * flower-trellis 自己的安装清单。
 *
 * 记录「flower 上一次为该项目铺设了哪些强化文件」,使升级(如 0.5/old → 0.6)时
 * 能精确删除当前变体不再包含的过期 skill / command —— 只删自己铺过的路径,
 * 绝不误删用户或 Trellis 本体的文件。
 *
 * 放在 .trellis/ 下,随项目的 Trellis 生命周期存在(uninstall 删 .trellis 时一并消失)。
 */
const MANIFEST_REL = path.join(".trellis", ".flower-manifest.json");

/** manifest 文件的绝对路径。 */
export function manifestPath(target) {
  return path.join(target, MANIFEST_REL);
}

/** 读取 manifest;不存在或损坏时返回 null。 */
export function readManifest(target) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath(target), "utf8"));
  } catch {
    return null;
  }
}

/** 写入 manifest。 */
export function writeManifest(target, data) {
  fs.writeFileSync(manifestPath(target), JSON.stringify(data, null, 2) + "\n");
}
