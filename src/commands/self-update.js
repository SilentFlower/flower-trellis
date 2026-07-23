import { spawnSync } from "node:child_process";
import {
  buildSelfCheck,
  projectUpdateCommand,
  projectUpdateForwardArgs,
  safetyState,
} from "../lib/self-check.js";
import { installFlowerVersion } from "../lib/update-check.js";

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

/** 读取目标 git 工作区变动数量,只作为 self-update 后续动作提示。 */
function gitDirtySummary(target) {
  const common = {
    cwd: target,
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 1500,
  };
  const root = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], common);
  if (root.error || root.status !== 0 || String(root.stdout || "").trim() !== "true") {
    return {
      checked: false,
      reason: "not_git_repo",
      dirtyCount: 0,
      changedFilesDetected: false,
      files: [],
    };
  }
  const status = spawnSync("git", ["status", "--porcelain"], common);
  if (status.error || status.status !== 0) {
    return {
      checked: false,
      reason: "git_status_failed",
      dirtyCount: 0,
      changedFilesDetected: false,
      files: [],
    };
  }
  const files = String(status.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    checked: true,
    reason: null,
    dirtyCount: files.length,
    changedFilesDetected: files.length > 0,
    files: files.slice(0, 20),
  };
}

/** 打印 release notes 预览行。 */
function printReleaseNotesPreview(releaseNotes) {
  if (!releaseNotes) return;
  const versions = Array.isArray(releaseNotes.versions) ? releaseNotes.versions : [];
  if (!versions.length) {
    if (releaseNotes.unavailable) console.log("  · 更新内容:未获取到可用 release notes");
    return;
  }
  console.log("  · 更新内容:");
  for (const entry of versions) {
    const suffix = entry.truncated ? " (已截断)" : "";
    console.log(`    - ${entry.version}${suffix}:${entry.body}`);
  }
  if (releaseNotes.moreVersions) {
    console.log("    - 还有更多版本变更未展示");
  }
}

/** 打印结构化 self-update 结果块。 */
function printFlowerUpdateResult(fields) {
  console.log("<flower-update-result>");
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (typeof value === "object" && value !== null) {
      console.log(`${key}: ${JSON.stringify(value)}`);
    } else {
      console.log(`${key}: ${value}`);
    }
  }
  console.log("</flower-update-result>");
}

/**
 * flower-trellis self-update:执行受控自更新与项目重叠加。
 *
 * 默认项目 update 阶段追加 `--force`,等价 Trellis 交互里的 Apply Overwrite to all。
 * 用户可通过 `--` 透传 `--skip-all` / `--create-new` 等上游冲突策略覆盖默认。
 *
 * @param {object} ctx 见 cli-args.js 的 parseCliArgs()
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
    printReleaseNotesPreview(check.releaseNotes);
    console.log(`  · 写入:否`);
    printFlowerUpdateResult({
      status: "dry_run",
      target: ctx.target,
      write: false,
      current_status: check.status,
      post_action_preview: "run_trellis_push_after_real_update",
      release_notes: check.releaseNotes || null,
    });
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
    const res = installFlowerVersion(check.recommendation.version, { cwd: ctx.target });
    if (res.status !== 0) {
      const reason = res.error ? res.error.message : `退出码 ${res.status ?? 1}`;
      throw new Error(`全局 flower-trellis 升级失败(${reason})`);
    }
  } else {
    console.log("  · 跳过全局 flower-trellis 升级");
  }

  runCommand(
    "flower-trellis",
    projectArgs,
    ctx.target,
    "目标项目重叠加失败,请手动运行:" + projectUpdateCommand(ctx.target, forwarded),
  );

  const dirty = gitDirtySummary(ctx.target);
  console.log(`\n🌸 flower-trellis self-update 完成 → ${ctx.target}`);
  printFlowerUpdateResult({
    status: "completed",
    target: ctx.target,
    write: true,
    git_dirty_count: dirty.dirtyCount,
    changed_files_detected: dirty.changedFilesDetected,
    changed_files_sample: dirty.files,
    git_check_reason: dirty.reason,
    post_action: "run_trellis_push_confirmation",
    release_notes: check.releaseNotes || null,
    ai_instruction:
      "必须先加载并遵循 `trellis-push`,不得用自行 Git 检查或手写计划替代;以本次升级变动为默认候选,展示文件列表和 commit message 后等待确认。",
  });
}
