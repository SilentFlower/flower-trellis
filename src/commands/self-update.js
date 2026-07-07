import { spawnSync } from "node:child_process";
import {
  buildSelfCheck,
  projectUpdateCommand,
  projectUpdateForwardArgs,
  safetyState,
} from "../lib/self-check.js";

/** 判断参数里是否包含指定 flag。 */
function hasFlag(args, name) {
  return args.includes(name);
}

/** 执行命令并在失败时给出统一错误。 */
function runCommand(command, args, cwd, failureMessage) {
  const res = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (res.status !== 0) {
    const reason = res.error ? res.error.message : `退出码 ${res.status ?? 1}`;
    throw new Error(`${failureMessage}(${reason})`);
  }
}

/**
 * flower-trellis self-update:执行受控自更新与项目重叠加。
 *
 * 默认项目 update 阶段追加 `--force`,等价 Trellis 交互里的 Apply Overwrite to all。
 * 用户可通过 `--` 透传 `--skip-all` / `--create-new` 等上游冲突策略覆盖默认。
 *
 * @param {object} ctx 见 cli.js 的 parse()
 * @returns {Promise<void>}
 */
export async function selfUpdate(ctx) {
  const dryRun = hasFlag(ctx.passthrough, "--dry-run");
  const yes = hasFlag(ctx.passthrough, "--yes") || hasFlag(ctx.passthrough, "-y");
  const projectOnly = hasFlag(ctx.passthrough, "--project-only");
  const forwarded = ctx.forwarded || [];
  const projectArgs = [
    "update",
    "--target",
    ctx.target,
    "--no-update-check",
    ...projectUpdateForwardArgs(forwarded),
  ];
  const check = await buildSelfCheck(ctx.target, {
    writeCache: !dryRun,
    forceRemote: !projectOnly,
  });
  const shouldInstallFlower = !projectOnly && check.status === "update_available" && check.recommendation;
  const effectiveSafety = check.safety || safetyState(
    ctx.target,
    projectOnly ? "project_out_of_sync" : check.status,
    projectUpdateCommand(ctx.target, forwarded),
  );

  if (dryRun) {
    console.log("self-update dry-run:");
    if (shouldInstallFlower) {
      console.log(`  · 全局升级:${check.recommendation.command}`);
    } else {
      console.log("  · 全局升级:跳过");
    }
    console.log(`  · 项目更新:${projectUpdateCommand(ctx.target, forwarded)}`);
    console.log(`  · 当前状态:${check.status}`);
    console.log(`  · 目标:${ctx.target}`);
    console.log(`  · 当前 flower:${check.current?.flowerVersion || "unknown"}`);
    console.log(`  · 项目 flower:${check.project?.flowerVersion || "unknown"}`);
    console.log(`  · 捆绑 Trellis:${check.current?.bundledTrellisVersion || "unknown"}`);
    console.log(`  · 项目 Trellis:${check.project?.trellisVersion || "unknown"}`);
    console.log(
      `  · 安全检查:${effectiveSafety.safe ? "通过" : `需确认(${effectiveSafety.reasons.join(", ") || "无可用结果"})`}`,
    );
    console.log(`  · 写入:否`);
    return;
  }

  if (!yes) {
    throw new Error("self-update 执行写入前需要 --yes;如需预览请使用 --dry-run");
  }

  if (!shouldInstallFlower && !projectOnly && check.status !== "project_out_of_sync") {
    console.log(`  · 当前状态:${check.status},无需执行 self-update`);
    return;
  }

  if (shouldInstallFlower) {
    runCommand(
      "npm",
      ["i", "-g", `flower-trellis@${check.recommendation.tag}`],
      ctx.target,
      "全局 flower-trellis 升级失败",
    );
  } else {
    console.log("  · 跳过全局 flower-trellis 升级");
  }

  runCommand(
    "flower-trellis",
    projectArgs,
    ctx.target,
    "目标项目重叠加失败,请手动运行:" + projectUpdateCommand(ctx.target, forwarded),
  );

  console.log(`\n🌸 flower-trellis self-update 完成 → ${ctx.target}`);
}
