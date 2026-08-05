import { SAFE_PATH_SCHEMA } from "./shared.js";
import { createSchemaValidator, schemaIssue } from "./validator.js";

const NULLABLE_HASH_SCHEMA = {
  anyOf: [
    { type: "string", format: "sha256" },
    { type: "null" },
  ],
};

const CONTROL_ENTRY_KIND_SCHEMA = {
  enum: ["exclusive-file", "managed-block", "json-fragment"],
};

/** `.flower/trellis-control.json` v1 JSON Schema。 */
export const TRELLIS_CONTROL_STATE_SCHEMA = Object.freeze({
  $id: "https://flower-trellis.local/schema/trellis-control-state-v1.json",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "status",
    "transactionId",
    "disabledAt",
    "configuredPlatforms",
    "trellisVersion",
    "flowerVersion",
    "manifestPath",
    "expectedDisabled",
  ],
  properties: {
    schemaVersion: { const: 1 },
    status: { enum: ["disabled", "repair-required"] },
    transactionId: { type: "string", pattern: "^[a-f0-9]{24}$" },
    disabledAt: { type: "string", minLength: 1 },
    configuredPlatforms: {
      type: "array",
      items: { type: "string", minLength: 1 },
      uniqueItems: true,
    },
    trellisVersion: { type: "string", minLength: 1 },
    flowerVersion: { type: "string", minLength: 1 },
    manifestPath: SAFE_PATH_SCHEMA,
    expectedDisabled: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "kind", "afterHash"],
        properties: {
          path: SAFE_PATH_SCHEMA,
          kind: CONTROL_ENTRY_KIND_SCHEMA,
          afterHash: NULLABLE_HASH_SCHEMA,
        },
      },
    },
  },
});

/** `.flower/trellis-detached/<id>/manifest.json` v1 JSON Schema。 */
export const TRELLIS_DETACHED_MANIFEST_SCHEMA = Object.freeze({
  $id: "https://flower-trellis.local/schema/trellis-detached-manifest-v1.json",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "id",
    "createdAt",
    "configuredPlatforms",
    "entries",
    "completed",
  ],
  properties: {
    schemaVersion: { const: 1 },
    id: { type: "string", pattern: "^[a-f0-9]{24}$" },
    createdAt: { type: "string", minLength: 1 },
    configuredPlatforms: {
      type: "array",
      items: { type: "string", minLength: 1 },
      uniqueItems: true,
    },
    entries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "path",
          "kind",
          "owners",
          "beforeHash",
          "afterHash",
          "mode",
          "backupPath",
          "disabledPath",
        ],
        properties: {
          path: SAFE_PATH_SCHEMA,
          kind: CONTROL_ENTRY_KIND_SCHEMA,
          owners: {
            type: "array",
            items: { type: "string", minLength: 1 },
            uniqueItems: true,
          },
          beforeHash: { type: "string", format: "sha256" },
          afterHash: NULLABLE_HASH_SCHEMA,
          mode: { type: "integer", minimum: 0, maximum: 511 },
          backupPath: SAFE_PATH_SCHEMA,
          disabledPath: {
            anyOf: [SAFE_PATH_SCHEMA, { type: "null" }],
          },
          block: {
            type: "object",
            additionalProperties: false,
            required: ["content", "prefix", "suffix"],
            properties: {
              content: { type: "string" },
              prefix: { type: "string" },
              suffix: { type: "string" },
            },
          },
        },
      },
    },
    completed: {
      type: "array",
      items: SAFE_PATH_SCHEMA,
      uniqueItems: true,
    },
  },
});

const validateControlState = createSchemaValidator(
  TRELLIS_CONTROL_STATE_SCHEMA,
  ".flower/trellis-control.json",
  (value) => {
    const state = /** @type {{transactionId:string,manifestPath:string,expectedDisabled:Array<{path:string}>}} */ (value);
    const issues = [];
    const expectedManifest = `.flower/trellis-detached/${state.transactionId}/manifest.json`;
    if (state.manifestPath !== expectedManifest) {
      issues.push(schemaIssue(
        "trellis-control.manifest-mismatch",
        "/manifestPath",
        "Trellis control manifestPath 与 transactionId 不一致",
      ));
    }
    const paths = new Set();
    state.expectedDisabled.forEach((entry, index) => {
      if (paths.has(entry.path)) {
        issues.push(schemaIssue(
          "trellis-control.duplicate-path",
          `/expectedDisabled/${index}/path`,
          `Trellis control 路径重复:${entry.path}`,
        ));
      }
      paths.add(entry.path);
    });
    return issues;
  },
);

const validateDetachedManifest = createSchemaValidator(
  TRELLIS_DETACHED_MANIFEST_SCHEMA,
  ".flower/trellis-detached manifest",
  (value) => {
    const manifest = /** @type {{id:string,entries:Array<{path:string,kind:string,afterHash:string|null,backupPath:string,disabledPath:string|null,block?:object}>,completed:string[]}} */ (value);
    const issues = [];
    const paths = new Set();
    manifest.entries.forEach((entry, index) => {
      if (paths.has(entry.path)) {
        issues.push(schemaIssue(
          "trellis-detached.duplicate-path",
          `/entries/${index}/path`,
          `Trellis detached 路径重复:${entry.path}`,
        ));
      }
      paths.add(entry.path);
      const prefix = `.flower/trellis-detached/${manifest.id}/`;
      if (!entry.backupPath.startsWith(prefix)) {
        issues.push(schemaIssue(
          "trellis-detached.backup-outside-transaction",
          `/entries/${index}/backupPath`,
          `Trellis detached 备份不属于当前事务:${entry.path}`,
        ));
      }
      if (entry.disabledPath !== null && !entry.disabledPath.startsWith(prefix)) {
        issues.push(schemaIssue(
          "trellis-detached.disabled-outside-transaction",
          `/entries/${index}/disabledPath`,
          `Trellis detached 关闭态材料不属于当前事务:${entry.path}`,
        ));
      }
      const fragment = entry.kind !== "exclusive-file";
      if (fragment !== (entry.afterHash !== null && entry.disabledPath !== null)) {
        issues.push(schemaIssue(
          "trellis-detached.mutation-material-mismatch",
          `/entries/${index}`,
          `Trellis detached mutation 类型与关闭态材料不一致:${entry.path}`,
        ));
      }
      if ((entry.kind === "managed-block") !== Boolean(entry.block)) {
        issues.push(schemaIssue(
          "trellis-detached.block-mismatch",
          `/entries/${index}/block`,
          `Trellis detached 管理块恢复材料不一致:${entry.path}`,
        ));
      }
    });
    manifest.completed.forEach((completedPath, index) => {
      if (!paths.has(completedPath)) {
        issues.push(schemaIssue(
          "trellis-detached.completed-unknown",
          `/completed/${index}`,
          `Trellis detached completed 路径不存在:${completedPath}`,
        ));
      }
    });
    return issues;
  },
);

/**
 * 校验 Trellis 项目级控制状态。
 *
 * @param {unknown} value 原始状态
 * @returns {import("../contracts.js").TrellisControlState} 已校验状态
 */
export function validateTrellisControlState(value) {
  return /** @type {import("../contracts.js").TrellisControlState} */ (validateControlState(value));
}

/**
 * 校验 Trellis detach 恢复 manifest。
 *
 * @param {unknown} value 原始 manifest
 * @returns {import("../contracts.js").TrellisDetachedManifest} 已校验 manifest
 */
export function validateTrellisDetachedManifest(value) {
  return /** @type {import("../contracts.js").TrellisDetachedManifest} */ (
    validateDetachedManifest(value)
  );
}
