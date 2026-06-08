import figlet from "figlet";
import chalk from "chalk";
import { execFileSync } from "node:child_process";

/**
 * 打印 flower-trellis 品牌头部 —— ASCII logo + 副标题 + 开发者身份,
 * 风格对齐 Trellis 页面。init 交互模式与 update 都会显示。
 *
 * @param {string|null} developer 开发者名(来自 -u/--user 或 git config)
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

/** 解析开发者名:优先 -u/--user 的取值,否则回退到目标仓库的 git config user.name。 */
export function getDeveloper(passthrough, target) {
  const i = passthrough.findIndex((a) => a === "-u" || a === "--user");
  if (i >= 0) {
    const v = passthrough[i + 1];
    if (v && !v.startsWith("-")) return v;
  }
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
