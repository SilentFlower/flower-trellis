import { runTrellisPty } from "../lib/trellis-runner.js";
import { applyEnhancements } from "../lib/apply-enhancements.js";
import { printBanner, getDeveloper } from "../lib/banner.js";

/**
 * flower-trellis update:驱动 `trellis update`,随后按(可能已升级的)版本重新叠加强化包。
 *
 * 打印 flower 品牌头部;trellis update 在伪终端(pty)里运行,保留其冲突处理等交互,
 * 同时过滤掉它重复打印的启动 banner / Developer。
 * `--dry-run` 时只让 trellis 预览,叠加阶段跳过。
 *
 * @param {object} ctx 见 cli.js 的 parse()
 */
export async function update(ctx) {
  const { target } = ctx;
  const dryRun = ctx.passthrough.includes("--dry-run");

  printBanner(getDeveloper(ctx.passthrough, target));

  if (!ctx.enhanceOnly) {
    const code = await runTrellisPty(["update", ...ctx.passthrough], target, {
      stripBanner: true,
    });
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
