import { PLUGIN_SCHEMA_VERSION, SAFE_PATH_SCHEMA } from "./shared.js";
import { createSchemaValidator, schemaIssue } from "./validator.js";

const sourceSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["type"],
      properties: {
        type: { const: "path" },
        path: SAFE_PATH_SCHEMA,
        manifestPath: SAFE_PATH_SCHEMA,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "project"],
      properties: {
        type: { const: "gitlab" },
        project: { type: "string", format: "gitlab-project" },
        subdir: SAFE_PATH_SCHEMA,
        manifestPath: SAFE_PATH_SCHEMA,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "repository"],
      properties: {
        type: { const: "github" },
        repository: { type: "string", format: "github-repository" },
        subdir: SAFE_PATH_SCHEMA,
        manifestPath: SAFE_PATH_SCHEMA,
      },
    },
  ],
};

/** Flower Marketplace Manifest v1 JSON Schema。 */
export const MARKETPLACE_MANIFEST_SCHEMA = Object.freeze({
  $id: "https://flower-trellis.local/schema/marketplace-manifest-v1.json",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "id", "name", "plugins"],
  properties: {
    schemaVersion: { const: PLUGIN_SCHEMA_VERSION },
    id: { type: "string", format: "plugin-id" },
    name: { type: "string", minLength: 1 },
    plugins: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "description", "source", "trust", "versions"],
        properties: {
          id: { type: "string", format: "plugin-id" },
          description: { type: "string", minLength: 1 },
          source: sourceSchema,
          trust: {
            type: "object",
            additionalProperties: false,
            required: ["maxProfile"],
            properties: {
              maxProfile: { enum: ["standard", "integration"] },
            },
          },
          versions: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["version", "ref", "commit", "integrity"],
              properties: {
                version: { type: "string", format: "semver" },
                ref: { type: "string", minLength: 1 },
                commit: { type: "string", format: "git-commit" },
                integrity: { type: "string", format: "sha256" },
              },
            },
          },
        },
      },
    },
  },
});

/**
 * 校验 Marketplace 内的 ID 和版本唯一性。
 *
 * @param {unknown} value 已通过结构校验的 Marketplace
 * @returns {Array<{code:string,path:string,message:string}>} 语义 issue
 */
function marketplaceIssues(value) {
  const manifest = /** @type {{plugins:Array<{id:string,versions:Array<{version:string}>}>}} */ (value);
  const issues = [];
  const pluginIds = new Set();
  manifest.plugins.forEach((plugin, pluginIndex) => {
    if (pluginIds.has(plugin.id)) {
      issues.push(schemaIssue(
        "marketplace.duplicate-plugin",
        `/plugins/${pluginIndex}/id`,
        `Marketplace Plugin ID 重复:${plugin.id}`,
      ));
    }
    pluginIds.add(plugin.id);
    const versions = new Set();
    plugin.versions.forEach((entry, versionIndex) => {
      if (versions.has(entry.version)) {
        issues.push(schemaIssue(
          "marketplace.duplicate-version",
          `/plugins/${pluginIndex}/versions/${versionIndex}/version`,
          `Marketplace Plugin 版本重复:${plugin.id}@${entry.version}`,
        ));
      }
      versions.add(entry.version);
    });
  });
  return issues;
}

const validate = createSchemaValidator(
  MARKETPLACE_MANIFEST_SCHEMA,
  "Flower Marketplace manifest",
  marketplaceIssues,
);

/**
 * 校验 Flower Marketplace Manifest v1。
 *
 * @param {unknown} value Marketplace 原始值
 * @returns {import("../contracts.js").MarketplaceManifest} 已校验 Marketplace
 */
export function validateMarketplaceManifest(value) {
  return /** @type {import("../contracts.js").MarketplaceManifest} */ (validate(value));
}
