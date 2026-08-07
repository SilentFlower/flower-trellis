import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  createPluginTestRoot,
  pluginManifest,
  writePluginPackage,
} from "./plugin-test-helpers.js";
import {
  parseFlowerJson,
  runFlower,
  snapshotProjectFiles,
} from "./plugin-e2e-helpers.js";

test("真实 bin 在无 Trellis 项目安装 standard Plugin 并保持重放幂等", (t) => {
  const workspace = createPluginTestRoot(t, "flower-e2e-local-");
  const project = path.join(workspace, "project");
  fs.mkdirSync(project);
  writePluginPackage(project, "plugins/demo", pluginManifest(), {
    "skills/demo/SKILL.md": "# Demo\n",
    "skills/demo/references/guide.md": "guide\n",
  });

  const result = runFlower(project, [
    "plugin", "add", "local/demo",
    "--source", "plugins/demo",
    "--platform", "codex",
    "--platform", "gemini",
    "--json",
  ]);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const output = parseFlowerJson(result);
  assert.equal(output.command, "add");
  assert.equal(fs.existsSync(path.join(project, ".trellis")), false);
  assert.equal(fs.existsSync(path.join(project, ".agents/skills/demo/SKILL.md")), true);
  const state = JSON.parse(fs.readFileSync(path.join(project, ".flower/state.json"), "utf8"));
  assert.deepEqual(state.plugins[0].platforms, ["codex", "gemini"]);
  assert.equal(state.plugins.some(({ id }) => id === "flower/skill-garden"), false);

  const beforeReplay = snapshotProjectFiles(project);
  const replay = runFlower(project, [
    "plugin", "replay",
    "--platform", "codex",
    "--platform", "gemini",
    "--json",
  ]);
  assert.equal(replay.status, 0, `${replay.stdout}\n${replay.stderr}`);
  assert.equal(parseFlowerJson(replay).transaction.status, "unchanged");
  assert.deepEqual(snapshotProjectFiles(project), beforeReplay);
});

test("受管目录里的 Python 字节码缓存不阻断重放，也不写进 state", (t) => {
  const workspace = createPluginTestRoot(t, "flower-e2e-pycache-");
  const project = path.join(workspace, "project");
  fs.mkdirSync(project);
  writePluginPackage(project, "plugins/demo", pluginManifest(), {
    "skills/demo/SKILL.md": "# Demo\n",
    "skills/demo/scripts/self_check.py": "print(1)\n",
  });

  const added = runFlower(project, [
    "plugin", "add", "local/demo",
    "--source", "plugins/demo",
    "--platform", "codex",
    "--json",
  ]);
  assert.equal(added.status, 0, `${added.stdout}\n${added.stderr}`);
  const cleanState = JSON.parse(fs.readFileSync(path.join(project, ".flower/state.json"), "utf8"));

  // 模拟解释器执行受管脚本后就地生成字节码缓存。
  const scripts = path.join(project, ".agents/skills/demo/scripts");
  fs.mkdirSync(path.join(scripts, "__pycache__"));
  fs.writeFileSync(path.join(scripts, "__pycache__/self_check.cpython-312.pyc"), "cache");

  const replay = runFlower(project, ["plugin", "replay", "--platform", "codex", "--json"]);
  assert.equal(replay.status, 0, `${replay.stdout}\n${replay.stderr}`);
  assert.equal(parseFlowerJson(replay).transaction.status, "unchanged");
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(project, ".flower/state.json"), "utf8")),
    cleanState,
  );
  // 缓存既不被当作用户改动，也不被写链顺手删除。
  assert.equal(fs.existsSync(path.join(scripts, "__pycache__/self_check.cpython-312.pyc")), true);

  // 移除 Plugin 时非递归 rmdir 必须先清掉缓存，否则整笔事务因 ENOTEMPTY 失败。
  const removed = runFlower(project, ["plugin", "remove", "local/demo", "--json"]);
  assert.equal(removed.status, 0, `${removed.stdout}\n${removed.stderr}`);
  assert.equal(fs.existsSync(path.join(project, ".agents/skills/demo")), false);
});

test("显式依赖 skill-garden 但缺少 Trellis 时在写盘前阻断", (t) => {  const workspace = createPluginTestRoot(t, "flower-e2e-dependent-");
  const project = path.join(workspace, "project");
  fs.mkdirSync(project);
  writePluginPackage(project, "plugins/dependent", pluginManifest({
    id: "dependent",
    dependencies: { "flower/skill-garden": "*" },
    content: { skills: ["skills/dependent"] },
  }), { "skills/dependent/SKILL.md": "# Dependent\n" });
  const before = snapshotProjectFiles(project);

  const result = runFlower(project, [
    "plugin", "add", "local/dependent",
    "--source", "plugins/dependent",
    "--platform", "codex",
    "--json",
  ]);
  assert.equal(result.status, 3, `${result.stdout}\n${result.stderr}`);
  assert.equal(parseFlowerJson(result).diagnostics[0].code, "PLUGIN_DEPENDENCY_MISSING");
  assert.deepEqual(snapshotProjectFiles(project), before);
  assert.equal(fs.existsSync(path.join(project, ".flower")), false);
});

test("Plugin help、未知命令退出码和 JSON stdout 契约通过真实 bin", (t) => {
  const workspace = createPluginTestRoot(t, "flower-e2e-help-");
  const project = path.join(workspace, "project");
  fs.mkdirSync(project);
  const help = runFlower(project, ["plugin", "--help"]);
  assert.equal(help.status, 0, help.stderr);
  for (const command of ["plugin add", "plugin source", "plugin auth", "plugin init", "plugin validate"]) {
    assert.match(help.stdout, new RegExp(command.replace(" ", "\\s+")));
  }

  const unknown = runFlower(project, ["plugin", "unknown", "--json"]);
  assert.equal(unknown.status, 2, unknown.stderr);
  assert.equal(parseFlowerJson(unknown).diagnostics[0].code, "PLUGIN_USAGE_ERROR");
  assert.equal(unknown.stderr, "");
});
