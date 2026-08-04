import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { readManifest, readUpdateCheck, writeUpdateCheck } from "./manifest.js";
import {
  buildReleaseNotesSummary,
  fetchPackageUpdateMetadata,
  getUpdateRecommendation,
  isPrerelease,
} from "./update-check.js";
import { isRunningViaNpx } from "./runtime-env.js";
import { flowerVersion, trellisVersion } from "./versions.js";
import { ProjectStore } from "../plugin/state/project-store.js";
import { SKILL_GARDEN_PLUGIN_ID } from "../builtin-plugins/skill-garden/provider.js";

/** 上游 trellis update 支持的批量冲突处理参数。 */
const CONFLICT_FLAGS = new Set(["-f", "--force", "-s", "--skip-all", "-n", "--create-new"]);
/** 同一更新提示默认冷却时长,避免每次会话启动都阻塞用户。 */
export const DEFAULT_UPDATE_PROMPT_COOLDOWN_HOURS = 24;
/** 用户选择稍后时的默认延后时长。 */
export const DEFAULT_UPDATE_PROMPT_SNOOZE_HOURS = 24 * 7;

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
  if (updateCheck.lastStatus === "offline" || updateCheck.lastErrorCode) return false;
  if (!updateCheck.lastRemote) return false;
  if (!updateCheck.lastCheckedAt) return false;
  const checkedAt = new Date(updateCheck.lastCheckedAt).getTime();
  if (!Number.isFinite(checkedAt)) return false;
  return now.getTime() - checkedAt < updateCheck.intervalHours * 60 * 60 * 1000;
}

/**
 * 判断缓存的 release notes 是否匹配本次检查范围。
 *
 * @param {object} updateCheck 归一化 updateCheck 配置
 * @param {{from:string|null,to:string|null,channel:string,reason:string}|null} range 本次期望范围
 * @returns {object|null} 可复用的缓存摘要
 */
function cachedReleaseNotes(updateCheck, range) {
  const cached = updateCheck.lastReleaseNotes;
  if (!cached || !range || cached.unavailable) return null;
  const cachedRange = cached.range || {};
  if (
    cachedRange.from !== range.from ||
    cachedRange.to !== range.to ||
    cachedRange.channel !== range.channel
  ) {
    return null;
  }
  if (!Array.isArray(cached.versions) || !cached.versions.length) return null;
  // 同一版本范围的内容相同;reason 只是触发路径,不能让项目追平场景丢失摘要。
  return {
    ...cached,
    range: {
      ...cachedRange,
      from: range.from,
      to: range.to,
      channel: range.channel,
      reason: range.reason,
    },
  };
}

/**
 * 构造新版升级 release notes 范围。
 *
 * @param {string} currentFlower 当前 flower 版本
 * @param {{version:string,tag:string}|null} recommendation 升级推荐
 * @returns {{from:string,to:string,channel:string,reason:string}|null} release notes 范围
 */
function updateReleaseNotesRange(currentFlower, recommendation) {
  if (!recommendation?.version) return null;
  return {
    from: currentFlower,
    to: recommendation.version,
    channel: recommendation.tag,
    reason: "update_available",
  };
}

/**
 * 构造项目追平 release notes 范围。
 *
 * @param {string|null} projectFlower 项目 manifest 记录的 flower 版本
 * @param {string} currentFlower 当前 flower 版本
 * @returns {{from:string,to:string,channel:string,reason:string}|null} release notes 范围
 */
function projectReleaseNotesRange(projectFlower, currentFlower) {
  if (!projectFlower || !currentFlower) return null;
  return {
    from: projectFlower,
    to: currentFlower,
    channel: isPrerelease(currentFlower) ? "beta" : "latest",
    reason: "project_out_of_sync",
  };
}

/**
 * 从 registry metadata 构造 release notes 摘要。
 *
 * @param {object|null} metadata registry metadata
 * @param {object|null} range release notes 范围
 * @returns {object|null} release notes 摘要
 */
function releaseNotesFromMetadata(metadata, range) {
  if (!range) return null;
  return buildReleaseNotesSummary(metadata?.releaseNotesByVersion, range);
}

/**
 * 安全执行 npm metadata 拉取。
 *
 * 默认 fetcher 已经吞掉网络错误;这里再兜底测试注入的 fetcher,确保 release notes
 * 补拉失败不会破坏 self-check 主流程。
 *
 * @param {() => Promise<object|null>} fetchMetadata npm metadata 拉取函数
 * @returns {Promise<object|null>} registry metadata,失败时为 null
 */
async function safeFetchPackageUpdateMetadata(fetchMetadata) {
  try {
    return await fetchMetadata();
  } catch {
    return null;
  }
}

/**
 * 缓存命中但缺少摘要时,主动补拉 release notes。
 *
 * 这个补拉只服务当前 actionable 提示的摘要展示,不能把失败写成新的远程版本证据;
 * 成功时也只写回 lastReleaseNotes,保持 lastRemote 仍只记录 dist-tags。
 *
 * @param {string} target 目标项目根
 * @param {object|null} projectEvidence 目标项目 Plugin lock 或旧 manifest 证据
 * @param {boolean} writeCache 是否允许写缓存
 * @param {object|null} range release notes 范围
 * @param {() => Promise<object|null>} fetchMetadata npm metadata 拉取函数
 * @returns {Promise<object|null>} release notes 摘要;范围有效但不可用时返回 unavailable 摘要
 */
async function fetchMissingReleaseNotes(target, projectEvidence, writeCache, range, fetchMetadata) {
  if (!range) return null;
  const metadata = await safeFetchPackageUpdateMetadata(fetchMetadata);
  const releaseNotes = releaseNotesFromMetadata(metadata, range);
  if (releaseNotes && !releaseNotes.unavailable && writeCache && projectEvidence) {
    writeUpdateCheck(target, { lastReleaseNotes: releaseNotes });
  }
  return releaseNotes;
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

/**
 * 生成 update-check 提示管理命令。
 *
 * @param {string} target 目标项目根
 * @returns {{snooze:string,skip:string,reset:string}} 可执行命令
 */
function promptManagementCommands(target) {
  const base = ["flower-trellis", "update-check"];
  const targetArgs = ["--target", target];
  return {
    snooze: [...base, "snooze", ...targetArgs].map(shellQuote).join(" "),
    skip: [...base, "skip", ...targetArgs].map(shellQuote).join(" "),
    reset: [...base, "reset", ...targetArgs].map(shellQuote).join(" "),
  };
}

/** 把版本差异字段转为稳定 prompt key 片段。 */
function keyPart(value) {
  return String(value || "unknown").replace(/\s+/g, "_");
}

/**
 * 为可执行更新结果生成提示 key。
 *
 * @param {object} result self-check 结果
 * @returns {string|null} 当前提示 key
 */
function updatePromptKey(result) {
  if (result.status === "update_available" && result.recommendation?.version) {
    return `update:${keyPart(result.recommendation.tag)}:${keyPart(result.recommendation.version)}`;
  }
  if (result.status === "project_out_of_sync") {
    const current = result.current || {};
    const project = result.project || {};
    return [
      "project",
      `flower:${keyPart(project.flowerVersion)}>${keyPart(current.flowerVersion)}`,
      `trellis:${keyPart(project.trellisVersion)}>${keyPart(current.bundledTrellisVersion)}`,
    ].join(":");
  }
  return null;
}

/** 解析 ISO 时间,无效时返回 null。 */
function parseTimeMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

/** 给时间加指定小时。 */
function addHours(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

/**
 * 判断当前提示是否应被延后、跳过或冷却抑制。
 *
 * @param {object} updateCheck 归一化 updateCheck
 * @param {string} promptKey 当前提示 key
 * @param {Date} now 当前时间
 * @returns {{suppressed:boolean,reason:string|null,until:string|null}} 抑制结果
 */
function promptSuppression(updateCheck, promptKey, now) {
  if (updateCheck.promptSuppressedKey === promptKey) {
    if (updateCheck.promptSuppressionReason === "skip") {
      return { suppressed: true, reason: "skip", until: null };
    }
    if (updateCheck.promptSuppressionReason === "snooze") {
      const suppressedUntilMs = parseTimeMs(updateCheck.promptSuppressedUntil);
      if (suppressedUntilMs && suppressedUntilMs > now.getTime()) {
        return {
          suppressed: true,
          reason: "snooze",
          until: new Date(suppressedUntilMs).toISOString(),
        };
      }
    }
  }

  if (updateCheck.lastPromptedKey === promptKey) {
    const lastPromptedMs = parseTimeMs(updateCheck.lastPromptedAt);
    if (lastPromptedMs) {
      const nextPromptAt = addHours(
        new Date(lastPromptedMs),
        DEFAULT_UPDATE_PROMPT_COOLDOWN_HOURS,
      );
      if (nextPromptAt.getTime() > now.getTime()) {
        return {
          suppressed: true,
          reason: "cooldown",
          until: nextPromptAt.toISOString(),
        };
      }
    }
  }

  return { suppressed: false, reason: null, until: null };
}

/**
 * 构造提示节流诊断对象。
 *
 * @param {string} target 目标项目根
 * @param {object} updateCheck 归一化 updateCheck
 * @param {string} promptKey 当前提示 key
 * @param {object} suppression 抑制结果
 * @returns {object} prompt 字段
 */
function promptInfo(target, updateCheck, promptKey, suppression) {
  return {
    key: promptKey,
    suppressed: suppression.suppressed,
    reason: suppression.reason,
    until: suppression.until,
    lastPromptedAt: updateCheck.lastPromptedAt,
    lastPromptedKey: updateCheck.lastPromptedKey,
    suppressedKey: updateCheck.promptSuppressedKey,
    suppressionReason: updateCheck.promptSuppressionReason,
    cooldownHours: DEFAULT_UPDATE_PROMPT_COOLDOWN_HOURS,
    snoozeHours: DEFAULT_UPDATE_PROMPT_SNOOZE_HOURS,
    commands: promptManagementCommands(target),
  };
}

/**
 * 对可执行更新结果应用提示节流。
 *
 * 远程检查节流只回答“是否知道有更新”;这里单独回答“本次会话是否还要打扰用户”。
 *
 * @param {string} target 目标项目根
 * @param {object} result 可执行 self-check 结果
 * @param {{now:Date,writeCache:boolean,projectEvidence:object|null,recordPrompt:boolean,ignorePromptSuppression:boolean}} options 提示选项
 * @returns {object} 应返回给 self-check 的结果
 */
function applyPromptPolicy(target, result, options) {
  const promptKey = updatePromptKey(result);
  if (!promptKey) return result;

  const bypassSuppression = options.ignorePromptSuppression || result.ai?.mode === "auto";
  const suppression = bypassSuppression
    ? { suppressed: false, reason: null, until: null }
    : promptSuppression(result.updateCheck, promptKey, options.now);

  if (suppression.suppressed) {
    return {
      ...result,
      status: "skipped",
      reason: `prompt_${suppression.reason}`,
      prompt: promptInfo(target, result.updateCheck, promptKey, suppression),
      suppressedAction: {
        status: result.status,
        reason: result.reason,
        recommendation: result.recommendation,
        commands: result.commands,
        releaseNotes: result.releaseNotes,
      },
      recommendation: null,
      releaseNotes: null,
      commands: {},
      safety: null,
      ai: null,
    };
  }

  if (options.recordPrompt && options.writeCache && options.projectEvidence) {
    const updateCheck = writeUpdateCheck(target, {
      lastPromptedAt: options.now.toISOString(),
      lastPromptedKey: promptKey,
      promptSuppressedUntil: null,
      promptSuppressedKey: null,
      promptSuppressionReason: null,
    });
    return {
      ...result,
      updateCheck,
      prompt: promptInfo(target, updateCheck, promptKey, suppression),
    };
  }

  return {
    ...result,
    prompt: promptInfo(target, result.updateCheck, promptKey, suppression),
  };
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
function projectOutOfSyncResult(base, target, remotePatch = {}, releaseNotes = null, promptOptions = null) {
  const command = selfUpdateCommand(target, { projectOnly: true });
  const result = withAction(
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
      releaseNotes,
    },
    command,
  );
  return promptOptions ? applyPromptPolicy(target, result, promptOptions) : result;
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
 * @param {{writeCache?: boolean, forceRemote?: boolean, fetchMetadata?: () => Promise<object|null>,onRemoteCheck?:()=>Promise<unknown>,recordPrompt?:boolean,ignorePromptSuppression?:boolean}} options 检查选项
 * @returns {Promise<object>} 结构化检查结果
 */
export async function buildSelfCheck(target, options = {}) {
  const writeCache = options.writeCache !== false;
  const forceRemote = options.forceRemote === true;
  const recordPrompt = options.recordPrompt === true;
  const ignorePromptSuppression = options.ignorePromptSuppression === true;
  const fetchMetadata = typeof options.fetchMetadata === "function"
    ? options.fetchMetadata
    : fetchPackageUpdateMetadata;
  const onRemoteCheck = typeof options.onRemoteCheck === "function"
    ? options.onRemoteCheck
    : null;
  const now = new Date();
  const absoluteTarget = path.resolve(target);
  const trellisDir = path.join(absoluteTarget, ".trellis");
  const manifest = readManifest(absoluteTarget);
  const store = new ProjectStore(absoluteTarget);
  const pluginLock = store.readLock();
  const pluginState = store.readState();
  const projectEvidence = manifest || pluginLock;
  const updateCheck = readUpdateCheck(absoluteTarget);
  const currentFlower = flowerVersion();
  const currentTrellis = trellisVersion();
  const projectTrellis = readProjectTrellisVersion(absoluteTarget);
  const skillGardenLock = pluginLock?.plugins.find(({ id }) => id === SKILL_GARDEN_PLUGIN_ID);
  const projectFlower = skillGardenLock?.version || (
    typeof manifest?.flowerVersion === "string" ? manifest.flowerVersion : null
  );
  const projectOutOfSyncReasons = [];
  if (projectFlower && projectFlower !== currentFlower) {
    projectOutOfSyncReasons.push("flower_version_mismatch");
  }
  if (projectTrellis && projectTrellis !== currentTrellis) {
    projectOutOfSyncReasons.push("trellis_version_mismatch");
  }
  const projectOutOfSync = projectOutOfSyncReasons.length > 0;
  const promptOptions = {
    now,
    writeCache,
    projectEvidence,
    recordPrompt,
    ignorePromptSuppression,
  };

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
      pluginStatePresent: Boolean(pluginLock && pluginState),
      plugins: (pluginLock?.plugins || []).map(({ id, version, source }) => ({
        id,
        version,
        source: source.type,
        applied: Boolean(pluginState?.plugins.some((entry) => entry.id === id)),
      })),
      migration: pluginState?.migration || null,
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
    releaseNotes: null,
    commands: {},
    safety: null,
    ai: null,
    reason: null,
  };

  const persistRemoteCache = (patch) => {
    if (!writeCache || (!manifest && !pluginLock)) return base;
    writeUpdateCheck(absoluteTarget, patch);
    return { ...base, updateCheck: readUpdateCheck(absoluteTarget) };
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
      const releaseNotesRange = updateReleaseNotesRange(currentFlower, recommendation);
      const result = withAction(
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
          releaseNotes: cachedReleaseNotes(updateCheck, releaseNotesRange),
        },
        command,
      );
      return applyPromptPolicy(absoluteTarget, result, promptOptions);
    }
    if (projectOutOfSync) {
      const releaseNotesRange = projectReleaseNotesRange(projectFlower, currentFlower);
      const releaseNotes = cachedReleaseNotes(updateCheck, releaseNotesRange) ||
        await fetchMissingReleaseNotes(
          absoluteTarget,
          projectEvidence,
          writeCache,
          releaseNotesRange,
          fetchMetadata,
        );
      return projectOutOfSyncResult(base, absoluteTarget, {
        tags,
        fromCache: true,
        skipped: true,
      }, releaseNotes, promptOptions);
    }
    return {
      ...base,
      status: "skipped",
      reason: "interval_not_elapsed",
      remote: { ...base.remote, tags, fromCache: true, skipped: true },
    };
  }

  const [metadata] = await Promise.all([
    safeFetchPackageUpdateMetadata(fetchMetadata),
    onRemoteCheck ? Promise.resolve().then(onRemoteCheck).catch(() => null) : null,
  ]);
  if (!metadata) {
    const resultBase = persistRemoteCache({
      lastStatus: "offline",
      lastErrorCode: "fetch_failed",
    });
    const remotePatch = { tags: updateCheck.lastRemote, errorCode: "fetch_failed" };
    if (projectOutOfSync) {
      const releaseNotesRange = projectReleaseNotesRange(projectFlower, currentFlower);
      return projectOutOfSyncResult(
        resultBase,
        absoluteTarget,
        remotePatch,
        cachedReleaseNotes(updateCheck, releaseNotesRange),
        promptOptions,
      );
    }
    return {
      ...resultBase,
      status: "offline",
      reason: "fetch_failed",
      remote: { ...resultBase.remote, ...remotePatch },
    };
  }

  tags = metadata.tags;
  const recommendation = getUpdateRecommendation(currentFlower, tags);
  const remoteStatus = recommendation ? "update_available" : "up_to_date";
  const releaseNotesRange = recommendation
    ? updateReleaseNotesRange(currentFlower, recommendation)
    : projectReleaseNotesRange(projectFlower, currentFlower);
  const releaseNotes = releaseNotesFromMetadata(metadata, releaseNotesRange);
  const resultBase = persistRemoteCache({
    lastCheckedAt: now.toISOString(),
    lastRemote: tags,
    lastReleaseNotes: releaseNotes && !releaseNotes.unavailable ? releaseNotes : null,
    lastStatus: remoteStatus,
    lastErrorCode: null,
  });

  if (!recommendation) {
    if (projectOutOfSync) {
      return projectOutOfSyncResult(resultBase, absoluteTarget, { tags }, releaseNotes, promptOptions);
    }
    return {
      ...resultBase,
      status: remoteStatus,
      remote: { ...resultBase.remote, tags },
    };
  }

  const command = selfUpdateCommand(absoluteTarget);
  const result = withAction(
    absoluteTarget,
    updateCheck.policy,
    {
      ...resultBase,
      status: remoteStatus,
      remote: { ...resultBase.remote, tags },
      recommendation,
      commands: {
        recommended: command,
        npm: recommendation.command,
        projectUpdate: projectUpdateCommand(absoluteTarget),
      },
      releaseNotes,
    },
    command,
  );
  return applyPromptPolicy(absoluteTarget, result, promptOptions);
}
