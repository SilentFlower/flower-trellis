import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { hashContent } from "../../src/plugin/install/content-hash.js";
import { createInstallPlan } from "../../src/plugin/install/install-planner.js";
import { PLUGIN_RUNTIME_ERROR_CODES } from "../../src/plugin/runtime-errors.js";
import { createPluginTestRoot } from "./plugin-test-helpers.js";

const GRAPH = { roots: [], plugins: [] };

/**
 * 创建测试 mutation。
 *
 * @param {Partial<import("../../src/plugin/contracts.js").ContentMutation>} overrides 覆盖字段
 * @returns {import("../../src/plugin/contracts.js").ContentMutation} mutation
 */
function mutation(overrides = {}) {
  return {
    owner: "flower/demo",
    target: ".agents/skills/demo/SKILL.md",
    operation: "write",
    beforeHash: null,
    afterHash: hashContent("demo"),
    source: "flower/demo:skills:demo",
    ...overrides,
  };
}

test("Planner 合并同 owner 同内容的共享物理 root mutation", (t) => {
  const project = createPluginTestRoot(t);
  const plan = createInstallPlan(GRAPH, [mutation(), mutation()], { projectRoot: project });
  assert.equal(plan.contentMutations.length, 1);
});

test("Planner 在写盘前拒绝跨 Plugin 同路径与文件目录前缀冲突", (t) => {
  const project = createPluginTestRoot(t);
  assert.throws(
    () => createInstallPlan(GRAPH, [mutation(), mutation({ owner: "flower/other" })], {
      projectRoot: project,
    }),
    (error) => error.code === PLUGIN_RUNTIME_ERROR_CODES.CONTENT_CONFLICT,
  );
  assert.throws(
    () => createInstallPlan(GRAPH, [
      mutation({ target: "generated/file" }),
      mutation({ target: "generated/file/child" }),
    ], { projectRoot: project }),
    (error) => error.code === PLUGIN_RUNTIME_ERROR_CODES.CONTENT_CONFLICT,
  );
});

test("Planner 拒绝覆盖未被 state 管理的用户文件", (t) => {
  const project = createPluginTestRoot(t);
  const target = path.join(project, ".agents/skills/demo/SKILL.md");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "user\n");
  assert.throws(
    () => createInstallPlan(GRAPH, [mutation({ beforeHash: hashContent("user\n") })], {
      projectRoot: project,
      currentState: null,
    }),
    (error) => error.code === PLUGIN_RUNTIME_ERROR_CODES.CONTENT_CONFLICT,
  );
  assert.equal(fs.readFileSync(target, "utf8"), "user\n");
});

test("Planner 允许同 owner 更新受管路径并拒绝删除他人路径", (t) => {
  const project = createPluginTestRoot(t);
  const state = {
    schemaVersion: 1,
    transactionVersion: 1,
    plugins: [{
      id: "flower/demo",
      version: "1.0.0",
      platforms: ["codex"],
      paths: [{
        path: ".agents/skills/demo/SKILL.md",
        kind: "file",
        hash: hashContent("old"),
        ownership: "exclusive",
      }],
      patches: [],
    }],
  };
  const plan = createInstallPlan(GRAPH, [mutation({ beforeHash: hashContent("old") })], {
    projectRoot: project,
    currentState: state,
  });
  assert.equal(plan.contentMutations.length, 1);
  assert.throws(
    () => createInstallPlan(GRAPH, [mutation({
      owner: "flower/other",
      operation: "remove",
      beforeHash: hashContent("old"),
      afterHash: null,
    })], { projectRoot: project, currentState: state }),
    (error) => error.code === PLUGIN_RUNTIME_ERROR_CODES.CONTENT_CONFLICT,
  );
});

test("Planner 合并 Patch mutation 并拒绝普通内容覆盖 Patch 目标", (t) => {
  const project = createPluginTestRoot(t);
  const patchMutation = {
    owner: "rd-guide/guide",
    target: ".trellis/workflow.md",
    beforeHash: hashContent("old"),
    afterHash: hashContent("new"),
    operations: ["plugin-rd-guide/insert-note"],
    provenance: [],
  };
  const plan = createInstallPlan(GRAPH, [], {
    projectRoot: project,
    patchMutations: [patchMutation],
  });
  assert.deepEqual(plan.patchMutations, [patchMutation]);
  assert.throws(() => createInstallPlan(GRAPH, [mutation({
    target: ".trellis/workflow.md",
  })], {
    projectRoot: project,
    patchMutations: [patchMutation],
  }), (error) => error.code === PLUGIN_RUNTIME_ERROR_CODES.CONTENT_CONFLICT);
});
