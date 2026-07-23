import fs from "node:fs";
import { runTrellisPty } from "../lib/trellis-runner.js";
import { applyEnhancements } from "../lib/apply-enhancements.js";
import { pickPlatforms } from "../lib/pick-platforms.js";
import { printBanner, getDeveloper } from "../lib/banner.js";
import { checkForUpdate } from "../lib/update-check.js";
import { PLATFORM_FLAGS } from "../constants.js";

/**
 * flower-trellis init:驱动 `trellis init`,随后叠加强化包。
 *
 * - 非交互(-y):打印简短提示,平台默认 codex + claude(或用户显式平台)。
 * - 交互:打印 flower 品牌头部;未指定平台则弹 flower 平台多选菜单(默认勾 codex+claude)。
 *
 * trellis init 在伪终端(pty)里运行,**保留它原生的模板 / monorepo 等交互**,
 * 同时由 flower 过滤掉它重复打印的启动 banner / Developer。
 *
 * @param {object} ctx 见 cli-args.js 的 parseCliArgs()
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

  // 交互模式打印一次 flower 品牌头部(非交互/脚本场景不打扰)
  if (!nonInteractive) {
    printBanner(getDeveloper(passthrough, target));
  }

  // 主操作前尽力而为地检测 flower-trellis 自身新版本(失败静默;用户确认升级成功会直接退出)
  // 放在平台菜单之前:若用户选择升级,不必先让他挑完平台再退出做无用功
  await checkForUpdate(ctx, "init");

  if (!hasPlatform) {
    if (nonInteractive) {
      passthrough.push("--codex", "--claude");
      console.log("· 非交互(-y):默认平台 codex + claude");
    } else {
      // flower 自己出平台菜单(默认勾 codex + claude),选完转 flag 透传给 trellis
      const picked = await pickPlatforms();
      const flags = picked.length ? picked : ["--codex", "--claude"];
      passthrough.push(...flags);
    }
  }

  if (!ctx.enhanceOnly) {
    // 伪终端运行:保留 trellis 的模板 / monorepo 交互 + 过滤其重复 banner
    const code = await runTrellisPty(["init", ...passthrough], target, {
      stripBanner: true,
    });
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
