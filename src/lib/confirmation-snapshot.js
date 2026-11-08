import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { ENHANCEMENTS_ROOT } from "./paths.js";
import { confirmationDirectory, readConfirmationFile } from "./confirmation-files.js";
import { resolveTrellisPythonCommand, trellisPythonInvocation } from "./trellis-python-command.js";

const HELPER = path.join(ENHANCEMENTS_ROOT, "0.6/scripts/confirmation.py");

/**
 * 解析项目实际使用的解释器，保留显式路径和 launcher 前置参数。
 * @param {string} root 项目根。
 * @param {object} env 当前环境。
 * @returns {object} 可执行文件和固定前置参数。
 */
export function resolveConfirmationPython(root, env = process.env) {
  const command = env.FLOWER_TEST_PYTHON || env.PYTHON || resolveTrellisPythonCommand(root, { env }).command;
  return fs.existsSync(command) ? { executable: command, args: [] } : trellisPythonInvocation(command);
}

/**
 * 读取当前项目的确认开关；策略仍由同一份 Python 协议解析。
 * @param {string} root 项目根。
 * @param {object} python 解释器启动参数。
 * @param {AbortSignal} signal 原窗口中断信号。
 * @returns {Promise<object>} 不含会话信息的策略。
 */
export function readConfirmationPolicy(root, python, signal) {
  return runHelper(root, python, HELPER, "policy", [], "", process.env, signal);
}

/**
 * 只运行随 Flower 发布的快照检查器，材料复核不阻塞原窗口监听。
 * @param {string} root 项目根。
 * @param {object} options 解释器、环境与可替换的检查脚本。
 * @returns {Function} 状态机可调用的材料复核函数。
 */
export function createConfirmationSnapshot(root, { python, env = process.env, helper = HELPER } = {}) {
  const invocation = python || resolveConfirmationPython(root, env);
  return (spec, owner, signal) => runHelper(root, invocation, helper, "inspect", ["--owner", owner],
    JSON.stringify(spec), env, signal);
}

/** 将完整正文冻结在项目运行目录；@param {string} root 项目根；@param {object} python 解释器；@param {string} body 完整正文；@param {AbortSignal} signal 原窗口中断信号；@returns {Promise<object>} 正文相对路径。 */
export function materializeConfirmation(root, python, body, signal) {
  return runHelper(root, python, HELPER, "materialize", [], body, process.env, signal);
}

async function runHelper(root, python, helper, command, args, input, env, signal) {
  const dir = fs.mkdtempSync(path.join(confirmationDirectory(root, "python"), "run-"));
  const inputFile = path.join(dir, "input");
  const outputFile = path.join(dir, "output");
  let inputFd, outputFd;
  try {
    fs.writeFileSync(inputFile, input, { flag: "wx", mode: 0o600 });
    inputFd = fs.openSync(inputFile, "r");
    outputFd = fs.openSync(outputFile, "wx", 0o600);
    // 普通 Codex 沙箱拒绝 libuv 为管道创建 socketpair；普通文件描述符仍在项目写入范围内。
    const code = await new Promise((resolve, reject) => {
      let failed;
      const child = spawn(python.executable, [...python.args, "-X", "utf8", helper, command, "--root", root, ...args],
        { cwd: root, env: { ...env, GIT_OPTIONAL_LOCKS: "0" }, stdio: [inputFd, outputFd, "ignore"],
          signal, timeout: 10000, windowsHide: true });
      child.once("error", error => { failed = error; });
      child.once("close", code => { if (failed) reject(failed); else resolve(code); });
    });
    let result;
    try { result = JSON.parse(readConfirmationFile(outputFile, 16 * 1024 * 1024)); }
    catch { /* 不回显解释器输出或材料正文。 */ }
    if (code !== 0 || !result || result.error) {
      throw new Error(result?.error || "无法核验确认材料或项目 Python 配置，保持人工确认");
    }
    return result;
  } finally {
    if (inputFd !== undefined) fs.closeSync(inputFd);
    if (outputFd !== undefined) fs.closeSync(outputFd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
