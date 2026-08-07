const { execFileSync } = require("node:child_process");
const conventionalCommits = require("conventional-changelog-conventionalcommits");
const configSpec = require("conventional-changelog-config-spec");
const semver = require("semver");
const releaseConfig = require("../../.versionrc.cjs");

const COMMIT_FORMAT_WITHOUT_TAGS = "%B%n-hash-%n%H%n-committerDate-%n%ci";

/**
 * 从标签列表中选择版本最高的稳定标签。
 *
 * @param {string[]} tags Git 标签列表
 * @returns {string} 最近稳定标签
 */
function selectLatestStableTag(tags) {
  const stableTags = tags
    .map((tag) => String(tag || "").trim())
    .filter(Boolean)
    .map((tag) => ({ tag, version: semver.valid(tag.replace(/^v/, "")) }))
    .filter(({ version }) => version && semver.prerelease(version) === null)
    .sort((a, b) => semver.rcompare(a.version, b.version));

  if (stableTags.length === 0) {
    throw new Error("未找到可作为稳定版发布起点的稳定标签");
  }
  return stableTags[0].tag;
}

/**
 * 读取当前 HEAD 可达的 Git 标签。
 *
 * @returns {string[]} 当前分支已合并标签
 */
function listMergedTags() {
  return execFileSync(
    "git",
    ["tag", "--merged", "HEAD", "--list", "v*"],
    { encoding: "utf8" },
  ).split("\n");
}

/**
 * 为稳定版生成聚合 CHANGELOG 的 Conventional Commits preset。
 *
 * @returns {Promise<object>} Conventional Changelog preset 配置
 */
async function stableReleasePreset() {
  const presetOptions = {};
  for (const key of Object.keys(configSpec.properties)) {
    if (releaseConfig[key] !== undefined) {
      presetOptions[key] = releaseConfig[key];
    }
  }

  const preset = await conventionalCommits(presetOptions);
  const previousTag = selectLatestStableTag(listMergedTags());
  return {
    ...preset,
    gitRawCommitsOpts: {
      ...preset.gitRawCommitsOpts,
      from: previousTag,
      // 稳定版要聚合整个 beta 周期，因此不能让中间预发布标签触发分段。
      format: COMMIT_FORMAT_WITHOUT_TAGS,
    },
  };
}

module.exports = stableReleasePreset;
module.exports.COMMIT_FORMAT_WITHOUT_TAGS = COMMIT_FORMAT_WITHOUT_TAGS;
module.exports.selectLatestStableTag = selectLatestStableTag;
