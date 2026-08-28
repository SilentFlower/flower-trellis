import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import chalk from "chalk";
import semver from "semver";
import {
  SKILL_GARDEN_PLUGIN_ID,
  SkillGardenBuiltinProvider,
} from "../builtin-plugins/skill-garden/provider.js";
import { readLegacyManifestStatus } from "../lib/manifest.js";
import { summarizeSkillDescription } from "../lib/skill-catalog.js";
import { flowerVersion } from "../lib/versions.js";
import { createCredentialStore } from "../plugin/auth/keyring-credential-store.js";
import {
  detectPluginPlatforms,
  listPluginPlatforms,
} from "../plugin/install/platform-detector.js";
import { PLUGIN_RUNTIME_ERROR_CODES } from "../plugin/runtime-errors.js";
import {
  normalizeGitHubRepository,
  UserSourceStore,
} from "../plugin/sources/user-source-store.js";
import { ProjectStore } from "../plugin/state/project-store.js";
import {
  contentSelectionsEqual,
  contentSelectionArgs,
  contentSelectionFromSkillNames,
  normalizeContentSelection,
} from "../plugin/content-selection.js";
import { parseCanonicalPluginId } from "../plugin/schemas/shared.js";
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
 * 推断安装时应使用的平台；没有任何平台证据时返回空列表。
 *
 * 服务层本身会按「显式平台 → 既有 state 平台 → 项目探测」兜底，所以这里返回非空
 * 就意味着不必再问用户；返回空才需要交互补齐。
 *
 * @param {string} projectRoot 项目根
 * @param {object|null} state 当前应用状态
 * @returns {string[]} 已推断出的平台
 */
function inferPlatforms(projectRoot, state) {
  const applied = [...new Set((state?.plugins || []).flatMap(({ platforms }) => platforms))];
  if (applied.length > 0) return applied;
  try {
    return detectPluginPlatforms(projectRoot).platforms;
  } catch {
    return [];
  }
}

/**
 * 为安装流程选择默认平台。
 *
 * @param {string} projectRoot 项目根
 * @param {object|null} state 当前应用状态
 * @returns {string[]} 默认选中平台
 */
function defaultPlatforms(projectRoot, state) {
  const inferred = inferPlatforms(projectRoot, state);
  if (inferred.length > 0) return inferred;
  const supported = new Set(listPluginPlatforms());
  return ["codex", "claude"].filter((platform) => supported.has(platform));
}

/**
 * 计算一次更新应当使用的版本约束。
 *
 * Marketplace 常常只保留最新版，此时旧的精确锁会让解析器筛不到任何候选并直接报错。
 * 这里把「最新版是否仍落在声明范围内」显式区分出来，让交互层可以在跨兼容边界时先问人。
 *
 * @param {{declared?:string,available?:string[]}} input 当前声明与 Marketplace 可用版本
 * @returns {{action:"in-range"|"widen"|"unknown",latest?:string,nextRange?:string}} 更新计划
 */
export function planVersionUpdate(input = {}) {
  const available = (input.available || []).filter((value) => semver.valid(value));
  if (available.length === 0) return { action: "unknown" };
  const latest = [...available].sort(semver.rcompare)[0];
  const declared = input.declared || "";
  if (semver.validRange(declared) && semver.satisfies(latest, declared)) {
    return { action: "in-range", latest };
  }
  return { action: "widen", latest, nextRange: `^${latest}` };
}

/**
 * 从缓存的发现页结果中读取某个 Plugin 的 Marketplace 版本列表。
 *
 * @param {object} state 交互状态
 * @param {string} pluginId canonical Plugin ID
 * @returns {string[]} 可用版本；未知时为空
 */
function marketplaceVersions(state, pluginId) {
  const entry = (state.discovery?.entries || [])
    .find((candidate) => candidate.kind === "plugin" && candidate.plugin.id === pluginId);
  return entry?.plugin.versions || [];
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
 * 计算纯文本宽度，用于对齐 Skill 名称。
 *
 * @param {string[]} values 文本列表
 * @returns {number} 最大宽度
 */
function maxTextWidth(values) {
  return Math.max(0, ...values.map((value) => String(value).length));
}

/**
 * 判断 canonical Plugin 是否来自 rd-guide Marketplace。
 *
 * @param {string} pluginId canonical Plugin ID
 * @param {string|null|undefined} source 显式来源 ID
 * @returns {boolean} 是否 rd-guide 来源
 */
function isRdGuideMarketplacePlugin(pluginId, source) {
  const sourceId = source || parseCanonicalPluginId(pluginId).sourceId;
  return sourceId === "rd-guide";
}

/**
 * 从多份 Project 记录中读取第一份显式 Skill 选择。
 *
 * @param {...object|null|undefined} entries Project plugin 记录
 * @returns {import("../plugin/contracts.js").PluginContentSelection|undefined} 归一化后的选择
 */
function firstContentSelection(...entries) {
  for (const entry of entries) {
    const selection = normalizeContentSelection(entry?.contentSelection);
    if (selection) return selection;
  }
  return undefined;
}

/**
 * 生成 rd-guide 来源级 Skill 入口的元信息。
 *
 * @param {string} sourceName 来源展示名
 * @param {object|null|undefined} selection 当前 Skill 选择
 * @returns {string} 不暴露底层 Plugin 包版本的元信息
 */
function rdGuideSkillMeta(sourceName, selection) {
  const normalized = normalizeContentSelection(selection);
  const count = normalized?.skills?.length || 0;
  return count > 0 ? `${sourceName} · 已启用 ${count} 个技能` : sourceName;
}

/**
 * 为一次 Skill 清单 inspection 构造会话缓存键。
 *
 * @param {{pluginId:string,version?:string,source?:string|null,lockedPlugin?:object|null}} input 选择输入
 * @returns {string|null} 缓存键
 */
function skillInspectionCacheKey(input) {
  const pluginId = input.pluginId || input.lockedPlugin?.id;
  if (!pluginId) return null;
  const sourceId = input.source || input.lockedPlugin?.source?.id || parseCanonicalPluginId(pluginId).sourceId;
  const version = input.version || input.lockedPlugin?.version || "";
  const integrity = input.lockedPlugin?.integrity || "";
  return [sourceId, pluginId, version, integrity].join("\u0000");
}

/**
 * 生成 Marketplace Skill 管理标题。
 *
 * @param {string} pluginId canonical Plugin ID
 * @returns {string} 标题
 */
function skillSelectionTitle(pluginId) {
  const { sourceId } = parseCanonicalPluginId(pluginId);
  return sourceId === "rd-guide" ? "RD Guide 技能管理" : `${pluginId} Skill 管理`;
}

/**
 * 生成普通 Marketplace Skill 选择页文案。
 *
 * @param {{pluginId:string,source?:string|null}} input 选择输入
 * @param {{version?:string,name?:string}} inspection inspection 结果
 * @returns {{title:string,meta:string,section:string,hint:string,message:string,empty:string}} 文案集合
 */
function skillSelectionLabels(input, inspection) {
  if (isRdGuideMarketplacePlugin(input.pluginId, input.source)) {
    return {
      title: "RD Guide 技能管理",
      meta: "来源 rd-guide",
      section: "可选研发技能",
      hint: "勾选表示启用，取消勾选表示停用；未勾选项仍保留在清单中，可重新启用。",
      message: "选择要启用的 RD Guide 技能",
      empty: "未选择 RD Guide 技能，已取消安装",
    };
  }
  return {
    title: skillSelectionTitle(input.pluginId),
    meta: [inspection.name || input.pluginId, inspection.version ? `版本 ${inspection.version}` : ""]
      .filter(Boolean)
      .join(" · "),
    section: "可选 Plugin 技能",
    hint: "勾选表示启用，取消勾选表示停用。",
    message: "选择要启用的 Plugin 技能",
    empty: "未选择 Plugin 技能，已取消",
  };
}

/**
 * 打印普通 Marketplace Skill 选择页头部。
 *
 * @param {object} context 交互上下文
 * @param {{title:string,meta:string,section:string,hint:string}} labels 文案集合
 * @returns {void}
 */
function printMarketplaceSkillHeader(context, labels) {
  context.output.log("");
  context.output.log(chalk.hex(TITLE_COLOR).bold(labels.title));
  if (labels.meta) context.output.log(chalk.gray(`  ${labels.meta}`));
  context.output.log("");
  context.output.log(chalk.bold(labels.section));
  context.output.log(chalk.gray(`  ${labels.hint}`));
}

/**
 * 构造 Marketplace Skill checkbox 选项。
 *
 * @param {Array<{name:string,path:string,description?:string,version?:string}>} skills Skill 清单
 * @param {Set<string>} defaults 默认勾选项
 * @returns {Array<object>} checkbox choices
 */
function buildMarketplaceSkillChoices(skills, defaults) {
  const width = maxTextWidth(skills.map(({ name }) => name));
  const versionWidth = maxTextWidth(skills.map(({ version }) => version ? `v${version}` : ""));
  return skills.map((skill) => {
    const description = skill.description
      ? summarizeSkillDescription(skill.description, 34)
      : summarizeSkillDescription(skill.path, 34);
    const version = skill.version ? `v${skill.version}` : "";
    const detail = versionWidth > 0
      ? `${version.padEnd(versionWidth)}  ${description}`
      : description;
    const label = `${skill.name.padEnd(width)}  ${chalk.gray(detail)}`;
    return {
      name: label,
      short: skill.name,
      checkedName: label,
      value: skill.name,
      checked: defaults.has(skill.name),
    };
  });
}

/**
 * 创建与内置 skill 管理一致的中文 checkbox 主题。
 *
 * @returns {object} Inquirer theme
 */
function marketplaceSkillCheckboxTheme() {
  return {
    style: {
      description: (text) => chalk.gray(text),
      keysHelpTip: (keys) =>
        keys
          .map(([key, action]) => {
            const keyLabels = {
              escape: "Esc",
              space: "空格",
              "⏎": "回车",
            };
            const labels = {
              navigate: "移动",
              select: "选择",
              submit: "确认",
            };
            return `${chalk.bold(keyLabels[key] || key)} ${chalk.gray(labels[action] || action)}`;
          })
          .concat(`${chalk.bold("ESC")} ${chalk.gray("退出")}`)
          .join(chalk.gray(" · ")),
      renderSelectedChoices: (selectedChoices) =>
        selectedChoices.map((choice) => choice.short).join(", "),
    },
  };
}

/**
 * 创建 Esc 取消控制器。
 *
 * @returns {{signal?:AbortSignal,dispose:Function,isEscAbort:Function}} prompt signal 与清理函数
 */
function createEscAbortController() {
  if (!process.stdin?.isTTY) {
    return { dispose: () => {}, isEscAbort: () => false };
  }
  const controller = new AbortController();
  let abortedByEsc = false;
  readline.emitKeypressEvents(process.stdin);

  const onKeypress = (_value, key) => {
    if (key && key.name === "escape") {
      abortedByEsc = true;
      controller.abort();
    }
  };
  process.stdin.on("keypress", onKeypress);

  return {
    signal: controller.signal,
    dispose: () => process.stdin.off("keypress", onKeypress),
    isEscAbort: () => abortedByEsc,
  };
}

/**
 * 判断已安装 Plugin 是否适合展示普通 Marketplace Skill 选择入口。
 *
 * @param {string} pluginId canonical Plugin ID
 * @param {object|null|undefined} declaration 直接声明
 * @returns {boolean} 是否展示入口
 */
function supportsMarketplaceSkillSelection(pluginId, declaration) {
  if (pluginId === SKILL_GARDEN_PLUGIN_ID) return false;
  const sourceId = declaration?.source || parseCanonicalPluginId(pluginId).sourceId;
  return sourceId !== "local" && sourceId !== "flower";
}

/**
 * 读取并提示用户选择普通 Marketplace Plugin 的 Skill 子集。
 *
 * @param {object} context 交互上下文
 * @param {{pluginId:string,version?:string,source?:string|null,currentSelection?:object|null,lockedPlugin?:object|null,emptySelectionAction?:"cancel"|"return",defaultSelected?:boolean}} input 选择输入
 * @returns {Promise<{ok:boolean,selection:object|null,emptySelection?:boolean}>} 选择结果；无 Skill 时 selection 为 null
 */
async function promptMarketplaceSkillSelection(context, input) {
  let inspection;
  const cacheKey = skillInspectionCacheKey(input);
  try {
    inspection = cacheKey ? context.state.skillInspections.get(cacheKey) : null;
    if (!inspection) {
      if (isRdGuideMarketplacePlugin(input.pluginId, input.source)) {
        context.output.log("\n正在读取 RD Guide 技能清单...");
      }
      inspection = await context.inspectPluginContentSkills(input);
      if (cacheKey) context.state.skillInspections.set(cacheKey, inspection);
    }
  } catch (error) {
    recordIssue(context.state, `${input.pluginId} Skill 清单读取失败`, error);
    context.state.lastFailure = `${input.pluginId} Skill 清单读取失败`;
    return { ok: false, selection: null };
  }
  const skills = inspection.skills || [];
  if (skills.length === 0) return { ok: true, selection: null };
  const currentSelection = normalizeContentSelection(input.currentSelection);
  const initialDefaultSkills = input.defaultSelected === false
    ? []
    : skills.map(({ name }) => name);
  const defaults = new Set(
    currentSelection?.skills || initialDefaultSkills,
  );
  const labels = skillSelectionLabels(input, inspection);
  printMarketplaceSkillHeader(context, labels);
  let selected;
  const escAbort = createEscAbortController();
  try {
    selected = await context.prompts.checkbox({
      message: labels.message,
      choices: buildMarketplaceSkillChoices(skills, defaults),
      required: false,
      loop: false,
      pageSize: Math.min(skills.length, 12),
      shortcuts: { all: null, invert: null },
      theme: marketplaceSkillCheckboxTheme(),
    }, escAbort.signal ? { signal: escAbort.signal } : undefined);
  } catch (err) {
    if (err && err.name === "AbortPromptError" && escAbort.isEscAbort()) {
      context.output.log("  · 已取消 Skill 选择");
      return { ok: false, selection: null };
    }
    if (err && err.name === "ExitPromptError") {
      throw new Error("已取消 Skill 管理");
    }
    throw err;
  } finally {
    escAbort.dispose();
  }
  if (selected.length === 0) {
    if (input.emptySelectionAction === "return") {
      return { ok: true, selection: null, emptySelection: true };
    }
    context.output.log(`  · ${labels.empty}`);
    return { ok: false, selection: null, emptySelection: true };
  }
  return {
    ok: true,
    selection: contentSelectionFromSkillNames(selected, {
      code: PLUGIN_RUNTIME_ERROR_CODES.USAGE_ERROR,
      path: input.pluginId,
    }),
  };
}

/**
 * 把用户可识别的仓库或项目名转换成内部来源标识。
 *
 * @param {unknown} value 来源名称、项目路径或仓库地址
 * @returns {string} 可作为 source ID 的基础值
 */
function slugifySourceId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\.git$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

/**
 * 取路径最后一段作为默认来源标识，避免把内部 source ID 放到第一步交互。
 *
 * @param {unknown} value 项目路径或仓库地址
 * @returns {string} 默认来源标识基础值
 */
function sourceIdBaseName(value) {
  const segments = String(value || "")
    .trim()
    .replace(/\.git$/i, "")
    .replace(/^https?:\/\/[^/]+\//i, "")
    .split("/")
    .filter(Boolean);
  return segments.at(-1) || "source";
}

/**
 * 为新增来源生成不会冲突的内部来源标识。
 *
 * @param {unknown} base 来源基础值
 * @param {Set<string>} existingIds 已存在来源 ID
 * @returns {string} 唯一 source ID
 */
function uniqueSourceId(base, existingIds) {
  const normalized = slugifySourceId(base) || "source";
  if (!existingIds.has(normalized)) return normalized;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${normalized}-${index}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `source-${Date.now()}`;
}

/**
 * 计算新增来源可用的现有 ID 集合。
 *
 * @param {UserSourceStore} sourceStore 来源存储
 * @param {string} [currentId] 编辑中的当前 ID
 * @returns {Set<string>} 已占用 ID
 */
function existingSourceIds(sourceStore, currentId) {
  return new Set(sourceStore.list()
    .map(({ id }) => id)
    .filter((id) => id !== currentId));
}

/**
 * 从 GitHub 输入中推导默认来源标识。
 *
 * @param {unknown} repository GitHub URL 或 owner/repository
 * @returns {string} 来源标识基础值
 */
function githubSourceIdBase(repository) {
  try {
    return sourceIdBaseName(normalizeGitHubRepository(repository));
  } catch {
    return sourceIdBaseName(repository);
  }
}

/**
 * 根据来源标识生成更适合展示的默认名称。
 *
 * @param {unknown} value 来源基础值
 * @returns {string} 默认显示名称
 */
function defaultSourceName(value) {
  const slug = slugifySourceId(value);
  if (!slug) return "Plugin Source";
  return slug.split("-")
    .map((segment) => `${segment.slice(0, 1).toUpperCase()}${segment.slice(1)}`)
    .join(" ");
}

/**
 * 规范化 GitLab 地址，便于复用已有来源的默认 OAuth 应用。
 *
 * @param {unknown} value GitLab 地址
 * @returns {string} 规范化地址
 */
function normalizeGitLabBaseUrl(value) {
  try {
    const url = new URL(String(value || ""));
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return String(value || "").trim().replace(/\/+$/, "");
  }
}

/**
 * 生成 GitLab 项目 URL，作为新增来源时的用户可读默认值。
 *
 * @param {object|null} source GitLab 来源
 * @returns {string|undefined} 项目 URL
 */
function gitLabProjectUrl(source) {
  if (!source?.baseUrl || !source?.project) return undefined;
  return `${normalizeGitLabBaseUrl(source.baseUrl)}/${String(source.project).replace(/^\/+/, "")}`;
}

/**
 * 解析 GitLab Marketplace 项目 URL，保留 group/project 兼容作为隐藏兜底。
 *
 * @param {unknown} value 项目 URL
 * @param {string} fallbackBaseUrl 默认 GitLab 地址
 * @returns {{baseUrl:string,project:string}} 解析后的地址与项目路径
 */
function parseGitLabProjectLocator(value, fallbackBaseUrl = "") {
  const raw = String(value || "").trim();
  if (!/^https?:\/\//i.test(raw)) return {
    baseUrl: normalizeGitLabBaseUrl(fallbackBaseUrl),
    project: raw.replace(/^\/+|\/+$/g, ""),
  };
  const url = new URL(raw);
  const segments = url.pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  const marker = segments.indexOf("-");
  const project = (marker === -1 ? segments : segments.slice(0, marker)).join("/");
  return {
    baseUrl: normalizeGitLabBaseUrl(`${url.protocol}//${url.host}`),
    project,
  };
}

/**
 * 找到同 GitLab 地址的已有来源，用于补全新增来源默认值。
 *
 * @param {UserSourceStore} sourceStore 来源存储
 * @param {string} [baseUrl] GitLab 地址
 * @returns {object|null} 已有 GitLab 来源
 */
function findGitLabDefaultSource(sourceStore, baseUrl = "") {
  const sources = sourceStore.list().filter(({ type }) => type === "gitlab");
  const normalizedBaseUrl = normalizeGitLabBaseUrl(baseUrl);
  return sources.find((source) => normalizeGitLabBaseUrl(source.baseUrl) === normalizedBaseUrl)
    || sources[0]
    || null;
}

/**
 * 收集 GitLab source 表单值。
 *
 * @param {object} prompts prompt adapter
 * @param {object|null} current 当前 source
 * @param {Set<string>} existingIds 已存在来源 ID
 * @param {UserSourceStore} sourceStore 来源存储
 * @returns {Promise<object>} source 表单值
 */
async function promptGitLabSource(prompts, current, existingIds, sourceStore) {
  const values = {};
  if (!current) {
    const existing = findGitLabDefaultSource(sourceStore);
    const locator = await prompts.input({
      message: "GitLab 项目 URL",
      default: gitLabProjectUrl(existing),
      required: true,
    });
    const parsed = parseGitLabProjectLocator(locator, existing?.baseUrl);
    values.baseUrl = parsed.baseUrl || await prompts.input({
      message: "GitLab 地址（http/https）",
      default: existing?.baseUrl,
      required: true,
    });
    values.project = parsed.project;
    const defaults = findGitLabDefaultSource(sourceStore, values.baseUrl);
    values.id = uniqueSourceId(sourceIdBaseName(values.project), existingIds);
    values.name = defaultSourceName(values.id);
    values.ref = "main";
    values.marketplacePath = ".flower-plugin/marketplace.json";
    values.applicationId = defaults?.oauth?.applicationId || await prompts.input({
      message: "OAuth 应用 ID（Application ID）",
      required: true,
    });
    return values;
  }
  values.baseUrl = await prompts.input({
    message: "GitLab 地址（http/https）",
    default: current?.baseUrl,
    required: true,
  });
  values.project = await prompts.input({
    message: "Marketplace 项目路径（group/project）",
    default: current?.project,
    required: true,
  });
  values.name = await prompts.input({
    message: "显示名称",
    default: current?.name || sourceIdBaseName(values.project),
    required: true,
  });
  values.ref = await prompts.input({ message: "索引 ref（branch/tag/commit）", default: current?.ref || "main", required: true });
  values.marketplacePath = await prompts.input({
    message: "Marketplace 文件路径",
    default: current?.marketplacePath || ".flower-plugin/marketplace.json",
    required: true,
  });
  values.applicationId = await prompts.input({
    message: "OAuth 应用 ID（Application ID）",
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
 * @param {Set<string>} existingIds 已存在来源 ID
 * @returns {Promise<object>} source 表单值
 */
async function promptGitHubSource(prompts, current, existingIds) {
  const values = { type: "github" };
  values.repository = await prompts.input({
    message: "GitHub 仓库（URL 或 owner/repo）",
    default: current?.repository,
    required: true,
  });
  if (!current) {
    values.id = uniqueSourceId(githubSourceIdBase(values.repository), existingIds);
    values.name = defaultSourceName(values.id);
    values.ref = "";
    values.subdir = "";
    values.format = "auto";
    return values;
  }
  values.ref = await prompts.input({ message: "分支 / tag / commit（留空使用默认分支）", default: current?.ref || "" });
  values.subdir = await prompts.input({
    message: "仓库子目录（可留空）",
    default: current?.subdir || "",
  });
  values.name = await prompts.input({
    message: "显示名称",
    default: current?.name || githubSourceIdBase(values.repository),
    required: true,
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
 * @param {UserSourceStore} sourceStore 来源存储
 * @param {"gitlab"|"github"} [sourceType] 新增来源类型
 * @returns {Promise<object>} source 表单值
 */
async function promptSource(prompts, current, sourceStore, sourceType) {
  const type = current?.type || sourceType;
  const usedIds = existingSourceIds(sourceStore, current?.id);
  if (type === "github") return promptGitHubSource(prompts, current, usedIds);
  return { type: "gitlab", ...await promptGitLabSource(prompts, current, usedIds, sourceStore) };
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
    context.output.log(
      `\n正在按已选择入口继续检测:${selected.displayName || selected.entryPath}`,
    );
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
 * 让 Marketplace 目录与登录态一起失效。
 *
 * 二者来自同一批网络与凭据读取，任何认证或来源变更都会同时影响它们；
 * 分开失效会让发现页出现「已登录但仍显示需要登录」这类漂移。
 *
 * @param {object} state 交互状态
 * @returns {void}
 */
function invalidateDiscovery(state) {
  state.discovery = null;
  state.authStatuses.clear();
  state.skillInspections?.clear();
}

/**
 * 构造 Flower 内置 Plugin 的发现页 entry。
 *
 * @param {object} context 交互上下文
 * @returns {object[]} 内置 entry
 */
function buildBuiltinDiscoverEntries(context) {
  if (!fs.existsSync(path.join(context.ctx.target, ".trellis"))) {
    return [{ kind: "builtin", id: SKILL_GARDEN_PLUGIN_ID, version: flowerVersion() }];
  }
  try {
    const candidate = context.skillGardenProvider.listCandidates(SKILL_GARDEN_PLUGIN_ID)[0];
    if (!candidate) return [];
    return [{ kind: "builtin", id: candidate.id, version: candidate.version }];
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
 * 主循环在每次动作后会清屏重绘，命令自身打印的 `❌` 行会被一并抹掉。
 * 这里额外记下失败标记，让主循环先停下来让用户读完再继续。
 *
 * @param {object} context 交互上下文
 * @param {string[]} args 命令参数
 * @param {string} title 失败标题
 * @returns {Promise<number>} 退出码
 */
async function runChecked(context, args, title) {
  const code = await context.runCommand(args, context.commandOptions);
  if (code !== 0) {
    recordIssue(context.state, title, new Error(`命令退出码 ${code}`));
    context.state.lastFailure = title;
  }
  return code;
}

/**
 * 拉取发现页原始 entry，并缓存已授权 Marketplace 的目录。
 *
 * 这里只缓存 Marketplace 侧的事实（来源、登录态、Plugin 记录）。已安装状态会随安装、
 * 卸载、更新实时变化，交给 renderDiscoverItems 每轮重新计算，避免缓存导致状态过期。
 *
 * @param {object} context 交互上下文
 * @param {Map<string,object>} statuses 登录状态
 * @returns {Promise<object[]>} 发现页 entry
 */
async function loadDiscoverEntries(context, statuses) {
  if (context.state.discovery) return context.state.discovery.entries;

  const entries = [];
  entries.push(...buildBuiltinDiscoverEntries(context));
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
      entries.push({ kind: "auth", source, invalid: Boolean(status.error) });
      continue;
    }
    try {
      const results = await context.searchPlugins("", source.id);
      for (const plugin of results) {
        entries.push({
          kind: "plugin",
          source,
          plugin: { ...plugin, source: plugin.source || source.id },
        });
      }
    } catch (error) {
      if ([PLUGIN_RUNTIME_ERROR_CODES.AUTH_REQUIRED, PLUGIN_RUNTIME_ERROR_CODES.AUTH_SCOPE_INVALID].includes(error?.code)) {
        entries.push({ kind: "auth", source, invalid: true });
      } else {
        recordIssue(context.state, `${source.name} Marketplace 加载失败`, error);
      }
    }
  }
  if (sources.length === 0) entries.push({ kind: "no-source" });
  context.state.discovery = { entries };
  return entries;
}

/**
 * 计算一个 Marketplace Plugin 相对当前项目的安装状态。
 *
 * @param {object} plugin Marketplace Plugin 记录
 * @param {{declared:Map<string,object>,locked:Map<string,object>,applied?:Map<string,object>}} project 项目视图索引
 * @returns {{installed:boolean,current:string|null,latest:string,outdated:boolean}} 安装状态
 */
function installedStatus(plugin, project) {
  const latest = [...plugin.versions].sort(semver.rcompare)[0] || "未知版本";
  const declaration = project.declared.get(plugin.id);
  if (!declaration) return { installed: false, current: null, latest, outdated: false };
  const current = project.locked.get(plugin.id)?.version || declaration.version;
  const outdated = Boolean(
    semver.valid(current) && semver.valid(latest) && semver.gt(latest, current),
  );
  return { installed: true, current, latest, outdated };
}

/**
 * 把发现页 entry 渲染成当前项目视角下的条目。
 *
 * @param {object[]} entries 发现页 entry
 * @param {{declared:Map<string,object>,locked:Map<string,object>,applied?:Map<string,object>}} project 项目视图索引
 * @param {Map<string,object>} actions 动作索引
 * @returns {object[]} 发现页条目
 */
function renderDiscoverItems(entries, project, actions) {
  const items = [];
  for (const entry of entries) {
    if (entry.kind === "builtin") {
      const key = `builtin:${entry.id}`;
      actions.set(key, { type: "skill-manager", pluginId: entry.id });
      items.push({
        title: entry.id,
        meta: `Flower 内置 · ${entry.version}`,
        description: "管理 Skill Garden 提供的工作流强化与可选通用技能。",
        badge: "内置",
        tone: "success",
        value: key,
      });
      continue;
    }
    if (entry.kind === "auth") {
      const key = `auth:${entry.source.id}`;
      actions.set(key, { type: "auth", sourceId: entry.source.id, returnTab: "discover" });
      items.push({
        title: entry.source.name,
        meta: entry.source.project,
        description: entry.invalid
          ? "现有凭据已失效，按 Enter 获取新授权码并覆盖旧凭据。"
          : "按 Enter 获取 GitLab 授权码，完成后自动返回这里加载插件。",
        badge: entry.invalid ? "重新登录" : "需要登录",
        tone: "warning",
        value: key,
      });
      continue;
    }
    if (entry.kind === "plugin") {
      const { plugin, source } = entry;
      const status = installedStatus(plugin, project);
      const key = `plugin:${source.id}:${plugin.id}`;
      const declaration = project.declared.get(plugin.id);
      const lock = project.locked.get(plugin.id);
      const state = project.applied?.get(plugin.id);
      const isRdGuide = isRdGuideMarketplacePlugin(plugin.id, source.id);
      const selection = firstContentSelection(declaration, state, lock);
      const meta = isRdGuide
        ? rdGuideSkillMeta(source.name, selection)
        : status.outdated
          ? `${source.name} · ${status.current} → ${status.latest}`
          : `${source.name} · ${status.current || status.latest}`;
      const badge = isRdGuide
        ? status.installed ? "已安装" : source.id
        : status.outdated ? "可更新" : status.installed ? "已安装" : source.id;
      const tone = isRdGuide
        ? status.installed ? "success" : "info"
        : status.outdated ? "warning" : status.installed ? "success" : "info";
      actions.set(key, status.installed
        ? { type: isRdGuide && selection ? "marketplace-skills" : "installed", pluginId: plugin.id }
        : { type: "plugin", plugin });
      items.push({
        title: isRdGuide ? "RD Guide 技能" : plugin.id,
        meta,
        description: isRdGuide
          ? status.installed
            ? "已安装，按 Enter 管理当前启用的 RD Guide 技能。"
            : "按 Enter 选择要启用的 RD Guide 技能。"
          : status.installed
            ? `${plugin.description || "暂无描述"}（已安装，按 Enter 校验、更新或卸载）`
            : plugin.description || "暂无描述",
        badge,
        tone,
        value: key,
      });
      continue;
    }
    if (entry.kind === "no-source") {
      items.push({
        title: "没有启用的 Plugin 来源",
        description: "切换到“来源”页签新增或启用 Marketplace。",
        badge: "空",
        tone: "muted",
        value: "discover:empty",
        disabled: true,
      });
    }
  }
  if (items.length === 0) {
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
  // 登录态与 Marketplace 目录同生命周期缓存：主循环每完成一次动作都会重建视图，
  // 若每轮都重查全部来源，Keyring 读取会成为固定的启动开销。
  const statuses = context.state.authStatuses;
  const sources = context.sourceStore.list();
  for (const source of sources) {
    if (statuses.has(source.id)) continue;
    try {
      statuses.set(source.id, await context.authStatus(source.id));
    } catch (error) {
      if (error?.code !== PLUGIN_RUNTIME_ERROR_CODES.AUTH_SCOPE_INVALID) {
        recordIssue(context.state, `${source.name} 登录状态读取失败`, error);
      }
      statuses.set(source.id, { authorized: false, error: true });
    }
  }

  const locked = new Map((view.lock?.plugins || []).map((plugin) => [plugin.id, plugin]));
  const applied = new Map((view.state?.plugins || []).map((plugin) => [plugin.id, plugin]));
  const declared = new Map(view.plugins.plugins.map((plugin) => [plugin.id, plugin]));
  const discoverEntries = await loadDiscoverEntries(context, statuses);
  const discover = renderDiscoverItems(discoverEntries, { declared, locked, applied }, actions);
  const sourceNames = new Map(sources.map(({ id, name }) => [id, name]));
  const installed = view.plugins.plugins.map((declaration) => {
    const lock = locked.get(declaration.id);
    const state = applied.get(declaration.id);
    const version = lock?.version || declaration.version;
    const platforms = state?.platforms?.join(", ") || "未应用";
    const key = `installed:${declaration.id}`;
    const isRdGuide = isRdGuideMarketplacePlugin(declaration.id, declaration.source);
    const selection = firstContentSelection(declaration, state, lock);
    const directSkillManager = isRdGuide && Boolean(selection);
    actions.set(key, { type: directSkillManager ? "marketplace-skills" : "installed", pluginId: declaration.id });
    return {
      title: directSkillManager ? "RD Guide 技能" : declaration.id,
      meta: directSkillManager
        ? rdGuideSkillMeta(sourceNames.get(declaration.source) || declaration.source, selection)
        : `${version} · ${platforms}`,
      description: directSkillManager
        ? "按 Enter 管理当前启用的 RD Guide 技能。"
        : `来源 ${declaration.source}，按 Enter 校验、更新或卸载。`,
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
 * 执行 Marketplace Plugin 安装计划。
 *
 * @param {object} context 交互上下文
 * @param {object} plugin Plugin 搜索结果
 * @returns {Promise<void>} 完成信号
 */
async function installSelectedPlugin(context, plugin) {
  const versions = [...plugin.versions].sort(semver.rcompare);
  // Marketplace 只发一个版本时没有可选项，多问一步只是噪音。
  const version = versions.length === 1
    ? versions[0]
    : await context.prompts.select({
      message: "选择版本",
      choices: versions.map((value) => ({ name: value, value })),
      loop: false,
    });
  // 声明写兼容范围而不是精确版本，否则 Marketplace 一发新版，解析器就再也筛不到候选。
  const range = `^${version}`;
  const args = ["add", plugin.id, "--version", range];
  const skillSelection = await promptMarketplaceSkillSelection(context, {
    pluginId: plugin.id,
    version,
    source: plugin.source,
  });
  if (!skillSelection.ok) return;
  args.push(...contentSelectionArgs(skillSelection.selection));
  // 平台交给服务层的「既有 state → 项目探测」链；只有项目完全没有平台证据时才问用户。
  const current = readProjectView(context.store, context.ctx.target);
  if (inferPlatforms(context.ctx.target, current.state).length === 0) {
    const defaults = new Set(defaultPlatforms(context.ctx.target, current.state));
    const platforms = await context.prompts.checkbox({
      message: "当前项目还没有可识别的平台，请选择安装目标",
      choices: listPluginPlatforms().map((platform) => ({
        name: platform,
        value: platform,
        checked: defaults.has(platform),
      })),
      required: true,
      loop: false,
      pageSize: 12,
    });
    args.push(...withPlatforms([], platforms));
  }
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
 * 读取 Marketplace 返回的最新版本。
 *
 * @param {object} plugin Plugin 搜索结果
 * @returns {string|null} 最新 SemVer 版本
 */
function latestMarketplaceVersion(plugin) {
  const versions = (plugin.versions || []).filter((value) => semver.valid(value));
  if (versions.length === 0) return null;
  return [...versions].sort(semver.rcompare)[0];
}

/**
 * 直接应用 rd-guide Skill 选择。
 *
 * rd-guide 在 TUI 中按来源级 Skill 管理呈现；平台缺失时沿用普通安装页的默认平台推断，
 * 但不把底层平台选择、dry-run 预览和确认流暴露给用户。
 *
 * @param {object} context 交互上下文
 * @param {object} plugin Plugin 搜索结果
 * @returns {Promise<void>} 完成信号
 */
async function installRdGuideSkills(context, plugin) {
  const version = latestMarketplaceVersion(plugin);
  if (!version) {
    recordIssue(context.state, `${plugin.id} 安装失败`, new Error("Marketplace 没有可安装版本"));
    context.state.lastFailure = `${plugin.id} 安装失败`;
    return;
  }
  const skillSelection = await promptMarketplaceSkillSelection(context, {
    pluginId: plugin.id,
    version,
    source: plugin.source,
    defaultSelected: false,
  });
  if (!skillSelection.ok || !skillSelection.selection) return;
  let args = [
    "add",
    plugin.id,
    "--version",
    `^${version}`,
    ...contentSelectionArgs(skillSelection.selection),
  ];
  const current = readProjectView(context.store, context.ctx.target);
  if (inferPlatforms(context.ctx.target, current.state).length === 0) {
    args = withPlatforms(args, defaultPlatforms(context.ctx.target, current.state));
  }
  context.output.log("\n正在应用 RD Guide 技能选择...");
  if (await runChecked(context, args, `${plugin.id} 安装失败`) === 0) {
    context.output.log("  · RD Guide 技能已应用");
    context.state.activeTab = "installed";
  }
}

/**
 * 停用全部 RD Guide 技能。
 *
 * 当前 contentSelection.skills 不允许为空；当用户在已安装的 rd-guide 技能管理中取消全部勾选时，
 * 最接近内置 Skill 管理语义的项目状态是移除这个 rd-guide Plugin 声明与投影文件。
 *
 * @param {object} context 交互上下文
 * @param {string} pluginId canonical Plugin ID
 * @returns {Promise<void>} 完成信号
 */
async function removeRdGuideSkills(context, pluginId) {
  context.output.log("\n正在停用全部 RD Guide 技能...");
  if (await runChecked(context, ["remove", pluginId], `${pluginId} 停用失败`) === 0) {
    context.output.log("  · RD Guide 技能已全部停用");
    context.state.activeTab = "discover";
  }
}

/**
 * 展示远程 Plugin 详情并执行安装。
 *
 * rd-guide 是来源级 Skill 管理体验，用户选中后直接进入技能列表；普通 Marketplace
 * Plugin 仍保留详情页，避免把已有插件安装流程全部改成 Skill 管理模型。
 *
 * @param {object} context 交互上下文
 * @param {object} plugin Plugin 搜索结果
 * @returns {Promise<void>} 完成信号
 */
async function installPlugin(context, plugin) {
  if (isRdGuideMarketplacePlugin(plugin.id, plugin.source)) {
    await installRdGuideSkills(context, plugin);
    return;
  }

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
  await installSelectedPlugin(context, plugin);
}

/**
 * 计算一个已安装 Plugin 的更新版本约束。
 *
 * 内置 skill-garden 的版本跟随 flower 本体，不参与 Marketplace range 协商。
 *
 * @param {object} context 交互上下文
 * @param {string} pluginId canonical Plugin ID
 * @returns {{action:"in-range"|"widen"|"unknown",latest?:string,nextRange?:string,declared?:string}} 更新计划
 */
function updatePlanFor(context, pluginId) {
  if (pluginId === SKILL_GARDEN_PLUGIN_ID) return { action: "unknown" };
  const declaration = context.store.readPlugins().plugins.find(({ id }) => id === pluginId);
  if (!declaration) return { action: "unknown" };
  const plan = planVersionUpdate({
    declared: declaration.version,
    available: marketplaceVersions(context.state, pluginId),
  });
  return { ...plan, declared: declaration.version };
}

/**
 * 收集全部需要放宽的声明。
 *
 * 声明范围盖不住最新版时，该 Plugin 的锁定包通常也已从 Marketplace 移除。解析器对
 * 未请求更新的节点执行 lock-first，遇到不可重放的锁定包会抛 `已锁定 Plugin 包不可重放`，
 * 于是「只更新 A」会被 B 挡住、「只更新 B」又被 A 挡住。放宽必须一次覆盖全部被阻塞的
 * 声明，并按 `update: "all"` 解析，才能解开这种互锁。
 *
 * @param {object} context 交互上下文
 * @returns {Array<{id:string,declared:string,latest:string,nextRange:string}>} 需要放宽的声明
 */
function collectWidenPlan(context) {
  return context.store.readPlugins().plugins
    .map(({ id }) => ({ id, ...updatePlanFor(context, id) }))
    .filter(({ action }) => action === "widen")
    .map(({ id, declared, latest, nextRange }) => ({ id, declared, latest, nextRange }));
}

/**
 * 构造批量放宽命令参数。
 *
 * @param {Array<{id:string,nextRange:string}>} plan 放宽计划
 * @returns {string[]} 命令参数
 */
function widenArgs(plan) {
  return ["update", ...plan.flatMap(({ id, nextRange }) => ["--widen", `${id}=${nextRange}`])];
}

/**
 * 打印放宽计划，让跨兼容边界的升级在确认前完全可见。
 *
 * @param {object} context 交互上下文
 * @param {Array<{id:string,declared:string,latest:string,nextRange:string}>} plan 放宽计划
 * @returns {void}
 */
function printWidenPlan(context, plan) {
  context.output.log("");
  context.output.log(chalk.yellow("  ! 以下声明未覆盖 Marketplace 最新版，将一并放宽后更新:"));
  for (const entry of plan) {
    context.output.log(chalk.yellow(`    ${entry.id}  ${entry.declared} → ${entry.nextRange}（${entry.latest}）`));
  }
}

/**
 * 管理已安装 Marketplace Plugin 的 Skill 选择。
 *
 * @param {object} context 交互上下文
 * @param {string} pluginId canonical Plugin ID
 * @returns {Promise<void>} 完成信号
 */
async function managePluginSkillSelection(context, pluginId) {
  const view = readProjectView(context.store, context.ctx.target);
  const declaration = view.plugins.plugins.find(({ id }) => id === pluginId) || null;
  const lockedPlugin = (view.lock?.plugins || []).find(({ id }) => id === pluginId) || null;
  const applied = (view.state?.plugins || []).find(({ id }) => id === pluginId) || null;
  const currentSelection = declaration?.contentSelection || applied?.contentSelection || lockedPlugin?.contentSelection || null;
  if (!declaration) {
    recordIssue(context.state, `${pluginId} Skill 选择失败`, new Error(`项目未声明 Plugin:${pluginId}`));
    context.state.lastFailure = `${pluginId} Skill 选择失败`;
    return;
  }
  const rdGuide = isRdGuideMarketplacePlugin(pluginId, declaration.source);
  const version = lockedPlugin?.version || marketplaceVersions(context.state, pluginId)[0] || null;
  const skillSelection = await promptMarketplaceSkillSelection(context, {
    pluginId,
    version,
    source: declaration.source,
    currentSelection,
    emptySelectionAction: rdGuide ? "return" : "cancel",
    ...(lockedPlugin ? { lockedPlugin } : {}),
  });
  if (!skillSelection.ok) return;
  if (skillSelection.emptySelection) {
    if (rdGuide) await removeRdGuideSkills(context, pluginId);
    return;
  }
  if (!skillSelection.selection) return;
  if (contentSelectionsEqual(currentSelection, skillSelection.selection)) {
    context.output.log("  · Skill 选择没有修改");
    return;
  }
  const args = ["update", pluginId, ...contentSelectionArgs(skillSelection.selection)];
  if (rdGuide) {
    context.output.log("\n正在应用 RD Guide 技能选择...");
    if (await runChecked(context, args, `${pluginId} Skill 选择更新失败`) === 0) {
      context.output.log("  · RD Guide 技能选择已应用");
    }
    return;
  }
  context.output.log("\n更新 Skill 选择预览:");
  if (await runChecked(context, [...args, "--dry-run"], `${pluginId} Skill 选择预览失败`) !== 0) return;
  const confirmed = await context.prompts.confirm({
    message: `应用 ${pluginId} 的 Skill 选择?`,
    default: true,
  });
  if (!confirmed) {
    context.output.log("  · 已取消 Skill 选择更新");
    return;
  }
  await runChecked(context, args, `${pluginId} Skill 选择更新失败`);
}

/**
 * 管理一个已安装 Plugin。
 *
 * @param {object} context 交互上下文
 * @param {string} pluginId Plugin ID
 * @returns {Promise<void>} 完成信号
 */
async function manageInstalledPlugin(context, pluginId) {
  const view = readProjectView(context.store, context.ctx.target);
  const declaration = view.plugins.plugins.find(({ id }) => id === pluginId) || null;
  const canManageSkills = supportsMarketplaceSkillSelection(pluginId, declaration);
  const action = await context.prompts.select({
    message: `管理 ${pluginId}`,
    choices: [
      { name: "校验安装状态", value: "verify" },
      ...(canManageSkills ? [{ name: "管理 Skill 选择", value: "skills" }] : []),
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
  if (action === "update") {
    await runUpdate(context, collectWidenPlan(context), pluginId);
    return;
  }
  if (action === "skills") {
    await managePluginSkillSelection(context, pluginId);
    return;
  }
  context.output.log("\n卸载预览:");
  if (await runChecked(context, ["remove", pluginId, "--dry-run"], `${pluginId} 卸载预览失败`) !== 0) return;
  const confirmed = await context.prompts.confirm({
    message: `确认卸载 ${pluginId}?`,
    default: false,
  });
  if (!confirmed) {
    context.output.log("  · 已取消卸载");
    return;
  }
  await runChecked(context, ["remove", pluginId], `${pluginId} 卸载失败`);
}

/**
 * 执行一次更新：需要放宽时走批量放宽，否则按请求范围普通更新。
 *
 * @param {object} context 交互上下文
 * @param {Array<{id:string,declared:string,latest:string,nextRange:string}>} plan 放宽计划
 * @param {string|null} pluginId 只更新单个 Plugin 时的 ID
 * @returns {Promise<void>} 完成信号
 */
async function runUpdate(context, plan, pluginId) {
  let args = pluginId ? ["update", pluginId] : ["update"];
  let message = pluginId ? `确认更新 ${pluginId}?` : "按上述计划更新项目 Plugin?";
  if (plan.length > 0) {
    printWidenPlan(context, plan);
    if (pluginId && !plan.some(({ id }) => id === pluginId)) {
      context.output.log(chalk.yellow(`    （${pluginId} 本身在范围内，但上述声明不放宽则整图无法解析）`));
    }
    args = widenArgs(plan);
    message = `放宽 ${plan.length} 个声明并更新项目 Plugin?`;
  }
  context.output.log("\n更新预览:");
  if (await runChecked(context, [...args, "--dry-run"], "Plugin 更新预览失败") !== 0) return;
  const confirmed = await context.prompts.confirm({ message, default: true });
  if (!confirmed) {
    context.output.log("  · 已取消更新");
    return;
  }
  await runChecked(context, args, "Plugin 更新失败");
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
  await runUpdate(context, collectWidenPlan(context), null);
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
  if (!source.builtin) choices.push({
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
    const values = await promptSource(context.prompts, source, context.sourceStore);
    if (source.type === "github") {
      values.format = "auto";
      delete values.entryPath;
      const inspection = await inspectGitHubSourceForUi(context, {
        schemaVersion: 2,
        id: sourceId,
        type: "github",
        name: values.name,
        enabled: source.enabled,
        repository: values.repository,
        ref: values.ref,
        ...(values.subdir ? { subdir: values.subdir } : {}),
        format: "auto",
      }, source.name);
      if (!inspection) return;
      printGitHubInspection(context.output, inspection);
      const confirmed = await context.prompts.confirm({ message: "保存这个 GitHub 来源?", default: true });
      if (!confirmed) return;
      values.format = inspection.detection.format;
      values.entryPath = inspection.detection.entryPath;
    }
    context.output.log(`\n正在保存 ${source.type === "github" ? "GitHub" : "GitLab"} 来源:${sourceId}`);
    await runChecked(context, sourceCommand("update", sourceId, values), `${source.name} 更新失败`);
  } else if (action === "restore" || action === "remove") {
    const label = action === "restore" ? "恢复内置默认配置" : "删除来源";
    const confirmed = await context.prompts.confirm({ message: `确认${label} ${sourceId}?`, default: false });
    if (confirmed) await runChecked(context, ["source", "remove", sourceId], `${source.name} ${label}失败`);
    else context.output.log(`  · 已取消${label}`);
  }
  invalidateDiscovery(context.state);
}

/**
 * 选择新增来源类型，并保留明确返回与退出入口。
 *
 * @param {object} context 交互上下文
 * @returns {Promise<"github"|"gitlab"|"back"|"exit">} 用户选择
 */
async function promptNewSourceType(context) {
  const choices = [
    {
      name: "GitHub 公共仓库",
      value: "github",
      description: "输入 GitHub URL 或 owner/repo，自动识别 Flower、Codex、Claude Code 或 Skill。",
      section: "来源类型",
      icon: "◆",
      tone: "primary",
    },
    {
      name: "GitLab Marketplace",
      value: "gitlab",
      description: "连接团队 GitLab 项目；需要只读 OAuth 应用 ID，后续可用授权码登录。",
      section: "来源类型",
      icon: "◆",
    },
    {
      name: "返回来源",
      value: "back",
      description: "回到来源列表，不新增来源。",
      section: "导航",
      icon: "←",
    },
    {
      name: "退出管理",
      value: "exit",
      description: "关闭 Flower Plugin 管理器。",
      section: "导航",
      icon: "×",
      tone: "danger",
    },
  ];
  const actionPrompt = context.prompts.action || (async (config) => context.prompts.select({
    message: config.title,
    choices: config.choices,
    loop: false,
  }));
  return actionPrompt({
    projectRoot: context.ctx.target,
    eyebrow: "来源",
    title: "新增来源",
    subtitle: "选择要连接的来源类型",
    facts: [{
      label: "保存",
      value: "确认前不写入配置",
      tone: "muted",
    }],
    choices,
  }, { clearPromptOnDone: true });
}

/**
 * 检测 GitHub 来源，并把失败留在交互管理器的问题页。
 *
 * @param {object} context 交互上下文
 * @param {object} source GitHub 来源草稿
 * @param {string} title 来源标题
 * @returns {Promise<object|null>} 探测结果；失败时返回 null
 */
async function inspectGitHubSourceForUi(context, source, title) {
  context.output.log(`\n正在检测 GitHub 来源:${source.repository}`);
  try {
    return await inspectGitHubWithSelection(context, source);
  } catch (error) {
    recordIssue(context.state, `${title} GitHub 来源检测失败`, error);
    context.state.activeTab = "issues";
    invalidateDiscovery(context.state);
    context.output.log(chalk.yellow("  ! GitHub 来源检测失败，已记录到问题页。"));
    return null;
  }
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
    invalidateDiscovery(context.state);
    return;
  }
  if (actionKey === "update:all") {
    await updateAllPlugins(context);
    return;
  }
  if (actionKey === "source:add") {
    const sourceType = await promptNewSourceType(context);
    if (sourceType === "back") return;
    if (sourceType === "exit") {
      context.state.exitRequested = true;
      return;
    }
    const values = await promptSource(context.prompts, null, context.sourceStore, sourceType);
    if (sourceType === "github") {
      const inspection = await inspectGitHubSourceForUi(context, {
        schemaVersion: 2,
        id: values.id,
        type: "github",
        name: values.name,
        enabled: true,
        repository: values.repository,
        ref: values.ref,
        ...(values.subdir ? { subdir: values.subdir } : {}),
        format: "auto",
      }, values.name);
      if (!inspection) return;
      printGitHubInspection(context.output, inspection);
      const confirmed = await context.prompts.confirm({ message: "添加这个 GitHub 来源?", default: true });
      if (!confirmed) return;
      values.format = inspection.detection.format;
      values.entryPath = inspection.detection.entryPath;
    }
    context.output.log(`\n正在保存 ${sourceType === "github" ? "GitHub" : "GitLab"} 来源:${values.id}`);
    await runChecked(context, sourceCommand("add", values.id, values), `${values.name} 来源新增失败`);
    invalidateDiscovery(context.state);
    return;
  }

  const action = actions.get(actionKey);
  if (!action) return;
  if (action.type === "auth") {
    if (await runChecked(context, ["auth", "login", action.sourceId, "--device"], `${action.sourceId} 登录失败`) === 0) {
      invalidateDiscovery(context.state);
      context.state.activeTab = action.returnTab;
    }
  } else if (action.type === "plugin") {
    await installPlugin(context, action.plugin);
  } else if (action.type === "skill-manager") {
    await context.openSkillManager();
  } else if (action.type === "marketplace-skills") {
    await managePluginSkillSelection(context, action.pluginId);
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
 * @param {{prompts?:object,output?:{log:(message:string)=>void,error?:(message:string)=>void},store?:ProjectStore,sourceStore?:UserSourceStore,credentialBundle?:object,credentialStoreOptions?:object,remoteRuntime?:object,skillGardenProvider?:SkillGardenBuiltinProvider,openSkillManager?:()=>Promise<void>,runCommand:(args:string[],commandOptions?:object)=>Promise<number>|number,searchPlugins?:(query:string,sourceId:string)=>Promise<object[]>,authStatus?:(sourceId:string)=>Promise<object>,inspectGitHubSource?:(source:object)=>Promise<object>,inspectPluginContentSkills?:(request:object)=>Promise<object>,confirmApproval?:Function,promptAuthoring?:Function}} options 交互依赖
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
  const inspectPluginContentSkills = options.inspectPluginContentSkills || ((request) => (
    remoteRuntime.inspectPluginContentSkills(request, ctx, commandOptions)
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
    authStatuses: new Map(),
    skillInspections: new Map(),
    issues: [],
    lastFailure: null,
    exitRequested: false,
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
    inspectPluginContentSkills,
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
      if (state.exitRequested) {
        output.log("  · 已退出 Plugin 管理");
        return 0;
      }
      if (state.lastFailure) {
        // 命令已经把 `❌` 打到终端，但下一轮会清屏；先停下来让用户读完。
        const failure = state.lastFailure;
        state.lastFailure = null;
        await prompts.select({
          message: `${failure}，返回管理器?`,
          choices: [{ name: "返回", value: "back" }],
          loop: false,
        });
      }
    }
  } catch (error) {
    if (error?.name === "ExitPromptError" || error?.name === "AbortPromptError") return 130;
    throw error;
  }
}
