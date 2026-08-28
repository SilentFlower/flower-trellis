import path from "node:path";
import semver from "semver";
import { PluginPathError } from "../errors.js";

/** Flower Plugin schema 版本。 */
export const PLUGIN_SCHEMA_VERSION = 1;

/** Plugin/source 本地 ID 的正则源。 */
export const PLUGIN_ID_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*$";

/** canonical Plugin ID 的正则源。 */
export const CANONICAL_PLUGIN_ID_PATTERN =
  "^[a-z0-9]+(?:-[a-z0-9]+)*/[a-z0-9]+(?:-[a-z0-9]+)*$";

/** contentSelection.skills 与 manifest Skill 条目名称的正则源。 */
export const CONTENT_SKILL_NAME_PATTERN = "^(?!\\.{1,2}$)[^/\\\\]+$";

/** SHA-256 摘要的正则源。 */
export const SHA256_DIGEST_PATTERN = "^sha256:[a-f0-9]{64}$";

/** Git commit SHA 的正则源。 */
export const GIT_COMMIT_PATTERN = "^[a-fA-F0-9]{40}$";

/**
 * 判断字符串是否为合法 Plugin/source 本地 ID。
 *
 * @param {unknown} value 待判断值
 * @returns {boolean} 是否合法
 */
export function isPluginId(value) {
  return typeof value === "string" && new RegExp(PLUGIN_ID_PATTERN).test(value);
}

/**
 * 判断字符串是否为 canonical Plugin ID。
 *
 * @param {unknown} value 待判断值
 * @returns {boolean} 是否合法
 */
export function isCanonicalPluginId(value) {
  return typeof value === "string" && new RegExp(CANONICAL_PLUGIN_ID_PATTERN).test(value);
}

/**
 * 组合 canonical Plugin ID。
 *
 * @param {string} sourceId 来源 ID
 * @param {string} pluginId Plugin 本地 ID
 * @returns {string} canonical Plugin ID
 */
export function composeCanonicalPluginId(sourceId, pluginId) {
  if (!isPluginId(sourceId) || !isPluginId(pluginId)) {
    throw new PluginPathError(`无法组合非法 Plugin ID:${sourceId}/${pluginId}`);
  }
  return `${sourceId}/${pluginId}`;
}

/**
 * 拆分 canonical Plugin ID。
 *
 * @param {string} value canonical Plugin ID
 * @returns {{sourceId:string,pluginId:string}} 来源与本地 ID
 */
export function parseCanonicalPluginId(value) {
  if (!isCanonicalPluginId(value)) {
    throw new PluginPathError(`非法 canonical Plugin ID:${value}`);
  }
  const [sourceId, pluginId] = value.split("/");
  return { sourceId, pluginId };
}

/**
 * 判断字符串是否为严格 SemVer。
 *
 * @param {unknown} value 待判断值
 * @returns {boolean} 是否合法
 */
export function isStrictSemVer(value) {
  if (typeof value !== "string") return false;
  const normalized = semver.valid(value, { loose: false });
  return normalized !== null && normalized === value;
}

/**
 * 判断字符串是否为有效 SemVer range。
 *
 * @param {unknown} value 待判断值
 * @returns {boolean} 是否合法
 */
export function isSemVerRange(value) {
  return typeof value === "string" && semver.validRange(value, { loose: false }) !== null;
}

/**
 * 判断字符串是否为 SHA-256 摘要。
 *
 * @param {unknown} value 待判断值
 * @returns {boolean} 是否合法
 */
export function isSha256Digest(value) {
  return typeof value === "string" && new RegExp(SHA256_DIGEST_PATTERN).test(value);
}

/**
 * 判断字符串是否为完整 Git commit SHA。
 *
 * @param {unknown} value 待判断值
 * @returns {boolean} 是否合法
 */
export function isGitCommit(value) {
  return typeof value === "string" && new RegExp(GIT_COMMIT_PATTERN).test(value);
}

/**
 * 校验项目内 POSIX 相对路径。
 *
 * @param {unknown} value 待校验路径
 * @param {string} [label] 诊断标签
 * @returns {string} 已校验路径
 */
export function assertSafePosixRelativePath(value, label = "Plugin 路径") {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\\") ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value)
  ) {
    throw new PluginPathError(`${label} 必须是非空 POSIX 相对路径`, {
      path: typeof value === "string" ? value : "",
    });
  }
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new PluginPathError(`${label} 包含不安全路径片段:${value}`, { path: value });
  }
  return value;
}

/**
 * 判断值是否为安全 POSIX 相对路径。
 *
 * @param {unknown} value 待判断值
 * @returns {boolean} 是否安全
 */
export function isSafePosixRelativePath(value) {
  try {
    assertSafePosixRelativePath(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * 判断 GitLab project path 是否由安全的非空段组成。
 *
 * @param {unknown} value 待判断值
 * @returns {boolean} 是否合法
 */
export function isGitLabProjectPath(value) {
  if (typeof value !== "string" || value.includes("\\")) return false;
  const segments = value.split("/");
  return segments.length >= 2 && segments.every(
    (segment) => segment && segment !== "." && segment !== "..",
  );
}

/**
 * 判断 GitHub 仓库是否使用 `owner/repository` 形式。
 *
 * @param {unknown} value 待判断值
 * @returns {boolean} 是否合法
 */
export function isGitHubRepository(value) {
  if (typeof value !== "string" || value.includes("\\")) return false;
  const segments = value.split("/");
  return segments.length === 2 && segments.every((segment) => (
    /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(segment)
  ));
}

/** 可复用的安全相对路径 JSON Schema。 */
export const SAFE_PATH_SCHEMA = Object.freeze({ type: "string", format: "posix-relative-path" });

/** 可复用的内容 Skill 名称 JSON Schema。 */
export const CONTENT_SKILL_NAME_SCHEMA = Object.freeze({
  type: "string",
  minLength: 1,
  pattern: CONTENT_SKILL_NAME_PATTERN,
});

/** 可复用的 capability 名称 JSON Schema。 */
export const CAPABILITY_NAME_SCHEMA = Object.freeze({
  type: "string",
  pattern: "^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$",
});
