import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { preparePatchPlan as prepareCorePatchPlan } from "../../lib/patch-engine.js";
import {
  assertNoPatchConflictErrors,
  buildPatchCompatibilityReport,
  buildPatchConflictReport,
  loadPatchPolicies,
} from "../../lib/patch-conflicts.js";
import { assertSafePosixRelativePath, parseCanonicalPluginId } from "../schemas/shared.js";
import { createCapabilityApprovalDigest } from "../capabilities/approval-digest.js";
import {
  PLUGIN_CAPABILITY_ERROR_CODES,
  PluginCapabilityError,
} from "../capabilities/errors.js";
import {
  authorizeCapabilityGrant,
  evaluateCapabilityRequest,
} from "../capabilities/policy-engine.js";
import { CAPABILITY_PROFILES, PLUGIN_CAPABILITIES } from "../capabilities/profiles.js";
import { registerPluginPatchPlanner } from "../runtime-extensions.js";

const PATCH_FIELDS = new Set(["schemaVersion", "id", "purpose", "required", "operations"]);
const OPERATION_FIELDS = new Set([
  "id", "operation", "required", "targetPolicy", "targets", "selector", "content",
  "position", "scope", "after", "dependsOn", "baselines",
]);
const TARGET_FIELDS = new Set(["kind", "path", "missing", "requires", "markerStyle"]);
const BUNDLE_FIELDS = new Set(["schemaVersion", "id", "aliases", "installMode", "patches"]);
const SELECTOR_FIELDS = Object.freeze({
  literal: new Set(["type", "source", "expectedMatches"]),
  "workflow-hub": new Set(["type", "heading", "expectedMatches"]),
  "markdown-section": new Set(["type", "heading", "expectedMatches"]),
});
const CONTENT_FIELDS = new Set(["source", "sources"]);

function compareStable(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertPlainObject(value, label, pluginId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw policyError(`${label} 必须是对象`, pluginId);
  }
}

function assertAllowedFields(value, allowed, label, pluginId) {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw policyError(`${label} 包含外部 Plugin 不允许的字段:${unknown}`, pluginId);
}

function policyError(message, pluginId, details = {}) {
  return new PluginCapabilityError(message, {
    code: PLUGIN_CAPABILITY_ERROR_CODES.PATCH_POLICY_INVALID,
    path: pluginId,
    details,
  });
}

function safeRelativePath(value, label, pluginId) {
  try {
    return assertSafePosixRelativePath(value, label);
  } catch (error) {
    throw policyError(`${label} 不是安全 POSIX 相对路径`, pluginId, { cause: error?.code });
  }
}

function resolveInside(root, relative, label, pluginId) {
  const safe = safeRelativePath(relative, label, pluginId);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...safe.split("/"));
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw policyError(`${label} 逃逸 Plugin 根目录:${safe}`, pluginId);
  }
  return resolved;
}

function assertExistingInside(root, candidate, label, pluginId) {
  if (!fs.existsSync(candidate)) throw policyError(`${label} 不存在`, pluginId);
  let realRoot;
  let realCandidate;
  try {
    realRoot = fs.realpathSync(root);
    realCandidate = fs.realpathSync(candidate);
  } catch (error) {
    throw policyError(`${label} 无法解析真实路径`, pluginId, { cause: error?.code || error?.name });
  }
  if (realCandidate !== realRoot && !realCandidate.startsWith(`${realRoot}${path.sep}`)) {
    throw policyError(`${label} 通过软链逃逸 Plugin 根目录`, pluginId);
  }
}

function listFiles(root, pluginId) {
  const files = [];
  function visit(directory) {
    let directoryEntries;
    try {
      directoryEntries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      throw policyError("无法读取外部 Patch catalog", pluginId, { cause: error?.code || error?.name });
    }
    for (const entry of directoryEntries.sort((left, right) => (
      compareStable(left.name, right.name)
    ))) {
      const candidate = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw policyError("外部 Patch catalog 不允许软链", pluginId);
      if (entry.isDirectory()) visit(candidate);
      else if (entry.isFile()) files.push(candidate);
      else throw policyError("外部 Patch catalog 不允许特殊文件", pluginId);
    }
  }
  visit(root);
  return files;
}

function isAllowedMarkdownTarget(target) {
  if (target.kind === "workflow") return target.path === ".trellis/workflow.md";
  return (
    target.kind === "markdown" &&
    /^\.trellis\/spec\/(?:[^/]+\/)*[^/]+\.md$/.test(target.path)
  );
}

function validateTarget(target, operationId, pluginId) {
  assertPlainObject(target, `Patch ${operationId} target`, pluginId);
  assertAllowedFields(target, TARGET_FIELDS, `Patch ${operationId} target`, pluginId);
  safeRelativePath(target.path, `Patch ${operationId} target.path`, pluginId);
  if (!isAllowedMarkdownTarget(target)) {
    throw policyError(`Integration Patch target 不在 Markdown 白名单:${target.path}`, pluginId);
  }
  const missing = target.missing || "skip";
  if (!new Set(["skip", "error"]).has(missing)) {
    throw policyError(`Integration Patch 禁止 missing=${missing}:${target.path}`, pluginId);
  }
  if (target.markerStyle !== undefined && target.markerStyle !== "html") {
    throw policyError(`Integration Patch 只允许 HTML marker:${target.path}`, pluginId);
  }
  if (target.requires !== undefined && (!Array.isArray(target.requires) || target.requires.length > 0)) {
    throw policyError(`Integration Patch 不允许 target.requires:${target.path}`, pluginId);
  }
  return { kind: target.kind, path: target.path, missing, markerStyle: target.markerStyle || "html" };
}

function validateSelector(selector, operationId, pluginId) {
  assertPlainObject(selector, `Patch ${operationId} selector`, pluginId);
  const allowed = SELECTOR_FIELDS[selector.type];
  if (!allowed) {
    throw policyError(`Integration Patch selector 不允许:${String(selector.type)}`, pluginId);
  }
  assertAllowedFields(selector, allowed, `Patch ${operationId} selector`, pluginId);
  return { ...structuredClone(selector), expectedMatches: selector.expectedMatches ?? 1 };
}

function validateContent(content, operationId, pluginId) {
  assertPlainObject(content, `Patch ${operationId} content`, pluginId);
  assertAllowedFields(content, CONTENT_FIELDS, `Patch ${operationId} content`, pluginId);
  const hasSource = Object.prototype.hasOwnProperty.call(content, "source");
  const hasSources = Object.prototype.hasOwnProperty.call(content, "sources");
  if (hasSource === hasSources) {
    throw policyError(`Patch ${operationId} content 必须且只能声明 source 或 sources`, pluginId);
  }
  if (hasSource) {
    safeRelativePath(content.source, `Patch ${operationId} content.source`, pluginId);
  } else if (
    !Array.isArray(content.sources) ||
    content.sources.length === 0 ||
    content.sources.some((source) => typeof source !== "string")
  ) {
    throw policyError(`Patch ${operationId} content.sources 必须是非空路径数组`, pluginId);
  } else {
    content.sources.forEach((source, index) => (
      safeRelativePath(source, `Patch ${operationId} content.sources[${index}]`, pluginId)
    ));
  }
  return structuredClone(content);
}

function assertLocalRelations(operation, pluginId) {
  for (const field of ["after", "dependsOn"]) {
    if (operation[field] === undefined) continue;
    if (!Array.isArray(operation[field]) || operation[field].some((value) => (
      typeof value !== "string" || value.includes("/")
    ))) {
      throw policyError(`外部 Patch ${field} 只允许当前 catalog 的 local operation ID`, pluginId);
    }
  }
}

function inspectPatchFile(file, catalogId, pluginId) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw policyError("外部 Patch declaration JSON 无效", pluginId, { cause: error?.name });
  }
  assertPlainObject(raw, "外部 Patch declaration", pluginId);
  assertAllowedFields(raw, PATCH_FIELDS, "外部 Patch declaration", pluginId);
  if (raw.schemaVersion !== 2 || !Array.isArray(raw.operations) || raw.operations.length === 0) {
    throw policyError("外部 Patch declaration schemaVersion 或 operations 无效", pluginId);
  }
  return raw.operations.map((operation) => {
    assertPlainObject(operation, `Patch ${raw.id} operation`, pluginId);
    assertAllowedFields(operation, OPERATION_FIELDS, `Patch ${raw.id} operation`, pluginId);
    if (operation.operation !== "insert") {
      throw policyError(`Integration Patch 只允许 insert:${String(operation.operation)}`, pluginId);
    }
    if (!Array.isArray(operation.targets) || operation.targets.length === 0) {
      throw policyError(`Patch ${operation.id} targets 不能为空`, pluginId);
    }
    if (!new Set([undefined, "each-existing", "at-least-one", "required-all"]).has(operation.targetPolicy)) {
      throw policyError(`Patch ${operation.id} targetPolicy 不允许:${operation.targetPolicy}`, pluginId);
    }
    assertLocalRelations(operation, pluginId);
    return {
      catalog: catalogId,
      patch: raw.id,
      id: operation.id,
      operation: operation.operation,
      required: operation.required ?? raw.required ?? true,
      targetPolicy: operation.targetPolicy || "each-existing",
      position: operation.position,
      scope: operation.scope || null,
      selector: validateSelector(operation.selector, operation.id, pluginId),
      targets: operation.targets.map((target) => validateTarget(target, operation.id, pluginId)),
      content: validateContent(operation.content, operation.id, pluginId),
    };
  });
}

function inspectBundleFile(file, pluginId) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw policyError("外部 Patch bundle JSON 无效", pluginId);
  }
  assertPlainObject(raw, "外部 Patch bundle", pluginId);
  assertAllowedFields(raw, BUNDLE_FIELDS, "外部 Patch bundle", pluginId);
  if (
    raw.schemaVersion !== 1 ||
    !Array.isArray(raw.patches) ||
    raw.patches.length === 0 ||
    (raw.installMode !== undefined && raw.installMode !== "full-or-selected")
  ) {
    throw policyError("外部 Patch bundle schemaVersion、patches 或 installMode 无效", pluginId);
  }
}

function catalogPaths(entry) {
  const { manifest, packageRoot } = entry;
  const pluginId = entry.plugin.id;
  if (!manifest.patches) return null;
  const patchesDir = resolveInside(packageRoot, manifest.patches.catalog, "patches.catalog", pluginId);
  const bundlesReference = manifest.patches.bundles || `${manifest.patches.catalog}/bundles`;
  const bundlesDir = resolveInside(packageRoot, bundlesReference, "patches.bundles", pluginId);
  assertExistingInside(packageRoot, patchesDir, "Patch catalog", pluginId);
  assertExistingInside(packageRoot, bundlesDir, "Patch bundles", pluginId);
  if (fs.lstatSync(patchesDir).isSymbolicLink() || fs.lstatSync(bundlesDir).isSymbolicLink()) {
    throw policyError("Patch catalog 与 bundles 根目录不允许软链", pluginId);
  }
  if (!fs.statSync(patchesDir).isDirectory() || !fs.statSync(bundlesDir).isDirectory()) {
    throw policyError("Patch catalog 与 bundles 必须是目录", pluginId);
  }
  return { patchesDir, bundlesDir };
}

function sanitizedPatchError(error, target, entries) {
  let message = String(error?.message || error);
  const roots = [path.resolve(target), ...entries.map((entry) => path.resolve(entry.packageRoot))];
  for (const root of roots.sort((left, right) => right.length - left.length)) {
    message = message.split(root).join("<redacted-root>");
  }
  return new PluginCapabilityError(`Plugin Patch 预检失败:${message}`, {
    code: PLUGIN_CAPABILITY_ERROR_CODES.PATCH_POLICY_INVALID,
    cause: error,
  });
}

function readApprovalValue(values, pluginId) {
  if (values instanceof Map) return values.get(pluginId) || null;
  return values?.[pluginId] || null;
}

function readTargetTrellisVersion(target) {
  try {
    return fs.readFileSync(path.join(target, ".trellis", ".version"), "utf8").trim();
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

function policyDiagnostics(report) {
  return report.diagnostics.map((item) => ({
    code: "PLUGIN_PATCH_POLICY_DIAGNOSTIC",
    path: item.target,
    message: `${item.reason}${item.evidence.length > 0 ? `:${item.evidence.join(" | ")}` : ""}`,
    severity: item.severity,
    details: {
      catalog: item.catalog,
      qualifiedId: item.qualifiedId,
      owner: item.owner,
    },
  }));
}

/**
 * 为 canonical Plugin ID 生成不可伪装成内置 catalog 的稳定 ID。
 *
 * @param {string} canonicalId canonical Plugin ID
 * @returns {string} Patch Engine catalog ID
 */
export function externalPluginCatalogId(canonicalId) {
  const { sourceId, pluginId } = parseCanonicalPluginId(canonicalId);
  const suffix = crypto.createHash("sha256").update(canonicalId).digest("hex").slice(0, 12);
  return `plugin-${sourceId}-${pluginId}-${suffix}`;
}

/**
 * 校验 Integration 外部 catalog 子协议并生成 Patch Engine descriptor。
 *
 * @param {{plugin:{id:string},manifest:import("../contracts.js").PluginManifest,packageRoot:string}} entry Plugin 固定包
 * @returns {{catalog:{id:string,patchesDir:string,bundlesDir:string},operations:object[]}} catalog 与批准证据
 */
export function inspectExternalPatchCatalog(entry) {
  try {
    const paths = catalogPaths(entry);
    if (!paths) throw policyError(`Plugin 未声明 Patch catalog:${entry.plugin.id}`, entry.plugin.id);
    const catalogId = externalPluginCatalogId(entry.plugin.id);
    const files = listFiles(paths.patchesDir, entry.plugin.id);
    const operations = files
      .filter((file) => path.basename(file) === "patch.json")
      .flatMap((file) => inspectPatchFile(file, catalogId, entry.plugin.id));
    const bundleFiles = listFiles(paths.bundlesDir, entry.plugin.id).filter((file) => file.endsWith(".json"));
    bundleFiles.forEach((file) => inspectBundleFile(file, entry.plugin.id));
    if (operations.length === 0 || bundleFiles.length === 0) {
      throw policyError(`外部 Patch catalog 缺少 declaration 或 bundle:${entry.plugin.id}`, entry.plugin.id);
    }
    return {
      catalog: { id: catalogId, patchesDir: paths.patchesDir, bundlesDir: paths.bundlesDir },
      operations,
    };
  } catch (error) {
    if (error instanceof PluginCapabilityError) throw error;
    throw policyError(`无法检查外部 Patch catalog:${entry.plugin.id}`, entry.plugin.id, {
      cause: error?.code || error?.name,
    });
  }
}

/**
 * 把统一 Patch Engine 文件计划转换为 P1 PatchMutation。
 *
 * @param {ReturnType<typeof prepareCorePatchPlan>} plan Patch Engine 计划
 * @param {Map<string,string>} ownerByCatalog catalog ID 到 canonical Plugin ID
 * @returns {import("../contracts.js").PatchMutation[]} Patch mutation
 */
export function buildPluginPatchMutations(plan, ownerByCatalog) {
  const mutations = [];
  for (const file of plan.files) {
    const byOwner = new Map();
    for (const entry of file.operationEntries) {
      const owner = ownerByCatalog.get(entry.catalog);
      if (!owner) throw policyError(`Patch catalog 缺少 Plugin owner:${entry.catalog}`, entry.catalog);
      const entries = byOwner.get(owner) || [];
      entries.push(entry);
      byOwner.set(owner, entries);
    }
    for (const [owner, entries] of [...byOwner].sort(([left], [right]) => compareStable(left, right))) {
      mutations.push({
        owner,
        target: file.target,
        beforeHash: file.beforeHash,
        afterHash: file.afterHash,
        operations: entries.map(({ qualifiedId }) => qualifiedId),
        provenance: entries.map((entry) => ({
          ...entry,
          target: file.target,
          status: "applied",
          resultHash: file.afterHash,
        })),
      });
    }
  }
  return mutations.sort((left, right) => (
    compareStable(left.target, right.target) || compareStable(left.owner, right.owner)
  ));
}

/**
 * 从统一 Patch plan 生成按目标寻址的事务 payload。
 *
 * @param {ReturnType<typeof prepareCorePatchPlan>} plan Patch Engine 计划
 * @returns {Map<string,Buffer>} 目标路径到最终字节
 */
export function buildPluginPatchPayloads(plan) {
  return new Map(plan.files.map((file) => [file.target, Buffer.from(file.next, "utf8")]));
}

/**
 * 断言普通内容 mutation 与统一 Patch plan 没有目标冲突。
 *
 * @param {import("../contracts.js").ContentMutation[]} contentMutations 普通内容 mutation
 * @param {import("../contracts.js").PatchMutation[]} patchMutations Patch mutation
 * @returns {void}
 */
export function assertNoContentPatchConflicts(contentMutations, patchMutations, allowedOwners = new Set()) {
  const contentOwners = new Map();
  for (const mutation of contentMutations || []) {
    const owners = contentOwners.get(mutation.target) || [];
    owners.push(mutation.owner);
    contentOwners.set(mutation.target, owners);
  }
  const conflict = patchMutations.find((mutation) => (
    contentOwners.has(mutation.target) &&
    !(
      allowedOwners.has(mutation.owner) &&
      contentOwners.get(mutation.target).every((owner) => owner === mutation.owner)
    )
  ));
  if (conflict) {
    throw new PluginCapabilityError(`Plugin 内容与 Patch 目标冲突:${conflict.target}`, {
      code: PLUGIN_CAPABILITY_ERROR_CODES.MUTATION_CONFLICT,
      path: conflict.target,
      details: {
        patchOwners: patchMutations
          .filter(({ target }) => target === conflict.target)
          .map(({ owner }) => owner),
        contentOwners: contentOwners.get(conflict.target),
      },
    });
  }
}

/**
 * 协商、批准并一次性预检全部 Plugin Patch catalog。
 *
 * `approvalMode=preview` 只返回待批准摘要，不把未批准摘要写入 grant；默认模式在缺少
 * frozen digest 或本轮显式批准时失败。此函数不调用 `applyPatchPlan()`，不会写目标项目。
 *
 * @param {string} target 项目根目录
 * @param {Array<{plugin:{id:string,version:string,integrity:string,source:import("../contracts.js").SourceDescriptor},manifest:import("../contracts.js").PluginManifest,packageRoot:string,marketplaceMaxProfile?:"standard"|"integration",provider?:object,catalog?:object,catalogs?:object[]}>} entries Plugin 固定包
 * @param {{contentMutations?:import("../contracts.js").ContentMutation[],approvedDigests?:Map<string,string>|Record<string,string>,approvals?:string[],approvalMode?:"require"|"preview",nonInteractive?:boolean,systemAdapters?:Record<string,Function>,patchOptions?:object,contentPatchOverlapOwners?:Set<string>,preparePatchPlan?:typeof prepareCorePatchPlan,trellisVersion?:string}} [options] 计划选项
 * @returns {{grants:Array<{pluginId:string,grant:import("../contracts.js").CapabilityGrant,reusedApproval:boolean}>,approvalRequests:object[],diagnostics:object[],patchPlan:ReturnType<typeof prepareCorePatchPlan>,patchMutations:import("../contracts.js").PatchMutation[],patchPayloads:Map<string,Buffer>,patchReport:object|null}} 统一计划
 */
export function preparePluginPatchPlan(target, entries, options = {}) {
  const prepare = options.preparePatchPlan || prepareCorePatchPlan;
  const approvals = new Set(options.approvals || []);
  const catalogs = [];
  const ownerByCatalog = new Map();
  const grants = [];
  const diagnostics = [];
  const approvalRequests = [];
  let hasTrustedSystemCatalog = false;

  for (const entry of [...entries].sort((left, right) => compareStable(left.plugin.id, right.plugin.id))) {
    const evaluation = evaluateCapabilityRequest({
      pluginId: entry.plugin.id,
      request: entry.manifest.capabilities,
      sourceType: entry.plugin.source.type,
      marketplaceMaxProfile: entry.marketplaceMaxProfile,
      provider: entry.provider,
    });
    diagnostics.push(...evaluation.diagnostics);
    if (!entry.manifest.patches) {
      if (evaluation.request.required.some((capability) => capability.startsWith("patch."))) {
        throw policyError(`Plugin required Patch capability 缺少 catalog:${entry.plugin.id}`, entry.plugin.id);
      }
      grants.push({ pluginId: entry.plugin.id, grant: evaluation.grant, reusedApproval: false });
      continue;
    }

    let inspected;
    if (evaluation.trustedBuiltin && evaluation.grant.profile === CAPABILITY_PROFILES.SYSTEM) {
      const descriptors = entry.catalogs || [entry.catalog || (() => {
        const paths = catalogPaths(entry);
        return { id: externalPluginCatalogId(entry.plugin.id), ...paths };
      })()];
      inspected = { catalogs: descriptors, operations: [] };
      hasTrustedSystemCatalog = true;
    } else {
      const requestedPatchInsert = (
        evaluation.request.required.includes(PLUGIN_CAPABILITIES.PATCH_INSERT) ||
        evaluation.request.optional.includes(PLUGIN_CAPABILITIES.PATCH_INSERT)
      );
      if (!requestedPatchInsert) {
        throw policyError(`Plugin 声明 Patch catalog 但未请求 patch.insert:${entry.plugin.id}`, entry.plugin.id);
      }
      if (!evaluation.grant.granted.includes(PLUGIN_CAPABILITIES.PATCH_INSERT)) {
        grants.push({ pluginId: entry.plugin.id, grant: evaluation.grant, reusedApproval: false });
        continue;
      }
      if (entry.catalog) {
        throw policyError(`外部 Plugin 不得注入预构造 catalog descriptor:${entry.plugin.id}`, entry.plugin.id);
      }
      const external = inspectExternalPatchCatalog(entry);
      inspected = { catalogs: [external.catalog], operations: external.operations };
    }
    for (const catalog of inspected.catalogs) {
      catalogs.push(catalog);
      ownerByCatalog.set(catalog.id, entry.plugin.id);
    }

    let authorization = { grant: evaluation.grant, reusedApproval: false };
    if (evaluation.requiresApproval) {
      const approvalDigest = createCapabilityApprovalDigest({
        pluginId: entry.plugin.id,
        version: entry.plugin.version,
        integrity: entry.plugin.integrity,
        source: entry.plugin.source,
        request: evaluation.request,
        marketplaceMaxProfile: evaluation.limits.sourceProfile,
        runtimeProfile: evaluation.limits.runtimeProfile,
        operations: inspected.operations,
      });
      try {
        authorization = authorizeCapabilityGrant(evaluation, {
          approvalDigest,
          approvedDigest: readApprovalValue(options.approvedDigests, entry.plugin.id),
          approved: approvals.has(entry.plugin.id),
          nonInteractive: options.nonInteractive,
        });
      } catch (error) {
        if (
          options.approvalMode !== "preview" ||
          error?.code !== PLUGIN_CAPABILITY_ERROR_CODES.APPROVAL_REQUIRED
        ) throw error;
        approvalRequests.push({
          pluginId: entry.plugin.id,
          version: entry.plugin.version,
          source: entry.plugin.source,
          profile: evaluation.grant.profile,
          requested: [...evaluation.request.required, ...evaluation.request.optional],
          granted: evaluation.grant.granted,
          denied: evaluation.grant.denied,
          approvalDigest,
          operations: inspected.operations,
        });
      }
    }
    grants.push({ pluginId: entry.plugin.id, ...authorization });
  }

  let patchPlan;
  let patchReport = null;
  try {
    const policies = loadPatchPolicies(catalogs);
    if (policies.length > 0) {
      const compatibilityReport = buildPatchCompatibilityReport({
        version: options.trellisVersion ?? readTargetTrellisVersion(target),
        policies,
      });
      // 兼容线错误必须先于 selector 预检返回，确保用户得到可执行的版本指引。
      assertNoPatchConflictErrors(compatibilityReport);
    }
    patchPlan = prepare(target, catalogs, {
      adapters: hasTrustedSystemCatalog ? (options.systemAdapters || {}) : {},
      ...(hasTrustedSystemCatalog ? (options.patchOptions || {}) : {}),
    });
    if (policies.length > 0) {
      patchReport = buildPatchConflictReport({
        version: options.trellisVersion ?? readTargetTrellisVersion(target),
        plan: patchPlan,
        policies,
      });
      assertNoPatchConflictErrors(patchReport);
      diagnostics.push(...policyDiagnostics(patchReport));
    }
  } catch (error) {
    if (error instanceof PluginCapabilityError) throw error;
    throw sanitizedPatchError(error, target, entries);
  }
  const patchMutations = buildPluginPatchMutations(patchPlan, ownerByCatalog);
  const patchPayloads = buildPluginPatchPayloads(patchPlan);
  assertNoContentPatchConflicts(
    options.contentMutations || [],
    patchMutations,
    options.contentPatchOverlapOwners || new Set(),
  );
  return {
    grants,
    approvalRequests,
    diagnostics,
    patchPlan,
    patchMutations,
    patchPayloads,
    patchReport,
  };
}

registerPluginPatchPlanner(preparePluginPatchPlan);
