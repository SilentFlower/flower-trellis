import { runTrellisPty } from "../lib/trellis-runner.js";
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
import { SKILL_GARDEN_PLUGIN_ID } from "../builtin-plugins/skill-garden/provider.js";

function printBackupRetentionResult(result) {
  if (result.status === "preview") {
    console.log("\n升级备份清理预览:");
    console.log(
      `  · 保留策略:${result.retention} 份;预计保留 ${result.retained.length} 份;预计删除 ${result.removable.length} 份`,
    );
    for (const name of result.removable) {
      console.log(`  · 将删除 .trellis/${name}`);
    }
  } else if (result.status === "completed" && result.removed.length > 0) {
    console.log(`  ✓ 已清理 ${result.removed.length} 份旧升级备份，保留策略:${result.retention} 份`);
  }

  if (result.protected.length > result.retention) {
    console.log(`  · 本轮新建备份受保护，当前临时保留 ${result.protected.length} 份`);
  }
  for (const warning of result.warnings) {
    console.log(`  · 升级备份清理警告:${warning}`);
  }
}

/**
 * flower-trellis update:驱动 `trellis update`,随后按(可能已升级的)版本重新叠加强化包。
 *
 * 打印 flower 品牌头部;trellis update 在伪终端(pty)里运行,保留其冲突处理等交互,
 * 同时过滤掉它重复打印的启动 banner / Developer。
 * `--dry-run` 时只让 trellis 预览,叠加阶段跳过。
 *
 * @param {object} ctx 见 cli-args.js 的 parseCliArgs()
 * @returns {Promise<void>} 升级、强化叠加与备份保留处理完成后返回
 */
export async function update(ctx) {
  const { target } = ctx;
  const backupRetention = normalizeUpdateBackupRetention(ctx.backupRetention);
  const dryRun = ctx.passthrough.includes("--dry-run");
  const shouldManageBackups = !ctx.enhanceOnly && backupRetention > 0;
  const backupSnapshot = shouldManageBackups
    ? snapshotUpdateBackups(target)
    : null;
  const configSnapshot = captureConfigPreserveSnapshot(target);
  let shouldRestoreConfig = false;

  printBanner(getDeveloper(ctx.passthrough, target));

  // 主操作前尽力而为地检测 flower-trellis 自身新版本(失败静默;用户确认升级成功会直接退出)
  await checkForUpdate(ctx, "update");

  console.log("\n同步全局 Trellis:");
  syncGlobalTrellis();

  try {
    if (!ctx.enhanceOnly) {
      const code = await runTrellisPty(["update", ...ctx.passthrough], target, {
        stripBanner: true,
      });
      if (code !== 0) {
        throw new Error(`trellis update 失败(退出码 ${code}),已中止,未重新叠加`);
      }
      shouldRestoreConfig = true;
    } else {
      shouldRestoreConfig = true;
      console.log("· --enhance-only:跳过 trellis update,仅重新叠加强化包");
    }

    if (ctx.enhance) {
      const declared = new ProjectStore(target).readPlugins().plugins
        .some(({ id }) => id === SKILL_GARDEN_PLUGIN_ID);
      const code = await plugin({
        ...ctx,
        passthrough: [
          declared ? "update" : "add",
          SKILL_GARDEN_PLUGIN_ID,
          ...(dryRun ? ["--dry-run"] : []),
        ],
      }, {
        skillGarden: { variant: ctx.variant, skills: ctx.skills },
      });
      if (code !== 0) throw new Error(`Plugin Runtime 重放失败(退出码 ${code})`);
    } else {
      console.log("· --no-enhance:跳过强化包叠加");
      const preserveSkillGarden = new ProjectStore(target).readLock()?.plugins
        .some(({ id }) => id === SKILL_GARDEN_PLUGIN_ID) === true;
      const code = await plugin({
        ...ctx,
        passthrough: ["replay", ...(dryRun ? ["--dry-run"] : [])],
      }, {
        skillGarden: { preserve: preserveSkillGarden },
        preserveIds: preserveSkillGarden ? [SKILL_GARDEN_PLUGIN_ID] : [],
      });
      if (code !== 0) throw new Error(`外部 Plugin 重放失败(退出码 ${code})`);
    }
  } finally {
    if (shouldRestoreConfig) {
      const restored = restoreConfigPreserveSnapshot(target, configSnapshot);
      if (restored.restored) {
        console.log(`  ✓ config.yaml 已保留本地配置: ${restored.keys.join(", ")}`);
      }
    }
  }

  if (shouldManageBackups) {
    const backupResult = pruneUpdateBackups(target, {
      retention: backupRetention,
      beforeSnapshot: backupSnapshot,
      dryRun,
    });
    printBackupRetentionResult(backupResult);
  } else if (!ctx.enhanceOnly && backupRetention === 0) {
    console.log("  · --backup-retention 0:保留全部升级备份");
  }

  console.log(`\n🌸 flower-trellis update 完成 → ${target}`);
}
