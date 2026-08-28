import assert from "node:assert/strict";
import test from "node:test";
import { resolvePluginGraph } from "../../src/plugin/resolver/dependency-resolver.js";
import { buildPluginLock } from "../../src/plugin/resolver/lock-builder.js";
import { PLUGIN_RUNTIME_ERROR_CODES } from "../../src/plugin/runtime-errors.js";
import { candidate } from "./plugin-test-helpers.js";

/**
 * 创建可切换候选返回顺序的测试 Registry。
 *
 * @param {Record<string,import("../../src/plugin/contracts.js").PluginCandidate[]>} entries 候选表
 * @param {boolean} reverse 是否反序
 * @returns {{listCandidates:(id:string)=>import("../../src/plugin/contracts.js").PluginCandidate[]}} Registry
 */
function registry(entries, reverse = false) {
  return {
    listCandidates(id) {
      const values = [...(entries[id] || [])];
      return reverse ? values.reverse() : values;
    },
  };
}

test("resolver 稳定解析传递与共享依赖并生成依赖优先 lock", () => {
  const entries = {
    "flower/a": [candidate("flower/a", "1.0.0", { "flower/shared": "^1.0.0" })],
    "flower/b": [candidate("flower/b", "1.0.0", { "flower/shared": ">=1.1.0 <2.0.0" })],
    "flower/shared": [candidate("flower/shared", "1.1.0"), candidate("flower/shared", "1.0.0")],
  };
  const declarations = [
    { id: "flower/b", source: "flower", version: "*" },
    { id: "flower/a", source: "flower", version: "*" },
  ];
  const first = resolvePluginGraph(declarations, registry(entries));
  const second = resolvePluginGraph(declarations, registry(entries, true));
  assert.deepEqual(first.graph, second.graph);
  assert.deepEqual(first.graph.plugins.map(({ id }) => id), ["flower/shared", "flower/a", "flower/b"]);
  assert.equal(first.graph.plugins[0].version, "1.1.0");
  assert.deepEqual(buildPluginLock(first.graph), buildPluginLock(second.graph));
});

test("resolver 普通重放保持 lock，显式 update 选择更高兼容版本", () => {
  const entries = { "flower/demo": [candidate("flower/demo", "1.1.0"), candidate("flower/demo", "1.0.0")] };
  const declaration = [{ id: "flower/demo", source: "flower", version: "^1.0.0" }];
  const locked = resolvePluginGraph(declaration, registry({ "flower/demo": [candidate("flower/demo", "1.0.0")] })).graph.plugins;
  assert.equal(resolvePluginGraph(declaration, registry(entries), { lockedPlugins: locked }).graph.plugins[0].version, "1.0.0");
  assert.equal(resolvePluginGraph(declaration, registry(entries), { lockedPlugins: locked, update: ["flower/demo"] }).graph.plugins[0].version, "1.1.0");
});

test("resolver 使用旧 lock 求解冻结节点且不读取 Provider 候选", () => {
  const declaration = [{ id: "offline/demo", source: "offline", version: "^1.0.0" }];
  const lockedCandidate = candidate("offline/demo", "1.0.0");
  lockedCandidate.source = {
    id: "offline",
    type: "github",
    reference: "example/private-plugin",
    format: "skill-only",
    entryPath: "SKILL.md",
  };
  lockedCandidate.commit = "a".repeat(40);
  const locked = resolvePluginGraph(
    declaration,
    registry({ "offline/demo": [lockedCandidate] }),
  ).graph.plugins;
  const result = resolvePluginGraph(declaration, {
    listCandidates() {
      throw new Error("冻结节点不应读取 Provider 候选");
    },
  }, {
    lockedPlugins: locked,
    preserveIds: ["offline/demo"],
  });

  assert.deepEqual(result.graph.plugins, locked);
});

test("resolver 仍拒绝不满足新约束的冻结版本", () => {
  const originalDeclaration = [{ id: "offline/demo", source: "offline", version: "^1.0.0" }];
  const locked = resolvePluginGraph(
    originalDeclaration,
    registry({ "offline/demo": [candidate("offline/demo", "1.0.0")] }),
  ).graph.plugins;

  assert.throws(
    () => resolvePluginGraph(
      [{ id: "offline/demo", source: "offline", version: "^2.0.0" }],
      registry({}),
      { lockedPlugins: locked, preserveIds: ["offline/demo"] },
    ),
    (error) => error.code === PLUGIN_RUNTIME_ERROR_CODES.DEPENDENCY_CONFLICT,
  );
});

test("resolver 报告缺失、冲突、自依赖和循环", () => {
  assert.throws(
    () => resolvePluginGraph([{ id: "flower/missing", source: "flower", version: "*" }], registry({})),
    (error) => error.code === PLUGIN_RUNTIME_ERROR_CODES.DEPENDENCY_MISSING,
  );
  assert.throws(
    () => resolvePluginGraph(
      [{ id: "flower/root", source: "flower", version: "*" }],
      registry({
        "flower/root": [candidate("flower/root", "1.0.0", { "flower/missing": "*" })],
      }),
    ),
    (error) => error.code === PLUGIN_RUNTIME_ERROR_CODES.DEPENDENCY_MISSING && error.path === "flower/missing",
  );

  const conflictEntries = {
    "flower/a": [candidate("flower/a", "1.0.0", { "flower/shared": "^1.0.0" })],
    "flower/b": [candidate("flower/b", "1.0.0", { "flower/shared": "^2.0.0" })],
    "flower/shared": [candidate("flower/shared", "1.0.0"), candidate("flower/shared", "2.0.0")],
  };
  assert.throws(
    () => resolvePluginGraph([
      { id: "flower/a", source: "flower", version: "*" },
      { id: "flower/b", source: "flower", version: "*" },
    ], registry(conflictEntries)),
    (error) => error.code === PLUGIN_RUNTIME_ERROR_CODES.DEPENDENCY_CONFLICT,
  );

  assert.throws(
    () => resolvePluginGraph(
      [{ id: "flower/self", source: "flower", version: "*" }],
      registry({ "flower/self": [candidate("flower/self", "1.0.0", { "flower/self": "*" })] }),
    ),
    (error) => error.code === PLUGIN_RUNTIME_ERROR_CODES.DEPENDENCY_CYCLE,
  );

  assert.throws(
    () => resolvePluginGraph(
      [{ id: "flower/a", source: "flower", version: "*" }],
      registry({
        "flower/a": [candidate("flower/a", "1.0.0", { "flower/b": "*" })],
        "flower/b": [candidate("flower/b", "1.0.0", { "flower/a": "*" })],
      }),
    ),
    (error) => error.code === PLUGIN_RUNTIME_ERROR_CODES.DEPENDENCY_CYCLE,
  );
});

test("resolver 普通重放拒绝同版本包摘要漂移", () => {
  const declaration = [{ id: "flower/demo", source: "flower", version: "^1.0.0" }];
  const original = candidate("flower/demo", "1.0.0");
  const locked = resolvePluginGraph(declaration, registry({ "flower/demo": [original] })).graph.plugins;
  const changed = candidate("flower/demo", "1.0.0");
  changed.integrity = `sha256:${"f".repeat(64)}`;
  assert.throws(
    () => resolvePluginGraph(declaration, registry({ "flower/demo": [changed] }), { lockedPlugins: locked }),
    (error) => error.code === PLUGIN_RUNTIME_ERROR_CODES.TARGET_DRIFT,
  );
});

test("resolver 返回从旧 lock 脱离的稳定 orphan 集合", () => {
  const active = candidate("flower/active", "1.0.0");
  const old = candidate("flower/old", "1.0.0");
  const locked = resolvePluginGraph([
    { id: "flower/active", source: "flower", version: "*" },
    { id: "flower/old", source: "flower", version: "*" },
  ], registry({ "flower/active": [active], "flower/old": [old] })).graph.plugins;
  const result = resolvePluginGraph(
    [{ id: "flower/active", source: "flower", version: "*" }],
    registry({ "flower/active": [active] }),
    { lockedPlugins: locked },
  );
  assert.deepEqual(result.orphans, ["flower/old"]);
});
