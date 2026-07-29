import figlet from "figlet";
import chalk from "chalk";
import { execFileSync } from "node:child_process";

/**
 * 打印 flower-trellis 品牌头部 —— ASCII logo + 副标题 + 开发者身份,
 * 风格对齐 Trellis 页面。init 交互模式与 update 都会显示。
 *
 * @param {string|null} developer 开发者名(来自 -u/--user 或 git config)
 * @returns {void} 横幅输出完成后返回
 */
export function printBanner(developer) {
  let art;
  try {
    art = figlet.textSync("Flower", { font: "ANSI Shadow" });
  } catch {
    art = "flower-trellis";
  }
  console.log("\n" + chalk.hex("#ff6fb5")(art));
  console.log(
    chalk.gray("  一键装 Trellis 工程框架,并融合 skill-garden 强化包\n"),
  );
  if (developer) {
    console.log(
      `👤 ${chalk.magentaBright("Developer")}: ${chalk.bold(developer)}\n`,
    );
  }
}

/**
 * 解析开发者名:优先 `-u/--user` 的取值,否则回退到目标目录可见的 Git 配置。
 *
 * @param {string[]} passthrough Trellis 透传参数
 * @param {string} target 目标项目根目录
 * @returns {string|null} 开发者名，无法识别时返回 null
 */
export function getDeveloper(passthrough, target) {
  const i = passthrough.findIndex((a) => a === "-u" || a === "--user");
  if (i >= 0) {
    const v = passthrough[i + 1];
    if (v && !v.startsWith("-")) return v;
  }
  const inline = passthrough.find((arg) => arg.startsWith("--user="));
  if (inline) return inline.slice("--user=".length) || null;
  try {
    return (
      execFileSync("git", ["-C", target, "config", "user.name"], {
        encoding: "utf8",
      }).trim() || null
    );
  } catch {
    return null;
  }
}
