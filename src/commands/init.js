import fs from "node:fs";
import { runTrellis } from "../lib/trellis-runner.js";
import { applyEnhancements } from "../lib/apply-enhancements.js";
import { pickPlatforms } from "../lib/pick-platforms.js";
import { PLATFORM_FLAGS } from "../constants.js";

/**
 * flower-trellis init:驱动 `trellis init`,随后叠加强化包。
 *
 * 平台选择:
 * - 用户显式传了平台 flag(--claude/--codex/...)→ 原样透传,不弹菜单。
 * - 未传平台 + 交互模式 → 弹 flower 平台多选菜单(默认勾 codex + claude),选完转 flag。
 * - 未传平台 + 非交互(-y)→ 无法弹菜单,用默认 codex + claude。
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
  const nonInteractive =
    passthrough.includes("-y") || passthrough.includes("--yes");
  if (!hasPlatform) {
    if (nonInteractive) {
      passthrough.push("--codex", "--claude");
      console.log("· 非交互(-y):默认平台 codex + claude");
    } else {
      // flower 自己出菜单(默认勾 codex + claude);Trellis 原生菜单默认勾选写死为
      // claude+cursor,改不了,故由 flower 接管平台选择再把 flag 透传给 trellis。
      const picked = await pickPlatforms();
      const flags = picked.length ? picked : ["--codex", "--claude"];
      passthrough.push(...flags);
    }
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
