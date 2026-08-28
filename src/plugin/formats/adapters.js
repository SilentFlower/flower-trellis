import fs from "node:fs";
import path from "node:path";
import { normalizeExternalPlugin, normalizeFlowerPlugin } from "./normalized-package.js";
import { readFormatJson, relativeEntryPath } from "./shared.js";

/**
 * 构造一个格式检测结果。
 *
 * @param {object} values 检测字段
 * @returns {object} 检测结果
 */
function detection(values) {
  return {
    format: values.format,
    kind: values.kind,
    entryPath: values.entryPath,
    pluginRoot: values.pluginRoot,
    manifestPath: values.manifestPath,
    displayName: values.displayName,
    manifest: values.manifest || null,
  };
}

/**
 * 判断 manifest 声明的内容路径是否在指定根目录下存在。
 *
 * @param {string} root 检测根
 * @param {object} manifest Flower manifest
 * @returns {boolean} 是否存在声明内容
 */
function hasDeclaredContent(root, manifest) {
  const content = manifest?.content || {};
  const skillPaths = (content.skills || []).map((entry) => entry?.path).filter(Boolean);
  const passivePaths = ["specs", "assets", "scripts", "tests"]
    .flatMap((kind) => content[kind] || []);
  return [...skillPaths, ...passivePaths].some((entry) => (
    fs.existsSync(path.join(root, ...String(entry).split("/")))
  ));
}

/** Flower 原生格式 Adapter。 */
export const flowerFormatAdapter = Object.freeze({
  format: "flower",
  /** @param {string} root 检测根 @returns {object[]} 检测结果 */
  detect(root) {
    const results = [];
    const marketplace = path.join(root, ".flower-plugin", "marketplace.json");
    if (fs.existsSync(marketplace)) {
      const manifest = readFormatJson(marketplace, "Flower Marketplace");
      results.push(detection({
        format: "flower",
        kind: "marketplace",
        entryPath: relativeEntryPath(root, marketplace),
        pluginRoot: root,
        displayName: manifest.name || manifest.id || path.basename(root),
        manifest,
      }));
    }
    for (const pluginRoot of [path.join(root, ".flower-plugin"), root]) {
      const manifestFile = path.join(pluginRoot, "plugin.json");
      if (!fs.existsSync(manifestFile)) continue;
      const manifest = readFormatJson(manifestFile, "Flower Plugin");
      const metadataRoot = path.join(root, ".flower-plugin");
      const rootLevelMetadata = pluginRoot === metadataRoot &&
        hasDeclaredContent(root, manifest) &&
        !hasDeclaredContent(metadataRoot, manifest);
      results.push(detection({
        format: "flower",
        kind: "plugin",
        entryPath: relativeEntryPath(root, manifestFile),
        pluginRoot: rootLevelMetadata ? root : pluginRoot,
        manifestPath: rootLevelMetadata ? ".flower-plugin/plugin.json" : "plugin.json",
        displayName: manifest.name || manifest.id || path.basename(pluginRoot),
        manifest,
      }));
    }
    return results;
  },
  /** @param {object} selected 检测结果 @param {object} context 规范化上下文 @returns {object} 标准包 */
  normalize(selected, context) {
    return normalizeFlowerPlugin({
      ...context,
      pluginRoot: selected.pluginRoot,
      manifestPath: selected.manifestPath,
    });
  },
});

/** Codex Plugin 格式 Adapter。 */
export const codexFormatAdapter = Object.freeze({
  format: "codex",
  /** @param {string} root 检测根 @returns {object[]} 检测结果 */
  detect(root) {
    const results = [];
    const marketplace = path.join(root, ".agents", "plugins", "marketplace.json");
    if (fs.existsSync(marketplace)) {
      const manifest = readFormatJson(marketplace, "Codex Marketplace");
      results.push(detection({
        format: "codex",
        kind: "marketplace",
        entryPath: relativeEntryPath(root, marketplace),
        pluginRoot: root,
        displayName: manifest.interface?.displayName || manifest.name || path.basename(root),
        manifest,
      }));
    }
    const manifestFile = path.join(root, ".codex-plugin", "plugin.json");
    if (fs.existsSync(manifestFile)) {
      const manifest = readFormatJson(manifestFile, "Codex Plugin");
      results.push(detection({
        format: "codex",
        kind: "plugin",
        entryPath: relativeEntryPath(root, manifestFile),
        pluginRoot: root,
        displayName: manifest.interface?.displayName || manifest.name || path.basename(root),
        manifest,
      }));
    }
    return results;
  },
  /** @param {object} selected 检测结果 @param {object} context 规范化上下文 @returns {object} 标准包 */
  normalize(selected, context) {
    return normalizeExternalPlugin({
      ...context,
      pluginRoot: selected.pluginRoot,
      format: "codex",
      manifest: selected.manifest,
      externalName: selected.manifest?.name,
      externalVersion: selected.manifest?.version,
    });
  },
});

/** Claude Code Plugin 格式 Adapter。 */
export const claudeCodeFormatAdapter = Object.freeze({
  format: "claude-code",
  /** @param {string} root 检测根 @returns {object[]} 检测结果 */
  detect(root) {
    const results = [];
    const marketplace = path.join(root, ".claude-plugin", "marketplace.json");
    if (fs.existsSync(marketplace)) {
      const manifest = readFormatJson(marketplace, "Claude Code Marketplace");
      results.push(detection({
        format: "claude-code",
        kind: "marketplace",
        entryPath: relativeEntryPath(root, marketplace),
        pluginRoot: root,
        displayName: manifest.name || path.basename(root),
        manifest,
      }));
    }
    const manifestFile = path.join(root, ".claude-plugin", "plugin.json");
    if (fs.existsSync(manifestFile)) {
      const manifest = readFormatJson(manifestFile, "Claude Code Plugin");
      results.push(detection({
        format: "claude-code",
        kind: "plugin",
        entryPath: relativeEntryPath(root, manifestFile),
        pluginRoot: root,
        displayName: manifest.name || path.basename(root),
        manifest,
      }));
    }
    return results;
  },
  /** @param {object} selected 检测结果 @param {object} context 规范化上下文 @returns {object} 标准包 */
  normalize(selected, context) {
    return normalizeExternalPlugin({
      ...context,
      pluginRoot: selected.pluginRoot,
      format: "claude-code",
      manifest: selected.manifest,
      externalName: selected.manifest?.name,
      externalVersion: selected.manifest?.version,
      includeCommands: true,
    });
  },
});

/** 独立 Skill 集合 Adapter。 */
export const skillOnlyFormatAdapter = Object.freeze({
  format: "skill-only",
  /** @param {string} root 检测根 @returns {object[]} 检测结果 */
  detect(root) {
    const knownEntries = [
      ".flower-plugin/marketplace.json",
      ".flower-plugin/plugin.json",
      "plugin.json",
      ".agents/plugins/marketplace.json",
      ".codex-plugin/plugin.json",
      ".claude-plugin/marketplace.json",
      ".claude-plugin/plugin.json",
    ];
    if (knownEntries.some((entry) => fs.existsSync(path.join(root, ...entry.split("/"))))) return [];
    if (fs.existsSync(path.join(root, "SKILL.md"))) {
      return [detection({
        format: "skill-only",
        kind: "plugin",
        entryPath: "SKILL.md",
        pluginRoot: path.dirname(root),
        displayName: path.basename(root),
        manifest: { name: path.basename(root), skills: [path.basename(root)] },
      })];
    }
    const skillsRoot = path.join(root, "skills");
    if (!fs.existsSync(skillsRoot)) return [];
    return [detection({
      format: "skill-only",
      kind: "plugin",
      entryPath: "skills",
      pluginRoot: root,
      displayName: path.basename(root),
      manifest: { name: path.basename(root), skills: ["skills"] },
    })];
  },
  /** @param {object} selected 检测结果 @param {object} context 规范化上下文 @returns {object} 标准包 */
  normalize(selected, context) {
    return normalizeExternalPlugin({
      ...context,
      pluginRoot: selected.pluginRoot,
      format: "skill-only",
      manifest: selected.manifest,
      externalName: selected.displayName,
    });
  },
});

/** 默认格式 Adapter 顺序。 */
export const DEFAULT_FORMAT_ADAPTERS = Object.freeze([
  flowerFormatAdapter,
  codexFormatAdapter,
  claudeCodeFormatAdapter,
  skillOnlyFormatAdapter,
]);
