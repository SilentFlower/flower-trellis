import { runTrellis, runTrellisPty } from "../lib/trellis-runner.js";
import { trellisUpdatePassthroughArgs } from "../lib/cli-args.js";
import { plugin } from "./plugin.js";
import { printBanner, getDeveloper } from "../lib/banner.js";
import { checkForUpdate } from "../lib/update-check.js";
import { syncGlobalTrellis } from "../lib/global-trellis-sync.js";
import {
  captureConfigPreserveSnapshot,
  restoreConfigPreserveSnapshot,
} from "../lib/config-preserver.js";
import {
  normalizeUpdateBackupRetention,
  pruneUpdateBackups,
  snapshotUpdateBackups,
} from "../lib/update-backups.js";
import { ProjectStore } from "../plugin/state/project-store.js";
import { resolveSkillGardenPlatforms } from "../builtin-plugins/skill-garden/runtime.js";
import { SKILL_GARDEN_PLUGIN_ID } from "../builtin-plugins/skill-garden/provider.js";
import { showCommandCompletion } from "../lib/command-completion.js";
import { reportTelemetry } from "../lib/telemetry.js";
import { selectVariant } from "../lib/variant.js";
import { trellisVersion } from "../lib/versions.js";
import {
  createUpdateSandbox,
  createUpdateSnapshot,
  disposeUpdateSandbox,
  disposeUpdateSnapshot,
  extendUpdateSnapshot,
  restoreUpdateSnapshot,
} from "../lib/update-transaction.js";
import { runWithTrellisIntegrationEnabled } from "../lib/trellis-control.js";

const SILENT_OUTPUT = Object.freeze({
  columns: 80,
  rows: 30,
  log() {},
  error() {},
  write() { return true; },
  on() {},
  off() {},
});

/**
 * 判断普通跨版本 dry-run 是否需要进入项目外升级沙箱。
 *
 * Trellis 的 dry-run 不会把目标项目写成捆绑版本，因此跨版本场景需要先在项目外沙箱
 * 真实升级，再对升级后的树执行 Plugin dry-run。`--enhance-only` 仍直接预检当前模板。
 *
 * @param {{dryRun:boolean,enhanceOnly:boolean,currentVersion:string,targetVersion:string}} options 判定输入
 * @returns {boolean} 是否使用项目外升级沙箱
 */
export function shouldUseUpdateSandbox(options) {
  const { dryRun, enhanceOnly, currentVersion, targetVersion } = options;
  return dryRun
    && !enhanceOnly
    && Boolean(currentVersion)
    && Boolean(targetVersion)
    && currentVersion !== targetVersion;
}

function sandboxTrellisUpdateArgs(passthrough) {
  const args = trellisUpdatePassthroughArgs(passthrough)
    .filter((arg) => arg !== "--dry-run");
  if (!args.some((arg) => ["--force", "--skip-all", "--create-new"].includes(arg))) {
    // 沙箱没有人工确认价值，默认覆盖只影响临时副本，并能得到完整的升级后模板供 Plugin 预检。
    args.push("--force");
  }
  return args;
}

/**
 * 把平台列表转换成 Plugin CLI 的重复 `--platform` 参数。
 *
 * @param {string[]} platforms Plugin 平台 ID
 * @returns {string[]} CLI passthrough 参数
 */
function pluginPlatformArgs(platforms) {
  return platforms.flatMap((platform) => ["--platform", platform]);
}

/**
 * 在 `flower-trellis update` 流程中重放 Plugin Runtime。
 *
 * @param {object} ctx update 命令上下文
 * @param {string} target 目标项目根
 * @param {boolean} dryRun 是否仅预演
 * @param {ReturnType<typeof createUpdateSnapshot>|null} [compensationSnapshot] 失败补偿快照
 * @returns {Promise<void>} Plugin 重放完成
 */
export async function replayPlugins(ctx, target, dryRun, compensationSnapshot = null) {
  const output = ctx.trellisControlQuiet ? SILENT_OUTPUT : console;
  const store = new ProjectStore(target);
  const lock = store.readLock();
  const preserveIds = (lock?.plugins || [])
    .filter(({ id, source }) => (
      id !== SKILL_GARDEN_PLUGIN_ID && ["gitlab", "github"].includes(source.type)
    ))
    .map(({ id }) => id);
  const onPreflight = compensationSnapshot || ctx.trellisControlExtendSnapshot
    ? ({ plan }) => {
      const targets = [
        ...plan.contentMutations.map(({ target: mutationTarget }) => mutationTarget),
        ...plan.patchMutations.map(({ target: mutationTarget }) => mutationTarget),
      ];
      if (compensationSnapshot) extendUpdateSnapshot(compensationSnapshot, targets);
      ctx.trellisControlExtendSnapshot?.(targets);
    }
    : undefined;
  if (ctx.enhance) {
    const declared = store.readPlugins().plugins
      .some(({ id }) => id === SKILL_GARDEN_PLUGIN_ID);
    const code = await plugin({
      ...ctx,
      target,
      passthrough: [
        declared ? "update" : "add",
        SKILL_GARDEN_PLUGIN_ID,
        ...pluginPlatformArgs(resolveSkillGardenPlatforms(target)),
        ...(dryRun ? ["--dry-run"] : []),
      ],
    }, {
      skillGarden: { variant: ctx.variant, skills: ctx.skills },
      preserveIds,
      compact: true,
      onPreflight,
      output,
    });
    if (code !== 0) throw new Error(`Plugin Runtime 重放失败(退出码 ${code})`);
    return;
  }

  output.log("· --no-enhance:跳过 Skill-Garden，仅重放其它已声明 Plugin");
  const preserveSkillGarden = lock?.plugins
    .some(({ id }) => id === SKILL_GARDEN_PLUGIN_ID) === true;
  const code = await plugin({
    ...ctx,
    target,
    passthrough: ["replay", ...(dryRun ? ["--dry-run"] : [])],
  }, {
    skillGarden: { preserve: preserveSkillGarden },
    preserveIds: preserveSkillGarden ? [SKILL_GARDEN_PLUGIN_ID] : [],
    compact: true,
    onPreflight,
    output,
  });
  if (code !== 0) throw new Error(`外部 Plugin 重放失败(退出码 ${code})`);
}

async function previewCrossVersionUpdate(ctx, currentVersion, targetVersion) {
  const sandbox = createUpdateSandbox(ctx.target);
  console.log(
    `· 跨版本 dry-run:在项目外沙箱预演 Trellis + Plugin (${currentVersion} → ${targetVersion})`,
  );
  try {
    const code = await runTrellis(
      ["update", ...sandboxTrellisUpdateArgs(ctx.passthrough)],
      sandbox.root,
      { stripBanner: true },
    );
    if (code !== 0) throw new Error(`沙箱 trellis update 失败(退出码 ${code})`);
    await replayPlugins(ctx, sandbox.root, true);
  } finally {
    disposeUpdateSandbox(sandbox);
  }
}

/**
 * 构造 Flower update 补偿不完整的结构化错误。
 *
 * @param {Error} updateError 原始更新错误
 * @param {{failedPaths:Array<{path:string,error:string}>,manifestPath:string}} recovery 恢复证据
 * @returns {Error & {code:string,details:object}} 带稳定错误码和恢复详情的错误
 */
export function createUpdateCompensationError(updateError, recovery) {
  const error = new Error(
    `Update 失败且补偿恢复不完整:${updateError.message};` +
    `未恢复 ${recovery.failedPaths.length} 个路径;快照:${recovery.manifestPath}`,
    { cause: updateError },
  );
  error.code = "UPDATE_COMPENSATION_INCOMPLETE";
  error.details = recovery;
  return error;
}

function printBackupRetentionResult(result, output = console) {
  if (result.status === "preview") {
    output.log("\n升级备份清理预览:");
    output.log(
      `  · 保留策略:${result.retention} 份;预计保留 ${result.retained.length} 份;预计删除 ${result.removable.length} 份`,
    );
    for (const name of result.removable) {
      output.log(`  · 将删除 .trellis/${name}`);
    }
  } else if (result.status === "completed" && result.removed.length > 0) {
    output.log(`  ✓ 已清理 ${result.removed.length} 份旧升级备份，保留策略:${result.retention} 份`);
  }

  if (result.protected.length > result.retention) {
    output.log(`  · 本轮新建备份受保护，当前临时保留 ${result.protected.length} 份`);
  }
  for (const warning of result.warnings) {
    output.log(`  · 升级备份清理警告:${warning}`);
  }
}

/**
 * flower-trellis update:驱动 `trellis update`,随后按(可能已升级的)版本重新叠加强化包。
 *
 * 打印 flower 品牌头部;trellis update 在伪终端(pty)里运行,保留其冲突处理等交互,
 * 同时过滤掉它重复打印的启动 banner / Developer。
 * `--dry-run` 在同版本时直接预演；跨版本时在项目外沙箱真实升级后再预演 Plugin。
 * 真实更新在整条 Trellis + Plugin 链失败时恢复升级前受管状态。
 *
 * @param {object} ctx 见 cli-args.js 的 parseCliArgs()
 * @returns {Promise<void>} 升级、强化叠加与备份保留处理完成后返回
 */
export async function update(ctx) {
  const dryRun = ctx.passthrough.includes("--dry-run");
  if (!dryRun && ctx.trellisControlMode !== "materialized" && ctx.trellisControlMode !== "restoring") {
    return runWithTrellisIntegrationEnabled(ctx.target, ({ extendSnapshot }) => update({
      ...ctx,
      trellisControlMode: "materialized",
      trellisControlExtendSnapshot: extendSnapshot,
    }));
  }
  const { target } = ctx;
  const quiet = ctx.trellisControlQuiet === true;
  const output = quiet ? SILENT_OUTPUT : console;
  const backupRetention = normalizeUpdateBackupRetention(ctx.backupRetention);
  const currentTrellisVersion = selectVariant(target).version;
  const targetTrellisVersion = trellisVersion();
  const useUpdateSandbox = shouldUseUpdateSandbox({
    dryRun,
    enhanceOnly: ctx.enhanceOnly,
    currentVersion: currentTrellisVersion,
    targetVersion: targetTrellisVersion,
  });
  const shouldManageBackups = !ctx.enhanceOnly && backupRetention > 0;
  const backupSnapshot = shouldManageBackups
    ? snapshotUpdateBackups(target)
    : null;
  const configSnapshot = captureConfigPreserveSnapshot(target);
  let compensationSnapshot = null;
  let compensationRecovered = false;
  let updateSucceeded = false;

  if (!quiet) printBanner(getDeveloper(ctx.passthrough, target));

  // 主操作前尽力而为地检测 flower-trellis 自身新版本(失败静默;用户确认升级成功会直接退出)
  await checkForUpdate(ctx, "update");

  output.log("\n同步全局 Trellis:");
  syncGlobalTrellis({ logger: output, stdio: quiet ? "ignore" : "inherit" });

  try {
    compensationSnapshot = !dryRun && !ctx.enhanceOnly
      ? createUpdateSnapshot(target)
      : null;
    if (useUpdateSandbox) {
      await previewCrossVersionUpdate(ctx, currentTrellisVersion, targetTrellisVersion);
      updateSucceeded = true;
    } else if (!ctx.enhanceOnly) {
      const code = await runTrellisPty(
        ["update", ...trellisUpdatePassthroughArgs(ctx.passthrough)],
        target,
        { stripBanner: true, ...(quiet ? { stdout: SILENT_OUTPUT } : {}) },
      );
      if (code !== 0) {
        throw new Error(`trellis update 失败(退出码 ${code}),已中止,未重新叠加`);
      }
      await replayPlugins(ctx, target, dryRun, compensationSnapshot);
      updateSucceeded = true;
    } else {
      output.log("· --enhance-only:跳过 trellis update,仅重新叠加强化包");
      await replayPlugins(ctx, target, dryRun);
      updateSucceeded = true;
    }
  } catch (error) {
    if (compensationSnapshot) {
      const recovery = restoreUpdateSnapshot(compensationSnapshot);
      if (!recovery.ok) {
        output.error(`  ✗ Update 补偿恢复不完整;快照保留:${recovery.manifestPath}`);
        for (const failure of recovery.failedPaths) {
          output.error(`    · ${failure.path}:${failure.error}`);
        }
        throw createUpdateCompensationError(error, recovery);
      }
      output.error(
        `  ✓ Update 已补偿恢复:${recovery.restored.length} 项;移除新增 ${recovery.removed.length} 项;` +
        `Trellis .backup-* 已保留`,
      );
      compensationRecovered = true;
    }
    throw error;
  } finally {
    if (updateSucceeded && !dryRun && !ctx.enhanceOnly) {
      const restored = restoreConfigPreserveSnapshot(target, configSnapshot);
      if (restored.restored) {
        output.log(`  ✓ config.yaml 已保留本地配置: ${restored.keys.join(", ")}`);
      }
    }
    if (compensationSnapshot && (updateSucceeded || compensationRecovered)) {
      disposeUpdateSnapshot(compensationSnapshot);
    }
  }

  if (shouldManageBackups) {
    const backupResult = pruneUpdateBackups(target, {
      retention: backupRetention,
      beforeSnapshot: backupSnapshot,
      dryRun,
    });
    printBackupRetentionResult(backupResult, output);
  } else if (!ctx.enhanceOnly && backupRetention === 0) {
    output.log("  · --backup-retention 0:保留全部升级备份");
  }

  const telemetryPromise = dryRun
    ? null
    : reportTelemetry(target, "update_completed", { force: true });
  await showCommandCompletion("update", target, {
    passthrough: ctx.passthrough,
    outcome: dryRun ? "preview" : "success",
    output,
  });
  await telemetryPromise;
}
