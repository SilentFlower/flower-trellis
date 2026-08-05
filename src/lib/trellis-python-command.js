import fs from "node:fs";
import path from "node:path";

const TARGET_EVIDENCE_FILES = Object.freeze([
  ".codex/hooks.json",
  ".claude/settings.json",
  ".trellis/workflow.md",
]);
const GENERATED_COMMAND_RE = /(?:^|[\s`"'([{])(py -3|python3|python)(?=\s+(?:-X\s+utf8\s+)?(?:\.\/)?(?:\.trellis\/scripts|\.codex\/hooks|\.claude\/hooks)\/)/m;

/**
 * 校验可用于 Trellis 文本物化的 Python 命令。
 *
 * @param {unknown} value 待校验命令
 * @param {string} label 错误字段说明
 * @returns {string} 去除首尾空白后的命令
 */
function normalizePythonCommand(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} 必须是非空字符串`);
  }
  const command = value.trim();
  if (command.includes("\0") || /[\r\n]/.test(command)) {
    throw new Error(`${label} 不能包含换行或 NUL`);
  }
  return command;
}

/**
 * 从 Trellis 已生成文件中识别实际使用的 Python 命令。
 *
 * @param {string} targetRoot 目标项目根目录
 * @returns {{command:string,source:string}|null} 命令及证据来源；没有证据时返回 null
 */
function resolveGeneratedCommand(targetRoot) {
  for (const relative of TARGET_EVIDENCE_FILES) {
    const file = path.join(targetRoot, ...relative.split("/"));
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
    let value;
    try {
      value = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const match = value.match(GENERATED_COMMAND_RE);
    if (match) return { command: match[1], source: relative };
  }
  return null;
}

/**
 * 解析目标 Trellis 项目实际使用的 Python 命令。
 *
 * 已生成目标文件是最高优先级证据；仅在目标中没有证据时才读取环境变量和平台回退。
 *
 * @param {string} target 目标 Trellis 项目根目录
 * @param {{env?:Record<string,string|undefined>,platform?:string,generatedEvidence?:boolean}} [options] 环境、平台与目标证据开关
 * @returns {{command:string,source:string}} 命令及解析来源
 */
export function resolveTrellisPythonCommand(target, options = {}) {
  const targetRoot = path.resolve(target);
  const generated = options.generatedEvidence === false ? null : resolveGeneratedCommand(targetRoot);
  if (generated) return generated;

  const env = options.env || process.env;
  if (env.TRELLIS_PYTHON_CMD !== undefined) {
    return {
      command: normalizePythonCommand(env.TRELLIS_PYTHON_CMD, "TRELLIS_PYTHON_CMD"),
      source: "env:TRELLIS_PYTHON_CMD",
    };
  }

  const platform = options.platform || process.platform;
  return {
    command: platform === "win32" ? "python" : "python3",
    source: `platform:${platform}`,
  };
}

/**
 * 按 Trellis 模板渲染规则物化文本中的 canonical `python3` 命令。
 *
 * @param {string} value canonical Trellis 文本
 * @param {string} command 目标项目 Python 命令
 * @returns {string} 已物化文本
 */
export function materializeTrellisPythonText(value, command) {
  if (typeof value !== "string") throw new Error("Trellis Python 文本必须是字符串");
  const normalizedCommand = normalizePythonCommand(command, "Trellis Python 命令");
  if (normalizedCommand === "python3") return value;
  return value
    .split("\n")
    .map((line) => line.startsWith("#!") ? line : line.replaceAll("python3", normalizedCommand))
    .join("\n");
}

/**
 * 将已解析的 Python 命令拆成无 shell 的可执行文件与前置参数。
 *
 * @param {string} command Trellis Python 命令
 * @returns {{executable:string,args:string[]}} 可直接传给 child_process 的调用信息
 */
export function trellisPythonInvocation(command) {
  const normalized = normalizePythonCommand(command, "Trellis Python 命令");
  const tokens = normalized.match(/"[^"]*"|'[^']*'|\S+/g)?.map((token) => {
    if ((token.startsWith("\"") && token.endsWith("\"")) ||
        (token.startsWith("'") && token.endsWith("'"))) {
      return token.slice(1, -1);
    }
    return token;
  });
  if (!tokens?.length || tokens.some((token) => !token)) {
    throw new Error("Trellis Python 命令无法解析");
  }
  return { executable: tokens[0], args: tokens.slice(1) };
}
