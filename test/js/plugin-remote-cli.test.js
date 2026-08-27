import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { plugin, parsePluginArgs } from "../../src/commands/plugin.js";
import { inspectGitHubPluginSource } from "../../src/commands/plugin-remote.js";
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
  assert.deepEqual(parsePluginArgs([
    "source", "add", "public-guides",
    "--type", "github",
    "--repo", "example/public-guides",
    "--ref", "main",
    "--format", "auto",
    "--json",
  ]), {
    command: "source",
    subcommand: "add",
    sourceId: "public-guides",
    sourceType: "github",
    repository: "example/public-guides",
    ref: "main",
    format: "auto",
    json: true,
    device: false,
    help: false,
  });
});

test("GitHub source 新增先探测固定格式，再复用现有生命周期安装", async (t) => {
  const root = createPluginTestRoot(t, "flower-github-cli-add-");
  const packageRoot = writePluginPackage(root, "github-package", pluginManifest({ id: "review" }));
  const integrity = hashCanonicalTree(packageRoot);
  const candidate = {
    id: "public-guides/review",
    version: "1.0.0",
    source: {
      id: "public-guides",
      type: "github",
      reference: "example/public-guides",
      format: "codex",
      entryPath: ".codex-plugin/plugin.json",
    },
    commit: "c".repeat(40),
    integrity,
    manifest: pluginManifest({ id: "review" }),
    compatibilityReport: { status: "compatible", format: "codex", imported: [], omitted: [], diagnostics: [] },
  };
  const provider = {
    id: "public-guides",
    type: "github",
    inspect: async () => ({
      source: {
        schemaVersion: 2,
        id: "public-guides",
        type: "github",
        name: "Public Guides",
        enabled: true,
        repository: "example/public-guides",
        ref: "main",
        format: "codex",
        entryPath: ".codex-plugin/plugin.json",
      },
      resolvedCommit: candidate.commit,
      detection: { format: "codex", kind: "plugin", entryPath: ".codex-plugin/plugin.json" },
      candidate,
    }),
    prepare: async () => {},
    search: async () => [{
      id: candidate.id,
      description: "Review workflows",
      versions: [candidate.version],
      source: "public-guides",
      detectedFormat: "codex",
      entryPath: ".codex-plugin/plugin.json",
      resolvedCommit: candidate.commit,
      compatibility: candidate.compatibilityReport,
    }],
    listCandidates: () => [candidate],
    readPackage: () => ({ root: packageRoot, manifest: candidate.manifest, integrity }),
  };
  const sourceStore = new UserSourceStore({
    configFile: path.join(root, "source-config.json"),
    builtinDescriptors: [],
  });
  const common = { sourceStore, githubProviderFactory: () => provider };
  const sourceOutput = outputCollector();
  assert.equal(await plugin({
    target: root,
    passthrough: [
      "source", "add", "public-guides",
      "--type", "github",
      "--repo", "example/public-guides",
      "--name", "Public Guides",
      "--format", "auto",
      "--json",
    ],
  }, { ...common, output: sourceOutput.output }), 0);
  const persisted = sourceStore.get("public-guides");
  assert.equal(persisted.format, "codex");
  assert.equal(persisted.entryPath, ".codex-plugin/plugin.json");
  const sourceResult = JSON.parse(sourceOutput.stdout[0]);
  assert.equal(sourceResult.detectedFormat, "codex");
  assert.equal(sourceResult.entryPath, ".codex-plugin/plugin.json");
  assert.equal(sourceResult.resolvedCommit, candidate.commit);
  assert.equal(sourceResult.compatibility.status, "compatible");

  const addOutput = outputCollector();
  assert.equal(await plugin({
    target: root,
    passthrough: ["add", candidate.id, "--platform", "codex", "--json"],
  }, { ...common, output: addOutput.output }), 0);
  assert.equal(JSON.parse(addOutput.stdout[0]).graph.plugins[0].source.type, "github");
  assert.equal(fs.readFileSync(path.join(root, ".agents/skills/demo/SKILL.md"), "utf8"), "# Demo\n");
});

test("GitHub source 更新可清空 subdir，format=auto 不继承旧 entryPath", async (t) => {
  const root = createPluginTestRoot(t, "flower-github-cli-update-");
  const sourceStore = new UserSourceStore({
    configFile: path.join(root, "source-config.json"),
    builtinDescriptors: [],
  });
  sourceStore.set({
    id: "public-guides",
    type: "github",
    name: "Public Guides",
    enabled: true,
    repository: "example/public-guides",
    ref: "main",
    subdir: "plugins/review",
    format: "codex",
    entryPath: ".codex-plugin/plugin.json",
  });
  let inspectedSource;
  const output = outputCollector();
  const code = await plugin({
    target: root,
    passthrough: [
      "source", "update", "public-guides",
      "--type", "github",
      "--format", "auto",
      "--clear-subdir",
      "--json",
    ],
  }, {
    sourceStore,
    output: output.output,
    githubProviderFactory: ({ source }) => ({
      inspect: async () => {
        inspectedSource = source;
        return {
          source: { ...source, format: "claude-code", entryPath: ".claude-plugin/plugin.json" },
          resolvedCommit: "d".repeat(40),
          detection: { format: "claude-code", kind: "plugin", entryPath: ".claude-plugin/plugin.json" },
          candidate: {
            id: "public-guides/review",
            version: "1.0.0",
            compatibilityReport: { status: "compatible", imported: [], omitted: [], diagnostics: [] },
          },
        };
      },
    }),
  });
  assert.equal(code, 0);
  assert.equal("subdir" in inspectedSource, false);
  assert.equal("entryPath" in inspectedSource, false);
  assert.equal(inspectedSource.format, "auto");
  assert.equal("subdir" in sourceStore.get("public-guides"), false);
});

test("GitHub 来源预览只写临时缓存且结束后清理", async (t) => {
  const root = createPluginTestRoot(t, "flower-github-inspect-readonly-");
  let cacheRoot;
  const inspection = await inspectGitHubPluginSource({
    schemaVersion: 2,
    id: "public-guides",
    type: "github",
    name: "Public Guides",
    enabled: true,
    repository: "example/public-guides",
    format: "auto",
  }, { target: root }, {
    githubProviderFactory: (options) => {
      cacheRoot = options.cacheRoot;
      return {
        inspect: async () => {
          fs.mkdirSync(cacheRoot, { recursive: true });
          fs.writeFileSync(path.join(cacheRoot, "preview"), "temporary\n");
          return {
            source: { ...options.source, ref: "trunk", format: "codex", entryPath: ".codex-plugin/plugin.json" },
            resolvedCommit: "e".repeat(40),
            detection: { format: "codex", kind: "plugin", entryPath: ".codex-plugin/plugin.json" },
            candidate: null,
            candidates: [],
            diagnostics: [],
          };
        },
      };
    },
  });
  assert.equal(inspection.source.ref, "trunk");
  assert.equal(fs.existsSync(cacheRoot), false);
  assert.equal(fs.existsSync(path.join(root, ".flower")), false);
});

test("GitHub 来源预览失败也清理临时缓存且不写项目", async (t) => {
  const root = createPluginTestRoot(t, "flower-github-inspect-failed-");
  let cacheRoot;
  await assert.rejects(() => inspectGitHubPluginSource({
    schemaVersion: 2,
    id: "public-guides",
    type: "github",
    name: "Public Guides",
    enabled: true,
    repository: "example/public-guides",
    format: "auto",
  }, { target: root }, {
    githubProviderFactory: (options) => {
      cacheRoot = options.cacheRoot;
      return {
        inspect: async () => {
          fs.mkdirSync(cacheRoot, { recursive: true });
          fs.writeFileSync(path.join(cacheRoot, "preview"), "temporary\n");
          throw new PluginRuntimeError("格式未识别", { code: "PLUGIN_FORMAT_UNRECOGNIZED" });
        },
      };
    },
  }), (error) => error.code === "PLUGIN_FORMAT_UNRECOGNIZED");
  assert.equal(fs.existsSync(cacheRoot), false);
  assert.equal(fs.existsSync(path.join(root, ".flower")), false);
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
    env: {},
    fetch: async () => { networkCalls += 1; throw new Error("unexpected network"); },
    runGlab: async () => { throw new Error("glab unavailable"); },
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

test("auth status、search 与 logout 复用同 host 全局凭据且不持久化 token", async (t) => {
  const root = createPluginTestRoot(t, "flower-remote-cli-global-auth-");
  const sourceStore = new UserSourceStore({
    configFile: path.join(root, "config.json"),
    builtinDescriptors: [descriptor],
  });
  const credentialStore = new MemoryCredentialStore();
  const statusOutput = outputCollector();
  assert.equal(await plugin({ target: root, passthrough: ["auth", "status", "rd-guide", "--json"] }, {
    sourceStore,
    output: statusOutput.output,
    credentialBundle: { store: credentialStore, persistent: false },
    env: {},
    runGlab: async () => ({
      stdout: "gitlab.example.test\n  ✓ Logged in to gitlab.example.test\n  ✓ Token: glab-status-token\n",
      stderr: "",
    }),
  }), 0);
  const status = JSON.parse(statusOutput.stdout[0]);
  assert.equal(status.authorized, true);
  assert.equal(status.persistent, false);
  assert.equal("accessToken" in status, false);
  assert.equal(await credentialStore.get(descriptor), null);

  let tokenUsed = null;
  const searchOutput = outputCollector();
  assert.equal(await plugin({ target: root, passthrough: ["search", "规范", "--source", "rd-guide", "--json"] }, {
    sourceStore,
    output: searchOutput.output,
    credentialBundle: { store: credentialStore, persistent: false },
    env: { GITLAB_TOKEN: "env-search-token", GITLAB_HOST: "gitlab.example.test" },
    runGlab: async () => { throw new Error("glab unavailable"); },
    gitlabProviderFactory: ({ source, credentialManager }) => ({
      search: async () => {
        tokenUsed = await credentialManager.getAccessToken(source);
        return [{ id: "rd-guide/review", description: "规范", versions: ["1.0.0"], source: "rd-guide" }];
      },
    }),
  }), 0);
  assert.equal(tokenUsed, "env-search-token");
  assert.equal(JSON.parse(searchOutput.stdout[0]).results[0].id, "rd-guide/review");

  const logoutOutput = outputCollector();
  assert.equal(await plugin({ target: root, passthrough: ["auth", "logout", "rd-guide", "--json"] }, {
    sourceStore,
    output: logoutOutput.output,
    credentialBundle: { store: credentialStore, persistent: false },
  }), 0);
  const afterLogoutOutput = outputCollector();
  assert.equal(await plugin({ target: root, passthrough: ["auth", "status", "rd-guide", "--json"] }, {
    sourceStore,
    output: afterLogoutOutput.output,
    credentialBundle: { store: credentialStore, persistent: false },
    env: { GITLAB_TOKEN: "env-search-token", GITLAB_HOST: "gitlab.example.test" },
    runGlab: async () => { throw new Error("glab unavailable"); },
  }), 0);
  assert.equal(JSON.parse(afterLogoutOutput.stdout[0]).authorized, true);
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
