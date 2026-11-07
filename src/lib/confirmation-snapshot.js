import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, execFileSync } from "node:child_process";
import { ENHANCEMENTS_ROOT } from "./paths.js";
import { resolveTrellisPythonCommand, trellisPythonInvocation } from "./trellis-python-command.js";
import { parseConfirmationDescriptor } from "./confirmation-ipc.js";
import { CONFIRMATION_SESSION_ENV } from "../constants.js";

/**
 * 解析项目实际Python并验证最低版本，保留显式路径和launcher前置参数。
 * @param {string} root 项目根目录。
 * @param {object} options 当前环境及可替换的执行器。
 * @returns {string} 经过实际探测的解释器路径。
 */
export function resolveConfirmationPython(root, { env = process.env, execute = execFileSync } = {}) {
  const override = env.FLOWER_TEST_PYTHON || env.PYTHON;
  const command = override || resolveTrellisPythonCommand(root, { env }).command;
  const invocation = fs.existsSync(command) ? { executable: command, args: [] } : trellisPythonInvocation(command);
  try {
    return execute(invocation.executable, [...invocation.args, "-X", "utf8", "-c",
      "import sys; assert sys.version_info >= (3, 8); print(sys.executable)"],
    { env, encoding: "utf8", timeout: 10000, windowsHide: true }).trim();
  } catch { throw new Error("统一确认入口需要可运行的Python 3.8+，请检查项目Python配置"); }
}

/**
 * 只运行随Flower发布的快照检查器，不执行模型提供的代码。
 * @param {string} root 项目根目录。
 * @param {object} options 已验证解释器、环境与可替换的检查脚本。
 * @returns {Function} 状态机可调用的材料复核函数。
 */
export function createConfirmationSnapshot(root, { python, env = process.env,
  helper = path.join(ENHANCEMENTS_ROOT, "0.6/scripts/confirmation.py") } = {}) {
  const executable = python || resolveConfirmationPython(root, { env });
  const guard = fileURLToPath(new URL("../assets/confirmation_process.py", import.meta.url));
  const client = path.join(ENHANCEMENTS_ROOT, "0.6/scripts/confirmation.py");
  return (spec, owner, session) => new Promise((resolve, reject) => {
    const descriptor = parseConfirmationDescriptor(session);
    if (descriptor.owner_pid !== process.pid || descriptor.root !== fs.realpathSync.native(root)) {
      throw new Error("材料检查未绑定当前前台入口，保持人工确认");
    }
    // 材料复核不能阻塞前台事件循环，否则复核期间到达的输入来不及撤销许可。
    // 与CLI复用进程约束；独立Linux进程组只包含本次检查，超时和入口死亡都结束整树。
    const child = execFile(executable, ["-X", "utf8", guard, client, "--inspect", executable,
      "-X", "utf8", helper, "inspect", "--root", root, "--owner", owner],
    { cwd: root, env: { ...env, [CONFIRMATION_SESSION_ENV]: JSON.stringify(descriptor) },
      encoding: "utf8", timeout: 10000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => {
        let result;
        try { result = JSON.parse(stdout); } catch { /* 不回显外部堆栈或材料正文。 */ }
        if (error || !result || result.error) reject(new Error(result?.error || "无法核验确认材料，保持人工确认"));
        else resolve(result);
      });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(spec));
  });
}
