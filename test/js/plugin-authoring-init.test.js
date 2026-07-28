import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { parsePluginArgs } from "../../src/commands/plugin.js";
import { scaffoldFlowerPlugin } from "../../src/plugin/authoring/scaffold.js";
import { hashCanonicalTree } from "../../src/plugin/integrity/canonical-tree.js";
import { createPluginTestRoot } from "./plugin-test-helpers.js";

const CLI = path.resolve("src/cli.js");

test("plugin init parser 支持确定性非交互参数", () => {
  assert.deepEqual(parsePluginArgs([
    "init",
    "--id", "rd-guide/demo",
    "--name", "研发规范",
    "--version", "1.2.3",
    "--profile", "integration",
    "--patches",
    "--marketplace",
    "--non-interactive",
    "--json",
  ]), {
    command: "init",
    id: "rd-guide/demo",
    name: "研发规范",
    version: "1.2.3",
    profile: "integration",
    targetPath: null,
    json: true,
    help: false,
    force: false,
    includePatches: true,
    includeMarketplace: true,
    nonInteractive: true,
    ci: false,
  });
});

test("standard scaffold 稳定、幂等且不包含环境信息", (t) => {
  const root = createPluginTestRoot(t, "flower-author-init-");
  const options = { id: "rd-guide/demo", name: "研发规范", version: "1.0.0" };
  const first = scaffoldFlowerPlugin(root, options);
  const skill = path.join(root, ".flower-plugin/skills/demo/SKILL.md");
  const before = fs.statSync(skill).mtimeMs;
  const second = scaffoldFlowerPlugin(root, options);
  assert.equal(second.digest, first.digest);
  assert.equal(fs.statSync(skill).mtimeMs, before);
  const tree = fs.readdirSync(path.join(root, ".flower-plugin"), { recursive: true })
    .map(String)
    .join("\n");
  assert.doesNotMatch(tree, /README|CHANGELOG|QUICK_REFERENCE/);
  for (const file of first.files) {
    const content = fs.readFileSync(path.join(root, ".flower-plugin", ...file.split("/")), "utf8");
    assert.doesNotMatch(content, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(content, /createdAt|generatedAt|timestamp/);
  }
});

test("--force 只覆盖未被用户修改的 scaffold 文件", (t) => {
  const root = createPluginTestRoot(t, "flower-author-force-");
  scaffoldFlowerPlugin(root, { id: "rd-guide/demo", name: "研发规范" });
  const skill = path.join(root, ".flower-plugin/skills/demo/SKILL.md");
  fs.appendFileSync(skill, "\n用户修改\n");
  assert.throws(() => scaffoldFlowerPlugin(root, {
    id: "rd-guide/demo",
    name: "新版规范",
    force: true,
  }), /拒绝覆盖/);
  assert.match(fs.readFileSync(skill, "utf8"), /用户修改/);

  const managedRoot = createPluginTestRoot(t, "flower-author-force-managed-");
  scaffoldFlowerPlugin(managedRoot, {
    id: "rd-guide/managed",
    name: "旧版规范",
    includeMarketplace: true,
    commit: "a".repeat(40),
  });
  const userFile = path.join(managedRoot, ".flower-plugin/assets/user-added.txt");
  fs.mkdirSync(path.dirname(userFile), { recursive: true });
  fs.writeFileSync(userFile, "用户新增内容\n");
  scaffoldFlowerPlugin(managedRoot, {
    id: "rd-guide/managed",
    name: "新版规范",
    includeMarketplace: true,
    commit: "b".repeat(40),
    force: true,
  });
  const entryPath = path.join(managedRoot, "marketplace-entry.json");
  const updatedEntry = JSON.parse(fs.readFileSync(entryPath, "utf8"));
  assert.equal(updatedEntry.description, "新版规范");
  assert.equal(updatedEntry.versions[0].integrity, hashCanonicalTree(path.join(managedRoot, ".flower-plugin")));
  assert.equal(fs.readFileSync(userFile, "utf8"), "用户新增内容\n");
  fs.appendFileSync(entryPath, "\n");
  assert.throws(() => scaffoldFlowerPlugin(managedRoot, {
    id: "rd-guide/managed",
    name: "第三版规范",
    includeMarketplace: true,
    commit: "c".repeat(40),
    force: true,
  }), /拒绝覆盖/);

  const manifestRoot = createPluginTestRoot(t, "flower-author-force-manifest-");
  scaffoldFlowerPlugin(manifestRoot, { id: "rd-guide/manifest", name: "原始规范" });
  const manifestPath = path.join(manifestRoot, ".flower-plugin/plugin.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.name = "用户修改";
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  assert.throws(() => scaffoldFlowerPlugin(manifestRoot, {
    id: "rd-guide/manifest",
    name: "新版规范",
    force: true,
  }), /拒绝覆盖/);
});

test("scaffold 拒绝破坏 Skill frontmatter 或不可变发布契约的参数", (t) => {
  const root = createPluginTestRoot(t, "flower-author-input-");
  assert.throws(() => scaffoldFlowerPlugin(root, {
    id: "rd-guide/demo",
    name: "合法描述\nextra: injected",
  }), /单行文本/);
  assert.throws(() => scaffoldFlowerPlugin(root, {
    id: "rd-guide/demo",
    name: "研发规范",
    ref: "main",
  }), /必须固定/);
  assert.throws(() => scaffoldFlowerPlugin(root, {
    id: "rd-guide/demo",
    name: "研发规范",
    ref: "b".repeat(40),
    commit: "a".repeat(40),
  }), /必须与 --commit 一致/);
});

test("integration scaffold 只生成受限 insert 示例", (t) => {
  const root = createPluginTestRoot(t, "flower-author-integration-");
  const result = scaffoldFlowerPlugin(root, {
    id: "rd-guide/integration-demo",
    name: "集成规范",
    profile: "integration",
    includePatches: true,
  });
  assert.equal(result.files.includes("patches/example/patch.json"), true);
  const patch = JSON.parse(fs.readFileSync(
    path.join(root, ".flower-plugin/patches/example/patch.json"),
    "utf8",
  ));
  assert.deepEqual(patch.operations.map(({ operation }) => operation), ["insert"]);
  assert.throws(() => scaffoldFlowerPlugin(root, {
    id: "rd-guide/invalid",
    name: "非法",
    profile: "standard",
    includePatches: true,
  }), /只有 integration/);
});

test("作者 builtin Plugin 可在无 Trellis 项目安装", (t) => {
  const root = createPluginTestRoot(t, "flower-author-install-");
  fs.mkdirSync(path.join(root, ".agents"));
  const result = spawnSync(process.execPath, [
    CLI,
    "plugin", "add", "flower/flower-plugin-author",
    "--platform", "codex",
    "--json",
    "--target", root,
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(fs.existsSync(path.join(root, ".agents/skills/flower-plugin-author/SKILL.md")), true);
  assert.equal(fs.existsSync(path.join(root, ".trellis")), false);
  const lock = JSON.parse(fs.readFileSync(path.join(root, ".flower/plugin-lock.json"), "utf8"));
  assert.deepEqual(lock.roots, ["flower/flower-plugin-author"]);
});
