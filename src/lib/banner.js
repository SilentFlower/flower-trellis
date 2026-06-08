import figlet from "figlet";
import chalk from "chalk";

/**
 * 打印 flower-trellis 品牌头部 —— 交互模式下、弹平台菜单前显示。
 *
 * 风格对齐 Trellis 的页面:ASCII logo + 副标题 + 开发者身份。
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
