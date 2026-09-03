import fs from "node:fs";
import path from "node:path";
import {
  manifestPath,
  readManifest,
  readUpdateCheck,
  settingsPath,
  updateCheckCachePath,
  writeUpdateCheck,
} from "../lib/manifest.js";
import {
  buildSelfCheck,
  DEFAULT_UPDATE_PROMPT_SNOOZE_HOURS,
} from "../lib/self-check.js";
import { hasHelpFlag } from "../lib/cli-args.js";

const POLICIES = new Set(["off", "notify", "ask", "auto"]);
const ACTIONABLE_STATUSES = new Set(["update_available", "project_out_of_sync"]);

/** 打印 update-check 命令帮助。 */
function printUpdateCheckHelp() {
  console.log(`flower-trellis update-check — 管理启动更新检查策略

用法:
  flower-trellis update-check get [--target <dir>]
  flower-trellis update-check set [--policy <off|notify|ask|auto>] [--interval-hours <n>]
  flower-trellis update-check <disable|enable|reset>
  flower-trellis update-check snooze [--hours <n>|--days <n>]
  flower-trellis update-check skip

set 至少需要一个策略选项；snooze 与 skip 仅在当前存在可操作更新提示时有效。`);
}

/** 读取 flag 后面的取值。 */
function optionValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  return args[index + 1] || null;
}

/** 判断是否传入了某个 option。 */
function hasOption(args, name) {
  return args.includes(name);
}

/** 解析正数小时参数。 */
function positiveHours(value, label) {
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error(`${label} 必须是正数`);
  }
  return hours;
}

/** 解析 snooze 默认或显式时长。 */
function snoozeHours(args) {
  const hoursText = optionValue(args, "--hours");
  const daysText = optionValue(args, "--days");
  const hasHours = hasOption(args, "--hours");
  const hasDays = hasOption(args, "--days");
  if (hasHours && hoursText === null) throw new Error("--hours 缺少取值");
  if (hasDays && daysText === null) throw new Error("--days 缺少取值");
  if (hasHours && hasDays) {
    throw new Error("update-check snooze 不能同时使用 --hours 和 --days");
  }
  if (hasHours) return positiveHours(hoursText, "--hours");
  if (hasDays) return positiveHours(daysText, "--days") * 24;
  return DEFAULT_UPDATE_PROMPT_SNOOZE_HOURS;
}

/** 当前是否有可延后或跳过的更新提示。 */
async function currentPrompt(target) {
  const result = await buildSelfCheck(target, {
    writeCache: false,
    ignorePromptSuppression: true,
  });
  if (!ACTIONABLE_STATUSES.has(result.status) || !result.prompt?.key) {
    throw new Error("当前没有可延后或跳过的更新提示");
  }
  return result.prompt;
}

/** 确保目标是 Trellis 项目。 */
function assertTrellisProject(target) {
  if (!fs.existsSync(path.join(target, ".trellis"))) {
    throw new Error(`目标不是 Trellis 项目:${target}`);
  }
}

/**
 * flower-trellis update-check:管理启动更新检查策略,并展示本地运行缓存。
 *
 * @param {object} ctx 见 cli-args.js 的 parseCliArgs()
 */
export async function updateCheck(ctx) {
  const args = ctx.passthrough;
  if (hasHelpFlag(args)) {
    printUpdateCheckHelp();
    return;
  }
  const action = args.find((arg) => !arg.startsWith("-")) || "get";
  assertTrellisProject(ctx.target);

  if (action === "get") {
    const manifest = readManifest(ctx.target);
    const cachePath = updateCheckCachePath(ctx.target);
    console.log(`settings: ${settingsPath(ctx.target)}`);
    console.log(`cache: ${cachePath}`);
    console.log(`legacy manifest: ${manifestPath(ctx.target)}`);
    console.log(JSON.stringify(readUpdateCheck(ctx.target), null, 2));
    if (!manifest) console.log("  · manifest 不存在,当前显示默认策略");
    if (!fs.existsSync(cachePath)) {
      console.log("  · cache 不存在,当前显示默认或旧 manifest 兼容缓存");
    }
    return;
  }

  if (action === "set") {
    const policy = optionValue(args, "--policy");
    const intervalText = optionValue(args, "--interval-hours");
    const patch = {};
    if (policy) {
      if (!POLICIES.has(policy)) {
        throw new Error("policy 只能是 off / notify / ask / auto");
      }
      patch.policy = policy;
      patch.enabled = policy !== "off";
    }
    if (intervalText !== null) {
      const intervalHours = Number(intervalText);
      if (!Number.isFinite(intervalHours) || intervalHours < 0) {
        throw new Error("--interval-hours 必须是非负数字");
      }
      patch.intervalHours = intervalHours;
    }
    if (!Object.keys(patch).length) {
      throw new Error("update-check set 需要 --policy 或 --interval-hours");
    }
    writeUpdateCheck(ctx.target, patch);
    console.log("  ✓ updateCheck 策略已更新");
    console.log(JSON.stringify(readUpdateCheck(ctx.target), null, 2));
    return;
  }

  if (action === "disable") {
    writeUpdateCheck(ctx.target, { enabled: false });
    console.log("  ✓ 启动更新检查已关闭(policy 保留)");
    console.log(JSON.stringify(readUpdateCheck(ctx.target), null, 2));
    return;
  }

  if (action === "enable") {
    writeUpdateCheck(ctx.target, { enabled: true });
    console.log("  ✓ 启动更新检查已启用(policy 沿用)");
    console.log(JSON.stringify(readUpdateCheck(ctx.target), null, 2));
    return;
  }

  if (action === "snooze") {
    const prompt = await currentPrompt(ctx.target);
    const hours = snoozeHours(args);
    const until = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    writeUpdateCheck(ctx.target, {
      promptSuppressedKey: prompt.key,
      promptSuppressedUntil: until,
      promptSuppressionReason: "snooze",
    });
    console.log(`  ✓ 当前更新提示已延后到 ${until}`);
    console.log(JSON.stringify(readUpdateCheck(ctx.target), null, 2));
    return;
  }

  if (action === "skip") {
    const prompt = await currentPrompt(ctx.target);
    writeUpdateCheck(ctx.target, {
      promptSuppressedKey: prompt.key,
      promptSuppressedUntil: null,
      promptSuppressionReason: "skip",
    });
    console.log("  ✓ 当前更新提示已跳过;新版本或项目版本差异变化后会再次提示");
    console.log(JSON.stringify(readUpdateCheck(ctx.target), null, 2));
    return;
  }

  if (action === "reset") {
    writeUpdateCheck(ctx.target, {
      lastPromptedAt: null,
      lastPromptedKey: null,
      promptSuppressedUntil: null,
      promptSuppressedKey: null,
      promptSuppressionReason: null,
    });
    console.log("  ✓ 更新提示节流状态已清空");
    console.log(JSON.stringify(readUpdateCheck(ctx.target), null, 2));
    return;
  }

  throw new Error("update-check 只支持 get / set / disable / enable / snooze / skip / reset");
}
