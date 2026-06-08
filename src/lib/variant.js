import fs from "node:fs";
import path from "node:path";

/**
 * 根据目标项目的 `.trellis/.version` 选择强化包变体。
 *
 * 规则(逐字符移植 skill-garden install.sh 263-274):
 *   - 主版本 >= 1 或 次版本 >= 6 → "0.6"
 *   - 次版本 >= 5                → "0.5"
 *   - 其它(文件缺失 / 解析失败 / 更低)→ "old"
 *
 * 次版本会先剥掉 `-beta.x` 之类后缀(只取开头连续数字),
 * 因此 `0.6.0-beta.1` 也归入 0.6。
 *
 * @param {string} target 目标项目根目录
 * @returns {{ variant: string, version: string }}
 */
export function selectVariant(target) {
  const versionFile = path.join(target, ".trellis", ".version");
  let version = "";
  let variant = "old";

  try {
    version = fs.readFileSync(versionFile, "utf8").replace(/\s/g, "");
  } catch {
    return { variant, version }; // 文件不存在 → old
  }

  const parts = version.split(".");
  const major = parseInt(parts[0], 10);
  const minorMatch = (parts[1] || "").match(/^(\d+)/);
  const minor = minorMatch ? parseInt(minorMatch[1], 10) : NaN;

  if (Number.isInteger(major) && Number.isInteger(minor)) {
    if (major >= 1 || minor >= 6) variant = "0.6";
    else if (minor >= 5) variant = "0.5";
  }

  return { variant, version };
}
