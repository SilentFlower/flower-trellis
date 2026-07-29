import assert from "node:assert/strict";
import test from "node:test";
import { PluginSchemaError } from "../../src/plugin/errors.js";
import {
  createEmptyPluginsFile,
  validatePluginLock,
  validatePluginsFile,
  validatePluginState,
} from "../../src/plugin/schemas/project-files.js";

const DIGEST = `sha256:${"d".repeat(64)}`;

function validLock() {
  return {
    schemaVersion: 1,
    roots: ["flower/sample"],
    plugins: [
      {
        id: "flower/sample",
        version: "1.0.0",
        source: { id: "flower", type: "builtin", reference: "package:sample" },
        commit: null,
        integrity: DIGEST,
        dependencies: {},
        compatibility: { flower: ">=0.5.0 <1.0.0" },
        capabilities: {
          profile: "standard",
          granted: ["content.skills"],
          denied: [],
          approvalDigest: null,
        },
      },
    ],
  };
}

test("项目声明空模型稳定且拒绝重复直接 Plugin", () => {
  assert.deepEqual(createEmptyPluginsFile(), { schemaVersion: 1, plugins: [] });
  const plugins = {
    schemaVersion: 1,
    plugins: [
      { id: "flower/sample", source: "flower", version: "^1.0.0" },
      { id: "flower/sample", source: "flower", version: "^1.1.0" },
    ],
  };
  assert.throws(
    () => validatePluginsFile(plugins),
    (error) => error instanceof PluginSchemaError &&
      error.issues.some((issue) => issue.code === "project.duplicate-plugin"),
  );
});

test("项目声明和锁文件拒绝来源身份漂移及不安全来源字段", () => {
  const plugins = {
    schemaVersion: 1,
    plugins: [{ id: "flower/sample", source: "rd-guide", version: "^1.0.0" }],
  };
  assert.throws(
    () => validatePluginsFile(plugins),
    (error) => error instanceof PluginSchemaError &&
      error.issues.some((issue) => issue.code === "project.source-mismatch"),
  );

  const sourceMismatch = validLock();
  sourceMismatch.plugins[0].source.id = "rd-guide";
  assert.throws(
    () => validatePluginLock(sourceMismatch),
    (error) => error instanceof PluginSchemaError &&
      error.issues.some((issue) => issue.code === "lock.source-mismatch"),
  );

  const absoluteLocal = validLock();
  absoluteLocal.plugins[0].source = {
    id: "flower",
    type: "local",
    reference: "/tmp/sample",
  };
  assert.throws(() => validatePluginLock(absoluteLocal), PluginSchemaError);

  const invalidCapability = validLock();
  invalidCapability.plugins[0].capabilities.granted = ["bad capability"];
  assert.throws(() => validatePluginLock(invalidCapability), PluginSchemaError);
});

test("锁文件拒绝平台运行态和未知依赖", () => {
  const platform = validLock();
  platform.platforms = ["codex"];
  assert.throws(() => validatePluginLock(platform), /plugin-lock\.json 校验失败/);

  const dependency = validLock();
  dependency.plugins[0].dependencies = { "flower/missing": "1.0.0" };
  assert.throws(
    () => validatePluginLock(dependency),
    (error) => error instanceof PluginSchemaError &&
      error.issues.some((issue) => issue.code === "lock.unknown-dependency"),
  );
});

test("锁文件接受固定 GitHub 来源并拒绝不完整 Marketplace 身份", () => {
  const lock = validLock();
  lock.roots = ["github/sample"];
  lock.plugins[0].id = "github/sample";
  lock.plugins[0].source = {
    id: "github",
    type: "github",
    reference: "example/plugins",
    format: "codex",
    entryPath: ".codex-plugin/plugin.json",
  };
  lock.plugins[0].commit = "a".repeat(40);
  assert.equal(validatePluginLock(lock), lock);

  lock.plugins[0].source.indexReference = "example/catalog";
  assert.throws(
    () => validatePluginLock(lock),
    (error) => error instanceof PluginSchemaError &&
      error.issues.some((issue) => issue.code === "lock.github-index-incomplete"),
  );
});

test("GitLab 锁必须包含 Plugin commit 与 Marketplace index commit", () => {
  const lock = validLock();
  lock.plugins[0].source = {
    id: "rd-guide",
    type: "gitlab",
    reference: "digital-rd-governance/code-review",
  };
  assert.throws(
    () => validatePluginLock(lock),
    (error) => error instanceof PluginSchemaError &&
      error.issues.some((issue) => issue.code === "lock.gitlab-commit-required") &&
      error.issues.some((issue) => issue.code === "lock.index-commit-required"),
  );
});

test("本机 state 记录平台、ownership 与 Patch provenance并拒绝重复路径", () => {
  const state = {
    schemaVersion: 1,
    transactionVersion: 1,
    plugins: [
      {
        id: "flower/sample",
        version: "1.0.0",
        platforms: ["codex"],
        paths: [
          { path: ".agents/skills/sample", kind: "directory", hash: DIGEST, ownership: "exclusive" },
          { path: ".agents/skills/sample", kind: "directory", hash: DIGEST, ownership: "exclusive" },
        ],
        patches: [
          { operation: "flower/sample/insert", target: ".trellis/workflow.md", resultHash: DIGEST },
        ],
      },
    ],
  };
  assert.throws(
    () => validatePluginState(state),
    (error) => error instanceof PluginSchemaError &&
      error.issues.some((issue) => issue.code === "state.duplicate-path"),
  );
});
