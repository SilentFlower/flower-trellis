import { select } from "@inquirer/prompts";
import { scheduleWindowsTerminalExit } from "./terminal-state.js";

const SUCCESS_LABELS = {
  init: "安装成功",
  update: "更新成功",
};

const OUTCOME_LABELS = {
  preview: "预览完成",
};

/**
 * 输出命令成功状态，并在交互终端提供明确的退出入口。
 *
 * `-y` 与非 TTY 场景只打印成功行，避免 CI、脚本和管道被完成提示阻塞。
 *
 * @param {"init"|"update"} command 命令名
 * @param {string} target 目标项目根目录
 * @param {{passthrough?:string[],interactive?:boolean,outcome?:"success"|"preview",selectPrompt?:Function,output?:{log:(message:string)=>void},terminalExit?:object}} [options] 交互、结果类型与测试注入
 * @returns {Promise<void>} 成功状态输出及可选退出确认完成后返回
 */
export async function showCommandCompletion(command, target, options = {}) {
  const output = options.output || console;
  const outcome = options.outcome || "success";
  const completionLabel = OUTCOME_LABELS[outcome]
    || SUCCESS_LABELS[command]
    || "执行成功";
  output.log(`\n🌸 flower-trellis ${command} ${completionLabel} → ${target}`);

  const passthrough = options.passthrough || [];
  const yes = passthrough.includes("-y") || passthrough.includes("--yes");
  const interactive = options.interactive ?? Boolean(
    !yes && process.stdin.isTTY && process.stdout.isTTY,
  );
  if (!interactive) return;

  const selectPrompt = options.selectPrompt || select;
  const action = await selectPrompt({
    message: "操作已完成",
    choices: [{ name: "退出", value: "exit" }],
    loop: false,
  });
  if (action === "exit") scheduleWindowsTerminalExit(options.terminalExit);
}
