import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { create } from "tar";
import { hashCanonicalTree } from "../../src/plugin/integrity/canonical-tree.js";
import { PluginRuntimeError } from "../../src/plugin/runtime-errors.js";
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
  marketplacePath: ".flower-plugin/marketplace.json",
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
  assert.equal(candidate.source.indexPath, ".flower-plugin/marketplace.json");
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

test("GitLab Provider 通过受限映射重放旧 RD Guide Marketplace 路径", async (t) => {
  const root = createPluginTestRoot(t, "flower-gitlab-provider-legacy-index-");
  const project = "digital-rd-governance/rd-guide";
  const indexCommit = "b".repeat(40);
  const packageCommit = "c".repeat(40);
  const repositoryContainer = path.join(root, "archive-source");
  const repositoryRoot = path.join(repositoryContainer, "rd-guide-legacy");
  const pluginRoot = writePluginPackage(
    repositoryRoot,
    "plugins/xhgj-legacy",
    pluginManifest({ id: "xhgj-legacy" }),
  );
  const integrity = hashCanonicalTree(pluginRoot);
  const archive = await archiveDirectory(
    repositoryContainer,
    path.basename(repositoryRoot),
    path.join(root, "archive.tar.gz"),
  );
  const marketplace = {
    schemaVersion: 1,
    id: "rd-guide",
    name: "研发指南",
    plugins: [{
      id: "xhgj-legacy",
      description: "历史 Plugin",
      source: { type: "path", path: "plugins/xhgj-legacy" },
      trust: { maxProfile: "standard" },
      versions: [{ version: "1.0.0", ref: "v1.0.0", commit: packageCommit, integrity }],
    }],
  };
  const reads = [];
  const provider = new GitLabSourceProvider({
    source: { ...source, project },
    projectRoot: path.join(root, "project"),
    client: {
      resolveCommit: async () => { throw new Error("锁定重放不应解析当前 ref"); },
      readRawFile: async (readProject, filePath, ref) => {
        reads.push({ project: readProject, filePath, ref });
        return JSON.stringify(marketplace);
      },
      downloadArchive: async () => archive,
    },
  });
  const lockedPlugin = {
    id: "rd-guide/xhgj-legacy",
    version: "1.0.0",
    source: { id: "rd-guide", type: "gitlab", reference: project, indexCommit },
    commit: packageCommit,
    integrity,
    dependencies: {},
    compatibility: { flower: "*" },
    capabilities: {
      profile: "standard",
      granted: ["content.skills"],
      denied: [],
      approvalDigest: null,
    },
  };

  await provider.prepareLocked(lockedPlugin);

  const [candidate] = provider.listCandidates(lockedPlugin.id);
  assert.equal(candidate.source.indexPath, ".flower-marketplace/marketplace.json");
  assert.deepEqual(reads, [{
    project,
    filePath: ".flower-marketplace/marketplace.json",
    ref: indexCommit,
  }]);
});

test("GitLab Provider prepareVersion 只准备指定版本", async (t) => {
  const root = createPluginTestRoot(t, "flower-gitlab-provider-version-");
  const container = path.join(root, "archive-source");
  const oldCommit = "b".repeat(40);
  const newCommit = "c".repeat(40);
  const oldRepository = path.join(container, "repo-old");
  const newRepository = path.join(container, "repo-new");
  const oldPluginRoot = writePluginPackage(oldRepository, "plugins/demo", pluginManifest({ version: "1.0.0" }));
  const newPluginRoot = writePluginPackage(newRepository, "plugins/demo", pluginManifest({ version: "1.1.0" }));
  const oldIntegrity = hashCanonicalTree(oldPluginRoot);
  const newIntegrity = hashCanonicalTree(newPluginRoot);
  const oldArchive = await archiveDirectory(container, "repo-old", path.join(root, "old.tar.gz"));
  const newArchive = await archiveDirectory(container, "repo-new", path.join(root, "new.tar.gz"));
  const marketplace = {
    schemaVersion: 1,
    id: "rd-guide",
    name: "研发指南",
    plugins: [{
      id: "demo",
      description: "示例 Plugin",
      source: { type: "path", path: "plugins/demo" },
      trust: { maxProfile: "standard" },
      versions: [
        { version: "1.0.0", ref: "v1.0.0", commit: oldCommit, integrity: oldIntegrity },
        { version: "1.1.0", ref: "v1.1.0", commit: newCommit, integrity: newIntegrity },
      ],
    }],
  };
  const downloadedCommits = [];
  const client = {
    resolveCommit: async () => commit,
    readRawFile: async () => JSON.stringify(marketplace),
    downloadArchive: async (_project, archiveCommit) => {
      downloadedCommits.push(archiveCommit);
      return archiveCommit === newCommit ? newArchive : oldArchive;
    },
  };
  const provider = new GitLabSourceProvider({ source, projectRoot: path.join(root, "project"), client });

  await provider.prepareVersion("rd-guide/demo", "1.1.0");

  assert.deepEqual(downloadedCommits, [newCommit]);
  const candidates = provider.listCandidates("rd-guide/demo");
  assert.deepEqual(candidates.map(({ version }) => version), ["1.1.0"]);
  assert.equal(provider.readPackage(candidates[0]).integrity, newIntegrity);
});

test("GitLab Provider 支持仓库根 .flower-plugin 元数据发布 rd-guide 聚合包", async (t) => {
  const root = createPluginTestRoot(t, "flower-gitlab-provider-root-metadata-");
  const container = path.join(root, "archive-source");
  const repository = path.join(container, "repo-root");
  const manifest = pluginManifest({
    id: "rd-guide",
    version: "0.8.0",
    content: {
      skills: [{
        name: "xhgj-gitlab-collaboration",
        path: "skills/xhgj-gitlab-collaboration",
        version: "0.4.2",
        description: "GitLab 协作执行。",
      }],
    },
  });
  fs.mkdirSync(path.join(repository, ".flower-plugin"), { recursive: true });
  fs.mkdirSync(path.join(repository, "skills/xhgj-gitlab-collaboration"), { recursive: true });
  fs.writeFileSync(path.join(repository, ".flower-plugin/plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(repository, ".flower-plugin/marketplace.json"), "self reference must not enter package hash\n");
  fs.writeFileSync(path.join(repository, "skills/xhgj-gitlab-collaboration/SKILL.md"), "# GitLab\n");

  const runtimePackage = path.join(root, "runtime-package");
  fs.mkdirSync(path.join(runtimePackage, "skills/xhgj-gitlab-collaboration"), { recursive: true });
  fs.copyFileSync(path.join(repository, ".flower-plugin/plugin.json"), path.join(runtimePackage, "plugin.json"));
  fs.copyFileSync(
    path.join(repository, "skills/xhgj-gitlab-collaboration/SKILL.md"),
    path.join(runtimePackage, "skills/xhgj-gitlab-collaboration/SKILL.md"),
  );
  const integrity = hashCanonicalTree(runtimePackage);
  const marketplace = {
    schemaVersion: 1,
    id: "rd-guide",
    name: "研发指南",
    plugins: [{
      id: "rd-guide",
      description: "RD Guide 技能",
      source: { type: "path", manifestPath: ".flower-plugin/plugin.json" },
      trust: { maxProfile: "standard" },
      versions: [{ version: "0.8.0", ref: "v0.8.0", commit, integrity }],
    }],
  };
  const archive = await archiveDirectory(container, "repo-root", path.join(root, "repo.tar.gz"));
  const provider = new GitLabSourceProvider({
    source,
    projectRoot: path.join(root, "project"),
    client: {
      resolveCommit: async () => commit,
      readRawFile: async () => JSON.stringify(marketplace),
      downloadArchive: async () => archive,
    },
  });

  await provider.prepareVersion("rd-guide/rd-guide", "0.8.0");

  const [candidate] = provider.listCandidates("rd-guide/rd-guide");
  const pluginPackage = provider.readPackage(candidate);
  assert.equal(candidate.id, "rd-guide/rd-guide");
  assert.equal(candidate.source.reference, "group/rd-guide");
  assert.equal(pluginPackage.integrity, integrity);
  assert.equal(pluginPackage.manifest.content.skills[0].version, "0.4.2");
  assert.equal(fs.existsSync(path.join(pluginPackage.root, ".flower-plugin/marketplace.json")), false);
});

test("GitLab Provider manifest-only inspection 不下载固定包", async (t) => {
  const root = createPluginTestRoot(t, "flower-gitlab-provider-manifest-inspection-");
  const manifest = pluginManifest({
    id: "rd-guide",
    version: "0.8.0",
    content: {
      skills: [{
        name: "xhgj-gitlab-collaboration",
        path: "skills/xhgj-gitlab-collaboration",
        version: "0.4.2",
        description: "GitLab 协作执行。",
      }],
    },
  });
  const integrity = `sha256:${"1".repeat(64)}`;
  const marketplace = {
    schemaVersion: 1,
    id: "rd-guide",
    name: "研发指南",
    plugins: [{
      id: "rd-guide",
      description: "RD Guide 技能",
      source: { type: "path", manifestPath: ".flower-plugin/plugin.json" },
      trust: { maxProfile: "standard" },
      versions: [{ version: "0.8.0", ref: "v0.8.0", commit, integrity }],
    }],
  };
  const reads = [];
  const projectRoot = path.join(root, "project");
  const provider = new GitLabSourceProvider({
    source,
    projectRoot,
    client: {
      resolveCommit: async (project, ref) => {
        assert.equal(project, "group/rd-guide");
        assert.equal(ref, "main");
        return commit;
      },
      readRawFile: async (project, filePath, ref) => {
        reads.push({ project, filePath, ref });
        if (filePath === ".flower-plugin/marketplace.json") return JSON.stringify(marketplace);
        if (filePath === ".flower-plugin/plugin.json") return JSON.stringify(manifest);
        throw new Error(`unexpected raw file:${filePath}`);
      },
      downloadArchive: async () => { throw new Error("manifest-only inspection 不应下载 archive"); },
      readRepositoryTree: async () => { throw new Error("manifest-only inspection 不应读取 tree"); },
    },
  });

  const inspection = await provider.inspectContentManifest("rd-guide/rd-guide", { version: "0.8.0" });

  assert.equal(inspection.version, "0.8.0");
  assert.equal(inspection.source.indexCommit, commit);
  assert.equal(inspection.manifest.content.skills[0].version, "0.4.2");
  assert.equal(fs.existsSync(path.join(projectRoot, ".flower/cache/gitlab")), false);
  assert.deepEqual(reads, [
    { project: "group/rd-guide", filePath: ".flower-plugin/marketplace.json", ref: commit },
    { project: "group/rd-guide", filePath: ".flower-plugin/plugin.json", ref: commit },
  ]);
});

test("GitLab Provider locked manifest-only inspection 使用锁定索引", async (t) => {
  const root = createPluginTestRoot(t, "flower-gitlab-provider-locked-manifest-inspection-");
  const indexCommit = "d".repeat(40);
  const packageCommit = "e".repeat(40);
  const manifest = pluginManifest({
    id: "rd-guide",
    version: "0.8.0",
    content: {
      skills: [{
        name: "xhgj-gitlab-collaboration",
        path: "skills/xhgj-gitlab-collaboration",
        version: "0.4.2",
        description: "GitLab 协作执行。",
      }],
    },
  });
  const integrity = `sha256:${"2".repeat(64)}`;
  const marketplace = {
    schemaVersion: 1,
    id: "rd-guide",
    name: "研发指南",
    plugins: [{
      id: "rd-guide",
      description: "RD Guide 技能",
      source: { type: "path", manifestPath: ".flower-plugin/plugin.json" },
      trust: { maxProfile: "standard" },
      versions: [{ version: "0.8.0", ref: "v0.8.0", commit: packageCommit, integrity }],
    }],
  };
  const lockedPlugin = {
    id: "rd-guide/rd-guide",
    version: "0.8.0",
    source: { id: "rd-guide", type: "gitlab", reference: "group/rd-guide", indexCommit },
    commit: packageCommit,
    integrity,
    dependencies: {},
    compatibility: manifest.compatibility,
    capabilities: {
      profile: "standard",
      granted: ["content.skills"],
      denied: [],
      approvalDigest: null,
    },
  };
  const reads = [];
  const projectRoot = path.join(root, "project");
  const provider = new GitLabSourceProvider({
    source,
    projectRoot,
    client: {
      resolveCommit: async () => { throw new Error("locked inspection 不应解析当前 ref"); },
      readRawFile: async (project, filePath, ref) => {
        reads.push({ project, filePath, ref });
        if (filePath === ".flower-plugin/marketplace.json") return JSON.stringify(marketplace);
        if (filePath === ".flower-plugin/plugin.json") return JSON.stringify(manifest);
        throw new Error(`unexpected raw file:${filePath}`);
      },
      downloadArchive: async () => { throw new Error("locked inspection 不应下载 archive"); },
      readRepositoryTree: async () => { throw new Error("locked inspection 不应读取 tree"); },
    },
  });

  const inspection = await provider.inspectContentManifest("rd-guide/rd-guide", { lockedPlugin });

  assert.equal(inspection.version, lockedPlugin.version);
  assert.equal(inspection.source.indexCommit, indexCommit);
  assert.equal(inspection.source.indexPath, ".flower-plugin/marketplace.json");
  assert.equal(inspection.commit, packageCommit);
  assert.equal(fs.existsSync(path.join(projectRoot, ".flower/cache/gitlab")), false);
  assert.deepEqual(reads, [
    { project: "group/rd-guide", filePath: ".flower-plugin/marketplace.json", ref: indexCommit },
    { project: "group/rd-guide", filePath: ".flower-plugin/plugin.json", ref: packageCommit },
  ]);
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

test("GitLab Provider 在 OAuth archive 406 时通过固定 commit 的 tree/raw API 准备 Plugin", async (t) => {
  const root = createPluginTestRoot(t, "flower-gitlab-provider-tree-fallback-");
  const repositoryRoot = path.join(root, "repository");
  const pluginRoot = writePluginPackage(repositoryRoot, "skills", pluginManifest({
    content: {
      skills: [{
        name: "demo",
        path: "skills/demo",
        version: "1.0.0",
        description: "Demo Skill",
      }],
      assets: ["binary.dat"],
    },
  }));
  fs.writeFileSync(path.join(pluginRoot, "binary.dat"), Buffer.from([0, 255, 1]));
  const integrity = hashCanonicalTree(pluginRoot);
  const marketplace = {
    schemaVersion: 1,
    id: "rd-guide",
    name: "研发指南",
    plugins: [{
      id: "demo",
      description: "示例 Plugin",
      source: { type: "gitlab", project: "group/rd-guide", subdir: "skills" },
      trust: { maxProfile: "standard" },
      versions: [{ version: "1.0.0", ref: "v1.0.0", commit, integrity }],
    }],
  };
  const entries = [];
  function visit(directory, relative) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = relative ? `${relative}/${entry.name}` : entry.name;
      entries.push({ path: entryPath, type: entry.isDirectory() ? "tree" : "blob", mode: entry.isDirectory() ? "040000" : "100644" });
      if (entry.isDirectory()) visit(path.join(directory, entry.name), entryPath);
    }
  }
  visit(repositoryRoot, "");
  const client = {
    resolveCommit: async () => commit,
    readRawFile: async () => JSON.stringify(marketplace),
    downloadArchive: async () => {
      throw new PluginRuntimeError("GitLab REST 请求失败:406", {
        code: "PLUGIN_REMOTE_REQUEST_FAILED",
        path: "rd-guide",
        details: { status: 406, endpoint: "/repository/archive.tar.gz" },
      });
    },
    readRepositoryTree: async (_project, options) => {
      assert.equal(options.ref, commit);
      assert.equal(options.path, "skills");
      return entries.filter(({ path: entryPath }) => entryPath.startsWith("skills/"));
    },
    readRawBuffer: async (_project, filePath, ref) => {
      assert.equal(ref, commit);
      return fs.readFileSync(path.join(repositoryRoot, ...filePath.split("/")));
    },
  };
  const provider = new GitLabSourceProvider({
    source,
    projectRoot: path.join(root, "project"),
    client,
  });
  await provider.prepare("rd-guide/demo");
  const candidate = provider.listCandidates("rd-guide/demo")[0];
  assert.equal(provider.readPackage(candidate).integrity, integrity);
});

test("GitLab Provider 的 OAuth 406 tree 回退拒绝软链 mode", async (t) => {
  const root = createPluginTestRoot(t, "flower-gitlab-provider-tree-link-");
  const marketplace = {
    schemaVersion: 1,
    id: "rd-guide",
    name: "研发指南",
    plugins: [{
      id: "demo",
      description: "示例 Plugin",
      source: { type: "gitlab", project: "group/rd-guide", subdir: "skills" },
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
      downloadArchive: async () => {
        throw new PluginRuntimeError("GitLab REST 请求失败:406", {
          code: "PLUGIN_REMOTE_REQUEST_FAILED",
          path: "rd-guide",
          details: { status: 406 },
        });
      },
      readRepositoryTree: async () => [{ path: "skills/link", type: "blob", mode: "120000" }],
      readRawBuffer: async () => Buffer.from("target"),
    },
  });
  await assert.rejects(
    () => provider.prepare("rd-guide/demo"),
    (error) => error.code === "PLUGIN_REMOTE_ARCHIVE_INVALID" && error.message.includes("不安全条目"),
  );
});

for (const [name, entryPath, type] of [
  ["路径穿越", "../escape", "File"],
  ["Windows 路径", "repo-root\\escape", "File"],
  ["硬链", "repo-root/plugins/demo/hard-link", "Link"],
  ["特殊文件", "repo-root/plugins/demo/device", "CharacterDevice"],
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
