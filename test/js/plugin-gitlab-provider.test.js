import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { create } from "tar";
import { hashCanonicalTree } from "../../src/plugin/integrity/canonical-tree.js";
import { GitLabSourceProvider } from "../../src/plugin/sources/gitlab-provider.js";
import {
  createPluginTestRoot,
  pluginManifest,
  writePluginPackage,
} from "./plugin-test-helpers.js";

const commit = "a".repeat(40);
const source = {
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

async function archiveDirectory(root, entry, target) {
  await create({ cwd: root, file: target, gzip: true }, [entry]);
  return fs.readFileSync(target);
}

test("GitLab Provider 固定索引 commit、验证 digest 并复用不可变缓存", async (t) => {
  const root = createPluginTestRoot(t, "flower-gitlab-provider-");
  const repositoryContainer = path.join(root, "archive-source");
  const repositoryRoot = path.join(repositoryContainer, `rd-guide-${commit.slice(0, 8)}`);
  const pluginRoot = writePluginPackage(repositoryRoot, "plugins/demo", pluginManifest());
  const integrity = hashCanonicalTree(pluginRoot);
  const archive = await archiveDirectory(repositoryContainer, path.basename(repositoryRoot), path.join(root, "archive.tar.gz"));
  const marketplace = {
    schemaVersion: 1,
    id: "rd-guide",
    name: "研发指南",
    plugins: [{
      id: "demo",
      description: "示例 Plugin",
      source: { type: "path", path: "plugins/demo" },
      trust: { maxProfile: "standard" },
      versions: [{ version: "1.0.0", ref: "v1.0.0", commit, integrity }],
    }],
  };
  let archiveDownloads = 0;
  const client = {
    resolveCommit: async () => commit,
    readRawFile: async () => JSON.stringify(marketplace),
    downloadArchive: async () => { archiveDownloads += 1; return archive; },
  };
  const projectRoot = path.join(root, "project");
  fs.mkdirSync(projectRoot);
  const provider = new GitLabSourceProvider({ source, projectRoot, client });
  await provider.prepare("rd-guide/demo");
  const candidate = provider.listCandidates("rd-guide/demo")[0];
  assert.equal(candidate.commit, commit);
  assert.equal(candidate.source.indexCommit, commit);
  assert.equal(candidate.source.reference, "group/rd-guide");
  assert.equal(provider.readPackage(candidate).integrity, integrity);
  assert.deepEqual(await provider.search("示例"), [{
    id: "rd-guide/demo",
    description: "示例 Plugin",
    versions: ["1.0.0"],
    source: "rd-guide",
  }]);

  const providerFromCache = new GitLabSourceProvider({ source, projectRoot, client });
  await providerFromCache.prepareLocked({
    ...candidate,
    dependencies: {},
    compatibility: candidate.manifest.compatibility,
    capabilities: {
      profile: "standard",
      granted: ["content.skills"],
      denied: [],
      approvalDigest: null,
    },
  });
  assert.equal(providerFromCache.readPackage(candidate).integrity, integrity);
  assert.equal(archiveDownloads, 1);

  fs.rmSync(path.join(projectRoot, ".flower/cache/gitlab"), { recursive: true, force: true });
  const providerFromLockedIndex = new GitLabSourceProvider({ source, projectRoot, client });
  await providerFromLockedIndex.prepareLocked({
    ...candidate,
    dependencies: {},
    compatibility: candidate.manifest.compatibility,
    capabilities: {
      profile: "standard",
      granted: ["content.skills"],
      denied: [],
      approvalDigest: null,
    },
  });
  assert.equal(providerFromLockedIndex.readPackage(candidate).integrity, integrity);
  assert.equal(archiveDownloads, 2);
  fs.rmSync(path.join(projectRoot, ".flower/cache/gitlab"), { recursive: true, force: true });
  assert.throws(
    () => providerFromLockedIndex.readPackage(candidate),
    (error) => error.code === "PLUGIN_IO_ERROR" && !error.message.includes(root),
  );
});

test("GitLab Provider 删除损坏缓存后重新下载并恢复内容", async (t) => {
  const root = createPluginTestRoot(t, "flower-gitlab-provider-redownload-");
  const container = path.join(root, "archive-source");
  const repository = path.join(container, "repo-root");
  const pluginRoot = writePluginPackage(repository, "plugins/demo", pluginManifest());
  const integrity = hashCanonicalTree(pluginRoot);
  const archive = await archiveDirectory(container, "repo-root", path.join(root, "archive.tar.gz"));
  const marketplace = {
    schemaVersion: 1,
    id: "rd-guide",
    name: "研发指南",
    plugins: [{
      id: "demo",
      description: "示例 Plugin",
      source: { type: "path", path: "plugins/demo" },
      trust: { maxProfile: "standard" },
      versions: [{ version: "1.0.0", ref: "v1.0.0", commit, integrity }],
    }],
  };
  let downloads = 0;
  const projectRoot = path.join(root, "project");
  const client = {
    resolveCommit: async () => commit,
    readRawFile: async () => JSON.stringify(marketplace),
    downloadArchive: async () => { downloads += 1; return archive; },
  };
  const first = new GitLabSourceProvider({ source, projectRoot, client });
  await first.prepare("rd-guide/demo");
  const cacheRoot = path.join(projectRoot, ".flower/cache/gitlab");
  const cacheEntry = fs.readdirSync(cacheRoot, { withFileTypes: true })
    .find((entry) => entry.isDirectory()).name;
  fs.appendFileSync(path.join(cacheRoot, cacheEntry, "skills/demo/SKILL.md"), "corrupt\n");

  const second = new GitLabSourceProvider({ source, projectRoot, client });
  await second.prepare("rd-guide/demo");
  assert.equal(downloads, 2);
  assert.equal(second.readPackage(second.listCandidates("rd-guide/demo")[0]).integrity, integrity);
});

for (const [name, entryPath, type] of [
  ["路径穿越", "../escape", "File"],
  ["Windows 路径", "repo-root\\escape", "File"],
  ["硬链", "repo-root/hard-link", "Link"],
  ["特殊文件", "repo-root/device", "CharacterDevice"],
]) {
  test(`GitLab Provider 拒绝 archive ${name}`, async (t) => {
    const root = createPluginTestRoot(t, `flower-gitlab-provider-${name}-`);
    const marketplace = {
      schemaVersion: 1,
      id: "rd-guide",
      name: "研发指南",
      plugins: [{
        id: "demo",
        description: "示例 Plugin",
        source: { type: "path", path: "plugins/demo" },
        trust: { maxProfile: "standard" },
        versions: [{
          version: "1.0.0",
          ref: "v1.0.0",
          commit,
          integrity: `sha256:${"0".repeat(64)}`,
        }],
      }],
    };
    const provider = new GitLabSourceProvider({
      source,
      projectRoot: path.join(root, "project"),
      client: {
        resolveCommit: async () => commit,
        readRawFile: async () => JSON.stringify(marketplace),
        downloadArchive: async () => Buffer.from("archive"),
      },
      extractArchive: async (options) => { options.filter(entryPath, { type, size: 1 }); },
    });
    await assert.rejects(
      () => provider.prepare("rd-guide/demo"),
      (error) => error.code === "PLUGIN_REMOTE_ARCHIVE_INVALID",
    );
  });
}

test("GitLab Provider 拒绝 archive 内软链", async (t) => {
  const root = createPluginTestRoot(t, "flower-gitlab-provider-link-");
  const container = path.join(root, "archive-source");
  const repository = path.join(container, "repo-root");
  const pluginRoot = writePluginPackage(repository, "plugins/demo", pluginManifest());
  fs.symlinkSync("SKILL.md", path.join(pluginRoot, "skills/demo/link.md"));
  const archive = await archiveDirectory(container, "repo-root", path.join(root, "unsafe.tar.gz"));
  const marketplace = {
    schemaVersion: 1,
    id: "rd-guide",
    name: "研发指南",
    plugins: [{
      id: "demo",
      description: "示例 Plugin",
      source: { type: "path", path: "plugins/demo" },
      trust: { maxProfile: "standard" },
      versions: [{ version: "1.0.0", ref: "v1.0.0", commit, integrity: `sha256:${"0".repeat(64)}` }],
    }],
  };
  const provider = new GitLabSourceProvider({
    source,
    projectRoot: path.join(root, "project"),
    client: {
      resolveCommit: async () => commit,
      readRawFile: async () => JSON.stringify(marketplace),
      downloadArchive: async () => archive,
    },
  });
  await assert.rejects(
    () => provider.prepare("rd-guide/demo"),
    (error) => error.code === "PLUGIN_REMOTE_ARCHIVE_INVALID",
  );
});

test("GitLab Provider 拒绝超过 Marketplace trust 上限的 manifest", async (t) => {
  const root = createPluginTestRoot(t, "flower-gitlab-provider-trust-");
  const container = path.join(root, "archive-source");
  const repository = path.join(container, "repo-root");
  const manifest = pluginManifest();
  manifest.capabilities.profile = "integration";
  const pluginRoot = writePluginPackage(repository, "plugins/demo", manifest);
  const integrity = hashCanonicalTree(pluginRoot);
  const archive = await archiveDirectory(container, "repo-root", path.join(root, "trust.tar.gz"));
  const marketplace = {
    schemaVersion: 1,
    id: "rd-guide",
    name: "研发指南",
    plugins: [{
      id: "demo",
      description: "示例 Plugin",
      source: { type: "path", path: "plugins/demo" },
      trust: { maxProfile: "standard" },
      versions: [{ version: "1.0.0", ref: "v1.0.0", commit, integrity }],
    }],
  };
  const provider = new GitLabSourceProvider({
    source,
    projectRoot: path.join(root, "project"),
    client: {
      resolveCommit: async () => commit,
      readRawFile: async () => JSON.stringify(marketplace),
      downloadArchive: async () => archive,
    },
  });
  await assert.rejects(
    () => provider.prepare("rd-guide/demo"),
    (error) => error.code === "PLUGIN_SOURCE_CONFIG_INVALID",
  );
});
