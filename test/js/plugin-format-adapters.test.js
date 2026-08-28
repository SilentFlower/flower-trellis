import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { PluginFormatRegistry } from "../../src/plugin/formats/registry.js";
import { createPluginTestRoot } from "./plugin-test-helpers.js";

const COMMIT = "a".repeat(40);
const COMMITTED_AT = "2026-07-28T10:00:00Z";

function write(root, relative, content) {
  const target = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

test("Codex Plugin 被识别并规范化为只含 Skills 的 standard Flower package", (t) => {
  const root = createPluginTestRoot(t, "flower-format-codex-");
  write(root, ".codex-plugin/plugin.json", JSON.stringify({
    name: "review-suite",
    version: "1.2.0",
    description: "Review workflows",
    skills: "./skills/",
    hooks: "./hooks/hooks.json",
  }));
  write(root, "skills/review/SKILL.md", "---\nname: Review Flow\ndescription: Review changes\n---\n\n# Review\n");
  write(root, "hooks/hooks.json", "{}\n");
  const registry = new PluginFormatRegistry();
  const selected = registry.selectSingle(registry.detect(root));
  assert.equal(selected.format, "codex");
  const output = path.join(root, "normalized");
  const normalized = registry.normalize(selected, {
    outputRoot: output,
    sourceId: "github-guides",
    commit: COMMIT,
    committedAt: COMMITTED_AT,
  });
  assert.equal(normalized.manifest.id, "review-suite");
  assert.equal(normalized.manifest.version, "1.2.0");
  assert.deepEqual(normalized.manifest.capabilities, { profile: "standard", required: ["content.skills"] });
  assert.equal(normalized.compatibilityReport.status, "partial");
  assert.equal(normalized.compatibilityReport.omitted[0].kind, "hooks");
  assert.equal(fs.existsSync(path.join(output, "skills/review/SKILL.md")), true);
});

test("Claude Code commands 转换为 Skill，缺失版本使用 commit 时间版本", (t) => {
  const root = createPluginTestRoot(t, "flower-format-claude-");
  write(root, ".claude-plugin/plugin.json", JSON.stringify({ name: "Release Helper" }));
  write(root, "commands/release.md", "---\ndescription: Prepare release\n---\n\nPrepare the release.\n");
  const registry = new PluginFormatRegistry();
  const selected = registry.selectSingle(registry.detect(root));
  const normalized = registry.normalize(selected, {
    outputRoot: path.join(root, "normalized"),
    sourceId: "github-guides",
    commit: COMMIT,
    committedAt: COMMITTED_AT,
  });
  assert.equal(normalized.manifest.id, "release-helper");
  assert.match(normalized.manifest.version, /^0\.0\.0-git\.\d+\.shaa{12}$/);
  assert.equal(normalized.compatibilityReport.imported[0].kind, "commands");
  assert.match(fs.readFileSync(path.join(normalized.root, "skills/release/SKILL.md"), "utf8"), /name: release/);
});

test("skill-only 仓库可规范化，多个格式入口要求显式选择", (t) => {
  const root = createPluginTestRoot(t, "flower-format-skill-");
  write(root, "skills/guide/SKILL.md", "# Guide\n");
  const registry = new PluginFormatRegistry();
  const selected = registry.selectSingle(registry.detect(root));
  assert.equal(selected.format, "skill-only");
  const normalized = registry.normalize(selected, {
    outputRoot: path.join(root, "normalized"),
    sourceId: "github-guides",
    commit: COMMIT,
    committedAt: COMMITTED_AT,
  });
  assert.deepEqual(normalized.manifest.content.skills[0], {
    name: "guide",
    path: "skills/guide",
    version: normalized.manifest.version,
  });

  write(root, ".codex-plugin/plugin.json", JSON.stringify({ name: "guide-plugin", version: "1.0.0" }));
  write(root, ".claude-plugin/plugin.json", JSON.stringify({ name: "guide-plugin", version: "1.0.0" }));
  const detections = registry.detect(root);
  assert.equal(detections.length, 2);
  assert.throws(
    () => registry.selectSingle(detections),
    (error) => error.code === "PLUGIN_SOURCE_AMBIGUOUS" && error.details.detections.length === 2,
  );
});

test("只有主动组件的外部 Plugin 被拒绝且不会留下规范化目录", (t) => {
  const root = createPluginTestRoot(t, "flower-format-unsupported-");
  write(root, ".claude-plugin/plugin.json", JSON.stringify({ name: "hook-only", version: "1.0.0" }));
  write(root, "hooks/hooks.json", "{}\n");
  const registry = new PluginFormatRegistry();
  const selected = registry.selectSingle(registry.detect(root));
  const output = path.join(root, "normalized");
  assert.throws(() => registry.normalize(selected, {
    outputRoot: output,
    sourceId: "github-guides",
    commit: COMMIT,
    committedAt: COMMITTED_AT,
  }), (error) => error.code === "PLUGIN_FORMAT_UNSUPPORTED");
  assert.equal(fs.existsSync(output), false);
});

test("外部 manifest 的 skills 路径不能逃逸 Plugin 根", (t) => {
  const root = createPluginTestRoot(t, "flower-format-unsafe-skills-");
  const pluginRoot = path.join(root, "plugin");
  write(pluginRoot, ".codex-plugin/plugin.json", JSON.stringify({
    name: "unsafe-skills",
    version: "1.0.0",
    skills: "../outside",
  }));
  write(root, "outside/leak/SKILL.md", "# Leak\n");
  const registry = new PluginFormatRegistry();
  const selected = registry.selectSingle(registry.detect(pluginRoot));
  assert.throws(() => registry.normalize(selected, {
    outputRoot: path.join(root, "normalized"),
    sourceId: "github-guides",
    commit: COMMIT,
    committedAt: COMMITTED_AT,
  }), (error) => error.code === "PLUGIN_UNSAFE_PATH");
});

test("外部 Skill 描述按 YAML 字符串转义", (t) => {
  const root = createPluginTestRoot(t, "flower-format-yaml-description-");
  write(root, ".codex-plugin/plugin.json", JSON.stringify({ name: "yaml-safe", version: "1.0.0" }));
  write(root, "skills/review/SKILL.md", "---\ndescription: value: # literal\n---\n\n# Review\n");
  const registry = new PluginFormatRegistry();
  const selected = registry.selectSingle(registry.detect(root));
  const normalized = registry.normalize(selected, {
    outputRoot: path.join(root, "normalized"),
    sourceId: "github-guides",
    commit: COMMIT,
    committedAt: COMMITTED_AT,
  });
  assert.match(
    fs.readFileSync(path.join(normalized.root, "skills/review/SKILL.md"), "utf8"),
    /description: "value: # literal"/,
  );
});

test("仓库根 .flower-plugin metadata 规范化为声明式运行时包", (t) => {
  const root = createPluginTestRoot(t, "flower-format-flower-root-metadata-");
  write(root, ".flower-plugin/plugin.json", JSON.stringify({
    schemaVersion: 1,
    id: "rd-guide",
    name: "研发指南",
    version: "0.8.0",
    compatibility: { flower: ">=0.5.0 <1.0.0" },
    dependencies: {},
    capabilities: { profile: "standard", required: ["content.skills"] },
    content: {
      skills: [{
        name: "xhgj-gitlab-collaboration",
        path: "skills/xhgj-gitlab-collaboration",
        version: "0.4.2",
        description: "GitLab 协作执行。",
      }],
      tests: ["tests/self_check.js"],
    },
  }));
  write(root, ".flower-plugin/marketplace.json", JSON.stringify({
    schemaVersion: 1,
    id: "rd-guide",
    name: "研发指南",
    plugins: [],
  }));
  write(root, "skills/xhgj-gitlab-collaboration/SKILL.md", "# GitLab\n");
  write(root, "tests/self_check.js", "console.log('ok');\n");
  write(root, "README.md", "# Not packaged\n");

  const registry = new PluginFormatRegistry();
  const selected = registry.detect(root).find((entry) => (
    entry.format === "flower" &&
    entry.kind === "plugin" &&
    entry.entryPath === ".flower-plugin/plugin.json"
  ));
  assert.ok(selected);
  const normalized = registry.normalize(selected, {
    outputRoot: path.join(root, "normalized"),
    sourceId: "github-guides",
    commit: COMMIT,
    committedAt: COMMITTED_AT,
  });

  assert.equal(normalized.manifest.content.skills[0].version, "0.4.2");
  assert.equal(fs.existsSync(path.join(normalized.root, "plugin.json")), true);
  assert.equal(fs.existsSync(path.join(normalized.root, "skills/xhgj-gitlab-collaboration/SKILL.md")), true);
  assert.equal(fs.existsSync(path.join(normalized.root, "tests/self_check.js")), true);
  assert.equal(fs.existsSync(path.join(normalized.root, ".flower-plugin/marketplace.json")), false);
  assert.equal(fs.existsSync(path.join(normalized.root, "README.md")), false);
});
