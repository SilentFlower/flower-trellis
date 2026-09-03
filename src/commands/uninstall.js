import { runTrellis } from "../lib/trellis-runner.js";
import {
  applySkillGardenUninstall,
  planSkillGardenUninstall,
} from "../builtin-plugins/skill-garden/uninstall.js";
import { hasHelpFlag } from "../lib/cli-args.js";

/** 打印 uninstall 命令帮助。 */
function printUninstallHelp() {
  console.log(`flower-trellis uninstall — 卸载 Trellis 并清理受管强化资产

用法:
  flower-trellis uninstall [--target <dir>] [--dry-run] [-y|--yes]

选项:
  --dry-run       只预览 Trellis 与 Plugin 清理计划
  -y, --yes       传给 Trellis 的非交互确认
  --target <dir>  目标项目目录

若仍有其它 Plugin 依赖 flower/skill-garden，命令会拒绝清理并列出依赖方。`);
}

/**
 * flower-trellis uninstall：由 Trellis 删除自身内容，再按 Plugin state 清理平台资产。
 *
 * @param {object} ctx 见 cli-args.js 的 parseCliArgs()
 * @returns {Promise<void>} 卸载完成后返回
 */
export async function uninstall(ctx) {
  if (hasHelpFlag(ctx.passthrough)) {
    printUninstallHelp();
    return;
  }
  const { target } = ctx;
  const dryRun = ctx.passthrough.includes("--dry-run");
  const cleanupPlan = planSkillGardenUninstall(target);

  if (cleanupPlan.dependents.length > 0) {
    throw new Error(
      `以下 Plugin 仍依赖 flower/skill-garden:${cleanupPlan.dependents.join(", ")}`,
    );
  }

  if (cleanupPlan.managed) {
    console.log(
      `· Plugin 清理计划:删除 ${cleanupPlan.removals.length} 个、` +
        `共享保留 ${cleanupPlan.shared.length} 个、冲突 ${cleanupPlan.conflicts.length} 个`,
    );
  } else {
    console.log("· 未发现 flower/skill-garden Plugin state，不猜测强化残留");
  }

  const code = await runTrellis(["uninstall", ...ctx.passthrough], target);
  if (code !== 0) {
    throw new Error(`trellis uninstall 失败(退出码 ${code})，未清理 Plugin 资产`);
  }
  if (dryRun) {
    console.log("· --dry-run:Trellis 与 Plugin 清理均仅预览");
    return;
  }

  const result = applySkillGardenUninstall(target, cleanupPlan);
  if (result.status === "conflict") {
    for (const conflict of result.conflicts) {
      console.log(`  · 用户修改已保留:${conflict.path}`);
    }
  }
  console.log(
    `\n🌸 flower-trellis uninstall 完成:Plugin 清理 ${result.removed} 个 → ${target}`,
  );
}
