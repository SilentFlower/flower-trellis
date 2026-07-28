import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { plugin, parsePluginArgs } from "../../src/commands/plugin.js";
import { PluginRuntimeError } from "../../src/plugin/runtime-errors.js";
import { MemoryCredentialStore } from "../../src/plugin/auth/memory-credential-store.js";
import { hashCanonicalTree } from "../../src/plugin/integrity/canonical-tree.js";
import { UserSourceStore } from "../../src/plugin/sources/user-source-store.js";
import {
  createPluginTestRoot,
  pluginManifest,
  writePluginPackage,
} from "./plugin-test-helpers.js";

const descriptor = {
  schemaVersion: 1,
  id: "rd-guide",
  type: "gitlab",
  name: "研发指南",
  enabled: true,
  baseUrl: "http://gitlab.example.test",
  project: "group/rd-guide",
  ref: "main",
  marketplacePath: ".flower-marketplace/marketplace.json",
  oauth: { applicationId: "public-client", scopes: ["read_api", "read_repository"] },
};

function outputCollector() {
  const stdout = [];
  const stderr = [];
  return {
    stdout,
    stderr,
    output: {
      log: (message) => stdout.push(message),
      error: (message) => stderr.push(message),
    },
  };
}

test("Plugin parser 支持 source、auth 与 search 命令", () => {
  assert.deepEqual(parsePluginArgs(["auth", "login", "rd-guide", "--device", "--json"]), {
    command: "auth",
    subcommand: "login",
    sourceId: "rd-guide",
    json: true,
    device: true,
    help: false,
  });
  assert.deepEqual(parsePluginArgs(["search", "规范", "--source", "rd-guide", "--json"]), {
    command: "search",
    query: "规范",
    source: "rd-guide",
    json: true,
    help: false,
  });
});

test("source list 与 auth status 保持零网络并输出非敏感 JSON", async (t) => {
  const root = createPluginTestRoot(t, "flower-remote-cli-status-");
  const sourceStore = new UserSourceStore({
    configFile: path.join(root, "config.json"),
    builtinDescriptors: [descriptor],
  });
  let networkCalls = 0;
  const listOutput = outputCollector();
  assert.equal(await plugin({ target: root, passthrough: ["source", "list", "--json"] }, {
    sourceStore,
    output: listOutput.output,
    fetch: async () => { networkCalls += 1; throw new Error("unexpected network"); },
  }), 0);
  assert.equal(JSON.parse(listOutput.stdout[0]).sources[0].id, "rd-guide");

  const statusOutput = outputCollector();
  assert.equal(await plugin({ target: root, passthrough: ["auth", "status", "rd-guide", "--json"] }, {
    sourceStore,
    output: statusOutput.output,
    credentialBundle: { store: new MemoryCredentialStore(), persistent: false },
    fetch: async () => { networkCalls += 1; throw new Error("unexpected network"); },
  }), 0);
  const status = JSON.parse(statusOutput.stdout[0]);
  assert.equal(status.authorized, false);
  assert.equal("accessToken" in status, false);
  assert.equal(networkCalls, 0);

  const credentialStore = new MemoryCredentialStore();
  await credentialStore.set(descriptor, {
    schemaVersion: 1,
    sourceId: descriptor.id,
    baseUrl: descriptor.baseUrl,
    tokenType: "Bearer",
    scope: ["read_api", "read_repository"],
    accessToken: "access",
    refreshToken: "refresh",
    expiresAt: null,
  });
  const logoutOutput = outputCollector();
  assert.equal(await plugin({ target: root, passthrough: ["auth", "logout", "rd-guide", "--json"] }, {
    sourceStore,
    output: logoutOutput.output,
    credentialBundle: { store: credentialStore, persistent: false },
  }), 0);
  assert.equal(await credentialStore.get(descriptor), null);
});

test("auth login 只在 PKCE 环境不可用时降级 Device Flow", async (t) => {
  const root = createPluginTestRoot(t, "flower-remote-cli-fallback-");
  const sourceStore = new UserSourceStore({
    configFile: path.join(root, "config.json"),
    builtinDescriptors: [descriptor],
  });
  let deviceCalls = 0;
  const output = outputCollector();
  const code = await plugin({ target: root, passthrough: ["auth", "login", "rd-guide", "--json"] }, {
    sourceStore,
    output: output.output,
    credentialBundle: { store: new MemoryCredentialStore(), persistent: false },
    oauth: {
      loginWithPkce: async () => {
        throw new PluginRuntimeError("GitLab OAuth state 无效", {
          code: "PLUGIN_AUTH_FAILED",
          path: "rd-guide",
        });
      },
      loginWithDevice: async () => { deviceCalls += 1; },
    },
  });
  assert.equal(code, 1);
  assert.equal(deviceCalls, 0);
  assert.equal(JSON.parse(output.stdout[0]).diagnostics[0].code, "PLUGIN_AUTH_FAILED");

  const fallbackStore = new MemoryCredentialStore();
  const fallbackOutput = outputCollector();
  const fallbackCode = await plugin({ target: root, passthrough: ["auth", "login", "rd-guide", "--json"] }, {
    sourceStore,
    output: fallbackOutput.output,
    credentialBundle: { store: fallbackStore, persistent: false },
    oauth: {
      loginWithPkce: async () => {
        throw new PluginRuntimeError("无法打开 GitLab 授权页面", {
          code: "PLUGIN_AUTH_FAILED",
          path: "rd-guide",
          details: { deviceFallback: true },
        });
      },
      loginWithDevice: async () => {
        deviceCalls += 1;
        return {
          schemaVersion: 1,
          sourceId: descriptor.id,
          baseUrl: descriptor.baseUrl,
          tokenType: "Bearer",
          scope: ["read_api", "read_repository"],
          accessToken: "access",
          refreshToken: "refresh",
          createdAt: 1,
          expiresAt: null,
          redirectUri: null,
        };
      },
    },
  });
  assert.equal(fallbackCode, 0);
  assert.equal(deviceCalls, 1);
  assert.equal((await fallbackStore.get(descriptor)).accessToken, "access");
});

test("search 与远程 add 复用 Provider 和 P2 Application Service", async (t) => {
  const root = createPluginTestRoot(t, "flower-remote-cli-add-");
  const packageRoot = writePluginPackage(root, "remote-package", pluginManifest());
  const integrity = hashCanonicalTree(packageRoot);
  const candidate = {
    id: "rd-guide/demo",
    version: "1.0.0",
    source: { id: "rd-guide", type: "gitlab", reference: "group/rd-guide", indexCommit: "a".repeat(40) },
    commit: "b".repeat(40),
    integrity,
    manifest: pluginManifest(),
  };
  const provider = {
    id: "rd-guide",
    type: "gitlab",
    prepared: false,
    prepare: async () => { provider.prepared = true; },
    search: async () => [{ id: candidate.id, description: "示例", versions: ["1.0.0"], source: "rd-guide" }],
    listCandidates: () => [candidate],
    readPackage: () => ({ root: packageRoot, manifest: candidate.manifest, integrity }),
  };
  const sourceStore = new UserSourceStore({
    configFile: path.join(root, "config.json"),
    builtinDescriptors: [descriptor],
  });
  const common = {
    sourceStore,
    credentialBundle: { store: new MemoryCredentialStore(), persistent: false },
    gitlabProviderFactory: () => provider,
  };
  const searchOutput = outputCollector();
  assert.equal(await plugin({ target: root, passthrough: ["search", "示例", "--json"] }, {
    ...common,
    output: searchOutput.output,
  }), 0);
  assert.equal(JSON.parse(searchOutput.stdout[0]).results[0].id, "rd-guide/demo");

  const addOutput = outputCollector();
  assert.equal(await plugin({
    target: root,
    passthrough: ["add", "rd-guide/demo", "--platform", "codex", "--json"],
  }, { ...common, output: addOutput.output }), 0);
  assert.equal(provider.prepared, true);
  assert.equal(fs.readFileSync(path.join(root, ".agents/skills/demo/SKILL.md"), "utf8"), "# Demo\n");
  assert.equal(JSON.parse(addOutput.stdout[0]).graph.plugins[0].source.type, "gitlab");
});

test("带自定义 source ID 的本地 add 不会被误判为 GitLab", async (t) => {
  const root = createPluginTestRoot(t, "flower-custom-local-source-");
  writePluginPackage(root, "plugins/demo", pluginManifest());
  const sourceStore = new UserSourceStore({
    configFile: path.join(root, "config.json"),
    builtinDescriptors: [descriptor],
  });
  let remoteProviders = 0;
  const collected = outputCollector();
  const code = await plugin({
    target: root,
    passthrough: [
      "add",
      "team/demo",
      "--source",
      "plugins/demo",
      "--platform",
      "codex",
      "--json",
    ],
  }, {
    sourceStore,
    cwd: root,
    output: collected.output,
    gitlabProviderFactory: () => { remoteProviders += 1; throw new Error("不应构造远程 Provider"); },
  });
  assert.equal(code, 0, collected.stderr.join("\n"));
  assert.equal(remoteProviders, 0);
  assert.equal(fs.readFileSync(path.join(root, ".agents/skills/demo/SKILL.md"), "utf8"), "# Demo\n");
});
