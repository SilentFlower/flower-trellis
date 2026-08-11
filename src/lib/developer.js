import { execFileSync } from "node:child_process";

/**
 * 读取目标目录可见的 Git 开发者名称。
 *
 * @param {string} target 目标项目根目录
 * @param {{env?:NodeJS.ProcessEnv}} [options] 读取选项
 * @returns {string|null} Git 开发者名称，无法识别时返回 null
 */
export function readGitDeveloper(target, options = {}) {
  try {
    return (
      execFileSync("git", ["-C", target, "config", "user.name"], {
        encoding: "utf8",
        env: options.env || process.env,
      }).trim() || null
    );
  } catch {
    return null;
  }
}

/**
 * 解析开发者名称：优先命令行 `-u/--user`，否则回退到目标目录可见的 Git 配置。
 *
 * @param {string[]} passthrough Trellis 透传参数
 * @param {string} target 目标项目根目录
 * @param {{env?:NodeJS.ProcessEnv}} [options] 读取选项
 * @returns {string|null} 开发者名称，无法识别时返回 null
 */
export function getDeveloper(passthrough, target, options = {}) {
  const index = passthrough.findIndex((argument) => argument === "-u" || argument === "--user");
  if (index >= 0) {
    const value = passthrough[index + 1];
    if (value && !value.startsWith("-")) return value;
  }
  const inline = passthrough.find((argument) => argument.startsWith("--user="));
  if (inline) return inline.slice("--user=".length) || null;
  return readGitDeveloper(target, options);
}
