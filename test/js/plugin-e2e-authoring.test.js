import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createPluginTestRoot } from "./plugin-test-helpers.js";
import { parseFlowerJson, runFlower } from "./plugin-e2e-helpers.js";

test("真实 bin 确定性创建并校验 standard Plugin", (t) => {
  const workspace = createPluginTestRoot(t, "flower-e2e-authoring-");
  const project = path.join(workspace, "project");
  fs.mkdirSync(project);
  const args = [
    "plugin", "init",
    "--id", "rd-guide/example",
    "--name", "示例规范",
    "--version", "1.2.3",
    "--profile", "standard",
    "--non-interactive",
    "--json",
  ];
  const first = runFlower(project, args);
  assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
  const firstJson = parseFlowerJson(first);
  const second = runFlower(project, args);
  assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
  assert.deepEqual(parseFlowerJson(second), firstJson);

  const validation = runFlower(project, [
    "plugin", "validate", ".flower-plugin",
    "--subject", "plugin",
    "--source-id", "rd-guide",
    "--json",
  ]);
  assert.equal(validation.status, 0, `${validation.stdout}\n${validation.stderr}`);
  const report = parseFlowerJson(validation);
  assert.equal(report.ok, true);
  assert.deepEqual(report.subject, { id: "rd-guide/example", type: "plugin" });
  assert.equal(report.capabilities[0].profile, "standard");
});

test("README Plugin 示例与真实 help 保持命令面同步", (t) => {
  const workspace = createPluginTestRoot(t, "flower-e2e-readme-");
  const project = path.join(workspace, "project");
  fs.mkdirSync(project);
  const readme = fs.readFileSync(path.resolve("README.md"), "utf8");
  const help = runFlower(project, ["plugin", "--help"]);
  assert.equal(help.status, 0, help.stderr);
  for (const command of [
    "plugin add", "plugin list", "plugin update", "plugin remove", "plugin verify",
    "plugin source", "plugin auth", "plugin search", "plugin init", "plugin validate",
  ]) {
    assert.equal(readme.includes(command), true, `README 缺少 ${command}`);
    assert.equal(help.stdout.includes(command), true, `help 缺少 ${command}`);
  }
  assert.match(readme, /自动识别 Flower、Codex、Claude Code 与 Skill-only/);
  assert.match(readme, /hooks、agents、MCP.*只展示兼容性诊断，不会执行/);
  assert.match(readme, /独立的 `plugin add`.*不会隐式安装 `skill-garden`/s);
  assert.match(readme, /\.flower\/plugin-lock\.json/);
});
