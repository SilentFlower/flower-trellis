import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { readManifest, readUpdateCheck, writeUpdateCheck } from "./manifest.js";
import { fetchPackageDistTags, getUpdateRecommendation } from "./update-check.js";
import { isRunningViaNpx } from "./runtime-env.js";
import { flowerVersion, trellisVersion } from "./versions.js";

/** 上游 trellis update 支持的批量冲突处理参数。 */
const CONFLICT_FLAGS = new Set(["-f", "--force", "-s", "--skip-all", "-n", "--create-new"]);

/** 给命令建议使用的保守 shell 引号。 */
function shellQuote(value) {
  const text = String(value || "");
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, "'\\''")}'`;
}

/** 读取目标项目的 `.trellis/.version`。 */
function readProjectTrellisVersion(target) {
  try {
    const text = fs.readFileSync(path.join(target, ".trellis", ".version"), "utf8").trim();
    return text || null;
  } catch {
    return null;
  }
}

/** 判断远程探测缓存是否仍在 interval 内。 */
function isRemoteCacheFresh(updateCheck, now = new Date()) {
  if (!updateCheck.lastCheckedAt) return false;
  const checkedAt = new Date(updateCheck.lastCheckedAt).getTime();
  if (!Number.isFinite(checkedAt)) return false;
  return now.getTime() - checkedAt < updateCheck.intervalHours * 60 * 60 * 1000;
}

/** 检查目标目录 git 工作区是否 clean。 */
function gitSafety(target) {
  const common = {
    cwd: target,
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 1500,
  };
  const root = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], common);
  if (root.error || root.status !== 0 || String(root.stdout || "").trim() !== "true") {
    return { clean: false, reason: "not_git_repo" };
  }
  const status = spawnSync("git", ["status", "--porcelain"], common);
  if (status.error || status.status !== 0) return { clean: false, reason: "git_status_failed" };
  const dirty = String(status.stdout || "")
    .split(/\r?\n/)
    .filter((line) => line.trim());
  return dirty.length
    ? { clean: false, reason: "dirty_worktree", dirtyCount: dirty.length }
    : { clean: true, reason: null, dirtyCount: 0 };
}

/** 递归查找 active / in_progress Trellis 任务。 */
function hasActiveTask(target) {
  const tasksDir = path.join(target, ".trellis", "tasks");
  const stack = [tasksDir];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (entry.name !== "task.json") continue;
      try {
        const data = JSON.parse(fs.readFileSync(abs, "utf8"));
        if (data?.status === "in_progress" || data?.status === "active") {
          return true;
        }
      } catch {
        // 损坏任务文件不阻断版本检查;auto 安全门槛另由可读性结果降级。
      }
    }
  }
  return false;
}

/** 判断当前 shell 是否可直接调用 flower-trellis 命令。 */
function hasFlowerCommand() {
  const res = spawnSync("flower-trellis", ["-v"], {
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: ["ignore", "ignore", "ignore"],
    timeout: 1500,
  });
  return !res.error && res.status === 0;
}

/**
 * 生成项目更新阶段参数。
 *
 * 默认追加 `--force`,对应 Trellis 交互里的 Apply Overwrite to all。若用户显式透传
 * 其它批量冲突策略,则尊重用户选择,不再追加默认覆盖策略。
 *
 * @param {string[]} forwarded 透传给项目 update 的参数
 * @returns {string[]} 项目 update 透传参数
 */
export function projectUpdateForwardArgs(forwarded = []) {
  const hasConflictStrategy = forwarded.some((arg) => CONFLICT_FLAGS.has(arg));
  return hasConflictStrategy ? [...forwarded] : ["--force", ...forwarded];
}

/**
 * 生成手动项目更新命令。
 *
 * @param {string} target 目标项目根
 * @param {string[]} forwarded 透传参数
 * @returns {string} 可执行命令
 */
export function projectUpdateCommand(target, forwarded = []) {
  const args = [
    "flower-trellis",
    "update",
    "--target",
    target,
    "--no-update-check",
    ...projectUpdateForwardArgs(forwarded),
  ];
  return args.map(shellQuote).join(" ");
}

/**
 * 生成 self-update 命令。
 *
 * @param {string} target 目标项目根
 * @param {{projectOnly?: boolean}} options 命令选项
 * @returns {string} 可执行命令
 */
export function selfUpdateCommand(target, options = {}) {
  const args = ["flower-trellis", "self-update", "--target", target, "--yes"];
  if (options.projectOnly) args.push("--project-only");
  return args.map(shellQuote).join(" ");
}

/** 根据 policy 和安全检查结果生成 AI 动作指令。 */
function actionForPolicy(policy, command, safety) {
  if (policy === "notify") {
    return {
      mode: "notify",
      instruction: "只告知用户发现更新和手动命令,不要主动询问或执行。",
      command,
    };
  }
  if (policy === "auto" && safety.safe) {
    return {
      mode: "auto",
      instruction: "安全条件满足,可以直接执行受控更新命令。",
      command,
    };
  }
  return {
    mode: "ask",
    instruction: "必须先询问用户是否执行推荐命令;用户明确确认前禁止运行推荐命令。",
    command,
    downgradedFromAuto: policy === "auto",
    downgradeReasons: policy === "auto" ? safety.reasons : [],
  };
}

/** 给可执行状态补齐安全检查和 AI 动作建议。 */
function withAction(target, policy, result, command) {
  const safety = safetyState(target, result.status, command);
  return {
    ...result,
    safety,
    ai: actionForPolicy(policy, command, safety),
  };
}

/** 生成项目重叠加建议结果。 */
function projectOutOfSyncResult(base, target, remotePatch = {}) {
  const command = selfUpdateCommand(target, { projectOnly: true });
  return withAction(
    target,
    base.policy,
    {
      ...base,
      status: "project_out_of_sync",
      reason: "local_version_mismatch",
      remote: { ...base.remote, ...remotePatch },
      commands: {
        recommended: command,
        projectUpdate: projectUpdateCommand(target),
      },
    },
    command,
  );
}

/** 计算 auto 策略安全门槛。 */
export function safetyState(target, status, command) {
  const git = gitSafety(target);
  const activeTask = hasActiveTask(target);
  const flowerCommand = hasFlowerCommand();
  const reasons = [];
  if (!git.clean) reasons.push(git.reason);
  if (activeTask) reasons.push("active_task");
  if (!flowerCommand) reasons.push("flower_command_missing");
  if (!command) reasons.push("missing_command");
  if (process.env.FLOWER_NO_UPDATE_CHECK) reasons.push("disabled_by_env");
  if (!["update_available", "project_out_of_sync"].includes(status)) reasons.push("status_not_actionable");
  return {
    safe: reasons.length === 0,
    reasons,
    git,
    activeTask,
    flowerCommand,
  };
}

/**
 * 构建启动自更新检查结果。
 *
 * @param {string} target 目标项目根
 * @param {{writeCache?: boolean, forceRemote?: boolean}} options 检查选项
 * @returns {Promise<object>} 结构化检查结果
 */
export async function buildSelfCheck(target, options = {}) {
  const writeCache = options.writeCache !== false;
  const forceRemote = options.forceRemote === true;
  const now = new Date();
  const absoluteTarget = path.resolve(target);
  const trellisDir = path.join(absoluteTarget, ".trellis");
  const manifest = readManifest(absoluteTarget);
  const updateCheck = readUpdateCheck(absoluteTarget);
  const currentFlower = flowerVersion();
  const currentTrellis = trellisVersion();
  const projectTrellis = readProjectTrellisVersion(absoluteTarget);
  const projectFlower = typeof manifest?.flowerVersion === "string" ? manifest.flowerVersion : null;
  const projectOutOfSyncReasons = [];
  if (projectFlower && projectFlower !== currentFlower) {
    projectOutOfSyncReasons.push("flower_version_mismatch");
  }
  if (projectTrellis && projectTrellis !== currentTrellis) {
    projectOutOfSyncReasons.push("trellis_version_mismatch");
  }
  const projectOutOfSync = projectOutOfSyncReasons.length > 0;

  const base = {
    status: "up_to_date",
    checkedAt: now.toISOString(),
    target: absoluteTarget,
    policy: updateCheck.policy,
    updateCheck,
    current: {
      flowerVersion: currentFlower,
      bundledTrellisVersion: currentTrellis,
    },
    project: {
      flowerVersion: projectFlower,
      trellisVersion: projectTrellis,
      manifestPresent: Boolean(manifest),
      outOfSync: projectOutOfSync,
      outOfSyncReasons: projectOutOfSyncReasons,
    },
    remote: {
      tags: updateCheck.lastRemote,
      fromCache: false,
      skipped: false,
      errorCode: null,
    },
    recommendation: null,
    commands: {},
    safety: null,
    ai: null,
    reason: null,
  };

  if (!fs.existsSync(trellisDir)) {
    return { ...base, status: "skipped", reason: "not_trellis_project" };
  }
  if (process.env.FLOWER_NO_UPDATE_CHECK || !updateCheck.enabled || updateCheck.policy === "off") {
    return { ...base, status: "disabled", reason: "disabled" };
  }
  if (isRunningViaNpx(import.meta.url)) {
    return { ...base, status: "skipped", reason: "npx_runtime" };
  }

  let tags = updateCheck.lastRemote;
  if (!forceRemote && isRemoteCacheFresh(updateCheck, now)) {
    const recommendation = getUpdateRecommendation(currentFlower, tags);
    if (recommendation) {
      const command = selfUpdateCommand(absoluteTarget);
      return withAction(
        absoluteTarget,
        updateCheck.policy,
        {
          ...base,
          status: "update_available",
          reason: "cached_remote_update",
          remote: { ...base.remote, tags, fromCache: true, skipped: true },
          recommendation,
          commands: {
            recommended: command,
            npm: recommendation.command,
            projectUpdate: projectUpdateCommand(absoluteTarget),
          },
        },
        command,
      );
    }
    if (projectOutOfSync) {
      return projectOutOfSyncResult(base, absoluteTarget, {
        tags,
        fromCache: true,
        skipped: true,
      });
    }
    return {
      ...base,
      status: "skipped",
      reason: "interval_not_elapsed",
      remote: { ...base.remote, tags, fromCache: true, skipped: true },
    };
  }

  tags = await fetchPackageDistTags();
  if (!tags) {
    if (writeCache && manifest) {
      writeUpdateCheck(absoluteTarget, {
        lastCheckedAt: now.toISOString(),
        lastStatus: "offline",
        lastErrorCode: "fetch_failed",
      });
    }
    const remotePatch = { tags: updateCheck.lastRemote, errorCode: "fetch_failed" };
    if (projectOutOfSync) {
      return projectOutOfSyncResult(base, absoluteTarget, remotePatch);
    }
    return {
      ...base,
      status: "offline",
      reason: "fetch_failed",
      remote: { ...base.remote, ...remotePatch },
    };
  }

  const recommendation = getUpdateRecommendation(currentFlower, tags);
  const remoteStatus = recommendation ? "update_available" : "up_to_date";
  if (writeCache && manifest) {
    writeUpdateCheck(absoluteTarget, {
      lastCheckedAt: now.toISOString(),
      lastRemote: tags,
      lastStatus: remoteStatus,
      lastErrorCode: null,
    });
  }

  if (!recommendation) {
    if (projectOutOfSync) {
      return projectOutOfSyncResult(base, absoluteTarget, { tags });
    }
    return {
      ...base,
      status: remoteStatus,
      remote: { ...base.remote, tags },
    };
  }

  const command = selfUpdateCommand(absoluteTarget);
  return withAction(
    absoluteTarget,
    updateCheck.policy,
    {
      ...base,
      status: remoteStatus,
      remote: { ...base.remote, tags },
      recommendation,
      commands: {
        recommended: command,
        npm: recommendation.command,
        projectUpdate: projectUpdateCommand(absoluteTarget),
      },
    },
    command,
  );
}
