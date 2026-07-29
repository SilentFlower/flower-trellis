import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { scaffoldFlowerPlugin } from "../../src/plugin/authoring/scaffold.js";
import { validateAuthorMarketplace } from "../../src/plugin/authoring/validator.js";
import { hashCanonicalTree } from "../../src/plugin/integrity/canonical-tree.js";
import { createPluginTestRoot } from "./plugin-test-helpers.js";

const COMMIT = "a".repeat(40);
const REVIEW_GATE = path.resolve("src/plugin/authoring/templates/rd-guide/verify-integration-review.mjs");

function marketplace(entry) {
  return {
    schemaVersion: 1,
    id: "rd-guide",
    name: "研发规范 Marketplace",
    plugins: [entry],
  };
}

test("rd-guide CI 接受固定 checkout 并标记 integration review", (t) => {
  const root = createPluginTestRoot(t, "flower-marketplace-ci-");
  scaffoldFlowerPlugin(root, {
    id: "rd-guide/demo",
    name: "集成规范",
    profile: "integration",
    includePatches: true,
    includeMarketplace: true,
    project: "digital-rd/demo",
    commit: COMMIT,
  });
  const entry = JSON.parse(fs.readFileSync(path.join(root, "marketplace-entry.json"), "utf8"));
  const result = validateAuthorMarketplace(marketplace(entry), {
    baseDir: root,
    checkoutMap: {
      "rd-guide/demo@1.0.0": { path: ".flower-plugin", commit: COMMIT },
    },
    ci: true,
  });
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(result.review.required, true);
  assert.equal(result.capabilities[0].profile, "integration");
});

test("rd-guide CI 拒绝可变 ref、commit 和 digest 不一致", (t) => {
  const root = createPluginTestRoot(t, "flower-marketplace-reject-");
  scaffoldFlowerPlugin(root, {
    id: "rd-guide/demo",
    name: "研发规范",
    includeMarketplace: true,
    project: "digital-rd/demo",
    commit: COMMIT,
  });
  const entry = JSON.parse(fs.readFileSync(path.join(root, "marketplace-entry.json"), "utf8"));
  entry.versions[0].ref = "main";
  entry.versions[0].integrity = `sha256:${"b".repeat(64)}`;
  const result = validateAuthorMarketplace(marketplace(entry), {
    baseDir: root,
    checkoutMap: {
      "rd-guide/demo@1.0.0": { path: ".flower-plugin", commit: "c".repeat(40) },
    },
    ci: true,
  });
  const codes = new Set(result.issues.map(({ code }) => code));
  assert.equal(codes.has("marketplace.mutable-ref"), true);
  assert.equal(codes.has("marketplace.commit-mismatch"), true);
  assert.equal(codes.has("PLUGIN_INTEGRITY_MISMATCH"), true);
});

test("rd-guide CI 拒绝 ref/commit 分裂和 checkout 工作区逃逸", (t) => {
  const base = createPluginTestRoot(t, "flower-marketplace-base-");
  const outside = createPluginTestRoot(t, "flower-marketplace-outside-");
  scaffoldFlowerPlugin(outside, {
    id: "rd-guide/demo",
    name: "研发规范",
    includeMarketplace: true,
    project: "digital-rd/demo",
    commit: COMMIT,
  });
  const entry = JSON.parse(fs.readFileSync(path.join(outside, "marketplace-entry.json"), "utf8"));
  entry.versions[0].ref = "b".repeat(40);
  const result = validateAuthorMarketplace(marketplace(entry), {
    baseDir: base,
    checkoutMap: {
      "rd-guide/demo@1.0.0": { path: path.join(outside, ".flower-plugin"), commit: COMMIT },
    },
    ci: true,
  });
  const codes = new Set(result.issues.map(({ code }) => code));
  assert.equal(codes.has("marketplace.ref-commit-mismatch"), true);
  assert.equal(codes.has("PLUGIN_UNSAFE_PATH"), true);
});

test("integration review companion 绑定 Marketplace digest 并触发 CODEOWNERS 门禁", (t) => {
  const root = createPluginTestRoot(t, "flower-marketplace-review-");
  const validationPath = path.join(root, "flower-plugin-validation.json");
  const reviewPath = path.join(root, "integration-review.json");
  const digest = `sha256:${"d".repeat(64)}`;
  fs.writeFileSync(validationPath, `${JSON.stringify({
    ok: true,
    digest,
    review: { required: true, reason: "integration" },
  })}\n`);
  const missing = spawnSync(process.execPath, [REVIEW_GATE, validationPath, reviewPath], { encoding: "utf8" });
  assert.notEqual(missing.status, 0);
  fs.writeFileSync(reviewPath, `${JSON.stringify({
    schemaVersion: 1,
    profile: "integration",
    marketplaceDigest: digest,
  }, null, 2)}\n`);
  const allowed = spawnSync(process.execPath, [REVIEW_GATE, validationPath, reviewPath], { encoding: "utf8" });
  assert.equal(allowed.status, 0, allowed.stderr);
  const ciTemplate = fs.readFileSync("src/plugin/authoring/templates/rd-guide/gitlab-ci.yml", "utf8");
  const codeowners = fs.readFileSync("src/plugin/authoring/templates/rd-guide/CODEOWNERS", "utf8");
  assert.match(ciTemplate, /verify-integration-review\.mjs/);
  assert.match(codeowners, /integration-review\.json/);
});

test("完整 Marketplace 校验依赖闭包", (t) => {
  const root = createPluginTestRoot(t, "flower-marketplace-deps-");
  scaffoldFlowerPlugin(root, {
    id: "rd-guide/demo",
    name: "研发规范",
    includeMarketplace: true,
    project: "digital-rd/demo",
    commit: COMMIT,
  });
  const manifestPath = path.join(root, ".flower-plugin/plugin.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.dependencies = { "rd-guide/missing": "^1.0.0" };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const entry = JSON.parse(fs.readFileSync(path.join(root, "marketplace-entry.json"), "utf8"));
  entry.versions[0].integrity = hashCanonicalTree(path.join(root, ".flower-plugin"));
  const result = validateAuthorMarketplace(marketplace(entry), {
    baseDir: root,
    checkoutMap: {
      "rd-guide/demo@1.0.0": { path: ".flower-plugin", commit: COMMIT },
    },
    ci: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.issues.some(({ code }) => code === "PLUGIN_DEPENDENCY_MISSING"), true);
});
