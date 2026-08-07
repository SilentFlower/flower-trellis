import {
  createUpdateSnapshot,
  disposeUpdateSnapshot,
  extendUpdateSnapshot,
  restoreUpdateSnapshot,
} from "../lib/update-transaction.js";
import {
  disableTrellis,
  finalizeTrellisEnable,
  inspectTrellisControl,
  markTrellisRepairRequired,
  materializeTrellis,
} from "../lib/trellis-control.js";
import {
  TRELLIS_CONTROL_ERROR_CODES,
  TrellisControlError,
} from "../lib/trellis-control-errors.js";

const CONFLICT_CODES = new Set([
  TRELLIS_CONTROL_ERROR_CODES.CONFLICT,
  TRELLIS_CONTROL_ERROR_CODES.STATE_CORRUPT,
  TRELLIS_CONTROL_ERROR_CODES.REPAIR_REQUIRED,
]);

/**
 * 解析 Trellis 项目级控制子命令。
 *
 * 顶层写法 `flower-trellis <status|enable|disable>` 与兼容别名
 * `flower-trellis trellis <子命令>` 在 cli.js 归一为同一份 argv 后进入这里。
 *
 * @param {string[]} argv 以控制子命令开头的参数
 * @returns {{command:"disable"|"enable"|"status",dryRun:boolean,force:boolean,json:boolean,help:boolean}} 解析结果
 */
export function parseTrellisControlArgs(argv) {
  const rootHelp = argv[0] === "--help" || argv[0] === "-h";
  const command = rootHelp ? "status" : (argv[0] || "status");
  if (!["disable", "enable", "status"].includes(command)) {
    throw new TrellisControlError(`未知 Trellis 控制命令:${command}`, {
      code: TRELLIS_CONTROL_ERROR_CODES.USAGE_ERROR,
      path: command,
    });
  }
  let dryRun = false;
  let force = false;
  let json = false;
  let help = rootHelp;
  for (const token of argv.slice(1)) {
    if (token === "--dry-run") dryRun = true;
    else if (token === "--force") force = true;
    else if (token === "--json") json = true;
    else if (token === "--help" || token === "-h") help = true;
    else {
      throw new TrellisControlError(`未知 Trellis 控制参数:${token}`, {
        code: TRELLIS_CONTROL_ERROR_CODES.USAGE_ERROR,
        path: token,
      });
    }
  }
  if (command === "status" && (dryRun || force)) {
    throw new TrellisControlError("status 不支持 --dry-run 或 --force", {
      code: TRELLIS_CONTROL_ERROR_CODES.USAGE_ERROR,
      path: command,
    });
  }
  return { command, dryRun, force, json, help };
}

function printHelp(output) {
  output.log(`用法:
  flower-trellis disable [--dry-run] [--force] [--target <dir>] [--json]
  flower-trellis enable  [--dry-run] [--force] [--target <dir>] [--json]
  flower-trellis status  [--target <dir>] [--json]

开关始终作用于整个项目和全部已配置平台；操作完成后需要重启 AI 会话。`);
  output.log("--force 仅处理恢复证据完整时的目标冲突；repair-required 必须先修复证据。");
  output.log("旧写法 flower-trellis trellis <status|enable|disable> 继续等价保留。");
}

function printStatus(result, output) {
  output.log(`Trellis 状态:${result.status}`);
  output.log(`  · 平台:${result.configuredPlatforms.join(", ") || "无"}`);
  if (result.manifestPath) output.log(`  · 恢复材料:${result.manifestPath}`);
  if (result.driftedPaths.length > 0) {
    output.log(`  · 漂移入口:${result.driftedPaths.length} 项`);
    for (const entry of result.driftedPaths) output.log(`    - ${entry}`);
  }
  if (result.reason) output.log(`  · 说明:${result.reason}`);
  output.log(`  · 重启 AI 会话:${result.restartRequired ? "需要" : "不需要"}`);
}

function printMutationResult(command, result, output) {
  const action = result.status === "dry-run" ? "预览" : result.status === "unchanged" ? "无变化" : "完成";
  output.log(`Trellis ${command} ${action}，入口变化 ${result.changed.length} 项`);
  for (const entry of result.changed) output.log(`  ${command === "disable" ? "detach" : "restore"} ${entry}`);
  if (result.manifestPath) output.log(`  · 恢复材料:${result.manifestPath}`);
  for (const warning of result.warnings || []) output.log(`  · 警告:${warning}`);
  if (result.status !== "dry-run") output.log("  · 请重启 AI 会话使开关完全生效");
}

async function enableWithNormalization(ctx, parsed) {
  const status = inspectTrellisControl(ctx.target);
  if (status.status === "enabled") {
    return { status: "unchanged", changed: [], manifestPath: null, warnings: [] };
  }
  if (parsed.dryRun) {
    return materializeTrellis(ctx.target, { dryRun: true, force: parsed.force });
  }
  const snapshot = createUpdateSnapshot(ctx.target);
  try {
    const materialized = materializeTrellis(ctx.target, { force: parsed.force });
    const { update } = await import("./update.js");
    await update({
      ...ctx,
      enhance: true,
      enhanceOnly: false,
      updateCheck: false,
      backupRetention: 0,
      passthrough: ["--yes", "--force"],
      trellisControlMode: "restoring",
      trellisControlQuiet: parsed.json,
      trellisControlExtendSnapshot: (targets) => extendUpdateSnapshot(snapshot, targets),
    });
    const finalized = finalizeTrellisEnable(ctx.target);
    disposeUpdateSnapshot(snapshot);
    return {
      status: "enabled",
      changed: materialized.changed,
      manifestPath: null,
      warnings: [...materialized.warnings, ...finalized.warnings],
    };
  } catch (error) {
    const recovery = restoreUpdateSnapshot(snapshot);
    if (recovery.ok) {
      disposeUpdateSnapshot(snapshot);
      throw error;
    }
    const controlStateMarked = markTrellisRepairRequired(ctx.target);
    throw new TrellisControlError(
      `Trellis enable 规范化失败且 disabled 现场恢复不完整:${recovery.manifestPath}`,
      {
        code: TRELLIS_CONTROL_ERROR_CODES.REPAIR_REQUIRED,
        path: recovery.manifestPath,
        cause: error,
        details: { ...recovery, controlStateMarked },
      },
    );
  }
}

function exitCode(error) {
  if (error?.code === TRELLIS_CONTROL_ERROR_CODES.USAGE_ERROR) return 2;
  if (CONFLICT_CODES.has(error?.code)) return 3;
  return 1;
}

/**
 * 执行 Trellis 项目级关闭、恢复或状态检查。
 *
 * @param {object} ctx cli-args.js 的执行上下文
 * @param {{output?:{log:(message:string)=>void,error:(message:string)=>void}}} [options] 测试输出注入
 * @returns {Promise<0|1|2|3>} 进程退出码
 */
export async function trellis(ctx, options = {}) {
  const output = options.output || console;
  let parsed;
  try {
    parsed = parseTrellisControlArgs(ctx.passthrough || []);
    if (parsed.help) {
      printHelp(output);
      return 0;
    }
    if (parsed.command === "status") {
      const result = inspectTrellisControl(ctx.target);
      if (parsed.json) output.log(JSON.stringify(result, null, 2));
      else printStatus(result, output);
      return result.status === "repair-required" ? 3 : 0;
    }
    const result = parsed.command === "disable"
      ? disableTrellis(ctx.target, { dryRun: parsed.dryRun, force: parsed.force })
      : await enableWithNormalization(ctx, parsed);
    if (parsed.json) output.log(JSON.stringify(result, null, 2));
    else printMutationResult(parsed.command, result, output);
    return 0;
  } catch (error) {
    if (parsed?.json || ctx.passthrough?.includes("--json")) {
      output.log(JSON.stringify({
        ok: false,
        command: parsed?.command || "trellis",
        diagnostics: [{
          code: error.code || "TRELLIS_CONTROL_UNEXPECTED_ERROR",
          path: error.path || "",
          message: error.message,
          severity: "error",
        }],
      }, null, 2));
    } else {
      output.error(`❌ ${error.message}`);
    }
    return exitCode(error);
  }
}
