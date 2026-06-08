import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { PKG_ROOT } from "./paths.js";

/**
 * 读取 flower-trellis 自身版本(来自包根 package.json)。
 * @returns {string}
 */
export function flowerVersion() {
  const p = path.join(PKG_ROOT, "package.json");
  return JSON.parse(fs.readFileSync(p, "utf8")).version;
}

/**
 * 读取捆绑的 @mindfoldhq/trellis 版本。
 *
 * 与定位 bin 同源:解析依赖的 package.json(必随包发布)。依赖缺失时返回占位串,
 * 不抛错 —— `-v` 在任何环境下都应能打印。
 * @returns {string}
 */
export function trellisVersion() {
  try {
    const require = createRequire(import.meta.url);
    const p = require.resolve("@mindfoldhq/trellis/package.json");
    return JSON.parse(fs.readFileSync(p, "utf8")).version;
  } catch {
    return "(未安装)";
  }
}
