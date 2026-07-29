import assert from "node:assert/strict";
import test from "node:test";
import { PluginSchemaError } from "../../src/plugin/errors.js";
import { validatePluginManifest } from "../../src/plugin/schemas/plugin-manifest.js";

function validManifest() {
  return {
    schemaVersion: 1,
    id: "code-review",
    name: "代码审查",
    version: "1.2.0",
    compatibility: {
      flower: ">=0.5.0 <1.0.0",
      trellis: ">=0.6.0 <0.7.0",
    },
    dependencies: {
      "flower/skill-garden": "^1.0.0",
    },
    capabilities: {
      profile: "integration",
      required: ["content.skills", "patch.insert"],
      optional: ["content.assets"],
    },
    content: {
      skills: ["skills/code-review"],
      assets: ["assets/rules"],
      scripts: ["scripts/check.mjs"],
    },
    patches: {
      catalog: "patches",
      bundles: "patches/bundles",
    },
  };
}

test("Plugin manifest v1 接受完整合法契约", () => {
  const manifest = validManifest();
  assert.equal(validatePluginManifest(manifest), manifest);
});

test("Plugin manifest 拒绝未知字段、非法版本和不安全路径", () => {
  const unknown = { ...validManifest(), lifecycle: { install: "run.js" } };
  assert.throws(
    () => validatePluginManifest(unknown),
    (error) => error instanceof PluginSchemaError &&
      error.issues.some((issue) => issue.path === "/lifecycle"),
  );

  const version = validManifest();
  version.version = "v1.2.0";
  assert.throws(() => validatePluginManifest(version), /manifest 校验失败/);

  const unsafe = validManifest();
  unsafe.content.skills = ["C:/outside"];
  assert.throws(
    () => validatePluginManifest(unsafe),
    (error) => error instanceof PluginSchemaError &&
      error.issues.some((issue) => issue.path === "/content/skills/0"),
  );
});

test("Plugin manifest 拒绝非法 canonical 依赖和未知 schema 版本", () => {
  const dependency = validManifest();
  dependency.dependencies = { "skill-garden": "^1.0.0" };
  assert.throws(() => validatePluginManifest(dependency), /manifest 校验失败/);

  const future = validManifest();
  future.schemaVersion = 2;
  assert.throws(() => validatePluginManifest(future), /manifest 校验失败/);
});
