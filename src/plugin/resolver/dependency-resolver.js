import semver from "semver";
import {
  PLUGIN_RUNTIME_ERROR_CODES,
  PluginRuntimeError,
} from "../runtime-errors.js";
import { compareUtf8 } from "../stable-order.js";

/**
 * 比较候选的稳定优先级。
 *
 * @param {import("../contracts.js").PluginCandidate} left 左候选
 * @param {import("../contracts.js").PluginCandidate} right 右候选
 * @returns {number} 排序结果
 */
function compareCandidates(left, right) {
  const version = semver.rcompare(left.version, right.version);
  if (version !== 0) return version;
  const commit = compareUtf8(String(left.commit || ""), String(right.commit || ""));
  if (commit !== 0) return commit;
  const source = compareUtf8(left.source.id, right.source.id);
  if (source !== 0) return source;
  return compareUtf8(left.source.reference, right.source.reference);
}

/**
 * 创建 Runtime 需要的默认能力授权结果。
 *
 * P2 只分发被动内容，不执行 scripts 或 Patch；这里只把 manifest 中显式 required
 * 记录为解析结果，真正的能力裁剪由 P4 在进入 InstallPlan 前接管。
 *
 * @param {import("../contracts.js").CapabilityRequest} request 能力请求
 * @returns {import("../contracts.js").CapabilityGrant} 默认授权记录
 */
function defaultCapabilityGrant(request) {
  return {
    profile: request.profile,
    granted: [...request.required].sort(compareUtf8),
    denied: [...(request.optional || [])].sort(compareUtf8),
    approvalDigest: null,
  };
}

/**
 * 深复制约束映射。
 *
 * @param {Map<string,Array<{range:string,from:string}>>} constraints 约束
 * @returns {Map<string,Array<{range:string,from:string}>>} 副本
 */
function cloneConstraints(constraints) {
  return new Map([...constraints].map(([id, entries]) => [id, entries.map((entry) => ({ ...entry }))]));
}

/**
 * 判断候选是否满足节点当前全部约束。
 *
 * @param {import("../contracts.js").PluginCandidate} candidate 候选
 * @param {Array<{range:string,from:string}>} constraints 约束
 * @returns {boolean} 是否满足
 */
function satisfies(candidate, constraints) {
  return constraints.every(({ range }) => semver.satisfies(candidate.version, range, { loose: false }));
}

/**
 * 为候选应用 lock-first 排序。
 *
 * @param {import("../contracts.js").PluginCandidate[]} candidates 候选
 * @param {import("../contracts.js").ResolvedPlugin|undefined} locked 已锁定版本
 * @param {boolean} allowUpdate 是否允许升级
 * @param {Array<{range:string,from:string}>} constraints 当前约束
 * @returns {import("../contracts.js").PluginCandidate[]} 排序后候选
 */
function orderCandidates(candidates, locked, allowUpdate, constraints) {
  const ordered = [...candidates].sort(compareCandidates);
  if (!locked || allowUpdate) return ordered;
  const index = ordered.findIndex((candidate) => (
    candidate.version === locked.version &&
    candidate.integrity === locked.integrity &&
    candidate.source.id === locked.source.id
  ));
  if (index < 0 && satisfies(locked, constraints)) {
    throw new PluginRuntimeError(`已锁定 Plugin 包不可重放:${locked.id}@${locked.version}`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.TARGET_DRIFT,
      path: locked.id,
      details: { version: locked.version, integrity: locked.integrity },
    });
  }
  if (index <= 0) return ordered;
  return [ordered[index], ...ordered.slice(0, index), ...ordered.slice(index + 1)];
}

/**
 * 检查同一版本是否出现多个不可判定身份。
 *
 * @param {string} id canonical Plugin ID
 * @param {import("../contracts.js").PluginCandidate[]} candidates 候选
 */
function assertUnambiguous(id, candidates) {
  const identities = new Map();
  for (const candidate of candidates) {
    const previous = identities.get(candidate.version);
    const identity = `${candidate.source.type}:${candidate.source.reference}:${candidate.commit || ""}:${candidate.integrity}`;
    if (previous && previous !== identity) {
      throw new PluginRuntimeError(`Plugin 版本来源存在歧义:${id}@${candidate.version}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.SOURCE_AMBIGUOUS,
        path: id,
        details: { id, version: candidate.version },
      });
    }
    identities.set(candidate.version, identity);
  }
}

/**
 * 生成依赖优先的稳定拓扑顺序并检测循环。
 *
 * @param {string[]} roots 直接 Plugin
 * @param {Map<string,import("../contracts.js").PluginCandidate>} selected 已选择候选
 * @returns {string[]} 稳定拓扑 ID
 */
function stableTopologicalOrder(roots, selected) {
  const visited = new Set();
  const visiting = new Set();
  const stack = [];
  const result = [];

  /**
   * 深度优先访问节点。
   *
   * @param {string} id 节点 ID
   */
  function visit(id) {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      const cycle = [...stack.slice(start), id];
      throw new PluginRuntimeError(`Plugin 依赖存在循环:${cycle.join(" -> ")}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.DEPENDENCY_CYCLE,
        path: id,
        details: { cycle },
      });
    }
    const candidate = selected.get(id);
    if (!candidate) return;
    visiting.add(id);
    stack.push(id);
    for (const dependency of Object.keys(candidate.manifest.dependencies || {}).sort(compareUtf8)) visit(dependency);
    stack.pop();
    visiting.delete(id);
    visited.add(id);
    result.push(id);
  }

  for (const root of [...roots].sort(compareUtf8)) visit(root);
  for (const id of [...selected.keys()].sort(compareUtf8)) visit(id);
  return result;
}

/**
 * 解析直接与传递 Plugin 依赖。
 *
 * @param {import("../contracts.js").ProjectPluginDeclaration[]} declarations 直接声明
 * @param {{listCandidates:(id:string)=>import("../contracts.js").PluginCandidate[]}} registry Source Registry
 * @param {{lockedPlugins?:import("../contracts.js").ResolvedPlugin[],update?:string[]|"all",grantCapabilities?:(request:import("../contracts.js").CapabilityRequest,candidate:import("../contracts.js").PluginCandidate)=>import("../contracts.js").CapabilityGrant}} [options] 解析选项
 * @returns {{graph:import("../contracts.js").ResolvedGraph,selected:import("../contracts.js").PluginCandidate[],orphans:string[],constraints:Record<string,Array<{range:string,from:string}>>}} 解析结果
 */
export function resolvePluginGraph(declarations, registry, options = {}) {
  const roots = declarations.map(({ id }) => id).sort(compareUtf8);
  const lockedPlugins = options.lockedPlugins || [];
  const lockedById = new Map(lockedPlugins.map((plugin) => [plugin.id, plugin]));
  const updateIds = options.update === "all"
    ? new Set(lockedPlugins.map(({ id }) => id))
    : new Set(options.update || []);
  const grantCapabilities = options.grantCapabilities || defaultCapabilityGrant;
  const initialConstraints = new Map();

  for (const declaration of [...declarations].sort((left, right) => compareUtf8(left.id, right.id))) {
    const entries = initialConstraints.get(declaration.id) || [];
    entries.push({ range: declaration.version, from: "project" });
    initialConstraints.set(declaration.id, entries);
  }

  /**
   * 稳定回溯求解。
   *
   * @param {Map<string,Array<{range:string,from:string}>>} constraints 当前约束
   * @param {Map<string,import("../contracts.js").PluginCandidate>} selected 当前选择
   * @returns {{selected:Map<string,import("../contracts.js").PluginCandidate>,constraints:Map<string,Array<{range:string,from:string}>>}} 完整选择
   */
  function solve(constraints, selected) {
    const invalidSelected = [...selected].find(([id, candidate]) => !satisfies(candidate, constraints.get(id) || []));
    if (invalidSelected) {
      throw new PluginRuntimeError(`已选择版本不再满足约束:${invalidSelected[0]}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.DEPENDENCY_CONFLICT,
        path: invalidSelected[0],
      });
    }
    const nextId = [...constraints.keys()].filter((id) => !selected.has(id)).sort(compareUtf8)[0];
    if (!nextId) return { selected, constraints };

    let candidates;
    try {
      candidates = registry.listCandidates(nextId);
    } catch (error) {
      if (error?.code !== PLUGIN_RUNTIME_ERROR_CODES.SOURCE_NOT_FOUND) throw error;
      candidates = [];
    }
    if (candidates.length === 0) {
      throw new PluginRuntimeError(`找不到 Plugin 依赖:${nextId}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.DEPENDENCY_MISSING,
        path: nextId,
        details: { constraints: constraints.get(nextId) || [] },
      });
    }
    assertUnambiguous(nextId, candidates);
    const allowed = orderCandidates(
      candidates,
      lockedById.get(nextId),
      updateIds.has(nextId),
      constraints.get(nextId) || [],
    )
      .filter((candidate) => satisfies(candidate, constraints.get(nextId) || []));
    const failures = [];
    for (const candidate of allowed) {
      const nextConstraints = cloneConstraints(constraints);
      const nextSelected = new Map(selected);
      nextSelected.set(nextId, candidate);
      let invalid = false;
      for (const [dependency, range] of Object.entries(candidate.manifest.dependencies || {})
        .sort(([left], [right]) => compareUtf8(left, right))) {
        if (dependency === nextId) {
          throw new PluginRuntimeError(`Plugin 不能依赖自身:${nextId}`, {
            code: PLUGIN_RUNTIME_ERROR_CODES.DEPENDENCY_CYCLE,
            path: nextId,
            details: { cycle: [nextId, nextId] },
          });
        }
        const entries = nextConstraints.get(dependency) || [];
        entries.push({ range, from: nextId });
        nextConstraints.set(dependency, entries);
        const alreadySelected = nextSelected.get(dependency);
        if (alreadySelected && !satisfies(alreadySelected, entries)) {
          invalid = true;
          break;
        }
      }
      if (invalid) continue;
      try {
        return solve(nextConstraints, nextSelected);
      } catch (error) {
        if (
          error?.code !== PLUGIN_RUNTIME_ERROR_CODES.DEPENDENCY_CONFLICT &&
          error?.code !== PLUGIN_RUNTIME_ERROR_CODES.DEPENDENCY_MISSING
        ) throw error;
        failures.push(error);
      }
    }
    if (
      failures.length > 0 &&
      failures.every((error) => error.code === PLUGIN_RUNTIME_ERROR_CODES.DEPENDENCY_MISSING) &&
      failures.every((error) => error.path === failures[0].path)
    ) {
      throw failures[0];
    }
    throw new PluginRuntimeError(`Plugin 版本约束无法同时满足:${nextId}`, {
      code: PLUGIN_RUNTIME_ERROR_CODES.DEPENDENCY_CONFLICT,
      path: nextId,
      cause: failures.at(-1) || undefined,
      details: {
        id: nextId,
        constraints: constraints.get(nextId) || [],
        available: candidates.map(({ version }) => version).sort(semver.rcompare),
      },
    });
  }

  const solution = solve(initialConstraints, new Map());
  const selected = solution.selected;
  const order = stableTopologicalOrder(roots, selected);
  const resolvedPlugins = order.map((id) => {
    const candidate = selected.get(id);
    const dependencies = Object.fromEntries(
      Object.keys(candidate.manifest.dependencies || {}).sort(compareUtf8).map((dependency) => [
        dependency,
        selected.get(dependency).version,
      ]),
    );
    return {
      id: candidate.id,
      version: candidate.version,
      source: candidate.source,
      commit: candidate.commit,
      integrity: candidate.integrity,
      dependencies,
      compatibility: candidate.manifest.compatibility,
      capabilities: grantCapabilities(candidate.manifest.capabilities, candidate),
    };
  });
  const graph = { roots, plugins: resolvedPlugins };
  const active = new Set(order);
  const orphans = lockedPlugins.map(({ id }) => id).filter((id) => !active.has(id)).sort(compareUtf8);
  const constraintObject = Object.fromEntries(
    [...solution.constraints.keys()].sort(compareUtf8).map((id) => [id, solution.constraints.get(id)]),
  );
  return {
    graph,
    selected: order.map((id) => selected.get(id)),
    orphans,
    constraints: constraintObject,
  };
}
