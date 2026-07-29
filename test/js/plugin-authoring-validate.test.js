import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { scaffoldFlowerPlugin } from "../../src/plugin/authoring/scaffold.js";
import { validateAuthorPlugin } from "../../src/plugin/authoring/validator.js";
import { createPluginTestRoot } from "./plugin-test-helpers.js";

test("scaffold 产物复用 P1/P2/P4 真源并返回稳定摘要", (t) => {
  const root = createPluginTestRoot(t, "flower-author-validate-");
  const scaffold = scaffoldFlowerPlugin(root, {
    id: "rd-guide/demo",
    name: "研发规范",
  });
  const result = validateAuthorPlugin(path.join(root, ".flower-plugin"), {
    sourceId: "rd-guide",
  });
  assert.equal(result.ok, true);
  assert.equal(result.digest, scaffold.digest);
  assert.deepEqual(result.dependencies, [{ id: "rd-guide/demo", version: "1.0.0" }]);
  assert.deepEqual(result.capabilities[0].granted, ["content.skills"]);
});

test("integration 使用 Marketplace 上限校验受限 Patch", (t) => {
  const root = createPluginTestRoot(t, "flower-author-patch-");
  scaffoldFlowerPlugin(root, {
    id: "rd-guide/demo",
    name: "集成规范",
    profile: "integration",
    includePatches: true,
  });
  const denied = validateAuthorPlugin(path.join(root, ".flower-plugin"), {
    sourceId: "rd-guide",
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.issues[0].code, "PLUGIN_CAPABILITY_DENIED");

  const allowed = validateAuthorPlugin(path.join(root, ".flower-plugin"), {
    sourceId: "rd-guide",
    sourceType: "gitlab",
    maxProfile: "integration",
  });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.review.required, true);
  assert.deepEqual(allowed.capabilities[0].operations, [{
    id: "insert-example-guidance",
    operation: "insert",
  }]);
});

test("外部 system 与不闭合依赖使用真实错误码失败", (t) => {
  const root = createPluginTestRoot(t, "flower-author-invalid-");
  scaffoldFlowerPlugin(root, { id: "rd-guide/demo", name: "研发规范" });
  const manifestPath = path.join(root, ".flower-plugin/plugin.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.capabilities = { profile: "system", required: ["patch.replace"] };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const system = validateAuthorPlugin(path.join(root, ".flower-plugin"), {
    sourceId: "rd-guide",
    sourceType: "gitlab",
    maxProfile: "integration",
  });
  assert.equal(system.ok, false);
  assert.equal(system.issues[0].code, "PLUGIN_CAPABILITY_DENIED");

  manifest.capabilities = { profile: "standard", required: ["content.skills"] };
  manifest.dependencies = { "rd-guide/missing": "^1.0.0" };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const dependency = validateAuthorPlugin(path.join(root, ".flower-plugin"), {
    sourceId: "rd-guide",
  });
  assert.equal(dependency.ok, false);
  assert.equal(dependency.issues[0].code, "PLUGIN_DEPENDENCY_MISSING");
  assert.equal(dependency.issues[0].message.includes(root), false);
});
