import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PluginPathError } from "../errors.js";
import { inspectExternalPatchCatalog } from "../install/patch-planner.js";
import { evaluateCapabilityRequest } from "../capabilities/policy-engine.js";
import { stringifyCanonicalJson } from "../integrity/canonical-json.js";
import { resolvePluginGraph } from "../resolver/dependency-resolver.js";
import { validateMarketplaceManifest } from "../schemas/marketplace-manifest.js";
import { validatePluginManifest } from "../schemas/plugin-manifest.js";
import { readPluginCandidate } from "../sources/package-reader.js";
import { compareUtf8 } from "../stable-order.js";

/**
 * 生成稳定 issue。
 *
 * @param {string} code 错误码
 * @param {string} issuePath JSON path 或领域路径
 * @param {string} message 说明
 * @param {string} source 来源文件
 * @returns {{code:string,path:string,message:string,severity:"error",source:string}} issue
 */
function issue(code, issuePath, message, source) {
  return { code, path: issuePath || "/", message, severity: "error", source };
}

/**
 * 把底层真实错误转换为稳定 issues。
 *
 * @param {unknown} error 底层错误
 * @param {string} source 来源文件
 * @param {string[]} roots 需要从消息隐藏的绝对根
 * @returns {Array<ReturnType<typeof issue>>} issues
 */
function issuesFromError(error, source, roots = []) {
  const sanitize = (value) => roots.reduce(
    (message, root) => message.split(path.resolve(root)).join("<plugin-root>"),
    String(value || "校验失败"),
  );
  if (Array.isArray(error?.issues) && error.issues.length > 0) {
    return error.issues.map((entry) => issue(
      entry.code || error.code || "PLUGIN_SCHEMA_INVALID",
      entry.path,
      sanitize(entry.message),
      source,
    ));
  }
  return [issue(
    error?.code || "PLUGIN_UNEXPECTED_ERROR",
    path.isAbsolute(error?.path || "") ? "/" : error?.path,
    sanitize(error?.message),
    source,
  )];
}

/**
 * 判断 Marketplace ref 是否为版本绑定 tag 或完整 commit。
 *
 * @param {string} ref Git ref
 * @param {string} version SemVer
 * @returns {boolean} 是否不可变
 */
function isImmutableRef(ref, version) {
  return /^[a-fA-F0-9]{40}$/.test(ref) || ref === `v${version}` || ref === `refs/tags/v${version}`;
}

/**
 * 计算结构化 JSON 的稳定摘要。
 *
 * @param {object} value JSON 值
 * @returns {string} SHA-256 摘要
 */
function jsonDigest(value) {
  return `sha256:${crypto.createHash("sha256").update(stringifyCanonicalJson(value)).digest("hex")}`;
}

/**
 * 把 checkout 相对路径约束在 CI 工作区内，并拒绝通过父目录或软链逃逸。
 *
 * @param {string} baseDir CI 工作区根
 * @param {string} relativePath checkout 相对路径
 * @param {string} label 诊断标签
 * @returns {string} 已验证的绝对包根
 */
function resolveCheckoutRoot(baseDir, relativePath, label) {
  if (
    typeof relativePath !== "string" ||
    !relativePath ||
    relativePath.includes("\\") ||
    path.posix.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath) ||
    (relativePath !== "." && relativePath.split("/").some((segment) => !segment || segment === "." || segment === ".."))
  ) {
    throw new PluginPathError(`${label} 必须是工作区内 POSIX 相对路径`, { path: label });
  }
  const resolved = path.resolve(baseDir, ...relativePath.split("/"));
  const realBase = fs.realpathSync(baseDir);
  const realTarget = fs.realpathSync(resolved);
  const relative = path.relative(realBase, realTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new PluginPathError(`${label} 通过软链逃逸 CI 工作区`, { path: label });
  }
  return resolved;
}

/**
 * 创建只读候选 Registry facade。
 *
 * @param {Map<string,object[]>} candidatesById 候选表
 * @returns {{listCandidates:(id:string)=>object[]}} Resolver registry
 */
function candidateRegistry(candidatesById) {
  return {
    listCandidates(id) {
      return [...(candidatesById.get(id) || [])];
    },
  };
}

/**
 * 读取并校验一个 Plugin 包，复用 P1/P2/P4 真源。
 *
 * @param {string} packageRoot Plugin 包根
 * @param {{sourceId?:string,canonicalId?:string,maxProfile?:"standard"|"integration",sourceType?:"local"|"gitlab"}} [options] 来源约束
 * @returns {{candidate:object,capability:object,operations:object[]}} 包校验结果
 */
function inspectPluginPackage(packageRoot, options = {}) {
  const manifest = validatePluginManifest(JSON.parse(fs.readFileSync(path.join(packageRoot, "plugin.json"), "utf8")));
  const sourceId = options.sourceId || options.canonicalId?.split("/")[0] || "local";
  const candidate = readPluginCandidate({
    sourceId,
    type: "local",
    packageRoot,
    reference: ".",
  });
  if (options.canonicalId && candidate.id !== options.canonicalId) {
    throw Object.assign(new Error(`Marketplace entry 与 manifest ID 不一致:${options.canonicalId} != ${candidate.id}`), {
      code: "PLUGIN_SCHEMA_INVALID",
      path: "/id",
    });
  }
  const capability = evaluateCapabilityRequest({
    pluginId: candidate.id,
    request: manifest.capabilities,
    sourceType: options.sourceType || "local",
    marketplaceMaxProfile: options.maxProfile,
  });
  const operations = manifest.patches
    ? inspectExternalPatchCatalog({ plugin: candidate, manifest, packageRoot }).operations
    : [];
  return { candidate, capability, operations };
}

/**
 * 校验单个 Plugin 包。
 *
 * @param {string} packageRoot Plugin 包根
 * @param {{sourceId?:string,maxProfile?:"standard"|"integration",sourceType?:"local"|"gitlab",dependencyRoots?:Record<string,string>}} [options] 校验选项
 * @returns {object} 稳定校验结果
 */
export function validateAuthorPlugin(packageRoot, options = {}) {
  const root = path.resolve(packageRoot);
  const issues = [];
  const candidatesById = new Map();
  const capabilities = [];
  let digest = null;
  let subjectId = options.sourceId || "local";
  try {
    const inspected = inspectPluginPackage(root, options);
    digest = inspected.candidate.integrity;
    subjectId = inspected.candidate.id;
    candidatesById.set(inspected.candidate.id, [inspected.candidate]);
    capabilities.push({
      pluginId: inspected.candidate.id,
      profile: inspected.capability.grant.profile,
      granted: inspected.capability.grant.granted,
      denied: inspected.capability.grant.denied,
      requiresApproval: inspected.capability.requiresApproval,
      operations: inspected.operations.map(({ id, operation }) => ({ id, operation })),
    });
    for (const [id, dependencyRoot] of Object.entries(options.dependencyRoots || {}).sort(([left], [right]) => compareUtf8(left, right))) {
      const dependency = inspectPluginPackage(path.resolve(dependencyRoot), {
        canonicalId: id,
        sourceId: id.split("/")[0],
      });
      const entries = candidatesById.get(id) || [];
      entries.push(dependency.candidate);
      candidatesById.set(id, entries);
    }
    const resolution = resolvePluginGraph([{
      id: inspected.candidate.id,
      source: inspected.candidate.source.id,
      version: inspected.candidate.version,
    }], candidateRegistry(candidatesById));
    return {
      ok: true,
      subject: { type: "plugin", id: subjectId },
      digest,
      issues: [],
      dependencies: resolution.graph.plugins.map(({ id, version }) => ({ id, version })),
      capabilities,
      review: { required: capabilities.some(({ requiresApproval }) => requiresApproval), reason: "integration" },
    };
  } catch (error) {
    issues.push(...issuesFromError(error, "plugin.json", [root]));
  }
  return {
    ok: false,
    subject: { type: "plugin", id: subjectId },
    digest,
    issues: issues.sort((left, right) => compareUtf8(left.path, right.path) || compareUtf8(left.code, right.code)),
    dependencies: [],
    capabilities,
    review: { required: false, reason: null },
  };
}

/**
 * 校验 Marketplace entry 或完整 Marketplace，并对可用 checkout 复核包身份。
 *
 * @param {object} marketplace 原始 Marketplace
 * @param {{baseDir?:string,checkoutMap?:Record<string,string>,ci?:boolean}} [options] 校验选项
 * @returns {object} 稳定校验结果
 */
export function validateAuthorMarketplace(marketplace, options = {}) {
  const issues = [];
  const dependencies = [];
  const capabilities = [];
  const candidatesById = new Map();
  const rootCandidates = [];
  let validated;
  try {
    validated = validateMarketplaceManifest(marketplace);
  } catch (error) {
    issues.push(...issuesFromError(error, "marketplace.json"));
    return {
      ok: false,
      subject: { type: "marketplace", id: null },
      digest: jsonDigest(marketplace),
      issues: issues.sort((left, right) => compareUtf8(left.path, right.path) || compareUtf8(left.code, right.code)),
      dependencies,
      capabilities,
      review: { required: false, reason: null },
    };
  }
  const baseDir = path.resolve(options.baseDir || ".");
  for (const entry of [...validated.plugins].sort((left, right) => compareUtf8(left.id, right.id))) {
    const canonicalId = `${validated.id}/${entry.id}`;
    for (const version of [...entry.versions].sort((left, right) => compareUtf8(left.version, right.version))) {
      const pointer = `/plugins/${validated.plugins.indexOf(entry)}/versions/${entry.versions.indexOf(version)}`;
      if (!isImmutableRef(version.ref, version.version)) {
        issues.push(issue("marketplace.mutable-ref", `${pointer}/ref`, `ref 必须固定到 v${version.version} tag 或完整 commit`, "marketplace.json"));
      }
      if (/^[a-fA-F0-9]{40}$/.test(version.ref) && version.ref.toLowerCase() !== version.commit.toLowerCase()) {
        issues.push(issue(
          "marketplace.ref-commit-mismatch",
          `${pointer}/ref`,
          "ref 为完整 commit 时必须与 commit 字段一致",
          "marketplace.json",
        ));
      }
      if (options.ci && /^0{40}$/.test(version.commit)) {
        issues.push(issue("marketplace.placeholder-commit", `${pointer}/commit`, "CI 模式拒绝占位 commit", "marketplace.json"));
      }
      const checkoutKey = `${canonicalId}@${version.version}`;
      const mapped = options.checkoutMap?.[checkoutKey];
      const mappedPath = typeof mapped === "string" ? mapped : mapped?.path;
      const mappedCommit = typeof mapped === "object" && mapped !== null ? mapped.commit : null;
      let packageRoot = null;
      try {
        packageRoot = mappedPath
          ? resolveCheckoutRoot(baseDir, mappedPath, `checkout map:${checkoutKey}`)
          : entry.source.type === "path"
            ? resolveCheckoutRoot(baseDir, entry.source.path, `Marketplace path:${canonicalId}`)
            : null;
      } catch (error) {
        issues.push(...issuesFromError(error, "marketplace.json", [baseDir]));
        continue;
      }
      if (!packageRoot) {
        if (options.ci) issues.push(issue(
          "marketplace.checkout-missing",
          pointer,
          `CI 缺少不可变 checkout 映射:${checkoutKey}`,
          "marketplace.json",
        ));
        continue;
      }
      if (options.ci && entry.source.type === "gitlab" && mappedCommit !== version.commit) {
        issues.push(issue(
          "marketplace.commit-mismatch",
          `${pointer}/commit`,
          `checkout map commit 与 entry 不一致:${checkoutKey}`,
          "marketplace.json",
        ));
      }
      try {
        const inspected = inspectPluginPackage(packageRoot, {
          canonicalId,
          sourceId: validated.id,
          sourceType: entry.source.type === "gitlab" ? "gitlab" : "local",
          maxProfile: entry.trust.maxProfile,
        });
        if (inspected.candidate.version !== version.version) {
          issues.push(issue("marketplace.version-mismatch", `${pointer}/version`, "entry 版本与 Plugin manifest 不一致", "marketplace.json"));
        }
        if (inspected.candidate.integrity !== version.integrity) {
          issues.push(issue("PLUGIN_INTEGRITY_MISMATCH", `${pointer}/integrity`, "entry digest 与 Plugin canonical tree 不一致", "marketplace.json"));
        }
        dependencies.push({ id: inspected.candidate.id, version: inspected.candidate.version });
        const entries = candidatesById.get(inspected.candidate.id) || [];
        entries.push(inspected.candidate);
        candidatesById.set(inspected.candidate.id, entries);
        rootCandidates.push(inspected.candidate);
        capabilities.push({
          pluginId: canonicalId,
          profile: inspected.capability.grant.profile,
          granted: inspected.capability.grant.granted,
          denied: inspected.capability.grant.denied,
          requiresApproval: inspected.capability.requiresApproval,
        });
      } catch (error) {
        issues.push(...issuesFromError(error, "plugin.json", [packageRoot]));
      }
    }
  }
  for (const candidate of rootCandidates) {
    try {
      resolvePluginGraph([{
        id: candidate.id,
        source: candidate.source.id,
        version: candidate.version,
      }], candidateRegistry(candidatesById));
    } catch (error) {
      issues.push(...issuesFromError(error, "marketplace.json", [baseDir]));
    }
  }
  const reviewRequired = validated.plugins.some(({ trust }) => trust.maxProfile === "integration") ||
    capabilities.some(({ requiresApproval }) => requiresApproval);
  issues.sort((left, right) => compareUtf8(left.path, right.path) || compareUtf8(left.code, right.code));
  return {
    ok: issues.length === 0,
    subject: { type: "marketplace", id: validated.id },
    digest: jsonDigest(validated),
    issues,
    dependencies: [...new Map(dependencies
      .map((entry) => [`${entry.id}\u0000${entry.version}`, entry])).values()]
      .sort((left, right) => compareUtf8(left.id, right.id) || compareUtf8(left.version, right.version)),
    capabilities: capabilities.sort((left, right) => compareUtf8(left.pluginId, right.pluginId)),
    review: { required: reviewRequired, reason: reviewRequired ? "integration" : null },
  };
}

/**
 * 把单个 entry 包装成 P3 Marketplace schema 后校验。
 *
 * @param {object} entry Marketplace entry
 * @param {{sourceId:string,name?:string,baseDir?:string,checkoutMap?:Record<string,string>,ci?:boolean}} options 校验选项
 * @returns {object} 稳定校验结果
 */
export function validateAuthorMarketplaceEntry(entry, options) {
  const result = validateAuthorMarketplace({
    schemaVersion: 1,
    id: options.sourceId,
    name: options.name || `${options.sourceId} Marketplace`,
    plugins: [entry],
  }, options);
  return { ...result, subject: { type: "entry", id: `${options.sourceId}/${entry?.id || "unknown"}` } };
}
