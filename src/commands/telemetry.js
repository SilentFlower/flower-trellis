import { readTelemetryState, setTelemetryEnabled } from "../lib/telemetry.js";
import { hasHelpFlag } from "../lib/cli-args.js";

/** 打印 telemetry 命令帮助。 */
function printTelemetryHelp() {
  console.log(`flower-trellis telemetry — 管理匿名安装遥测

用法:
  flower-trellis telemetry status
  flower-trellis telemetry enable
  flower-trellis telemetry disable

status 只读取用户级状态；enable/disable 会更新用户级遥测开关。
环境变量 FLOWER_NO_TELEMETRY=1 可临时停用上报。`);
}

/**
 * 格式化可空时间。
 *
 * @param {string|null} value ISO 时间
 * @returns {string} 展示文本
 */
function formatTime(value) {
  return value || "从未";
}

/**
 * 显示当前遥测状态。
 *
 * @param {NodeJS.ProcessEnv} env 环境变量
 * @returns {void}
 */
function printStatus(env) {
  const result = readTelemetryState({ env });
  if (result.status === "corrupt") {
    console.log("Flower Telemetry:状态文件损坏");
    console.log(`  路径:${result.path}`);
    console.log("  可执行 flower-trellis telemetry enable 重建状态");
    return;
  }
  const state = result.state;
  const enabled = state?.enabled !== false;
  console.log(`Flower Telemetry:${enabled ? "已启用" : "已停用"}`);
  console.log(`  环境变量临时停用:${env.FLOWER_NO_TELEMETRY ? "是" : "否"}`);
  console.log(`  设备 ID:${state?.deviceId || "首次上报时生成"}`);
  console.log(`  开发者名称:${state?.developerName || "首次有效上报时识别"}`);
  console.log(`  最近尝试:${formatTime(state?.lastAttemptAt || null)}`);
  console.log(`  最近成功:${formatTime(state?.lastSuccessAt || null)}`);
}

/**
 * flower-trellis telemetry:查询或修改用户级匿名遥测开关。
 *
 * @param {object} ctx 见 cli-args.js 的 parseCliArgs()
 * @returns {Promise<void>} 命令执行完成后返回
 */
export async function telemetry(ctx) {
  if (hasHelpFlag(ctx.passthrough)) {
    printTelemetryHelp();
    return;
  }
  const action = ctx.passthrough[0] || "status";
  if (action === "status") {
    printStatus(process.env);
    return;
  }
  if (action === "enable" || action === "disable") {
    const enabled = action === "enable";
    const state = setTelemetryEnabled(enabled);
    console.log(`Flower Telemetry:${enabled ? "已启用" : "已停用"}`);
    console.log(`  设备 ID:${state.deviceId}`);
    console.log(`  开发者名称:${state.developerName || "首次有效上报时识别"}`);
    return;
  }
  throw new Error("用法:flower-trellis telemetry <status|enable|disable>");
}
