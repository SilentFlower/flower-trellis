import { runTrellis } from "../lib/trellis-runner.js";
import { applyEnhancements } from "../lib/apply-enhancements.js";

/**
 * flower-trellis update:驱动 `trellis update`,随后按(可能已升级的)版本重新叠加强化包。
 *
 * `--dry-run` 时只让 trellis 预览,叠加阶段跳过(避免「预览」却改了文件)。
 *
 * @param {object} ctx 见 cli.js 的 parse()
 */
export async function update(ctx) {
  const { target } = ctx;
  const dryRun = ctx.passthrough.includes("--dry-run");

  if (!ctx.enhanceOnly) {
    const code = await runTrellis(["update", ...ctx.passthrough], target);
    if (code !== 0) {
      throw new Error(`trellis update 失败(退出码 ${code}),已中止,未重新叠加`);
    }
  } else {
    console.log("· --enhance-only:跳过 trellis update,仅重新叠加强化包");
  }

  if (ctx.enhance) {
    if (dryRun) {
      console.log("· --dry-run:跳过强化包叠加(仅预览 trellis update)");
    } else {
      applyEnhancements(target, { variant: ctx.variant, skills: ctx.skills });
    }
  } else {
    console.log("· --no-enhance:跳过强化包叠加");
  }

  console.log(`\n🌸 flower-trellis update 完成 → ${target}`);
}
