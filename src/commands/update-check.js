import fs from "node:fs";
import path from "node:path";
import {
  manifestPath,
  readManifest,
  readUpdateCheck,
  writeUpdateCheck,
} from "../lib/manifest.js";

const POLICIES = new Set(["off", "notify", "ask", "auto"]);

/** 读取 flag 后面的取值。 */
function optionValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  return args[index + 1] || null;
}

/** 确保目标是 Trellis 项目。 */
function assertTrellisProject(target) {
  if (!fs.existsSync(path.join(target, ".trellis"))) {
    throw new Error(`目标不是 Trellis 项目:${target}`);
  }
}

/**
 * flower-trellis update-check:管理 manifest 内的启动更新检查策略。
 *
 * @param {object} ctx 见 cli.js 的 parse()
 */
export async function updateCheck(ctx) {
  const args = ctx.passthrough;
  const action = args.find((arg) => !arg.startsWith("-")) || "get";
  assertTrellisProject(ctx.target);

  if (action === "get") {
    const manifest = readManifest(ctx.target);
    console.log(`manifest: ${manifestPath(ctx.target)}`);
    console.log(JSON.stringify(readUpdateCheck(ctx.target), null, 2));
    if (!manifest) console.log("  · manifest 不存在,当前显示默认策略");
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

  throw new Error("update-check 只支持 get / set / disable / enable");
}
