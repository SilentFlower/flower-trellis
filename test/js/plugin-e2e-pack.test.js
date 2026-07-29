import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { extract } from "tar";
import {
  createPluginTestRoot,
  pluginManifest,
  writePluginPackage,
} from "./plugin-test-helpers.js";
import {
  findSensitiveText,
  parseFlowerJson,
  runFlower,
  scanSensitiveFiles,
} from "./plugin-e2e-helpers.js";

/**
 * 为解包副本链接运行依赖，但故意不提供 optional keyring。
 *
 * @param {string} packageRoot 解包后的 package 根
 * @returns {void}
 */
function linkRequiredDependencies(packageRoot) {
  const metadata = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8"));
  for (const name of Object.keys(metadata.dependencies)) {
    const parts = name.split("/");
    const target = path.resolve("node_modules", ...parts);
    const destination = path.join(packageRoot, "node_modules", ...parts);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.symlinkSync(target, destination, "dir");
  }
}

test("npm tarball 资产边界正确且解包副本可在无 keyring 时运行", async (t) => {
  const workspace = createPluginTestRoot(t, "flower-e2e-pack-");
  const packRoot = path.join(workspace, "pack");
  const extractRoot = path.join(workspace, "extract");
  const project = path.join(workspace, "project");
  fs.mkdirSync(packRoot);
  fs.mkdirSync(extractRoot);
  fs.mkdirSync(project);
  const packed = spawnSync("npm", [
    "pack", "--json", "--ignore-scripts", "--pack-destination", packRoot,
  ], { cwd: path.resolve("."), encoding: "utf8", timeout: 60_000 });
  assert.equal(packed.status, 0, `${packed.stdout}\n${packed.stderr}`);
  const report = JSON.parse(packed.stdout)[0];
  const files = new Set(report.files.map(({ path: file }) => file));
  for (const required of [
    "bin/flower-trellis.js",
    "src/commands/plugin.js",
    "src/commands/plugin-remote.js",
    "src/builtin-marketplaces/rd-guide.json",
    "src/builtin-plugins/skill-garden/plugin.json",
    "src/builtin-plugins/flower-plugin-author/plugin.json",
    "src/builtin-plugins/flower-plugin-author/skills/flower-plugin-author/SKILL.md",
    "src/plugin/authoring/templates/rd-guide/verify-integration-review.mjs",
  ]) assert.equal(files.has(required), true, `tarball 缺少 ${required}`);
  for (const file of files) {
    assert.equal(path.isAbsolute(file), false, `tarball 出现绝对路径:${file}`);
    assert.equal(/^(test|vendor|node_modules|\.trellis|\.flower)(\/|$)/.test(file), false, `tarball 越界:${file}`);
    assert.equal(file.includes("/.runtime/"), false, `tarball 包含 runtime:${file}`);
    assert.equal(file.endsWith(".tmp"), false, `tarball 包含临时文件:${file}`);
  }

  const tarball = path.join(packRoot, report.filename);
  await extract({ file: tarball, cwd: extractRoot });
  const packageRoot = path.join(extractRoot, "package");
  linkRequiredDependencies(packageRoot);
  assert.equal(fs.existsSync(path.join(packageRoot, "node_modules/@napi-rs/keyring")), false);
  const cli = path.join(packageRoot, "bin/flower-trellis.js");

  const help = runFlower(project, ["plugin", "--help"], { cli });
  assert.equal(help.status, 0, `${help.stdout}\n${help.stderr}`);
  assert.match(help.stdout, /plugin add/);

  const sourceList = runFlower(project, ["plugin", "source", "list", "--json"], { cli });
  assert.equal(sourceList.status, 0, `${sourceList.stdout}\n${sourceList.stderr}`);
  assert.equal(parseFlowerJson(sourceList).sources[0].id, "rd-guide");
  const authStatus = runFlower(project, ["plugin", "auth", "status", "rd-guide", "--json"], { cli });
  assert.equal(authStatus.status, 0, `${authStatus.stdout}\n${authStatus.stderr}`);
  assert.equal(parseFlowerJson(authStatus).persistent, false);

  writePluginPackage(project, "plugins/demo", pluginManifest());
  const local = runFlower(project, [
    "plugin", "add", "local/demo",
    "--source", "plugins/demo", "--platform", "codex", "--json",
  ], { cli });
  assert.equal(local.status, 0, `${local.stdout}\n${local.stderr}`);
  assert.equal(fs.existsSync(path.join(project, ".agents/skills/demo/SKILL.md")), true);

  const author = runFlower(project, [
    "plugin", "add", "flower/flower-plugin-author",
    "--platform", "codex", "--json",
  ], { cli, timeout: 60_000 });
  assert.equal(author.status, 0, `${author.stdout}\n${author.stderr}`);
  assert.equal(fs.existsSync(path.join(project, ".agents/skills/flower-plugin-author/SKILL.md")), true);
  assert.equal(fs.existsSync(path.join(project, ".trellis")), false);
  for (const result of [help, sourceList, authStatus, local, author]) {
    assert.deepEqual(findSensitiveText(`${result.stdout}\n${result.stderr}`), []);
  }
  assert.deepEqual(scanSensitiveFiles(packageRoot), []);
});
