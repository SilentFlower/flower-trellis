import fs from "node:fs";
import { runTrellis } from "../lib/trellis-runner.js";
import { applyEnhancements } from "../lib/apply-enhancements.js";
import { PLATFORM_FLAGS } from "../constants.js";

/**
 * flower-trellis init:驱动 `trellis init`,随后叠加强化包。
 *
 * @param {object} ctx 见 cli.js 的 parse():{ target, passthrough, enhance, enhanceOnly, skills, variant }
 */
export async function init(ctx) {
  const { target } = ctx;
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    throw new Error(`目标目录不存在:${target}`);
  }

  const passthrough = [...ctx.passthrough];
  const hasPlatform = passthrough.some((a) => PLATFORM_FLAGS.includes(a));
  if (ctx.pick) {
    // 想用 Trellis 原生平台菜单自选:不补默认平台,把选择权交给 trellis 交互
    console.log("· --pick:进入 Trellis 平台选择菜单");
  } else if (!hasPlatform) {
    // 默认平台 codex + claude(省事);想自选用 --pick,想要其它平台直接传 --cursor 等
    passthrough.push("--codex", "--claude");
    console.log("· 默认平台 codex + claude(加 --pick 可进 Trellis 菜单自选)");
  }

  if (!ctx.enhanceOnly) {
    const code = await runTrellis(["init", ...passthrough], target);
    // init 失败必须中止,绝不在半成品上叠加
    if (code !== 0) {
      throw new Error(`trellis init 失败(退出码 ${code}),已中止,未叠加强化包`);
    }
  } else {
    console.log("· --enhance-only:跳过 trellis init,仅叠加强化包");
  }

  if (ctx.enhance) {
    applyEnhancements(target, { variant: ctx.variant, skills: ctx.skills });
  } else {
    console.log("· --no-enhance:跳过强化包叠加");
  }

  console.log(`\n🌸 flower-trellis init 完成 → ${target}`);
}
