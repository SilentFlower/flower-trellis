import fs from "node:fs";
import path from "node:path";
import { PLUGIN_ERROR_CODES, PluginError } from "../plugin/errors.js";
import { PluginApplicationService } from "../plugin/application-service.js";
import { stringifyCanonicalJson } from "../plugin/integrity/canonical-json.js";
import { parsePluginAuthoringArgs } from "../plugin/authoring/args.js";
import {
  PLUGIN_RUNTIME_ERROR_CODES,
  PluginRuntimeError,
} from "../plugin/runtime-errors.js";
import { isSemVerRange, parseCanonicalPluginId } from "../plugin/schemas/shared.js";
import { ProjectStore } from "../plugin/state/project-store.js";
import { LocalSourceProvider } from "../plugin/sources/local-provider.js";
import { SourceRegistry } from "../plugin/sources/source-registry.js";
import { compareUtf8 } from "../plugin/stable-order.js";
import {
  SKILL_GARDEN_PLUGIN_ID,
  SkillGardenBuiltinProvider,
} from "../builtin-plugins/skill-garden/provider.js";

const REMOTE_PLUGIN_ENTRY = new URL("./plugin-remote.js", import.meta.url);
const PATCH_RUNTIME_ENTRY = new URL("../plugin/install/patch-planner.js", import.meta.url);
const CAPABILITY_APPROVAL_REQUIRED = "PLUGIN_CAPABILITY_APPROVAL_REQUIRED";
let remotePluginRuntimePromise = null;

const PLUGIN_CONFLICT_CODES = new Set([
  PLUGIN_ERROR_CODES.SCHEMA_INVALID,
  PLUGIN_ERROR_CODES.UNSAFE_PATH,
  PLUGIN_ERROR_CODES.INTEGRITY_MISMATCH,
  PLUGIN_RUNTIME_ERROR_CODES.SOURCE_NOT_FOUND,
  PLUGIN_RUNTIME_ERROR_CODES.SOURCE_AMBIGUOUS,
  PLUGIN_RUNTIME_ERROR_CODES.FORMAT_UNRECOGNIZED,
  PLUGIN_RUNTIME_ERROR_CODES.FORMAT_UNSUPPORTED,
  PLUGIN_RUNTIME_ERROR_CODES.EXTERNAL_VERSION_REUSED,
  PLUGIN_RUNTIME_ERROR_CODES.DEPENDENCY_MISSING,
  PLUGIN_RUNTIME_ERROR_CODES.DEPENDENCY_CONFLICT,
  PLUGIN_RUNTIME_ERROR_CODES.DEPENDENCY_CYCLE,
  PLUGIN_RUNTIME_ERROR_CODES.CONTENT_CONFLICT,
  PLUGIN_RUNTIME_ERROR_CODES.TARGET_DRIFT,
  PLUGIN_RUNTIME_ERROR_CODES.VERIFY_FAILED,
  CAPABILITY_APPROVAL_REQUIRED,
]);

/**
 * 解析逗号或重复声明的平台列表。
 *
 * @param {string[]} values 原始值
 * @returns {string[]} 稳定平台列表
 */
function parsePlatforms(values) {
  return [...new Set(values.flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean))]
    .sort(compareUtf8);
}

/**
 * 解析可重复的 `--widen <plugin>=<range>` 取值。
 *
 * 取值形态固定为 `id=range`，按第一个 `=` 切分即可，`>=1.0.0` 这类含 `=` 的
 * range 落在右侧不受影响。
 *
 * @param {string[]} values 原始 `--widen` 取值
 * @returns {Record<string,string>} plugin ID 到版本约束的映射
 */
function parseWidenPairs(values) {
  const pairs = {};
  for (const value of values) {
    const separator = value.indexOf("=");
    const id = separator === -1 ? "" : value.slice(0, separator).trim();
    const range = separator === -1 ? "" : value.slice(separator + 1).trim();
    if (!id || !range) {
      throw new PluginRuntimeError(`--widen 取值必须是 <plugin>=<range>:${value}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
        path: value,
      });
    }
    if (!isSemVerRange(range)) {
      throw new PluginRuntimeError(`--widen 的版本约束不是合法 SemVer range:${value}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
        path: value,
      });
    }
    if (pairs[id]) {
      throw new PluginRuntimeError(`--widen 重复声明同一个 Plugin:${id}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
        path: id,
      });
    }
    pairs[id] = range;
  }
  return pairs;
}

/**
 * 解析 source、auth 与 search 管理命令。
 *
 * @param {string[]} argv `plugin` 后的参数
 * @returns {object|null} 管理命令参数或空值
 */
function parseManagementArgs(argv) {
  const group = argv[0];
  if (!fs.existsSync(REMOTE_PLUGIN_ENTRY)) return null;
  if (!["source", "auth", "search"].includes(group)) return null;
  const groupHelp = argv[1] === "--help" || argv[1] === "-h";
  if (groupHelp) {
    return {
      command: group,
      ...(group === "search" ? { query: "" } : {
        subcommand: group === "source" ? "list" : "status",
        sourceId: group === "auth" ? "rd-guide" : null,
        device: false,
      }),
      json: false,
      help: true,
    };
  }
  const positional = [];
  const values = {};
  let json = false;
  let help = false;
  let device = false;
  let clearSubdir = false;
  const valueFlags = new Map([
    ["--source", "source"],
    ["--type", "sourceType"],
    ["--url", "baseUrl"],
    ["--project", "project"],
    ["--repo", "repository"],
    ["--ref", "ref"],
    ["--subdir", "subdir"],
    ["--format", "format"],
    ["--entry-path", "entryPath"],
    ["--marketplace-path", "marketplacePath"],
    ["--application-id", "applicationId"],
    ["--name", "name"],
  ]);
  for (let index = group === "search" ? 1 : 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (valueFlags.has(token)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new PluginRuntimeError(`${token} 缺少取值`, {
          code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
          path: token,
        });
      }
      values[valueFlags.get(token)] = value;
      index += 1;
    } else if (token === "--json") json = true;
    else if (token === "--device") device = true;
    else if (token === "--clear-subdir") clearSubdir = true;
    else if (token === "--help" || token === "-h") help = true;
    else if (token.startsWith("-")) {
      throw new PluginRuntimeError(`未知 Plugin 参数:${token}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
        path: token,
      });
    } else positional.push(token);
  }
  if (group === "search") {
    if (device || clearSubdir || Object.keys(values).some((key) => key !== "source")) {
      throw new PluginRuntimeError("plugin search 仅支持 --source 与 --json", {
        code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
        path: group,
      });
    }
    if (positional.length > 1) throw new PluginRuntimeError("plugin search 最多接受一个查询词", {
      code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
      path: group,
    });
    return { command: "search", query: positional[0] || "", ...values, json, help };
  }
  const subcommand = argv[1] || (group === "source" ? "list" : "status");
  const supported = group === "source"
    ? new Set(["add", "list", "remove", "update", "enable", "disable"])
    : new Set(["login", "logout", "status"]);
  if (!supported.has(subcommand)) throw new PluginRuntimeError(`未知 Plugin ${group} 命令:${subcommand}`, {
    code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
    path: subcommand,
  });
  if (group === "auth" && Object.keys(values).length > 0) throw new PluginRuntimeError(
    "plugin auth 不接受 source 配置参数",
    { code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR, path: subcommand },
  );
  if (group === "source" && (device || values.source)) throw new PluginRuntimeError(
    "plugin source 不支持 --device/--source",
    { code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR, path: subcommand },
  );
  if (subcommand === "list" && positional.length > 0) throw new PluginRuntimeError(
    "plugin source list 不接受位置参数",
    { code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR, path: subcommand },
  );
  if (group === "source" && subcommand !== "list" && positional.length === 0 && !help) {
    throw new PluginRuntimeError(`plugin source ${subcommand} 需要 source ID`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
      path: subcommand,
    });
  }
  if (subcommand !== "list" && positional.length > 1) throw new PluginRuntimeError(
    `plugin ${group} ${subcommand} 最多接受一个 source ID`,
    { code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR, path: subcommand },
  );
  if (clearSubdir && (group !== "source" || !["add", "update"].includes(subcommand))) {
    throw new PluginRuntimeError("--clear-subdir 仅支持 plugin source add/update", {
      code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
      path: subcommand,
    });
  }
  if (clearSubdir && values.subdir) {
    throw new PluginRuntimeError("--clear-subdir 不能与 --subdir 同时使用", {
      code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
      path: subcommand,
    });
  }
  return {
    command: group,
    subcommand,
    sourceId: positional[0] || (group === "auth" ? "rd-guide" : null),
    ...values,
    json,
    device,
    ...(clearSubdir ? { clearSubdir: true } : {}),
    help,
  };
}

/**
 * 解析 Plugin 多级命令参数。
 *
 * @param {string[]} argv `plugin` 后的参数
 * @returns {{command:string,pluginId:string|null,source:string|null,version:string|null,platforms:string[],dryRun:boolean,json:boolean,help:boolean}} 解析结果
 */
export function parsePluginArgs(argv) {
  const authoring = parsePluginAuthoringArgs(argv);
  if (authoring) return authoring;
  const management = parseManagementArgs(argv);
  if (management) return management;
  const rootHelp = argv[0] === "--help" || argv[0] === "-h";
  const command = rootHelp ? "list" : (argv[0] || "list");
  const positional = [];
  const platforms = [];
  const widen = [];
  let source = null;
  let version = null;
  let dryRun = false;
  let json = false;
  let help = rootHelp;

  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--source" || token === "--version" || token === "--platform" || token === "--widen") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new PluginRuntimeError(`${token} 缺少取值`, {
          code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
          path: token,
        });
      }
      index += 1;
      if (token === "--source") source = value;
      else if (token === "--version") version = value;
      else if (token === "--widen") widen.push(value);
      else platforms.push(value);
      continue;
    }
    if (token === "--dry-run") dryRun = true;
    else if (token === "--json") json = true;
    else if (token === "--help" || token === "-h") help = true;
    else if (token.startsWith("-")) {
      throw new PluginRuntimeError(`未知 Plugin 参数:${token}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
        path: token,
      });
    } else positional.push(token);
  }

  const supported = new Set(["list", "add", "update", "remove", "verify", "replay"]);
  if (!supported.has(command)) {
    throw new PluginRuntimeError(`未知 Plugin 命令:${command}`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
      path: command,
    });
  }
  if (["add", "remove"].includes(command) && positional.length !== 1 && !help) {
    throw new PluginRuntimeError(`plugin ${command} 需要一个 Plugin ID`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
      path: command,
    });
  }
  if (["list", "replay"].includes(command) && positional.length !== 0 && !help) {
    throw new PluginRuntimeError(`plugin ${command} 不接受位置参数`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
      path: command,
    });
  }
  if (["update", "verify"].includes(command) && positional.length > 1 && !help) {
    throw new PluginRuntimeError(`plugin ${command} 最多接受一个 Plugin ID`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
      path: command,
    });
  }
  if (command !== "add" && source) {
    throw new PluginRuntimeError(`--source 仅支持 plugin add`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
      path: command,
    });
  }
  // update 需要 --version 才能放宽存量精确锁，把声明改写成兼容范围。
  if (!["add", "update"].includes(command) && version) {
    throw new PluginRuntimeError(`--version 仅支持 plugin add 与 plugin update`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
      path: command,
    });
  }
  if (version && !isSemVerRange(version)) {
    throw new PluginRuntimeError(`--version 必须是合法 SemVer range:${version}`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
      path: version,
    });
  }
  if (command !== "update" && widen.length > 0) {
    throw new PluginRuntimeError(`--widen 仅支持 plugin update`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
      path: command,
    });
  }
  if (widen.length > 0 && (version || positional.length > 0)) {
    throw new PluginRuntimeError("--widen 不能与单个 Plugin ID 或 --version 同时使用", {
      code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
      path: "--widen",
    });
  }
  if (!["add", "update", "replay"].includes(command) && platforms.length > 0) {
    throw new PluginRuntimeError(`--platform 不支持 plugin ${command}`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
      path: command,
    });
  }
  if (!["add", "update", "remove", "replay"].includes(command) && dryRun) {
    throw new PluginRuntimeError(`--dry-run 不支持 plugin ${command}`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
      path: command,
    });
  }
  return {
    command,
    pluginId: positional[0] || null,
    source,
    version,
    widen: parseWidenPairs(widen),
    platforms: parsePlatforms(platforms),
    dryRun,
    json,
    help,
  };
}

/**
 * 打印 Plugin 子命令帮助。
 *
 * @param {{log:(message:string)=>void}} output 输出适配器
 */
function printPluginHelp(output) {
  const managementHelp = fs.existsSync(REMOTE_PLUGIN_ENTRY)
    ? `\n  flower-trellis plugin source <add|list|remove|update|enable|disable> [source] [--type <gitlab|github>] [--json]\n  flower-trellis plugin auth <login|logout|status> [source] [--device] [--json]\n  flower-trellis plugin search [query] [--source <id>] [--json]`
    : "";
  output.log(`用法:
  flower-trellis plugin list [--json]
  flower-trellis plugin add <plugin> [--source <来源 ID|项目内路径>] [--version <range>] [--platform <id>] [--dry-run] [--json]
  flower-trellis plugin update [plugin] [--version <range>] [--widen <plugin>=<range>]... [--platform <id>] [--dry-run] [--json]
  flower-trellis plugin remove <plugin> [--dry-run] [--json]
  flower-trellis plugin verify [plugin] [--json]
  flower-trellis plugin init --id <source/plugin> --name <name> [--version <semver>] [--profile <standard|integration>] [--patches] [--marketplace] [--non-interactive] [--json]
  flower-trellis plugin validate [path] [--subject <plugin|entry|marketplace>] [--source-id <id>] [--checkout-map <file>] [--ci] [--json]${managementHelp}`);
}

/**
 * 读取作者命令所需的交互值。
 *
 * @param {object} parsed 已解析参数
 * @param {{promptAuthoring?:(current:object)=>Promise<object>|object}} options 注入选项
 * @returns {Promise<object>} 完整 scaffold 参数
 */
async function resolveAuthoringInitOptions(parsed, options) {
  let values = { ...parsed };
  const missing = () => !values.id || !values.name;
  if (missing() && (parsed.nonInteractive || parsed.json)) {
    throw new PluginRuntimeError("plugin init 非交互模式需要 --id 与 --name", {
      code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
      path: "plugin init",
    });
  }
  if (missing() && options.promptAuthoring) values = { ...values, ...await options.promptAuthoring(values) };
  if (missing()) {
    const { input, select } = await import("@inquirer/prompts");
    values.id ||= await input({ message: "Canonical Plugin ID", required: true });
    values.name ||= await input({ message: "Plugin 名称", required: true });
    values.profile ||= await select({
      message: "Capability profile",
      choices: [
        { name: "standard", value: "standard" },
        { name: "integration", value: "integration" },
      ],
      default: "standard",
    });
  }
  return values;
}

/**
 * 读取 JSON 文件并隐藏绝对路径。
 *
 * @param {string} file 文件路径
 * @param {string} label 诊断标签
 * @returns {object} JSON 对象
 */
function readAuthoringJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new PluginRuntimeError(`${label} JSON 无法读取`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
      path: label,
      cause: error,
    });
  }
}

/**
 * 执行作者 scaffold 命令。
 *
 * @param {object} parsed 已解析参数
 * @param {object} ctx CLI 上下文
 * @param {object} options 测试注入
 * @param {{log:(message:string)=>void}} output 输出适配器
 * @returns {Promise<number>} 退出码
 */
async function runAuthoringInit(parsed, ctx, options, output) {
  const values = await resolveAuthoringInitOptions(parsed, options);
  const { scaffoldFlowerPlugin } = await import("../plugin/authoring/scaffold.js");
  const result = scaffoldFlowerPlugin(ctx.target, values);
  if (parsed.json) output.log(stringifyCanonicalJson(result).trimEnd());
  else {
    output.log(`Plugin scaffold 已生成:${result.root}`);
    output.log(`digest:${result.digest}`);
    if (result.marketplaceEntry) output.log(`Marketplace entry:${result.marketplaceEntry}`);
  }
  return 0;
}

/**
 * 执行作者校验命令。
 *
 * @param {object} parsed 已解析参数
 * @param {object} ctx CLI 上下文
 * @param {{checkoutMap?:Record<string,string>}} options 测试注入
 * @param {{log:(message:string)=>void}} output 输出适配器
 * @returns {Promise<number>} 退出码
 */
async function runAuthoringValidate(parsed, ctx, options, output) {
  const {
    validateAuthorMarketplace,
    validateAuthorMarketplaceEntry,
    validateAuthorPlugin,
  } = await import("../plugin/authoring/validator.js");
  const target = path.resolve(ctx.target, parsed.targetPath);
  const subject = parsed.subject || (fs.existsSync(target) && fs.statSync(target).isDirectory()
    ? "plugin"
    : "marketplace");
  let checkoutMap = options.checkoutMap || null;
  if (parsed.checkoutMap) checkoutMap = readAuthoringJson(
    path.resolve(ctx.target, parsed.checkoutMap),
    "checkout-map",
  );
  let result;
  if (subject === "plugin") {
    const entryPath = path.join(path.dirname(target), "marketplace-entry.json");
    if (fs.existsSync(entryPath)) {
      const entry = readAuthoringJson(entryPath, "marketplace-entry.json");
      const sourceId = parsed.sourceId || "rd-guide";
      const version = entry.versions?.[0]?.version || "unknown";
      result = validateAuthorPlugin(target, {
        sourceId,
        sourceType: entry.source?.type === "gitlab" ? "gitlab" : "local",
        maxProfile: entry.trust?.maxProfile,
      });
      const entryResult = validateAuthorMarketplaceEntry(entry, {
        sourceId,
        baseDir: path.dirname(target),
        checkoutMap: {
          [`${sourceId}/${entry.id}@${version}`]: {
            path: path.relative(path.dirname(target), target) || ".",
            commit: entry.versions?.[0]?.commit || null,
          },
        },
        ci: parsed.ci,
      });
      result = {
        ...result,
        ok: result.ok && entryResult.ok,
        issues: [...result.issues, ...entryResult.issues]
          .sort((left, right) => compareUtf8(left.path, right.path) || compareUtf8(left.code, right.code)),
        review: entryResult.review,
      };
    } else {
      result = validateAuthorPlugin(target, { sourceId: parsed.sourceId || "local" });
    }
  } else {
    const value = readAuthoringJson(target, subject === "entry" ? "marketplace-entry.json" : "marketplace.json");
    if (subject === "entry" && !checkoutMap) {
      const sourceId = parsed.sourceId || "rd-guide";
      const siblingPackage = path.join(path.dirname(target), ".flower-plugin");
      if (fs.existsSync(siblingPackage)) {
        checkoutMap = Object.fromEntries((value.versions || []).map((version) => [
          `${sourceId}/${value.id}@${version.version}`,
          { path: ".flower-plugin", commit: version.commit },
        ]));
      }
    }
    const validationOptions = {
      baseDir: path.dirname(target),
      checkoutMap: checkoutMap || {},
      ci: parsed.ci,
    };
    result = subject === "entry"
      ? validateAuthorMarketplaceEntry(value, {
        ...validationOptions,
        sourceId: parsed.sourceId || "rd-guide",
      })
      : validateAuthorMarketplace(value, validationOptions);
  }
  if (parsed.json || parsed.ci) output.log(stringifyCanonicalJson(result).trimEnd());
  else output.log(result.ok ? "Plugin 作者校验通过" : `Plugin 作者校验失败:${result.issues.length} 项`);
  return result.ok ? 0 : 3;
}

/**
 * 按需加载远程 Plugin Runtime，避免 P2 生命周期静态依赖 P3。
 *
 * @returns {Promise<object>} 远程 Plugin 运行时模块
 */
async function loadRemotePluginRuntime() {
  remotePluginRuntimePromise ||= import(REMOTE_PLUGIN_ENTRY.href);
  return remotePluginRuntimePromise;
}

/**
 * 加载可选的 P4 Patch Runtime，使其通过进程内扩展点接入 P2。
 *
 * @returns {Promise<void>} 加载完成
 */
async function loadOptionalPatchRuntime() {
  if (fs.existsSync(PATCH_RUNTIME_ENTRY)) await import(PATCH_RUNTIME_ENTRY.href);
}

/**
 * 打印 Integration capability 批准范围。
 *
 * @param {object[]} requests 待批准请求
 * @param {{log:(message:string)=>void}} output 输出适配器
 * @returns {void}
 */
function printApprovalRequests(requests, output) {
  for (const request of requests || []) {
    const source = request.source || {};
    output.log(`  · 需要批准 ${request.pluginId}@${request.version} [${source.type}:${source.id}]`);
    output.log(`    能力:${request.granted.join(", ")}`);
    for (const operation of request.operations) {
      const selector = operation.selector.heading || operation.selector.source || operation.selector.type;
      for (const target of operation.targets) {
        output.log(
          `    ${operation.operation} ${target.path} selector=${operation.selector.type}:${selector} missing=${target.missing}`,
        );
      }
    }
  }
}

/**
 * 在真实写入缺少 Integration 批准时执行零写入预览并请求交互确认。
 *
 * JSON 与非 TTY 场景不得自动批准；它们保留原始稳定错误，供 CI 先显式 dry-run 审计。
 *
 * @param {(approvals:string[])=>object} execute 执行真实生命周期
 * @param {()=>object} preview 执行 dry-run 预览
 * @param {{interactive:boolean,confirmApproval?:(requests:object[])=>Promise<boolean>|boolean}} options 确认选项
 * @param {{log:(message:string)=>void}} output 输出适配器
 * @returns {Promise<object>} 生命周期结果
 */
async function executeWithCapabilityApproval(execute, preview, options, output) {
  try {
    return execute([]);
  } catch (error) {
    if (error?.code !== CAPABILITY_APPROVAL_REQUIRED) throw error;
    if (!options.interactive || (!process.stdin.isTTY && !options.confirmApproval)) throw error;
    const previewResult = preview();
    if (!Array.isArray(previewResult.approvalRequests) || previewResult.approvalRequests.length === 0) {
      throw error;
    }
    printApprovalRequests(previewResult.approvalRequests, output);
    let approved;
    if (options.confirmApproval) {
      approved = await options.confirmApproval(previewResult.approvalRequests);
    } else {
      const { confirm } = await import("@inquirer/prompts");
      approved = await confirm({
        message: `批准 ${previewResult.approvalRequests.length} 个 Plugin 的 Integration Patch?`,
        default: false,
      });
    }
    if (!approved) throw error;
    return execute(previewResult.approvalRequests.map(({ pluginId }) => pluginId));
  }
}

/**
 * 把 local source 绝对路径转换为项目内 POSIX 引用。
 *
 * @param {string} projectRoot 项目根
 * @param {string} source 原始路径
 * @param {string} cwd 当前工作目录
 * @returns {string} 项目内 POSIX 引用
 */
function localReference(projectRoot, source, cwd) {
  const absolute = path.resolve(cwd, source);
  const relative = path.relative(projectRoot, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new PluginRuntimeError(`local source 必须位于项目内:${source}`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
      path: source,
    });
  }
  return relative.split(path.sep).join("/");
}

/**
 * 从现有 lock 恢复 local provider 引用。
 *
 * @param {import("../plugin/contracts.js").PluginLock|null} lock 当前 lock
 * @returns {Map<string,Set<string>>} source ID 到引用集合
 */
function localReferencesFromLock(lock) {
  const references = new Map();
  for (const plugin of lock?.plugins || []) {
    if (plugin.source.type !== "local") continue;
    const entries = references.get(plugin.source.id) || new Set();
    entries.add(plugin.source.reference);
    references.set(plugin.source.id, entries);
  }
  return references;
}

/**
 * 输出稳定 JSON 或简洁的人类可读结果。
 *
 * @param {object} result 命令结果
 * @param {boolean} json 是否 JSON 输出
 * @param {{log:(message:string)=>void}} output 输出适配器
 * @param {{compact?:boolean,verbose?:boolean}} [options] 人类可读输出选项
 */
function printResult(result, json, output, options = {}) {
  if (json) {
    output.log(stringifyCanonicalJson({ changes: [], diagnostics: [], ...result }).trimEnd());
    return;
  }
  if (result.command === "list") {
    const declarations = result.plugins.plugins;
    if (declarations.length === 0) output.log("当前项目未声明 Plugin");
    else declarations.forEach(({ id, version }) => output.log(`${id} ${version}`));
    return;
  }
  if (result.command === "verify") {
    output.log(result.ok ? "Plugin 校验通过" : `Plugin 校验失败:${result.diagnostics.length} 项`);
    return;
  }
  const action = result.transaction.status === "dry-run" ? "预览" : "完成";
  output.log(`Plugin ${result.command} ${action}，目标变化 ${result.transaction.changed.length} 项`);
  for (const pluginEntry of result.graph.plugins) {
    const dependencies = Object.keys(pluginEntry.dependencies);
    output.log(`${pluginEntry.id}@${pluginEntry.version} [${pluginEntry.source.type}:${pluginEntry.source.id}]`);
    if (dependencies.length > 0) output.log(`  依赖:${dependencies.join(", ")}`);
  }
  if (!options.compact) {
    // 生命周期命令会重新投影整图，未受影响的 Plugin 会产生大量前后字节一致的幂等写入。
    // 判定依据取事务层的 changed 清单而不是 before/after hash 比较：ensure-directory 的
    // afterHash 恒为 null，新建目录时 beforeHash 同样是 null，直接比较会把真实新建误判为空操作。
    const changedTargets = new Set(result.transaction.changed);
    const visible = options.verbose
      ? result.changes
      : result.changes.filter(({ target }) => changedTargets.has(target));
    for (const change of visible) output.log(`  ${change.operation} ${change.target}`);
    const hidden = result.changes.length - visible.length;
    if (hidden > 0) output.log(`  · 另有 ${hidden} 项目标无变化(设 FLOWER_DEBUG=1 查看完整清单)`);
  }
  for (const diagnostic of result.diagnostics.filter(({ severity }) => severity === "warning")) {
    output.log(`  · ${diagnostic.message}`);
  }
  printApprovalRequests(result.approvalRequests, output);
  if (result.orphans.length > 0) output.log(`孤立依赖:${result.orphans.join(", ")}`);
}

/**
 * 把稳定 Plugin 错误映射为 CLI 退出码。
 *
 * @param {unknown} error 捕获到的错误
 * @returns {1|2|3} 用法、验证/冲突或执行失败退出码
 */
function pluginExitCode(error) {
  if (
    error?.code === PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR ||
    error?.code === PLUGIN_RUNTIME_ERROR_CODES.PLATFORM_SELECTION_REQUIRED ||
    error?.code === PLUGIN_RUNTIME_ERROR_CODES.PLATFORM_UNKNOWN
  ) return 2;
  if (PLUGIN_CONFLICT_CODES.has(error?.code)) return 3;
  return 1;
}

/**
 * 执行 Plugin 生命周期命令。
 *
 * @param {object} ctx cli-args.js 的执行上下文
 * @param {{cwd?:string,providers?:object[],output?:{log:(message:string)=>void,error:(message:string)=>void},interactive?:boolean,prompts?:object,confirmApproval?:(requests:object[])=>Promise<boolean>|boolean,compact?:boolean,onPreflight?:(result:object)=>void,trellisControlMode?:"materialized"|"restoring"}} [options] 测试、Provider、输出与交互确认注入
 * @returns {Promise<number>} 进程退出码
 */
export async function plugin(ctx, options = {}) {
  const output = options.output || console;
  let parsed;
  try {
    const passthrough = ctx.passthrough || [];
    const interactive = options.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
    if (passthrough.length === 0 && interactive) {
      const { runPluginInteractive } = await import("./plugin-interactive.js");
      return await runPluginInteractive(ctx, {
        ...options,
        output,
        runCommand: (args, commandOptions = {}) => plugin(
          { ...ctx, passthrough: args },
          { ...options, ...commandOptions, output },
        ),
      });
    }
    parsed = parsePluginArgs(passthrough);
    if (parsed.help) {
      printPluginHelp(output);
      return 0;
    }
    if (parsed.command === "init") return await runAuthoringInit(parsed, ctx, options, output);
    if (parsed.command === "validate") return await runAuthoringValidate(parsed, ctx, options, output);
    if (["source", "auth", "search"].includes(parsed.command)) {
      const remoteRuntime = await loadRemotePluginRuntime();
      return await remoteRuntime.runPluginManagementCommand(parsed, ctx, options, output);
    }
    const trellisAlreadyMaterialized = ["materialized", "restoring"].includes(ctx.trellisControlMode) ||
      ["materialized", "restoring"].includes(options.trellisControlMode);
    if (
      ["add", "update", "remove", "replay"].includes(parsed.command) &&
      !parsed.dryRun &&
      !trellisAlreadyMaterialized
    ) {
      // trellis-control 会连带加载 @mindfoldhq/trellis 的配置器(约 240ms)，
      // 只有真正需要物化 Trellis 的写入路径才付这份加载成本。
      const { runWithTrellisIntegrationEnabled } = await import("../lib/trellis-control.js");
      return await runWithTrellisIntegrationEnabled(ctx.target, ({ extendSnapshot }) => plugin(
        { ...ctx, trellisControlMode: "materialized" },
        {
          ...options,
          trellisControlMode: "materialized",
          onPreflight: (result) => {
            extendSnapshot([
              ...result.plan.contentMutations.map(({ target }) => target),
              ...result.plan.patchMutations.map(({ target }) => target),
            ]);
            options.onPreflight?.(result);
          },
        },
      ));
    }
    await loadOptionalPatchRuntime();
    const store = new ProjectStore(ctx.target);
    const pluginsFile = store.readPlugins();
    const lock = store.readLock();
    const state = store.readState();
    const registry = new SourceRegistry(options.providers || []);
    const needsSkillGardenProvider = (
      parsed.pluginId?.startsWith("flower/") ||
      parsed.source === "flower" ||
      pluginsFile.plugins.some(({ id }) => id.startsWith("flower/")) ||
      lock?.plugins.some(({ id }) => id.startsWith("flower/"))
    );
    if (needsSkillGardenProvider && !registry.has("flower")) {
      registry.register(new SkillGardenBuiltinProvider({
        projectRoot: ctx.target,
        previousState: state,
        lockedPlugin: lock?.plugins.find(({ id }) => id === SKILL_GARDEN_PLUGIN_ID) || null,
        ...(options.skillGarden || {}),
      }));
    }
    const localReferences = localReferencesFromLock(lock);
    let canonicalId = parsed.pluginId;
    const remoteRuntime = fs.existsSync(REMOTE_PLUGIN_ENTRY)
      ? await loadRemotePluginRuntime()
      : null;
    await remoteRuntime?.registerRemotePluginSources({
      parsed,
      projectRoot: ctx.target,
      options,
      registry,
      lock,
    });

    if (parsed.command !== "add" && canonicalId && !canonicalId.includes("/")) {
      const knownIds = [...new Set([
        ...pluginsFile.plugins.map(({ id }) => id),
        ...(lock?.plugins || []).map(({ id }) => id),
        ...(state?.plugins || []).map(({ id }) => id),
      ])];
      const matches = knownIds.filter((id) => id.endsWith(`/${canonicalId}`));
      if (matches.length !== 1) {
        throw new PluginRuntimeError(
          matches.length === 0 ? `项目中不存在 Plugin:${canonicalId}` : `Plugin 短 ID 存在歧义:${canonicalId}`,
          {
            code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
            path: canonicalId,
            details: { matches: matches.sort(compareUtf8) },
          },
        );
      }
      [canonicalId] = matches;
    }

    if (parsed.command === "add") {
      let sourceId = parsed.pluginId.includes("/")
        ? parseCanonicalPluginId(parsed.pluginId).sourceId
        : null;
      if (parsed.source && registry.has(parsed.source)) {
        sourceId = parsed.source;
      } else if (parsed.source) {
        sourceId = sourceId || "local";
        const reference = localReference(ctx.target, parsed.source, options.cwd || process.cwd());
        if (!fs.existsSync(path.join(ctx.target, ...reference.split("/")))) {
          throw new PluginRuntimeError(`local source 不存在:${parsed.source}`, {
            code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
            path: parsed.source,
          });
        }
        const entries = localReferences.get(sourceId) || new Set();
        entries.add(reference);
        localReferences.set(sourceId, entries);
      }
      sourceId = sourceId || "local";
      canonicalId = parsed.pluginId.includes("/") ? parsed.pluginId : `${sourceId}/${parsed.pluginId}`;
    }

    for (const [sourceId, references] of [...localReferences]
      .sort(([left], [right]) => compareUtf8(left, right))) {
      if (registry.has(sourceId)) continue;
      registry.register(new LocalSourceProvider({
        id: sourceId,
        projectRoot: ctx.target,
        references: [...references],
      }));
    }

    await remoteRuntime?.prepareRemotePluginCandidates({ parsed, canonicalId, registry, lock });

    const service = new PluginApplicationService(ctx.target, { registry, store });
    let result;
    if (parsed.command === "list") {
      result = { ok: true, command: "list", ...service.list(), diagnostics: [] };
    } else if (parsed.command === "add") {
      const addOptions = {
        id: canonicalId,
        version: parsed.version || (
          parseCanonicalPluginId(canonicalId).sourceId === "flower"
            ? registry.listCandidates(canonicalId)[0]?.version || "*"
            : "*"
        ),
        platforms: parsed.platforms,
        dryRun: parsed.dryRun,
        onPreflight: options.onPreflight,
      };
      result = parsed.dryRun ? service.add(addOptions) : await executeWithCapabilityApproval(
        (approvals) => service.add({ ...addOptions, approvals }),
        () => service.add({ ...addOptions, dryRun: true }),
        { interactive: !parsed.json, confirmApproval: options.confirmApproval },
        output,
      );
    } else if (parsed.command === "update") {
      const updateOptions = {
        id: canonicalId,
        // 内置 skill-garden 的版本跟随 flower 本体，不接受调用方的 range。
        ...(canonicalId === SKILL_GARDEN_PLUGIN_ID
          ? { version: registry.get("flower").manifest.version }
          : parsed.version ? { version: parsed.version } : {}),
        ...(Object.keys(parsed.widen || {}).length > 0 ? { widen: parsed.widen } : {}),
        platforms: parsed.platforms,
        dryRun: parsed.dryRun,
        onPreflight: options.onPreflight,
      };
      result = parsed.dryRun ? service.update(updateOptions) : await executeWithCapabilityApproval(
        (approvals) => service.update({ ...updateOptions, approvals }),
        () => service.update({ ...updateOptions, dryRun: true }),
        { interactive: !parsed.json, confirmApproval: options.confirmApproval },
        output,
      );
    } else if (parsed.command === "remove") {
      result = service.remove({
        id: canonicalId,
        platforms: parsed.platforms,
        dryRun: parsed.dryRun,
        onPreflight: options.onPreflight,
      });
    } else if (parsed.command === "replay") {
      result = service.replay({
        platforms: parsed.platforms,
        dryRun: parsed.dryRun,
        preserveIds: options.preserveIds || [],
        onPreflight: options.onPreflight,
      });
    } else {
      result = { command: "verify", ...service.verify({ id: canonicalId }) };
    }
    const verbose = Boolean(process.env.DEBUG || process.env.FLOWER_DEBUG);
    const compact = options.compact === true && !verbose;
    printResult(result, parsed.json, output, { compact, verbose });
    return result.ok === false ? 3 : 0;
  } catch (error) {
    const json = parsed?.json || ctx.passthrough?.includes("--json");
    const code = error instanceof PluginError ? error.code : "PLUGIN_UNEXPECTED_ERROR";
    const publicPath = error.path && !path.isAbsolute(error.path) ? error.path : "";
    if (json) {
      output.log(stringifyCanonicalJson({
        ok: false,
        command: parsed?.command || "plugin",
        changes: [],
        diagnostics: [{ code, path: publicPath, message: error.message, severity: "error" }],
      }).trimEnd());
    } else {
      output.error(`❌ ${error.message}`);
    }
    return pluginExitCode(error);
  }
}
