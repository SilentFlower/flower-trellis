import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { create } from "tar";
import { hashCanonicalTree } from "../../src/plugin/integrity/canonical-tree.js";
import { GitHubSourceProvider } from "../../src/plugin/sources/github-provider.js";
import { createPluginTestRoot, pluginManifest, writePluginPackage } from "./plugin-test-helpers.js";

const COMMIT = "b".repeat(40);
const COMMITTED_AT = "2026-07-28T10:00:00Z";
const SOURCE = {
  schemaVersion: 2,
  id: "public-guides",
  type: "github",
  name: "Public Guides",
  enabled: true,
  repository: "example/public-guides",
  ref: "main",
  format: "auto",
};

/**
 * 写入测试文件。
 *
 * @param {string} root 根目录
 * @param {string} relative 相对路径
 * @param {string} content 内容
 * @returns {void}
 */
function write(root, relative, content) {
  const target = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

/**
 * 把目录打包为 GitHub 风格归档。
 *
 * @param {string} root 容器目录
 * @param {string} entry 仓库目录名
 * @param {string} target 归档路径
 * @returns {Promise<Buffer>} 归档字节
 */
async function archiveDirectory(root, entry, target) {
  await create({ cwd: root, file: target, gzip: true }, [entry]);
  return fs.readFileSync(target);
}

test("GitHub Provider 探测 Codex Plugin、规范化并复用不可变缓存", async (t) => {
  const root = createPluginTestRoot(t, "flower-github-provider-");
  const container = path.join(root, "archive-source");
  const repository = path.join(container, `public-guides-${COMMIT.slice(0, 7)}`);
  write(repository, ".codex-plugin/plugin.json", JSON.stringify({
    name: "review-suite",
    version: "1.2.0",
    description: "Review workflows",
  }));
  write(repository, "skills/review/SKILL.md", "# Review\n");
  write(repository, "hooks/hooks.json", "{}\n");
  const archive = await archiveDirectory(container, path.basename(repository), path.join(root, "archive.tar.gz"));
  let downloads = 0;
  const client = {
    resolveCommit: async () => ({ sha: COMMIT, committedAt: COMMITTED_AT }),
    downloadArchive: async () => { downloads += 1; return archive; },
  };
  const projectRoot = path.join(root, "project");
  const provider = new GitHubSourceProvider({ source: SOURCE, projectRoot, client });
  const inspected = await provider.inspect();
  assert.equal(inspected.source.format, "codex");
  assert.equal(inspected.source.entryPath, ".codex-plugin/plugin.json");
  assert.equal(inspected.candidate.id, "public-guides/review-suite");
  assert.equal(inspected.candidate.compatibilityReport.status, "partial");
  assert.equal(inspected.candidate.compatibilityReport.omitted[0].kind, "hooks");
  assert.equal(provider.readPackage(inspected.candidate).manifest.version, "1.2.0");

  const cached = new GitHubSourceProvider({ source: SOURCE, projectRoot, client });
  const cachedInspection = await cached.inspect();
  assert.equal(cachedInspection.candidate.integrity, inspected.candidate.integrity);
  assert.equal(downloads, 1);
});

test("GitHub Provider 从 lock 恢复固定 skill-only 包", async (t) => {
  const root = createPluginTestRoot(t, "flower-github-provider-lock-");
  const container = path.join(root, "archive-source");
  const repository = path.join(container, "repo-root");
  write(repository, "skills/release/SKILL.md", "# Release\n");
  const archive = await archiveDirectory(container, "repo-root", path.join(root, "archive.tar.gz"));
  let downloads = 0;
  const client = {
    resolveCommit: async () => ({ sha: COMMIT, committedAt: COMMITTED_AT }),
    downloadArchive: async () => { downloads += 1; return archive; },
  };
  const projectRoot = path.join(root, "project");
  const first = new GitHubSourceProvider({ source: SOURCE, projectRoot, client });
  const inspected = await first.inspect();
  const locked = {
    ...inspected.candidate,
    dependencies: {},
    compatibility: inspected.candidate.manifest.compatibility,
    capabilities: {
      profile: "standard",
      granted: ["content.skills"],
      denied: [],
      approvalDigest: null,
    },
  };
  const second = new GitHubSourceProvider({ source: SOURCE, projectRoot, client });
  await second.prepareLocked(locked);
  assert.equal(second.readPackage(locked).integrity, locked.integrity);
  assert.equal(downloads, 1);

  fs.rmSync(path.join(projectRoot, ".flower", "cache", "github"), { recursive: true, force: true });
  const third = new GitHubSourceProvider({ source: SOURCE, projectRoot, client });
  await third.prepareLocked(locked);
  assert.equal(third.readPackage(locked).integrity, locked.integrity);
  assert.equal(downloads, 2);
});

test("GitHub Provider 从 Claude Marketplace 一次归档准备多个同仓 Plugin", async (t) => {
  const root = createPluginTestRoot(t, "flower-github-marketplace-");
  const container = path.join(root, "archive-source");
  const repository = path.join(container, "repo-root");
  write(repository, ".claude-plugin/marketplace.json", JSON.stringify({
    name: "public-guides",
    plugins: [
      { name: "review", description: "Review workflows", source: "./plugins/review" },
      { name: "release", description: "Release workflows", source: { source: "local", path: "plugins/release" } },
      { name: "private", source: { source: "url", url: "https://example.test/private.git" } },
      { name: "other-host", source: { source: "git-subdir", url: "https://gitlab.example.test/team/plugin.git", path: "plugin" } },
    ],
  }));
  write(repository, "plugins/review/.claude-plugin/plugin.json", JSON.stringify({ name: "review", version: "1.0.0" }));
  write(repository, "plugins/review/skills/review/SKILL.md", "# Review\n");
  write(repository, "plugins/release/.codex-plugin/plugin.json", JSON.stringify({ name: "release", version: "2.0.0" }));
  write(repository, "plugins/release/skills/release/SKILL.md", "# Release\n");
  const archive = await archiveDirectory(container, "repo-root", path.join(root, "archive.tar.gz"));
  let downloads = 0;
  const provider = new GitHubSourceProvider({
    source: SOURCE,
    projectRoot: path.join(root, "project"),
    client: {
      resolveCommit: async () => ({ sha: COMMIT, committedAt: COMMITTED_AT }),
      downloadArchive: async () => { downloads += 1; return archive; },
    },
  });
  const inspected = await provider.inspect();
  assert.equal(inspected.detection.kind, "marketplace");
  assert.equal(inspected.candidate, null);
  assert.deepEqual(inspected.candidates.map(({ id }) => id), ["public-guides/review", "public-guides/release"]);
  assert.deepEqual(inspected.diagnostics.map(({ code }) => code), [
    "external.marketplace-source-unsupported",
    "external.marketplace-source-unsupported",
  ]);
  assert.equal(provider.listCandidates("public-guides/review")[0].source.indexCommit, COMMIT);
  assert.equal(provider.listCandidates("public-guides/release")[0].source.format, "codex");
  assert.equal(downloads, 1);
});

test("GitHub Provider 支持 Flower Marketplace 的 commit 与 integrity 锁定", async (t) => {
  const root = createPluginTestRoot(t, "flower-github-native-marketplace-");
  const container = path.join(root, "archive-source");
  const repository = path.join(container, "repo-root");
  const pluginRoot = writePluginPackage(repository, "plugins/demo", pluginManifest());
  const integrity = hashCanonicalTree(pluginRoot);
  write(repository, ".flower-plugin/marketplace.json", JSON.stringify({
    schemaVersion: 1,
    id: "public-guides",
    name: "Public Guides",
    plugins: [{
      id: "demo",
      description: "Native Flower Plugin",
      source: { type: "path", path: "plugins/demo" },
      trust: { maxProfile: "standard" },
      versions: [{ version: "1.0.0", ref: "v1.0.0", commit: COMMIT, integrity }],
    }],
  }));
  const archive = await archiveDirectory(container, "repo-root", path.join(root, "archive.tar.gz"));
  let downloads = 0;
  const provider = new GitHubSourceProvider({
    source: SOURCE,
    projectRoot: path.join(root, "project"),
    client: {
      resolveCommit: async () => ({ sha: COMMIT, committedAt: COMMITTED_AT }),
      downloadArchive: async () => { downloads += 1; return archive; },
    },
  });
  const inspected = await provider.inspect();
  assert.equal(inspected.detection.format, "flower");
  assert.equal(inspected.pluginCount, 1);
  assert.equal(inspected.candidates.length, 0);
  assert.equal(downloads, 1);
  await provider.prepare("public-guides/demo");
  const [candidate] = provider.listCandidates("public-guides/demo");
  assert.equal(candidate.source.indexCommit, COMMIT);
  assert.equal(candidate.integrity, integrity);
  assert.equal(provider.readPackage(candidate).manifest.id, "demo");
  assert.equal(downloads, 2);
});

test("GitHub Provider 搜索 Flower Marketplace 时聚合版本且不下载 Plugin 包", async (t) => {
  const root = createPluginTestRoot(t, "flower-github-native-search-");
  const container = path.join(root, "archive-source");
  const repository = path.join(container, "repo-root");
  write(repository, ".flower-plugin/marketplace.json", JSON.stringify({
    schemaVersion: 1,
    id: "public-guides",
    name: "Public Guides",
    plugins: [{
      id: "demo",
      description: "Native Flower Plugin",
      source: { type: "path", path: "plugins/demo" },
      trust: { maxProfile: "standard" },
      versions: [
        { version: "1.0.0", ref: "v1.0.0", commit: "1".repeat(40), integrity: `sha256:${"1".repeat(64)}` },
        { version: "2.0.0", ref: "v2.0.0", commit: "2".repeat(40), integrity: `sha256:${"2".repeat(64)}` },
      ],
    }],
  }));
  const archive = await archiveDirectory(container, "repo-root", path.join(root, "archive.tar.gz"));
  let downloads = 0;
  const provider = new GitHubSourceProvider({
    source: SOURCE,
    projectRoot: path.join(root, "project"),
    client: {
      resolveCommit: async () => ({ sha: COMMIT, committedAt: COMMITTED_AT }),
      downloadArchive: async () => { downloads += 1; return archive; },
    },
  });
  const results = await provider.search("demo");
  assert.deepEqual(results[0].versions, ["2.0.0", "1.0.0"]);
  assert.equal(downloads, 1);
});

test("GitHub Provider 支持外部 Marketplace 的公开 GitHub 跨仓条目", async (t) => {
  const root = createPluginTestRoot(t, "flower-github-cross-repo-");
  const indexContainer = path.join(root, "index-source");
  const indexRoot = path.join(indexContainer, "index-root");
  write(indexRoot, ".claude-plugin/marketplace.json", JSON.stringify({
    name: "public-guides",
    plugins: [{
      name: "review",
      description: "Cross repository review",
      source: { source: "github", repo: "other/review-plugin", ref: "stable" },
    }],
  }));
  const pluginContainer = path.join(root, "plugin-source");
  const pluginRoot = path.join(pluginContainer, "plugin-root");
  write(pluginRoot, ".codex-plugin/plugin.json", JSON.stringify({ name: "review", version: "1.0.0" }));
  write(pluginRoot, "skills/review/SKILL.md", "# Review\n");
  const indexArchive = await archiveDirectory(indexContainer, "index-root", path.join(root, "index.tar.gz"));
  const pluginArchive = await archiveDirectory(pluginContainer, "plugin-root", path.join(root, "plugin.tar.gz"));
  const pluginCommit = "c".repeat(40);
  const provider = new GitHubSourceProvider({
    source: SOURCE,
    projectRoot: path.join(root, "project"),
    client: {
      resolveCommit: async (repository) => ({
        sha: repository === SOURCE.repository ? COMMIT : pluginCommit,
        committedAt: COMMITTED_AT,
      }),
      downloadArchive: async (repository) => (
        repository === SOURCE.repository ? indexArchive : pluginArchive
      ),
    },
  });
  const inspected = await provider.inspect();
  assert.equal(inspected.candidates[0].commit, pluginCommit);
  assert.equal(inspected.candidates[0].source.reference, "other/review-plugin");
  assert.equal(inspected.candidates[0].source.indexReference, SOURCE.repository);
  assert.equal(inspected.candidates[0].source.indexCommit, COMMIT);
});

test("GitHub Provider 把无 Marketplace 的 plugins 目录识别为多 Plugin 集合", async (t) => {
  const root = createPluginTestRoot(t, "flower-github-plugin-collection-");
  const container = path.join(root, "archive-source");
  const repository = path.join(container, "repo-root");
  write(repository, "plugins/review/.codex-plugin/plugin.json", JSON.stringify({ name: "review", version: "1.0.0" }));
  write(repository, "plugins/review/skills/review/SKILL.md", "# Review\n");
  write(repository, "plugins/release/.claude-plugin/plugin.json", JSON.stringify({ name: "release", version: "2.0.0" }));
  write(repository, "plugins/release/skills/release/SKILL.md", "# Release\n");
  const archive = await archiveDirectory(container, "repo-root", path.join(root, "archive.tar.gz"));
  const provider = new GitHubSourceProvider({
    source: SOURCE,
    projectRoot: path.join(root, "project"),
    client: {
      resolveCommit: async () => ({ sha: COMMIT, committedAt: COMMITTED_AT }),
      downloadArchive: async () => archive,
    },
  });
  const inspected = await provider.inspect();
  assert.equal(inspected.detection.kind, "collection");
  assert.deepEqual(inspected.candidates.map(({ id }) => id), ["public-guides/release", "public-guides/review"]);
  assert.equal(inspected.source.format, "auto");
  assert.equal("entryPath" in inspected.source, false);
});

test("GitHub Provider 省略 ref 时固定仓库默认分支", async (t) => {
  const root = createPluginTestRoot(t, "flower-github-default-branch-");
  const container = path.join(root, "archive-source");
  const repository = path.join(container, "repo-root");
  write(repository, "skills/review/SKILL.md", "# Review\n");
  const archive = await archiveDirectory(container, "repo-root", path.join(root, "archive.tar.gz"));
  const provider = new GitHubSourceProvider({
    source: { ...SOURCE, ref: undefined },
    projectRoot: path.join(root, "project"),
    client: {
      resolveRepository: async () => ({ repository: SOURCE.repository, defaultBranch: "trunk" }),
      resolveCommit: async (_repository, ref) => {
        assert.equal(ref, "trunk");
        return { sha: COMMIT, committedAt: COMMITTED_AT };
      },
      downloadArchive: async () => archive,
    },
  });
  const inspected = await provider.inspect();
  assert.equal(inspected.source.ref, "trunk");
});

test("GitHub Provider 跳过全仓扫描阶段的无关软链", async (t) => {
  const root = createPluginTestRoot(t, "flower-github-root-symlink-");
  const container = path.join(root, "archive-source");
  const repository = path.join(container, "repo-root");
  write(repository, ".codex-plugin/plugin.json", JSON.stringify({ name: "review", version: "1.0.0" }));
  write(repository, "skills/review/SKILL.md", "# Review\n");
  write(repository, "CLAUDE.md", "# Claude\n");
  fs.symlinkSync("CLAUDE.md", path.join(repository, "AGENTS.md"));
  const archive = await archiveDirectory(container, "repo-root", path.join(root, "archive.tar.gz"));
  const provider = new GitHubSourceProvider({
    source: SOURCE,
    projectRoot: path.join(root, "project"),
    client: {
      resolveCommit: async () => ({ sha: COMMIT, committedAt: COMMITTED_AT }),
      downloadArchive: async () => archive,
    },
  });
  const inspected = await provider.inspect();
  assert.equal(inspected.detection.format, "codex");
  assert.equal(inspected.candidate.id, "public-guides/review");
});

test("GitHub Provider 拒绝 archive 路径穿越", async (t) => {
  const root = createPluginTestRoot(t, "flower-github-provider-unsafe-");
  const provider = new GitHubSourceProvider({
    source: SOURCE,
    projectRoot: path.join(root, "project"),
    client: {
      resolveCommit: async () => ({ sha: COMMIT, committedAt: COMMITTED_AT }),
      downloadArchive: async () => Buffer.from("archive"),
    },
    extractArchive: async (options) => { options.filter("../escape", { type: "File", size: 1 }); },
  });
  await assert.rejects(
    () => provider.inspect(),
    (error) => error.code === "PLUGIN_REMOTE_ARCHIVE_INVALID",
  );
});

test("GitHub Provider 保留外部 manifest 路径错误码", async (t) => {
  const root = createPluginTestRoot(t, "flower-github-provider-manifest-path-");
  const container = path.join(root, "archive-source");
  const repository = path.join(container, "repo-root");
  write(repository, ".codex-plugin/plugin.json", JSON.stringify({
    name: "unsafe",
    version: "1.0.0",
    skills: "../outside",
  }));
  write(repository, "outside/leak/SKILL.md", "# Leak\n");
  const archive = await archiveDirectory(container, "repo-root", path.join(root, "archive.tar.gz"));
  const provider = new GitHubSourceProvider({
    source: SOURCE,
    projectRoot: path.join(root, "project"),
    client: {
      resolveCommit: async () => ({ sha: COMMIT, committedAt: COMMITTED_AT }),
      downloadArchive: async () => archive,
    },
  });
  await assert.rejects(
    () => provider.inspect(),
    (error) => error.code === "PLUGIN_UNSAFE_PATH",
  );
});
