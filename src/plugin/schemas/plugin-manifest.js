import {
  CAPABILITY_NAME_SCHEMA,
  CONTENT_SKILL_NAME_SCHEMA,
  PLUGIN_SCHEMA_VERSION,
  SAFE_PATH_SCHEMA,
} from "./shared.js";
import { createSchemaValidator, schemaIssue } from "./validator.js";

const stringList = {
  type: "array",
  items: SAFE_PATH_SCHEMA,
  uniqueItems: true,
};

const skillEntryList = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["name", "path", "version"],
    properties: {
      name: CONTENT_SKILL_NAME_SCHEMA,
      path: SAFE_PATH_SCHEMA,
      version: { type: "string", format: "semver" },
      description: { type: "string", minLength: 1 },
    },
  },
};

/** Flower Plugin Manifest v1 JSON Schema。 */
export const PLUGIN_MANIFEST_SCHEMA = Object.freeze({
  $id: "https://flower-trellis.local/schema/plugin-manifest-v1.json",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "id", "name", "version", "compatibility", "capabilities", "content"],
  properties: {
    schemaVersion: { const: PLUGIN_SCHEMA_VERSION },
    id: { type: "string", format: "plugin-id" },
    name: { type: "string", minLength: 1 },
    version: { type: "string", format: "semver" },
    compatibility: {
      type: "object",
      additionalProperties: false,
      required: ["flower"],
      properties: {
        flower: { type: "string", format: "semver-range" },
        trellis: { type: "string", format: "semver-range" },
      },
    },
    dependencies: {
      type: "object",
      propertyNames: { format: "canonical-plugin-id" },
      additionalProperties: { type: "string", format: "semver-range" },
    },
    capabilities: {
      type: "object",
      additionalProperties: false,
      required: ["profile", "required"],
      properties: {
        profile: { enum: ["standard", "integration", "system"] },
        required: {
          type: "array",
          items: CAPABILITY_NAME_SCHEMA,
          uniqueItems: true,
        },
        optional: {
          type: "array",
          items: CAPABILITY_NAME_SCHEMA,
          uniqueItems: true,
        },
      },
    },
    content: {
      type: "object",
      additionalProperties: false,
      minProperties: 1,
      properties: {
        skills: skillEntryList,
        specs: stringList,
        assets: stringList,
        scripts: stringList,
        tests: stringList,
      },
    },
    patches: {
      type: "object",
      additionalProperties: false,
      required: ["catalog"],
      properties: {
        catalog: SAFE_PATH_SCHEMA,
        bundles: SAFE_PATH_SCHEMA,
      },
    },
  },
});

/**
 * 校验 manifest 中 Skill 条目的唯一性。
 *
 * @param {unknown} value 已通过结构校验的 manifest
 * @returns {Array<{code:string,path:string,message:string}>} 语义 issue
 */
function pluginManifestIssues(value) {
  const manifest = /** @type {{content?:{skills?:Array<{name:string,path:string}>}}} */ (value);
  const issues = [];
  const names = new Set();
  const paths = new Set();
  for (const [index, skill] of (manifest.content?.skills || []).entries()) {
    if (names.has(skill.name)) {
      issues.push(schemaIssue(
        "manifest.duplicate-skill-name",
        `/content/skills/${index}/name`,
        `Skill 名称重复:${skill.name}`,
      ));
    }
    names.add(skill.name);
    if (paths.has(skill.path)) {
      issues.push(schemaIssue(
        "manifest.duplicate-skill-path",
        `/content/skills/${index}/path`,
        `Skill 路径重复:${skill.path}`,
      ));
    }
    paths.add(skill.path);
  }
  return issues;
}

const validate = createSchemaValidator(
  PLUGIN_MANIFEST_SCHEMA,
  "Flower Plugin manifest",
  pluginManifestIssues,
);

/**
 * 校验 Flower Plugin Manifest v1。
 *
 * @param {unknown} value manifest 原始值
 * @returns {import("../contracts.js").PluginManifest} 已校验 manifest
 */
export function validatePluginManifest(value) {
  return /** @type {import("../contracts.js").PluginManifest} */ (validate(value));
}
