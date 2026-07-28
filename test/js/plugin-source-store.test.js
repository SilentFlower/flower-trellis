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
    schemaVersion: 1,
    id: "rd-guide",
    type: "gitlab",
    name: "研发指南",
    enabled: true,
    baseUrl: "http://gitlab.xhgjdev.com",
    project: "digital-rd-governance/rd-guide",
    ref: "main",
    marketplacePath: ".flower-marketplace/marketplace.json",
    oauth: {
      applicationId: "0f73e53d745450b6ab9596960b10a2ac1654d67c0941bae381f6dbbf6839ec04",
      scopes: ["read_api", "read_repository"],
    },
    builtin: true,
  });
  assert.equal(fs.existsSync(path.join(root, "plugin-sources.json")), false);
});

test("用户 source store 支持禁用内置来源、恢复默认与自定义来源", (t) => {
  const root = createPluginTestRoot(t, "flower-source-config-write-");
  const configFile = path.join(root, "config", "plugin-sources.json");
  const store = new UserSourceStore({ configFile });
  assert.equal(store.setEnabled("rd-guide", false).enabled, false);
  assert.equal(store.get("rd-guide", { includeDisabled: true }).enabled, false);
  assert.throws(() => store.get("rd-guide"), (error) => error.code === "PLUGIN_SOURCE_NOT_FOUND");
  assert.equal(store.remove("rd-guide"), true);
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
  assert.equal(fs.statSync(configFile).mode & 0o777, 0o600);
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
