import {
  PLUGIN_RUNTIME_ERROR_CODES,
  PluginRuntimeError,
} from "../runtime-errors.js";

/**
 * 读取必须带值的 CLI flag。
 *
 * @param {string[]} argv 参数
 * @param {number} index 当前索引
 * @returns {string} flag 值
 */
function flagValue(argv, index) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new PluginRuntimeError(`${argv[index]} 缺少取值`, {
    code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
    path: argv[index],
  });
  return value;
}

/**
 * 解析 plugin init / validate 作者命令。
 *
 * @param {string[]} argv `plugin` 后的参数
 * @returns {object|null} 作者命令或 null
 */
export function parsePluginAuthoringArgs(argv) {
  const command = argv[0];
  if (!new Set(["init", "validate"]).has(command)) return null;
  const values = {};
  const positional = [];
  const valueFlags = new Map([
    ["--id", "id"], ["--name", "name"], ["--version", "version"],
    ["--profile", "profile"], ["--project", "project"], ["--subdir", "subdir"],
    ["--ref", "ref"], ["--commit", "commit"], ["--subject", "subject"],
    ["--source-id", "sourceId"], ["--checkout-map", "checkoutMap"],
  ]);
  let json = false;
  let help = false;
  let force = false;
  let includePatches = false;
  let includeMarketplace = false;
  let nonInteractive = false;
  let ci = false;
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (valueFlags.has(token)) {
      values[valueFlags.get(token)] = flagValue(argv, index);
      index += 1;
    } else if (token === "--json") json = true;
    else if (token === "--help" || token === "-h") help = true;
    else if (token === "--force") force = true;
    else if (token === "--patches") includePatches = true;
    else if (token === "--marketplace") includeMarketplace = true;
    else if (token === "--non-interactive" || token === "--yes" || token === "-y") nonInteractive = true;
    else if (token === "--ci") ci = true;
    else if (token.startsWith("-")) throw new PluginRuntimeError(`未知 Plugin 参数:${token}`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
      path: token,
    });
    else positional.push(token);
  }
  if (command === "init" && positional.length > 0) throw new PluginRuntimeError("plugin init 不接受位置参数", {
    code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
    path: command,
  });
  if (command === "validate" && positional.length > 1) throw new PluginRuntimeError("plugin validate 最多接受一个路径", {
    code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
    path: command,
  });
  if (command === "validate" && !new Set([undefined, "plugin", "entry", "marketplace"]).has(values.subject)) {
    throw new PluginRuntimeError(`--subject 无效:${values.subject}`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
      path: "--subject",
    });
  }
  return {
    command,
    ...values,
    targetPath: positional[0] || (command === "init" ? null : ".flower-plugin"),
    json,
    help,
    force,
    includePatches,
    includeMarketplace,
    nonInteractive,
    ci,
  };
}
