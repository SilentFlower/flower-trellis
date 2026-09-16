import fs from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { trellisPythonInvocation } from "../src/lib/trellis-python-command.js";

let cachedExecutable;

/**
 * 探测开发验证进程的 Python，排除 WindowsApps 占位入口。
 * @param {object} options 环境、平台及可替换的探测器
 * @returns {string} Python 3.8 以上解释器的绝对路径
 */
export function resolvePythonExecutable({ env = process.env, platform = process.platform, probe = spawnSync } = {}) {
  const override = env.FLOWER_TEST_PYTHON || env.PYTHON;
  const candidates = override ? [override] : platform === "win32" ? ["python", "py -3", "python3"] : ["python3", "python"];
  for (const command of candidates) {
    // 显式可执行文件路径可能含空格；只有命令形式才需要拆分前置参数。
    const invocation = fs.existsSync(command) ? { executable: command, args: [] } : trellisPythonInvocation(command);
    const result = probe(invocation.executable, [...invocation.args, "-X", "utf8", "-c", "import sys; assert sys.version_info >= (3, 8); print(sys.executable)"], {
      env, encoding: "utf8", timeout: 10000, windowsHide: true,
    });
    if (!result.error && result.status === 0 && result.stdout?.trim()) return result.stdout.trim();
  }
  throw new Error(`未找到可运行的 Python 3.8+：${candidates.join(", ")}；可设置 FLOWER_TEST_PYTHON 指定解释器`);
}

/**
 * 使用已探测解释器执行 UTF-8 Python 命令并返回输出。
 * @param {string[]} args Python 参数
 * @param {object} options 子进程选项
 * @returns {string|Buffer} 子进程输出
 */
export function execPythonSync(args, options = {}) {
  cachedExecutable ??= resolvePythonExecutable();
  return execFileSync(cachedExecutable, ["-X", "utf8", ...args], options);
}

/**
 * 使用已探测解释器运行 UTF-8 Python 并保留退出状态。
 * @param {string[]} args Python 参数
 * @param {object} options 子进程选项
 * @returns {object} 子进程结果
 */
export function spawnPythonSync(args, options = {}) {
  cachedExecutable ??= resolvePythonExecutable();
  return spawnSync(cachedExecutable, ["-X", "utf8", ...args], options);
}
