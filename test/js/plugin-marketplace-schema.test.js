import assert from "node:assert/strict";
import test from "node:test";
import { PluginSchemaError } from "../../src/plugin/errors.js";
import { validateMarketplaceManifest } from "../../src/plugin/schemas/marketplace-manifest.js";

const COMMIT = "a".repeat(40);
const DIGEST = `sha256:${"b".repeat(64)}`;

function validMarketplace() {
  return {
    schemaVersion: 1,
    id: "rd-guide",
    name: "研发规范 Plugin 市场",
    plugins: [
      {
        id: "code-review",
        description: "代码审查规范",
        source: {
          type: "gitlab",
          project: "digital-rd-governance/code-review-plugin",
          subdir: "plugin",
        },
        trust: { maxProfile: "integration" },
        versions: [
          { version: "1.0.0", ref: "v1.0.0", commit: COMMIT, integrity: DIGEST },
        ],
      },
      {
        id: "local-guide",
        description: "共仓规范",
        source: { type: "path", manifestPath: ".flower-plugin/plugin.json" },
        trust: { maxProfile: "standard" },
        versions: [
          { version: "2.0.0", ref: "v2.0.0", commit: COMMIT, integrity: DIGEST },
        ],
      },
    ],
  };
}

test("Marketplace v1 接受 GitLab、GitHub 与共仓条目", () => {
  const marketplace = validMarketplace();
  marketplace.plugins.push({
    id: "github-guide",
    description: "GitHub 规范",
    source: { type: "github", repository: "example/guides", subdir: "plugin" },
    trust: { maxProfile: "standard" },
    versions: [{ version: "1.0.0", ref: "v1.0.0", commit: COMMIT, integrity: DIGEST }],
  });
  assert.equal(validateMarketplaceManifest(marketplace), marketplace);
});

test("Marketplace 拒绝重复 Plugin 和重复版本", () => {
  const duplicatePlugin = validMarketplace();
  duplicatePlugin.plugins.push(structuredClone(duplicatePlugin.plugins[0]));
  assert.throws(
    () => validateMarketplaceManifest(duplicatePlugin),
    (error) => error instanceof PluginSchemaError &&
      error.issues.some((issue) => issue.code === "marketplace.duplicate-plugin"),
  );

  const duplicateVersion = validMarketplace();
  duplicateVersion.plugins[0].versions.push({
    ...duplicateVersion.plugins[0].versions[0],
    commit: "c".repeat(40),
  });
  assert.throws(
    () => validateMarketplaceManifest(duplicateVersion),
    (error) => error instanceof PluginSchemaError &&
      error.issues.some((issue) => issue.code === "marketplace.duplicate-version"),
  );
});

test("Marketplace 不能授予 system 且必须使用固定 commit/digest", () => {
  const system = validMarketplace();
  system.plugins[0].trust.maxProfile = "system";
  assert.throws(() => validateMarketplaceManifest(system), /Marketplace manifest 校验失败/);

  const commit = validMarketplace();
  commit.plugins[0].versions[0].commit = "main";
  assert.throws(() => validateMarketplaceManifest(commit), /Marketplace manifest 校验失败/);

  const digest = validMarketplace();
  digest.plugins[0].versions[0].integrity = "sha256:short";
  assert.throws(() => validateMarketplaceManifest(digest), /Marketplace manifest 校验失败/);
});
