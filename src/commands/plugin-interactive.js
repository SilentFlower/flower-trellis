import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import semver from "semver";
import {
  SKILL_GARDEN_PLUGIN_ID,
  SkillGardenBuiltinProvider,
} from "../builtin-plugins/skill-garden/provider.js";
import { readLegacyManifestStatus } from "../lib/manifest.js";
import { createCredentialStore } from "../plugin/auth/keyring-credential-store.js";
import {
  detectPluginPlatforms,
  listPluginPlatforms,
} from "../plugin/install/platform-detector.js";
import { PLUGIN_RUNTIME_ERROR_CODES } from "../plugin/runtime-errors.js";
import { UserSourceStore } from "../plugin/sources/user-source-store.js";
import { ProjectStore } from "../plugin/state/project-store.js";
import {
  pluginActionPrompt,
  pluginManagerPrompt,
} from "./plugin-manager-prompt.js";

const TITLE_COLOR = "#ff6fb5";
const TAB_IDS = ["discover", "installed", "sources", "issues"];

/**
 * 加载默认终端 prompt adapter。
 *
 * @returns {Promise<{manager:Function,action:Function,select:Function,input:Function,checkbox:Function,confirm:Function}>} prompt 方法
 */
async function loadPrompts() {
  const { checkbox, confirm, input, select } = await import("@inquirer/prompts");
  return {
    manager: pluginManagerPrompt,
    action: pluginActionPrompt,
    checkbox,
    confirm,
    input,
    select,
  };
}

/**
 * 读取项目 Plugin 视图，损坏状态继续交给 ProjectStore 报错。
 *
 * @param {ProjectStore} store Project Store
 * @param {string} projectRoot 项目根
 * @returns {{plugins:object,lock:object|null,state:object|null,legacyManifest:object}} 项目视图
 */
function readProjectView(store, projectRoot) {
  return {
    plugins: store.readPlugins(),
    lock: store.readLock(),
    state: store.readState(),
    legacyManifest: readLegacyManifestStatus(projectRoot),
  };
}

/**
 * 为安装流程选择默认平台。
 *
 * @param {string} projectRoot 项目根
 * @param {object|null} state 当前应用状态
 * @returns {string[]} 默认选中平台
 */
function defaultPlatforms(projectRoot, state) {
  const applied = [...new Set((state?.plugins || []).flatMap(({ platforms }) => platforms))];
  if (applied.length > 0) return applied;
  try {
    return detectPluginPlatforms(projectRoot).platforms;
  } catch {
    const supported = new Set(listPluginPlatforms());
    return ["codex", "claude"].filter((platform) => supported.has(platform));
  }
}

/**
 * 构造带平台参数的命令。
 *
 * @param {string[]} args 基础参数
 * @param {string[]} platforms 平台列表
 * @returns {string[]} 完整命令参数
 */
function withPlatforms(args, platforms) {
  return [
    ...args,
    ...platforms.flatMap((platform) => ["--platform", platform]),
  ];
}

/**
 * 收集 GitLab source 表单值。
 *
 * @param {object} prompts prompt adapter
 * @param {object|null} current 当前 source
 * @returns {Promise<object>} source 表单值
 */
async function promptGitLabSource(prompts, current) {
  const values = {};
  if (!current) values.id = await prompts.input({ message: "Source ID", required: true });
  values.name = await prompts.input({
    message: "显示名称",
    default: current?.name || values.id,
    required: true,
  });
  values.baseUrl = await prompts.input({
    message: "GitLab 地址",
    default: current?.baseUrl,
    required: true,
  });
  values.project = await prompts.input({
    message: "Marketplace 项目路径",
    default: current?.project,
    required: true,
  });
  values.ref = await prompts.input({ message: "索引 ref", default: current?.ref || "main", required: true });
  values.marketplacePath = await prompts.input({
    message: "Marketplace 文件路径",
    default: current?.marketplacePath || ".flower-marketplace/marketplace.json",
    required: true,
  });
  values.applicationId = await prompts.input({
    message: "GitLab OAuth Application ID",
    default: current?.oauth?.applicationId,
    required: true,
  });
  return values;
}

/**
 * 收集 GitHub 公共仓库 source 表单值。
 *
 * @param {object} prompts prompt adapter
 * @param {object|null} current 当前 source
 * @returns {Promise<object>} source 表单值
 */
async function promptGitHubSource(prompts, current) {
  const values = { type: "github" };
  if (!current) values.id = await prompts.input({ message: "Source ID", required: true });
  values.name = await prompts.input({
    message: "显示名称",
    default: current?.name || values.id,
    required: true,
  });
  values.repository = await prompts.input({
    message: "GitHub 公共仓库",
    default: current?.repository,
    required: true,
  });
  values.ref = await prompts.input({ message: "分支或 ref（留空使用默认分支）", default: current?.ref || "" });
  values.subdir = await prompts.input({
    message: "仓库子目录（可留空）",
    default: current?.subdir || "",
  });
  values.format = current?.format || "auto";
  values.entryPath = current?.entryPath;
  values.clearSubdir = Boolean(current?.subdir && !values.subdir);
  return values;
}

/**
 * 收集指定类型的来源表单。
 *
 * @param {object} prompts prompt adapter
 * @param {object|null} current 当前 source
 * @param {"gitlab"|"github"} [sourceType] 新增来源类型
 * @returns {Promise<object>} source 表单值
 */
async function promptSource(prompts, current, sourceType) {
  const type = current?.type || sourceType;
  if (type === "github") return promptGitHubSource(prompts, current);
  return { type: "gitlab", ...await promptGitLabSource(prompts, current) };
}

/**
 * 把 source 表单转换为现有命令参数。
 *
 * @param {"add"|"update"} action source 动作
 * @param {string} sourceId source ID
 * @param {object} values 表单值
 * @returns {string[]} 命令参数
 */
function sourceCommand(action, sourceId, values) {
  if (values.type === "github") {
    return [
      "source", action, sourceId,
      "--type", "github",
      "--name", values.name,
      "--repo", values.repository,
      ...(values.ref ? ["--ref", values.ref] : []),
      ...(values.subdir ? ["--subdir", values.subdir] : []),
      ...(values.clearSubdir ? ["--clear-subdir"] : []),
      "--format", values.format || "auto",
      ...(values.entryPath ? ["--entry-path", values.entryPath] : []),
    ];
  }
  return [
    "source", action, sourceId,
    "--type", "gitlab",
    "--name", values.name,
    "--url", values.baseUrl,
    "--project", values.project,
    "--ref", values.ref,
    "--marketplace-path", values.marketplacePath,
    "--application-id", values.applicationId,
  ];
}

/**
 * 展示 GitHub 格式兼容性摘要。
 *
 * @param {object} output 输出适配器
 * @param {object} inspection 探测结果
 * @returns {void}
 */
function printGitHubInspection(output, inspection) {
  const candidates = inspection.candidates || (inspection.candidate ? [inspection.candidate] : []);
  const report = inspection.candidate?.compatibilityReport;
  output.log("");
  output.log(chalk.hex(TITLE_COLOR).bold("GitHub Plugin 识别结果"));
  if (candidates.length === 1) output.log(`  ${candidates[0].id}@${candidates[0].version}`);
  else output.log(`  Marketplace · ${inspection.pluginCount || candidates.length} 个可安装 Plugin`);
  output.log(chalk.gray(`  ${inspection.detection.format} · ${inspection.detection.entryPath}`));
  output.log(chalk.gray(`  commit ${inspection.resolvedCommit.slice(0, 12)}`));
  if (report) {
    output.log(`  可导入 ${report.imported.length} 项 · 忽略 ${report.omitted.length} 项`);
    for (const omitted of report.omitted) output.log(chalk.yellow(`  ! 不会安装 ${omitted.kind}: ${omitted.path}`));
  } else {
    const partial = candidates.filter(({ compatibilityReport }) => compatibilityReport?.status === "partial").length;
    output.log(`  可安装 ${candidates.length} 个 · 部分兼容 ${partial} 个`);
  }
  for (const diagnostic of inspection.diagnostics || []) output.log(chalk.yellow(`  ! ${diagnostic.message}`));
}

/**
 * 探测 GitHub 来源；遇到多个格式入口时让用户显式选择后重试。
 *
 * @param {object} context 交互上下文
 * @param {object} source GitHub 来源草稿
 * @returns {Promise<object>} 唯一探测结果
 */
async function inspectGitHubWithSelection(context, source) {
  try {
    return await context.inspectGitHubSource(source);
  } catch (error) {
    const detections = error?.details?.detections;
    if (error?.code !== PLUGIN_RUNTIME_ERROR_CODES.SOURCE_AMBIGUOUS || !Array.isArray(detections)) throw error;
    const selectedIndex = await context.prompts.select({
      message: "检测到多个 Plugin 入口，请选择",
      choices: detections.map((detection, index) => ({
        name: detection.displayName || detection.entryPath,
        value: index,
        description: `${detection.format} · ${detection.kind} · ${detection.entryPath}`,
      })),
      loop: false,
    });
    const selected = detections[selectedIndex];
    return context.inspectGitHubSource({
      ...source,
      format: selected.format,
      entryPath: selected.entryPath,
    });
  }
}

/**
 * 记录一次交互问题，避免同类错误反复堆积。
 *
 * @param {object} state 交互状态
 * @param {string} title 问题标题
 * @param {unknown} error 原始错误
 * @returns {void}
 */
function recordIssue(state, title, error) {
  const description = error instanceof Error ? error.message : String(error);
  const key = `${title}:${description}`;
  if (state.issues.some((issue) => issue.key === key)) return;
  state.issues.push({ key, title, description });
}

/**
 * 构造 Flower 内置 Plugin 入口。
 *
 * @param {object} context 交互上下文
 * @param {Map<string,object>} actions 动作索引
 * @param {object[]} cachedActions 缓存动作
 * @returns {object[]} 内置 Plugin 条目
 */
function buildBuiltinDiscoverItems(context, actions, cachedActions) {
  if (!fs.existsSync(path.join(context.ctx.target, ".trellis"))) return [];
  try {
    const candidate = context.skillGardenProvider.listCandidates(SKILL_GARDEN_PLUGIN_ID)[0];
    if (!candidate) return [];
    const key = `builtin:${candidate.id}`;
    const value = { type: "skill-manager", pluginId: candidate.id };
    actions.set(key, value);
    cachedActions.push({ key, value });
    return [{
      title: candidate.id,
      meta: `Flower 内置 · ${candidate.version}`,
      description: "管理 Skill Garden 提供的工作流强化与可选通用技能。",
      badge: "内置",
      tone: "success",
      value: key,
    }];
  } catch (error) {
    recordIssue(context.state, "Skill Garden 内置入口加载失败", error);
    return [];
  }
}

/**
 * 清理交互管理器的上一帧，保证主界面始终只占一屏。
 *
 * @param {object} output 输出适配器
 * @returns {void}
 */
function clearInteractiveScreen(output) {
  if (output === console && process.stdout.isTTY) process.stdout.write("\u001B[2J\u001B[H");
}

/**
 * 执行命令并把非零退出码纳入问题页签。
 *
 * @param {object} context 交互上下文
 * @param {string[]} args 命令参数
 * @param {string} title 失败标题
 * @returns {Promise<number>} 退出码
 */
async function runChecked(context, args, title) {
  const code = await context.runCommand(args, context.commandOptions);
  if (code !== 0) recordIssue(context.state, title, new Error(`命令退出码 ${code}`));
  return code;
}

/**
 * 构造发现页条目，并缓存已授权 Marketplace 的目录。
 *
 * @param {object} context 交互上下文
 * @param {Map<string,object>} actions 动作索引
 * @param {Map<string,object>} statuses 登录状态
 * @returns {Promise<object[]>} 发现页条目
 */
async function buildDiscoverItems(context, actions, statuses) {
  if (context.state.discovery) {
    for (const entry of context.state.discovery.actions) actions.set(entry.key, entry.value);
    return context.state.discovery.items;
  }

  const items = [];
  const cachedActions = [];
  items.push(...buildBuiltinDiscoverItems(context, actions, cachedActions));
  const sources = context.sourceStore.list().filter(({ enabled }) => enabled);
  for (const source of sources) {
    let status = statuses.get(source.id);
    if (!status) {
      try {
        status = await context.authStatus(source.id);
        statuses.set(source.id, status);
      } catch (error) {
        if (error?.code !== PLUGIN_RUNTIME_ERROR_CODES.AUTH_SCOPE_INVALID) {
          recordIssue(context.state, `${source.name} 登录状态读取失败`, error);
        }
        status = { authorized: false, error: true };
        statuses.set(source.id, status);
      }
    }
    if (!status.authorized) {
      const key = `auth:${source.id}`;
      const value = { type: "auth", sourceId: source.id, returnTab: "discover" };
      actions.set(key, value);
      cachedActions.push({ key, value });
      items.push({
        title: source.name,
        meta: source.project,
        description: status.error
          ? "现有凭据已失效，按 Enter 获取新授权码并覆盖旧凭据。"
          : "按 Enter 获取 GitLab 授权码，完成后自动返回这里加载插件。",
        badge: status.error ? "重新登录" : "需要登录",
        tone: "warning",
        value: key,
      });
      continue;
    }
    try {
      const results = await context.searchPlugins("", source.id);
      for (const plugin of results) {
        const key = `plugin:${source.id}:${plugin.id}`;
        const value = { type: "plugin", plugin: { ...plugin, source: plugin.source || source.id } };
        actions.set(key, value);
        cachedActions.push({ key, value });
        items.push({
          title: plugin.id,
          meta: `${source.name} · ${[...plugin.versions].sort(semver.rcompare)[0] || "未知版本"}`,
          description: plugin.description || "暂无描述",
          badge: source.id,
          tone: "info",
          value: key,
        });
      }
    } catch (error) {
      if (error?.code === PLUGIN_RUNTIME_ERROR_CODES.AUTH_REQUIRED) {
        const key = `auth:${source.id}`;
        const value = { type: "auth", sourceId: source.id, returnTab: "discover" };
        actions.set(key, value);
        cachedActions.push({ key, value });
        items.push({
          title: source.name,
          meta: source.project,
          description: "登录状态已失效，按 Enter 重新获取授权码。",
          badge: "重新登录",
          tone: "warning",
          value: key,
        });
      } else {
        recordIssue(context.state, `${source.name} Marketplace 加载失败`, error);
      }
    }
  }

  if (sources.length === 0) {
    items.push({
      title: "没有启用的 Plugin 来源",
      description: "切换到“来源”页签新增或启用 Marketplace。",
      badge: "空",
      tone: "muted",
      value: "discover:empty",
      disabled: true,
    });
  } else if (items.length === 0) {
    items.push({
      title: "Marketplace 中暂无 Plugin",
      description: "刷新目录，或到“问题”页签查看加载异常。",
      badge: "空",
      tone: "muted",
      value: "discover:empty",
      disabled: true,
    });
  }
  items.push({
    title: "刷新 Marketplace",
    description: "重新读取全部已启用来源的目录与登录状态。",
    badge: "↻",
    tone: "muted",
    value: "refresh:discover",
  });
  context.state.discovery = { items, actions: cachedActions };
  return items;
}

/**
 * 构造四页签管理器视图。
 *
 * @param {object} context 交互上下文
 * @returns {Promise<object>} prompt 配置和动作索引
 */
async function buildManagerModel(context) {
  const view = readProjectView(context.store, context.ctx.target);
  const actions = new Map();
  const statuses = new Map();
  const sources = context.sourceStore.list();
  for (const source of sources) {
    try {
      statuses.set(source.id, await context.authStatus(source.id));
    } catch (error) {
      if (error?.code !== PLUGIN_RUNTIME_ERROR_CODES.AUTH_SCOPE_INVALID) {
        recordIssue(context.state, `${source.name} 登录状态读取失败`, error);
      }
      statuses.set(source.id, { authorized: false, error: true });
    }
  }

  const discover = await buildDiscoverItems(context, actions, statuses);
  const locked = new Map((view.lock?.plugins || []).map((plugin) => [plugin.id, plugin]));
  const applied = new Map((view.state?.plugins || []).map((plugin) => [plugin.id, plugin]));
  const installed = view.plugins.plugins.map((declaration) => {
    const lock = locked.get(declaration.id);
    const state = applied.get(declaration.id);
    const version = lock?.version || declaration.version;
    const platforms = state?.platforms?.join(", ") || "未应用";
    const key = `installed:${declaration.id}`;
    actions.set(key, { type: "installed", pluginId: declaration.id });
    return {
      title: declaration.id,
      meta: `${version} · ${platforms}`,
      description: `来源 ${declaration.source}，按 Enter 校验、更新或卸载。`,
      badge: state ? "已应用" : "未应用",
      tone: state ? "success" : "warning",
      value: key,
    };
  });
  const hasManagedSkillGarden = view.plugins.plugins.some(({ id }) => id === SKILL_GARDEN_PLUGIN_ID)
    || (view.state?.plugins || []).some(({ id }) => id === SKILL_GARDEN_PLUGIN_ID);
  if (!hasManagedSkillGarden && view.legacyManifest.status === "valid") {
    const key = `legacy:${SKILL_GARDEN_PLUGIN_ID}`;
    actions.set(key, { type: "skill-manager", pluginId: SKILL_GARDEN_PLUGIN_ID });
    installed.unshift({
      title: SKILL_GARDEN_PLUGIN_ID,
      meta: `${view.legacyManifest.manifest.flowerVersion || "未知版本"} · ${view.legacyManifest.manifest.variant || "旧版"}`,
      description: "已通过旧版增强链安装，按 Enter 管理工作流强化与通用技能。",
      badge: "旧版安装",
      tone: "warning",
      value: key,
    });
  } else if (!hasManagedSkillGarden && view.legacyManifest.status === "corrupt") {
    recordIssue(context.state, "旧版 Skill Garden 状态读取失败", view.legacyManifest.error);
  }
  const installedCount = installed.length;
  if (installedCount === 0) installed.push({
    title: "当前项目尚未安装 Plugin",
    description: "切换到“发现”页签浏览可用插件。",
    badge: "空",
    tone: "muted",
    value: "installed:empty",
    disabled: true,
  });
  if (view.plugins.plugins.length > 0) {
    installed.push({
      title: "检查全部更新",
      description: "先展示更新计划，确认后再写入项目。",
      badge: "更新",
      tone: "info",
      value: "update:all",
    });
  }

  const sourceItems = sources.map((source) => {
    const status = statuses.get(source.id);
    const key = `source:${source.id}`;
    actions.set(key, { type: "source", sourceId: source.id });
    return {
      title: source.name,
      meta: `${source.id} · ${source.project || source.repository}`,
      description: source.type === "github"
        ? `${source.enabled ? "已启用" : "已停用"} · GitHub 公共仓库 · ${source.format}`
        : `${source.enabled ? "已启用" : "已停用"} · ${status?.authorized ? "GitLab 已登录" : "GitLab 未登录"}`,
      badge: source.type === "github" ? "公开" : status?.authorized ? "已登录" : status?.error ? "重新登录" : "未登录",
      tone: source.type === "github" || status?.authorized ? "success" : "warning",
      value: key,
    };
  });
  sourceItems.push({
    title: "新增来源",
    description: "连接 GitHub 公共仓库或 GitLab Marketplace。",
    badge: "新增",
    tone: "info",
    value: "source:add",
  });

  const issueItems = context.state.issues.map((issue, index) => {
    const key = `issue:${index}`;
    actions.set(key, { type: "issue", issue });
    return {
      title: issue.title,
      description: issue.description,
      badge: "错误",
      tone: "error",
      value: key,
    };
  });
  if (issueItems.length === 0) issueItems.push({
    title: "没有需要处理的问题",
    description: "Marketplace、授权和项目状态目前没有已知异常。",
    badge: "正常",
    tone: "success",
    value: "issues:empty",
    disabled: true,
  });

  return {
    actions,
    prompt: {
      projectRoot: context.ctx.target,
      summary: `已安装 ${installedCount} · 来源 ${sources.length} · 问题 ${context.state.issues.length}`,
      tabs: [
        {
          id: "discover",
          label: "发现",
          count: discover.filter((item) => (
            item.value.startsWith("plugin:") || item.value.startsWith("builtin:")
          )).length,
        },
        { id: "installed", label: "已安装", count: installedCount },
        { id: "sources", label: "来源", count: sources.length },
        { id: "issues", label: "问题", count: context.state.issues.length },
      ],
      activeTab: context.state.activeTab,
      itemsByTab: { discover, installed, sources: sourceItems, issues: issueItems },
      queries: context.state.queries,
      selectedByTab: context.state.selectedByTab,
      pageSize: 10,
    },
  };
}

/**
 * 展示远程 Plugin 详情并执行安装。
 *
 * @param {object} context 交互上下文
 * @param {object} plugin Plugin 搜索结果
 * @returns {Promise<void>} 完成信号
 */
async function installPlugin(context, plugin) {
  context.output.log("");
  context.output.log(chalk.hex(TITLE_COLOR).bold(plugin.id));
  context.output.log(`  ${plugin.description || "暂无描述"}`);
  context.output.log(chalk.gray(`  来源 ${plugin.source} · 版本 ${plugin.versions.join(", ")}`));
  const action = await context.prompts.select({
    message: "Plugin 详情",
    choices: [
      { name: "安装到当前项目", value: "install" },
      { name: "返回发现", value: "back" },
    ],
    loop: false,
  });
  if (action === "back") return;

  const versions = [...plugin.versions].sort(semver.rcompare);
  const version = await context.prompts.select({
    message: "选择版本",
    choices: versions.map((value) => ({ name: value, value })),
    loop: false,
  });
  const current = readProjectView(context.store, context.ctx.target);
  const defaults = new Set(defaultPlatforms(context.ctx.target, current.state));
  const platforms = await context.prompts.checkbox({
    message: "选择目标平台",
    choices: listPluginPlatforms().map((platform) => ({
      name: platform,
      value: platform,
      checked: defaults.has(platform),
    })),
    required: true,
    loop: false,
    pageSize: 12,
  });
  const args = withPlatforms(["add", plugin.id, "--version", version], platforms);
  context.output.log("\n安装预览:");
  if (await runChecked(context, [...args, "--dry-run"], `${plugin.id} 安装预览失败`) !== 0) return;
  const confirmed = await context.prompts.confirm({
    message: `按上述计划安装 ${plugin.id}@${version}?`,
    default: true,
  });
  if (!confirmed) {
    context.output.log("  · 已取消安装");
    return;
  }
  if (await runChecked(context, args, `${plugin.id} 安装失败`) === 0) {
    context.state.activeTab = "installed";
  }
}

/**
 * 管理一个已安装 Plugin。
 *
 * @param {object} context 交互上下文
 * @param {string} pluginId Plugin ID
 * @returns {Promise<void>} 完成信号
 */
async function manageInstalledPlugin(context, pluginId) {
  const action = await context.prompts.select({
    message: `管理 ${pluginId}`,
    choices: [
      { name: "校验安装状态", value: "verify" },
      { name: "检查并更新", value: "update" },
      { name: "卸载", value: "remove" },
      { name: "返回已安装", value: "back" },
    ],
    loop: false,
  });
  if (action === "back") return;
  if (action === "verify") {
    await runChecked(context, ["verify", pluginId], `${pluginId} 校验失败`);
    return;
  }
  context.output.log(`\n${action === "remove" ? "卸载" : "更新"}预览:`);
  if (await runChecked(context, [action, pluginId, "--dry-run"], `${pluginId} ${action} 预览失败`) !== 0) return;
  const confirmed = await context.prompts.confirm({
    message: action === "remove" ? `确认卸载 ${pluginId}?` : `确认更新 ${pluginId}?`,
    default: action !== "remove",
  });
  if (!confirmed) {
    context.output.log(`  · 已取消${action === "remove" ? "卸载" : "更新"}`);
    return;
  }
  await runChecked(context, [action, pluginId], `${pluginId} ${action} 失败`);
}

/**
 * 检查并应用全部 Plugin 更新。
 *
 * @param {object} context 交互上下文
 * @returns {Promise<void>} 完成信号
 */
async function updateAllPlugins(context) {
  if (context.store.readPlugins().plugins.length === 0) {
    context.output.log("  · 当前项目未声明 Plugin");
    return;
  }
  context.output.log("\n更新预览:");
  if (await runChecked(context, ["update", "--dry-run"], "Plugin 更新预览失败") !== 0) return;
  const confirmed = await context.prompts.confirm({
    message: "按上述计划更新项目 Plugin?",
    default: true,
  });
  if (confirmed) await runChecked(context, ["update"], "Plugin 更新失败");
  else context.output.log("  · 已取消更新");
}

/**
 * 管理一个 Marketplace 来源。
 *
 * @param {object} context 交互上下文
 * @param {string} sourceId 来源 ID
 * @returns {Promise<void>} 完成信号
 */
async function manageSource(context, sourceId) {
  const source = context.sourceStore.get(sourceId, { includeDisabled: true });
  let status;
  try {
    status = await context.authStatus(sourceId);
  } catch (error) {
    if (error?.code !== PLUGIN_RUNTIME_ERROR_CODES.AUTH_SCOPE_INVALID) throw error;
    status = { authorized: false, invalid: true };
  }
  const choices = [];
  if (source.type === "gitlab" && status.authorized) choices.push({
    name: "退出 GitLab 登录",
    value: "logout",
    description: "移除当前来源保存在本机的 GitLab 凭据。",
    section: "认证",
    icon: "↗",
    tone: "warning",
  });
  else if (source.type === "gitlab") {
    choices.push({
      name: status.invalid ? "重新获取授权码" : "使用授权码登录",
      value: "device",
      description: "显示 GitLab 地址和设备码，授权完成后自动返回来源页。",
      section: "认证",
      icon: "●",
      tone: "primary",
    });
    choices.push({
      name: "浏览器登录（高级）",
      value: "browser",
      description: "使用 PKCE 浏览器回调登录；普通场景建议使用授权码。",
      section: "认证",
      icon: "↗",
    });
  }
  choices.push({
    name: source.enabled ? "停用来源" : "启用来源",
    value: "toggle",
    description: source.enabled
      ? "停用后不会在发现页读取此 Marketplace。"
      : "启用后允许在发现页读取此 Marketplace。",
    section: "来源设置",
    icon: source.enabled ? "○" : "●",
  });
  choices.push({
    name: "编辑来源",
    value: "edit",
    description: source.type === "github"
      ? "修改公共仓库、ref 或子目录，并重新检测格式。"
      : "修改 GitLab 地址、项目路径、索引 ref 与 OAuth Application ID。",
    section: "来源设置",
    icon: "✎",
  });
  if (source.builtin && context.sourceStore.hasOverride(sourceId)) {
    choices.push({
      name: "恢复内置默认配置",
      value: "restore",
      description: "删除用户级覆盖，恢复 Flower 随包提供的来源配置。",
      section: "高级",
      icon: "↺",
      tone: "warning",
    });
  } else if (!source.builtin) choices.push({
    name: "删除来源",
    value: "remove",
    description: "删除此 Marketplace 配置；已安装 Plugin 不会被自动卸载。",
    section: "高级",
    icon: "×",
    tone: "danger",
  });
  choices.push({
    name: "返回来源",
    value: "back",
    description: "返回 Marketplace 来源列表。",
    section: "导航",
    icon: "←",
  });
  const actionPrompt = context.prompts.action || (async (config) => context.prompts.select({
    message: `管理 ${config.title}`,
    choices: config.choices,
    loop: false,
  }));
  const action = await actionPrompt({
    projectRoot: context.ctx.target,
    eyebrow: "来源",
    title: source.name,
    subtitle: `${source.id} · ${source.project || source.repository}`,
    facts: [
      {
        label: "状态",
        value: source.enabled ? "已启用" : "已停用",
        tone: source.enabled ? "success" : "muted",
      },
      source.type === "github" ? {
        label: "来源",
        value: `GitHub 公开 · ${source.format}`,
        tone: "success",
      } : {
        label: "GitLab",
        value: status.authorized ? "已登录" : status.invalid ? "凭据需更新" : "未登录",
        tone: status.authorized ? "success" : "warning",
      },
      {
        label: "配置",
        value: source.builtin ? "内置" : "自定义",
        tone: "muted",
      },
    ],
    choices,
  }, { clearPromptOnDone: true });
  if (action === "back") return;
  if (action === "device" || action === "browser") {
    await runChecked(context, [
      "auth", "login", sourceId,
      ...(action === "device" ? ["--device"] : []),
    ], `${source.name} 登录失败`);
  } else if (action === "logout") {
    await runChecked(context, ["auth", "logout", sourceId], `${source.name} 退出登录失败`);
  } else if (action === "toggle") {
    await runChecked(context, ["source", source.enabled ? "disable" : "enable", sourceId], `${source.name} 状态更新失败`);
  } else if (action === "edit") {
    const values = await promptSource(context.prompts, source);
    if (source.type === "github") {
      values.format = "auto";
      delete values.entryPath;
      const inspection = await inspectGitHubWithSelection(context, {
        schemaVersion: 2,
        id: sourceId,
        type: "github",
        name: values.name,
        enabled: source.enabled,
        repository: values.repository,
        ref: values.ref,
        ...(values.subdir ? { subdir: values.subdir } : {}),
        format: "auto",
      });
      printGitHubInspection(context.output, inspection);
      const confirmed = await context.prompts.confirm({ message: "保存这个 GitHub 来源?", default: true });
      if (!confirmed) return;
      values.format = inspection.detection.format;
      values.entryPath = inspection.detection.entryPath;
    }
    await runChecked(context, sourceCommand("update", sourceId, values), `${source.name} 更新失败`);
  } else if (action === "restore" || action === "remove") {
    const label = action === "restore" ? "恢复内置默认配置" : "删除来源";
    const confirmed = await context.prompts.confirm({ message: `确认${label} ${sourceId}?`, default: false });
    if (confirmed) await runChecked(context, ["source", "remove", sourceId], `${source.name} ${label}失败`);
    else context.output.log(`  · 已取消${label}`);
  }
  context.state.discovery = null;
}

/**
 * 执行管理器动作。
 *
 * @param {object} context 交互上下文
 * @param {string} actionKey 动作键
 * @param {Map<string,object>} actions 动作索引
 * @returns {Promise<void>} 完成信号
 */
async function handleAction(context, actionKey, actions) {
  if (actionKey === "refresh:discover") {
    context.state.discovery = null;
    return;
  }
  if (actionKey === "update:all") {
    await updateAllPlugins(context);
    return;
  }
  if (actionKey === "source:add") {
    const sourceType = await context.prompts.select({
      message: "选择来源类型",
      choices: [
        { name: "GitHub 公共仓库", value: "github", description: "无需登录，自动识别 Flower、Codex、Claude Code 或 Skill。" },
        { name: "GitLab Marketplace", value: "gitlab", description: "使用 GitLab OAuth 访问团队 Marketplace。" },
      ],
      loop: false,
    });
    const values = await promptSource(context.prompts, null, sourceType);
    if (sourceType === "github") {
      const inspection = await inspectGitHubWithSelection(context, {
        schemaVersion: 2,
        id: values.id,
        type: "github",
        name: values.name,
        enabled: true,
        repository: values.repository,
        ref: values.ref,
        ...(values.subdir ? { subdir: values.subdir } : {}),
        format: "auto",
      });
      printGitHubInspection(context.output, inspection);
      const confirmed = await context.prompts.confirm({ message: "添加这个 GitHub 来源?", default: true });
      if (!confirmed) return;
      values.format = inspection.detection.format;
      values.entryPath = inspection.detection.entryPath;
    }
    await runChecked(context, sourceCommand("add", values.id, values), `${values.name} 来源新增失败`);
    context.state.discovery = null;
    return;
  }

  const action = actions.get(actionKey);
  if (!action) return;
  if (action.type === "auth") {
    if (await runChecked(context, ["auth", "login", action.sourceId, "--device"], `${action.sourceId} 登录失败`) === 0) {
      context.state.discovery = null;
      context.state.activeTab = action.returnTab;
    }
  } else if (action.type === "plugin") {
    await installPlugin(context, action.plugin);
  } else if (action.type === "skill-manager") {
    await context.openSkillManager();
  } else if (action.type === "installed") {
    await manageInstalledPlugin(context, action.pluginId);
  } else if (action.type === "source") {
    await manageSource(context, action.sourceId);
  } else if (action.type === "issue") {
    context.output.log("");
    context.output.log(chalk.red.bold(action.issue.title));
    context.output.log(`  ${action.issue.description}`);
    await context.prompts.select({
      message: "问题详情",
      choices: [{ name: "返回问题列表", value: "back" }],
      loop: false,
    });
  }
}

/**
 * 运行交互式 Flower Plugin 管理器。
 *
 * @param {object} ctx cli.js 的解析上下文
 * @param {{prompts?:object,output?:{log:(message:string)=>void,error?:(message:string)=>void},store?:ProjectStore,sourceStore?:UserSourceStore,credentialBundle?:object,credentialStoreOptions?:object,remoteRuntime?:object,skillGardenProvider?:SkillGardenBuiltinProvider,openSkillManager?:()=>Promise<void>,runCommand:(args:string[],commandOptions?:object)=>Promise<number>|number,searchPlugins?:(query:string,sourceId:string)=>Promise<object[]>,authStatus?:(sourceId:string)=>Promise<object>,inspectGitHubSource?:(source:object)=>Promise<object>,confirmApproval?:Function,promptAuthoring?:Function}} options 交互依赖
 * @returns {Promise<number>} 退出码
 */
export async function runPluginInteractive(ctx, options) {
  if (typeof options?.runCommand !== "function") throw new TypeError("Plugin 交互管理器缺少命令执行器");
  const output = options.output || console;
  const prompts = options.prompts || await loadPrompts();
  if (typeof prompts.manager !== "function") throw new TypeError("Plugin 交互管理器缺少 manager prompt");
  const store = options.store || new ProjectStore(ctx.target);
  const sourceStore = options.sourceStore || new UserSourceStore(options.sourceStoreOptions);
  const skillGardenProvider = options.skillGardenProvider || new SkillGardenBuiltinProvider({
    projectRoot: ctx.target,
    previousState: store.readState(),
    lockedPlugin: store.readLock()?.plugins.find(({ id }) => id === SKILL_GARDEN_PLUGIN_ID) || null,
  });
  const credentialBundle = options.credentialBundle || await createCredentialStore(options.credentialStoreOptions);
  const remoteRuntime = options.remoteRuntime || await import("./plugin-remote.js");
  const promptAuthoring = options.promptAuthoring || (async (current) => ({
    id: current.id || await prompts.input({ message: "Canonical Plugin ID", required: true }),
    name: current.name || await prompts.input({ message: "Plugin 名称", required: true }),
    profile: current.profile || await prompts.select({
      message: "Capability profile",
      choices: [
        { name: "standard", value: "standard" },
        { name: "integration", value: "integration" },
      ],
      default: "standard",
    }),
  }));
  const confirmApproval = options.confirmApproval || ((requests) => prompts.confirm({
    message: `批准 ${requests.length} 个 Plugin 的 Integration Patch?`,
    default: false,
  }));
  const commandOptions = {
    ...options,
    output,
    sourceStore,
    credentialBundle,
    promptAuthoring,
    confirmApproval,
  };
  const searchPlugins = options.searchPlugins || (async (query, sourceId) => {
    const result = await remoteRuntime.searchPluginMarketplaces(
      { query, source: sourceId },
      ctx,
      commandOptions,
    );
    return result.results;
  });
  const authStatus = options.authStatus || ((sourceId) => remoteRuntime.getPluginAuthStatus(
    sourceId,
    commandOptions,
  ));
  const inspectGitHubSource = options.inspectGitHubSource || ((source) => remoteRuntime.inspectGitHubPluginSource(
    source,
    ctx,
    commandOptions,
  ));
  const openSkillManager = options.openSkillManager || (async () => {
    const { skill } = await import("./skill.js");
    await skill({ ...ctx, passthrough: [] });
  });
  const state = {
    activeTab: "discover",
    queries: Object.fromEntries(TAB_IDS.map((id) => [id, ""])),
    selectedByTab: Object.fromEntries(TAB_IDS.map((id) => [id, null])),
    discovery: null,
    issues: [],
  };
  const context = {
    ctx,
    prompts,
    output,
    store,
    sourceStore,
    skillGardenProvider,
    searchPlugins,
    authStatus,
    inspectGitHubSource,
    openSkillManager,
    runCommand: options.runCommand,
    commandOptions,
    state,
  };

  try {
    while (true) {
      const model = await buildManagerModel(context);
      clearInteractiveScreen(output);
      const result = await prompts.manager(model.prompt, { clearPromptOnDone: true });
      state.activeTab = result.tab;
      state.queries = result.queries;
      state.selectedByTab = result.selectedByTab;
      if (result.action === "exit") {
        output.log("  · 已退出 Plugin 管理");
        return 0;
      }
      await handleAction(context, result.action, model.actions);
    }
  } catch (error) {
    if (error?.name === "ExitPromptError" || error?.name === "AbortPromptError") return 130;
    throw error;
  }
}
