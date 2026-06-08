import fs from "node:fs";
import path from "node:path";
import { flowerVersion, trellisVersion } from "./lib/versions.js";
import { selectVariant } from "./lib/variant.js";
import { runTrellis } from "./lib/trellis-runner.js";

/**
 * flower-trellis CLI 主入口。
 *
 * 手动解析 argv(不引入 commander):分离子命令、flower 自有 flag、透传参数。
 * - init / update / uninstall → 走增强逻辑;
 * - 其它子命令 → 兜底透传给 trellis(覆盖现有及未来命令)。
 */

/** 打印版本:flower-trellis 自身 + 捆绑的 Trellis;若在 Trellis 项目内附带项目版本。 */
function printVersion(cwd) {
  console.log(`flower-trellis    ${flowerVersion()}`);
  console.log(`trellis (bundled) ${trellisVersion()}`);
  try {
    if (fs.existsSync(path.join(cwd, ".trellis", ".version"))) {
      const { version } = selectVariant(cwd);
      if (version) console.log(`project .trellis  ${version}`);
    }
  } catch {
    // 忽略:版本读取失败不应影响 -v 输出
  }
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

其余 flag 原样透传给 trellis(如 -u <name> -y -f --registry --template 等)。`);
}

/** 已知的增强子命令。 */
const ENHANCED = new Set(["init", "update", "uninstall"]);

/** 解析 argv → { command, ctx }。 */
function parse(argv) {
  let command = null;
  let enhance = true;
  let enhanceOnly = false;
  let variant = null;
  let target = process.cwd();
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
    },
  };
}

async function main() {
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

  if (enhanceConflict(ctx)) {
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

/** --enhance-only 与 --no-enhance 不能同时给(仅对增强命令有意义)。 */
function enhanceConflict(ctx) {
  return ctx.enhanceOnly && !ctx.enhance;
}

main();
