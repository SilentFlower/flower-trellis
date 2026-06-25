import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { flowerVersion, trellisVersion } from "./lib/versions.js";
import { selectVariant } from "./lib/variant.js";
import { readManifest } from "./lib/manifest.js";
import { runTrellis } from "./lib/trellis-runner.js";

/**
 * flower-trellis CLI 主入口。
 *
 * 手动解析 argv(不引入 commander):分离子命令、flower 自有 flag、透传参数。
 * - init / update / uninstall → 走增强逻辑;
 * - 其它子命令 → 兜底透传给 trellis(覆盖现有及未来命令)。
 */

/**
 * 格式化版本行。
 * @param {string} label 版本标签
 * @param {string} version 版本号
 * @param {{indent?: boolean, muted?: boolean}} options 显示选项
 * @returns {string}
 */
function versionLine(label, version, options = {}) {
  const prefix = options.indent ? "  " : "";
  const labelWidth = options.indent ? 14 : 16;
  const paddedLabel = label.padEnd(labelWidth);
  const styledLabel = options.muted ? chalk.gray(paddedLabel) : chalk.hex("#ff6fb5").bold(paddedLabel);
  return `${prefix}${styledLabel}${version}`;
}

/** 打印版本:flower-trellis 自身 + 项目版本 + 捆绑的 Trellis。 */
function printVersion(cwd) {
  console.log(versionLine("flower-trellis", flowerVersion()));

  const projectRows = [];
  try {
    if (fs.existsSync(path.join(cwd, ".trellis", ".version"))) {
      const { version } = selectVariant(cwd);
      if (version) projectRows.push([".trellis", version]);
    }
    // 项目里 flower 上次铺包时戳入的自身版本(来自 .trellis/.flower-manifest.json);
    // 与首行「当前工具版本」对比即可看出该项目是否需要重新 update。
    const mf = readManifest(cwd);
    if (mf && mf.flowerVersion) projectRows.unshift(["flower", mf.flowerVersion]);
  } catch {
    // 忽略:版本读取失败不应影响 -v 输出
  }

  if (projectRows.length) {
    console.log("");
    console.log(chalk.gray("project"));
    for (const [label, version] of projectRows) {
      console.log(versionLine(label, version, { indent: true, muted: true }));
    }
  }

  console.log("");
  console.log(chalk.gray("bundled"));
  console.log(versionLine("trellis", trellisVersion(), { indent: true, muted: true }));
}

function printHelp() {
  console.log(`flower-trellis — 一键装/升级 Trellis 并融合 skill-garden 强化包

用法:
  flower-trellis [init] [trellis flags] [flower flags]   安装 + 叠加强化包(默认命令)
  flower-trellis update [trellis flags] [flower flags]   升级 + 按新版本重新叠加
  flower-trellis uninstall [-y | --dry-run]              卸载 + 清理强化残留
  flower-trellis <其它命令> [...]                        透传给 trellis(面向未来)
  flower-trellis -v                                      打印版本

flower 自有 flag:
  --no-enhance             只跑 trellis,不叠加强化包
  --enhance-only           跳过 trellis,只叠加(用于已有项目)
  --skills <a,b,...>       只装指定技能(支持去 trellis- 前缀匹配)
  --variant <old|0.5|0.6>  强制强化包变体(默认按 .trellis/.version 自动选)
  --target <dir>           目标目录(默认当前目录)
  --no-update-check        本次跳过 flower-trellis 新版本检测(等价 FLOWER_NO_UPDATE_CHECK=1)

命令别名:flower-trellis 可简写为 ftl 或 ft(三者完全等价)。
init / update 启动时会顺带检测 flower-trellis 自身是否有新版(联网、带超时,失败静默)。

平台选择:未指定平台时,交互模式会弹出多选菜单(默认勾 Claude Code + Codex);
也可直接传 --claude / --codex / --cursor 等指定,或用 -y 跳过菜单(默认 codex + claude)。
其余 flag 原样透传给 trellis(如 -u <name> -f --registry --template 等)。`);
}

/** 解析 argv → { command, ctx }。 */
function parse(argv) {
  let command = null;
  let enhance = true;
  let enhanceOnly = false;
  let variant = null;
  let target = process.cwd();
  let updateCheck = true;
  const skills = [];
  const passthrough = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    // 第一个非 flag token 视为子命令
    if (command === null && !a.startsWith("-")) {
      command = a;
      continue;
    }
    switch (a) {
      case "--no-enhance":
        enhance = false;
        break;
      case "--enhance-only":
        enhanceOnly = true;
        break;
      case "--skills": {
        const v = argv[++i] || "";
        skills.push(...v.split(/[,\s]+/).filter(Boolean));
        break;
      }
      case "--variant":
        variant = argv[++i] || null;
        break;
      case "--target":
        target = path.resolve(argv[++i] || ".");
        break;
      case "--no-update-check":
        updateCheck = false;
        break;
      default:
        passthrough.push(a);
    }
  }

  return {
    command,
    ctx: {
      target: path.resolve(target),
      passthrough,
      enhance,
      enhanceOnly,
      skills,
      variant,
      updateCheck,
    },
  };
}

async function main() {
  // Ctrl+C:父进程也立即退出,绝不在子进程被取消后继续叠加
  process.on("SIGINT", () => process.exit(130));

  const argv = process.argv.slice(2);

  // 顶层 -v / -h 仅在作为首个参数时拦截;子命令的 --help/--version 透传给 trellis
  if (argv[0] === "-v" || argv[0] === "--version") {
    printVersion(process.cwd());
    return;
  }
  if (argv[0] === "-h" || argv[0] === "--help" || argv[0] === "help") {
    printHelp();
    return;
  }

  const { command, ctx } = parse(argv);
  const cmd = command || "init"; // 裸跑等同 init

  // 互斥校验
  if (ctx.enhanceOnly && !ctx.enhance) {
    console.error("❌ --enhance-only 与 --no-enhance 互斥");
    process.exit(2);
  }

  try {
    if (cmd === "init") {
      const { init } = await import("./commands/init.js");
      await init(ctx);
    } else if (cmd === "update") {
      const { update } = await import("./commands/update.js");
      await update(ctx);
    } else if (cmd === "uninstall") {
      const { uninstall } = await import("./commands/uninstall.js");
      await uninstall(ctx);
    } else {
      // 兜底透传:flower-trellis <其它命令> → trellis <其它命令>
      const code = await runTrellis([cmd, ...ctx.passthrough], ctx.target);
      process.exit(code);
    }
  } catch (err) {
    console.error(`❌ ${err.message}`);
    if (process.env.DEBUG || process.env.FLOWER_DEBUG) console.error(err.stack);
    process.exit(1);
  }
}

main();
