import crypto from "node:crypto";
import { stringifyCanonicalJson } from "../integrity/canonical-json.js";
import { RUNTIME_CAPABILITY_POLICY_VERSION } from "./profiles.js";
import {
  PLUGIN_CAPABILITY_ERROR_CODES,
  PluginCapabilityError,
} from "./errors.js";

function compareStable(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeStringList(values) {
  return [...new Set(values || [])].sort(compareStable);
}

function normalizeSource(source) {
  return {
    id: source.id,
    type: source.type,
    reference: source.reference,
    ...(source.indexCommit ? { indexCommit: source.indexCommit } : {}),
  };
}

function normalizeOperations(operations) {
  return operations.map((operation) => ({
    catalog: operation.catalog,
    patch: operation.patch,
    id: operation.id,
    operation: operation.operation,
    required: operation.required,
    targetPolicy: operation.targetPolicy || "each-existing",
    position: operation.position || null,
    scope: operation.scope || null,
    selector: operation.selector,
    content: operation.content || null,
    targets: operation.targets.map((target) => ({
      kind: target.kind,
      path: target.path,
      missing: target.missing,
      markerStyle: target.markerStyle || "html",
    })).sort((left, right) => compareStable(left.path, right.path)),
  })).sort((left, right) => (
    compareStable(`${left.catalog}/${left.id}`, `${right.catalog}/${right.id}`)
  ));
}

/**
 * 计算绑定 Plugin 身份、来源、能力边界与规范化 Patch 计划的批准摘要。
 *
 * @param {{pluginId:string,version:string,integrity:string,source:import("../contracts.js").SourceDescriptor,request:import("../contracts.js").CapabilityRequest,marketplaceMaxProfile:string,runtimeProfile:string,operations:object[]}} input 摘要输入
 * @returns {string} `sha256:<hex>` 批准摘要
 */
export function createCapabilityApprovalDigest(input) {
  if (
    typeof input.pluginId !== "string" ||
    typeof input.version !== "string" ||
    typeof input.integrity !== "string" ||
    !input.source ||
    !input.request ||
    !Array.isArray(input.operations)
  ) {
    throw new PluginCapabilityError("Plugin capability 批准摘要输入不完整", {
      code: PLUGIN_CAPABILITY_ERROR_CODES.PATCH_POLICY_INVALID,
      path: String(input.pluginId || ""),
    });
  }
  const canonical = stringifyCanonicalJson({
    schemaVersion: 1,
    plugin: {
      id: input.pluginId,
      version: input.version,
      integrity: input.integrity,
      source: normalizeSource(input.source),
    },
    request: {
      profile: input.request.profile,
      required: normalizeStringList(input.request.required),
      optional: normalizeStringList(input.request.optional),
    },
    limits: {
      marketplaceMaxProfile: input.marketplaceMaxProfile,
      runtimeProfile: input.runtimeProfile,
      runtimePolicyVersion: RUNTIME_CAPABILITY_POLICY_VERSION,
    },
    operations: normalizeOperations(input.operations),
  });
  return `sha256:${crypto.createHash("sha256").update(canonical).digest("hex")}`;
}
