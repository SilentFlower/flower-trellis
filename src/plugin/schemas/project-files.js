import {
  CAPABILITY_NAME_SCHEMA,
  PLUGIN_SCHEMA_VERSION,
  SAFE_PATH_SCHEMA,
  parseCanonicalPluginId,
} from "./shared.js";
import { createSchemaValidator, schemaIssue } from "./validator.js";

const sourceDescriptorSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "type", "reference"],
      properties: {
        id: { type: "string", format: "plugin-id" },
        type: { const: "builtin" },
        reference: { type: "string", pattern: "^[a-z0-9][a-z0-9:./-]*$" },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "type", "reference"],
      properties: {
        id: { type: "string", format: "plugin-id" },
        type: { const: "local" },
        reference: SAFE_PATH_SCHEMA,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "type", "reference"],
      properties: {
        id: { type: "string", format: "plugin-id" },
        type: { const: "gitlab" },
        reference: { type: "string", format: "gitlab-project" },
        indexCommit: { type: "string", format: "git-commit" },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "type", "reference", "format", "entryPath"],
      properties: {
        id: { type: "string", format: "plugin-id" },
        type: { const: "github" },
        reference: { type: "string", format: "github-repository" },
        subdir: SAFE_PATH_SCHEMA,
        format: { enum: ["flower", "codex", "claude-code", "skill-only"] },
        entryPath: SAFE_PATH_SCHEMA,
        indexReference: { type: "string", format: "github-repository" },
        indexCommit: { type: "string", format: "git-commit" },
      },
    },
  ],
};

const capabilityGrantSchema = {
  type: "object",
  additionalProperties: false,
  required: ["profile", "granted", "denied", "approvalDigest"],
  properties: {
    profile: { enum: ["standard", "integration", "system"] },
    granted: { type: "array", items: CAPABILITY_NAME_SCHEMA, uniqueItems: true },
    denied: { type: "array", items: CAPABILITY_NAME_SCHEMA, uniqueItems: true },
    approvalDigest: { type: ["string", "null"], format: "sha256" },
  },
};

/** `.flower/plugins.json` v1 JSON Schema。 */
export const PLUGINS_FILE_SCHEMA = Object.freeze({
  $id: "https://flower-trellis.local/schema/plugins-file-v1.json",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "plugins"],
  properties: {
    schemaVersion: { const: PLUGIN_SCHEMA_VERSION },
    plugins: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "source", "version"],
        properties: {
          id: { type: "string", format: "canonical-plugin-id" },
          source: { type: "string", format: "plugin-id" },
          version: { type: "string", format: "semver-range" },
          platforms: {
            type: "array",
            items: { type: "string", format: "plugin-id" },
            uniqueItems: true,
          },
        },
      },
    },
  },
});

/** `.flower/plugin-lock.json` v1 JSON Schema。 */
export const PLUGIN_LOCK_SCHEMA = Object.freeze({
  $id: "https://flower-trellis.local/schema/plugin-lock-v1.json",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "roots", "plugins"],
  properties: {
    schemaVersion: { const: PLUGIN_SCHEMA_VERSION },
    roots: {
      type: "array",
      items: { type: "string", format: "canonical-plugin-id" },
      uniqueItems: true,
    },
    plugins: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "version",
          "source",
          "commit",
          "integrity",
          "dependencies",
          "compatibility",
          "capabilities",
        ],
        properties: {
          id: { type: "string", format: "canonical-plugin-id" },
          version: { type: "string", format: "semver" },
          source: sourceDescriptorSchema,
          commit: { type: ["string", "null"], format: "git-commit" },
          integrity: { type: "string", format: "sha256" },
          dependencies: {
            type: "object",
            propertyNames: { format: "canonical-plugin-id" },
            additionalProperties: { type: "string", format: "semver" },
          },
          compatibility: {
            type: "object",
            additionalProperties: false,
            required: ["flower"],
            properties: {
              flower: { type: "string", format: "semver-range" },
              trellis: { type: "string", format: "semver-range" },
            },
          },
          capabilities: capabilityGrantSchema,
        },
      },
    },
  },
});

/** `.flower/state.json` v1 JSON Schema。 */
export const PLUGIN_STATE_SCHEMA = Object.freeze({
  $id: "https://flower-trellis.local/schema/plugin-state-v1.json",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "transactionVersion", "plugins"],
  properties: {
    schemaVersion: { const: PLUGIN_SCHEMA_VERSION },
    transactionVersion: { const: 1 },
    plugins: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "version", "platforms", "paths", "patches"],
        properties: {
          id: { type: "string", format: "canonical-plugin-id" },
          version: { type: "string", format: "semver" },
          platforms: {
            type: "array",
            items: { type: "string", format: "plugin-id" },
            uniqueItems: true,
          },
          paths: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["path", "kind", "hash", "ownership"],
              properties: {
                path: SAFE_PATH_SCHEMA,
                kind: { enum: ["file", "directory"] },
                hash: { type: "string", format: "sha256" },
                ownership: { enum: ["exclusive", "shared"] },
              },
            },
          },
          patches: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["operation", "target", "resultHash"],
              properties: {
                operation: { type: "string", minLength: 1 },
                target: SAFE_PATH_SCHEMA,
                resultHash: { type: "string", format: "sha256" },
              },
            },
          },
        },
      },
    },
    migration: {
      type: "object",
      additionalProperties: false,
      required: ["source", "schemaVersion"],
      properties: {
        source: { const: "legacy-flower-manifest" },
        schemaVersion: { type: "integer", minimum: 1 },
      },
    },
  },
});

/**
 * 收集数组对象 ID 重复 issue。
 *
 * @param {Array<{id:string}>} entries 条目
 * @param {string} basePath 数组 JSON Pointer
 * @returns {Array<{code:string,path:string,message:string}>} issue
 */
function duplicateIdIssues(entries, basePath) {
  const seen = new Set();
  const issues = [];
  entries.forEach((entry, index) => {
    if (seen.has(entry.id)) {
      issues.push(schemaIssue("project.duplicate-plugin", `${basePath}/${index}/id`, `Plugin ID 重复:${entry.id}`));
    }
    seen.add(entry.id);
  });
  return issues;
}

const validatePlugins = createSchemaValidator(
  PLUGINS_FILE_SCHEMA,
  ".flower/plugins.json",
  (value) => {
    const pluginsFile = /** @type {{plugins:Array<{id:string,source:string}>}} */ (value);
    const issues = duplicateIdIssues(pluginsFile.plugins, "/plugins");
    pluginsFile.plugins.forEach((plugin, index) => {
      if (parseCanonicalPluginId(plugin.id).sourceId !== plugin.source) {
        issues.push(schemaIssue(
          "project.source-mismatch",
          `/plugins/${index}/source`,
          `Plugin source 与 canonical ID 不一致:${plugin.id}`,
        ));
      }
    });
    return issues;
  },
);

const validateLock = createSchemaValidator(
  PLUGIN_LOCK_SCHEMA,
  ".flower/plugin-lock.json",
  (value) => {
    const lock = /** @type {{roots:string[],plugins:Array<{id:string,source:{type:string,indexCommit?:string},commit:string|null,dependencies:Record<string,string>}>}} */ (value);
    const issues = duplicateIdIssues(lock.plugins, "/plugins");
    const ids = new Set(lock.plugins.map((plugin) => plugin.id));
    lock.roots.forEach((root, index) => {
      if (!ids.has(root)) issues.push(schemaIssue("lock.unknown-root", `/roots/${index}`, `锁文件 root 不存在:${root}`));
    });
    lock.plugins.forEach((plugin, index) => {
      if (parseCanonicalPluginId(plugin.id).sourceId !== plugin.source.id) {
        issues.push(schemaIssue(
          "lock.source-mismatch",
          `/plugins/${index}/source/id`,
          `锁文件 source 与 canonical ID 不一致:${plugin.id}`,
        ));
      }
      if (plugin.source.type === "gitlab" && !plugin.commit) {
        issues.push(schemaIssue("lock.gitlab-commit-required", `/plugins/${index}/commit`, "GitLab Plugin 必须锁定 commit"));
      }
      if (plugin.source.type === "gitlab" && !plugin.source.indexCommit) {
        issues.push(schemaIssue("lock.index-commit-required", `/plugins/${index}/source/indexCommit`, "GitLab Plugin 必须锁定 Marketplace index commit"));
      }
      if (plugin.source.type === "github" && !plugin.commit) {
        issues.push(schemaIssue("lock.github-commit-required", `/plugins/${index}/commit`, "GitHub Plugin 必须锁定 commit"));
      }
      if (
        plugin.source.type === "github" &&
        Boolean(plugin.source.indexReference) !== Boolean(plugin.source.indexCommit)
      ) {
        issues.push(schemaIssue(
          "lock.github-index-incomplete",
          `/plugins/${index}/source`,
          "GitHub Marketplace 来源必须同时锁定 indexReference 与 indexCommit",
        ));
      }
      Object.keys(plugin.dependencies).forEach((dependency) => {
        if (!ids.has(dependency)) {
          issues.push(schemaIssue(
            "lock.unknown-dependency",
            `/plugins/${index}/dependencies/${dependency.replaceAll("~", "~0").replaceAll("/", "~1")}`,
            `锁文件依赖不存在:${dependency}`,
          ));
        }
      });
    });
    return issues;
  },
);

const validateState = createSchemaValidator(
  PLUGIN_STATE_SCHEMA,
  ".flower/state.json",
  (value) => {
    const state = /** @type {{plugins:Array<{id:string,paths:Array<{path:string}>}>}} */ (value);
    const issues = duplicateIdIssues(state.plugins, "/plugins");
    state.plugins.forEach((plugin, pluginIndex) => {
      const paths = new Set();
      plugin.paths.forEach((entry, pathIndex) => {
        if (paths.has(entry.path)) {
          issues.push(schemaIssue(
            "state.duplicate-path",
            `/plugins/${pluginIndex}/paths/${pathIndex}/path`,
            `Plugin state 路径重复:${entry.path}`,
          ));
        }
        paths.add(entry.path);
      });
    });
    return issues;
  },
);

/**
 * 创建空的直接 Plugin 声明文件。
 *
 * @returns {import("../contracts.js").ProjectPluginsFile} 空声明
 */
export function createEmptyPluginsFile() {
  return { schemaVersion: PLUGIN_SCHEMA_VERSION, plugins: [] };
}

/**
 * 校验 `.flower/plugins.json`。
 *
 * @param {unknown} value 原始值
 * @returns {import("../contracts.js").ProjectPluginsFile} 已校验声明
 */
export function validatePluginsFile(value) {
  return /** @type {import("../contracts.js").ProjectPluginsFile} */ (validatePlugins(value));
}

/**
 * 校验 `.flower/plugin-lock.json`。
 *
 * @param {unknown} value 原始值
 * @returns {import("../contracts.js").PluginLock} 已校验锁文件
 */
export function validatePluginLock(value) {
  return /** @type {import("../contracts.js").PluginLock} */ (validateLock(value));
}

/**
 * 校验 `.flower/state.json`。
 *
 * @param {unknown} value 原始值
 * @returns {import("../contracts.js").PluginState} 已校验本机状态
 */
export function validatePluginState(value) {
  return /** @type {import("../contracts.js").PluginState} */ (validateState(value));
}
