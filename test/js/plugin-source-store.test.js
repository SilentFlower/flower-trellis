import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { UserSourceStore } from "../../src/plugin/sources/user-source-store.js";
import { createPluginTestRoot } from "./plugin-test-helpers.js";

test("用户 source store 默认内置 rd-guide 且读取不触发网络", (t) => {
  const root = createPluginTestRoot(t, "flower-source-config-");
  const store = new UserSourceStore({ configFile: path.join(root, "plugin-sources.json") });
  const sources = store.list();
  assert.equal(sources.length, 1);
  assert.deepEqual(sources[0], {
    schemaVersion: 2,
    id: "rd-guide",
    type: "gitlab",
    name: "研发指南",
    enabled: true,
    baseUrl: "https://gitlab.xhgjdev.com",
    project: "digital-rd-governance/rd-guide",
    ref: "main",
    marketplacePath: ".flower-marketplace/marketplace.json",
    oauth: {
      applicationId: "0f73e53d745450b6ab9596960b10a2ac1654d67c0941bae381f6dbbf6839ec04",
      scopes: ["api", "openid", "profile", "read_user", "write_repository"],
    },
    builtin: true,
  });
  assert.equal(fs.existsSync(path.join(root, "plugin-sources.json")), false);
});

test("用户 source store 支持禁用内置来源、恢复默认与自定义来源", (t) => {
  const root = createPluginTestRoot(t, "flower-source-config-write-");
  const configFile = path.join(root, "config", "plugin-sources.json");
  const store = new UserSourceStore({ configFile });
  assert.equal(store.hasOverride("rd-guide"), false);
  assert.equal(store.setEnabled("rd-guide", false).enabled, false);
  assert.equal(store.hasOverride("rd-guide"), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(configFile, "utf8")), {
    schemaVersion: 3,
    sources: [{ id: "rd-guide", enabled: false }],
  });
  assert.equal(store.get("rd-guide", { includeDisabled: true }).enabled, false);
  assert.throws(() => store.get("rd-guide"), (error) => error.code === "PLUGIN_SOURCE_NOT_FOUND");
  assert.equal(store.remove("rd-guide"), true);
  assert.equal(store.hasOverride("rd-guide"), false);
  assert.equal(store.get("rd-guide").enabled, true);

  store.set({
    schemaVersion: 1,
    id: "team-guide",
    type: "gitlab",
    name: "团队指南",
    enabled: true,
    baseUrl: "http://gitlab.example.test",
    project: "group/team-guide",
    ref: "main",
    marketplacePath: ".flower-marketplace/marketplace.json",
    oauth: { applicationId: "public-client", scopes: ["read_repository", "read_api"] },
  });
  assert.equal(store.get("team-guide").project, "group/team-guide");
  store.set({
    schemaVersion: 2,
    id: "public-guides",
    type: "github",
    name: "Public Guides",
    enabled: true,
    repository: "https://github.com/example/public-guides.git",
    ref: "main",
    format: "auto",
  });
  assert.deepEqual(store.get("public-guides"), {
    schemaVersion: 2,
    id: "public-guides",
    type: "github",
    name: "Public Guides",
    enabled: true,
    repository: "example/public-guides",
    ref: "main",
    format: "auto",
    builtin: false,
  });
  assert.equal(JSON.parse(fs.readFileSync(configFile, "utf8")).schemaVersion, 3);
  assert.equal(fs.statSync(configFile).mode & 0o777, 0o600);
});

test("用户 source store 兼容读取 v1 GitLab 配置并在写入时迁移到 v3", (t) => {
  const root = createPluginTestRoot(t, "flower-source-config-migrate-");
  const configFile = path.join(root, "plugin-sources.json");
  fs.writeFileSync(configFile, `${JSON.stringify({
    schemaVersion: 1,
    sources: [{
      schemaVersion: 1,
      id: "legacy",
      type: "gitlab",
      name: "Legacy",
      enabled: true,
      baseUrl: "http://gitlab.example.test",
      project: "group/legacy",
      ref: "main",
      marketplacePath: "marketplace.json",
      oauth: { applicationId: "public-client", scopes: ["read_api", "read_repository"] },
    }],
  }, null, 2)}\n`);
  const store = new UserSourceStore({ configFile, builtinDescriptors: [] });
  assert.equal(store.get("legacy").schemaVersion, 2);
  store.setEnabled("legacy", false);
  assert.equal(JSON.parse(fs.readFileSync(configFile, "utf8")).schemaVersion, 3);
});

test("用户 source store 不让旧用户记录覆盖内置连接定义，并在写入时压缩为启停偏好", (t) => {
  const root = createPluginTestRoot(t, "flower-source-config-builtin-preference-");
  const configFile = path.join(root, "plugin-sources.json");
  fs.writeFileSync(configFile, `${JSON.stringify({
    schemaVersion: 2,
    sources: [{
      schemaVersion: 2,
      id: "rd-guide",
      type: "gitlab",
      name: "旧研发指南",
      enabled: false,
      baseUrl: "http://gitlab.xhgjdev.com",
      project: "legacy/rd-guide",
      ref: "legacy-branch",
      marketplacePath: "legacy-marketplace.json",
      oauth: { applicationId: "legacy-client", scopes: ["read_api", "read_repository"] },
    }],
  }, null, 2)}\n`);
  const store = new UserSourceStore({ configFile });
  const source = store.get("rd-guide", { includeDisabled: true });
  assert.equal(source.enabled, false);
  assert.equal(source.baseUrl, "https://gitlab.xhgjdev.com");
  assert.equal(source.project, "digital-rd-governance/rd-guide");
  assert.equal(source.ref, "main");
  assert.throws(
    () => store.set({ ...source, ref: "other", builtin: undefined }),
    (error) => error.code === "PLUGIN_SOURCE_CONFIG_INVALID" && error.message.includes("内置"),
  );

  store.setEnabled("rd-guide", false);
  assert.deepEqual(JSON.parse(fs.readFileSync(configFile, "utf8")), {
    schemaVersion: 3,
    sources: [{ id: "rd-guide", enabled: false }],
  });
});

test("用户 source store 拒绝把 v1 配置解释为 GitHub descriptor", (t) => {
  const root = createPluginTestRoot(t, "flower-source-config-v1-github-");
  const configFile = path.join(root, "plugin-sources.json");
  fs.writeFileSync(configFile, `${JSON.stringify({
    schemaVersion: 1,
    sources: [{
      schemaVersion: 1,
      id: "legacy-github",
      type: "github",
      name: "Legacy GitHub",
      enabled: true,
      repository: "example/guides",
      ref: "main",
      format: "auto",
    }],
  }, null, 2)}\n`);
  const store = new UserSourceStore({ configFile, builtinDescriptors: [] });
  assert.throws(() => store.list(), (error) => error.code === "PLUGIN_SOURCE_CONFIG_INVALID");
});

test("用户 source 配置拒绝 secret 与损坏 JSON", (t) => {
  const root = createPluginTestRoot(t, "flower-source-config-invalid-");
  const configFile = path.join(root, "plugin-sources.json");
  const store = new UserSourceStore({ configFile });
  assert.throws(() => store.set({
    schemaVersion: 1,
    id: "unsafe",
    type: "gitlab",
    name: "Unsafe",
    enabled: true,
    baseUrl: "http://gitlab.example.test",
    project: "group/project",
    ref: "main",
    marketplacePath: "marketplace.json",
    clientSecret: "must-not-persist",
    oauth: { applicationId: "public-client", scopes: ["read_api", "read_repository"] },
  }), (error) => error.code === "PLUGIN_SOURCE_CONFIG_INVALID");
  fs.writeFileSync(configFile, "{broken\n");
  assert.throws(() => store.list(), (error) => error.code === "PLUGIN_SOURCE_CONFIG_INVALID");
});

test("GitHub source 拒绝凭据、非 GitHub host 与不一致的格式入口", (t) => {
  const root = createPluginTestRoot(t, "flower-source-config-github-invalid-");
  const store = new UserSourceStore({ configFile: path.join(root, "plugin-sources.json"), builtinDescriptors: [] });
  assert.throws(() => store.set({
    id: "unsafe-github",
    type: "github",
    name: "Unsafe",
    enabled: true,
    repository: "https://user:secret@github.com/example/repo",
    ref: "main",
    format: "auto",
  }), (error) => error.code === "PLUGIN_SOURCE_CONFIG_INVALID");
  assert.throws(() => store.set({
    id: "other-host",
    type: "github",
    name: "Other",
    enabled: true,
    repository: "https://gitlab.com/example/repo",
    ref: "main",
    format: "auto",
  }), (error) => error.code === "PLUGIN_SOURCE_CONFIG_INVALID");
  assert.throws(() => store.set({
    id: "missing-entry",
    type: "github",
    name: "Missing Entry",
    enabled: true,
    repository: "example/repo",
    ref: "main",
    format: "codex",
  }), (error) => error.code === "PLUGIN_SOURCE_CONFIG_INVALID");
});
