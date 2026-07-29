import {
  CAPABILITY_NAME_SCHEMA,
  PLUGIN_SCHEMA_VERSION,
  SAFE_PATH_SCHEMA,
} from "./shared.js";
import { createSchemaValidator } from "./validator.js";

const stringList = {
  type: "array",
  items: SAFE_PATH_SCHEMA,
  uniqueItems: true,
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
        skills: stringList,
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

const validate = createSchemaValidator(PLUGIN_MANIFEST_SCHEMA, "Flower Plugin manifest");

/**
 * 校验 Flower Plugin Manifest v1。
 *
 * @param {unknown} value manifest 原始值
 * @returns {import("../contracts.js").PluginManifest} 已校验 manifest
 */
export function validatePluginManifest(value) {
  return /** @type {import("../contracts.js").PluginManifest} */ (validate(value));
}
