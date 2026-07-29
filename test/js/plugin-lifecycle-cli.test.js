import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { parsePluginArgs, plugin } from "../../src/commands/plugin.js";
import { PluginApplicationService } from "../../src/plugin/application-service.js";
import { LocalSourceProvider } from "../../src/plugin/sources/local-provider.js";
import { SourceRegistry } from "../../src/plugin/sources/source-registry.js";
import {
  createPluginTestRoot,
  pluginManifest,
  writePluginPackage,
} from "./plugin-test-helpers.js";

const CLI = path.resolve("src/cli.js");

/**
 * 在临时项目执行真实 Plugin CLI。
 *
 * @param {string} project 项目根
 * @param {string[]} args Plugin 参数
 * @returns {ReturnType<typeof spawnSync>} 子进程结果
 */
function runPlugin(project, args) {
  return spawnSync(process.execPath, [CLI, "plugin", ...args, "--target", project], {
    cwd: project,
    encoding: "utf8",
  });
}

test("Plugin parser 独立处理多级命令、重复平台与 dry-run", () => {
  assert.deepEqual(
    parsePluginArgs([
      "add",
      "local/demo",
      "--source",
      "plugins/demo",
      "--version",
      "^1.0.0",
      "--platform",
      "codex,gemini",
      "--platform",
      "zcode",
      "--dry-run",
      "--json",
    ]),
    {
      command: "add",
      pluginId: "local/demo",
      source: "plugins/demo",
      version: "^1.0.0",
      platforms: ["codex", "gemini", "zcode"],
      dryRun: true,
      json: true,
      help: false,
    },
  );
});

test("内嵌 Plugin compact 输出保留汇总并隐藏逐文件路径", async (t) => {
  const project = createPluginTestRoot(t, "flower-cli-compact-");
  writePluginPackage(project, "plugins/demo", pluginManifest(), {
    "skills/demo/SKILL.md": "# Demo\n",
  });
  const logs = [];
  const errors = [];

  const code = await plugin({
    target: project,
    passthrough: [
      "add",
      "local/demo",
      "--source",
      "plugins/demo",
      "--platform",
      "codex",
    ],
  }, {
    compact: true,
    interactive: false,
    cwd: project,
    output: {
      log: (message) => logs.push(message),
      error: (message) => errors.push(message),
    },
  });

  assert.equal(code, 0, errors.join("\n"));
  assert.match(logs.join("\n"), /Plugin add 完成，目标变化 \d+ 项/);
  assert.match(logs.join("\n"), /local\/demo@1\.0\.0/);
  assert.doesNotMatch(logs.join("\n"), /^\s+(?:write|patch|remove) /m);
});

test("无平台 Plugin add 明确失败且不创建 Runtime", (t) => {
  const project = createPluginTestRoot(t, "flower-cli-no-platform-");
  writePluginPackage(project, "plugins/demo", pluginManifest());
  const result = runPlugin(project, [
    "add",
    "local/demo",
    "--source",
    "plugins/demo",
    "--dry-run",
    "--json",
  ]);
  assert.equal(result.status, 2, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, false);
  assert.equal(output.diagnostics[0].code, "PLUGIN_PLATFORM_SELECTION_REQUIRED");
  assert.equal(fs.existsSync(path.join(project, ".flower")), false);
  assert.equal(fs.existsSync(path.join(project, ".claude")), false);
});

test("空项目 Plugin update 返回零变化且不创建 Runtime", (t) => {
  const project = createPluginTestRoot(t, "flower-cli-empty-update-");
  const result = runPlugin(project, ["update", "--json"]);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const output = JSON.parse(result.stdout);
  assert.equal(output.transaction.status, "unchanged");
  assert.deepEqual(output.changes, []);
  assert.equal(fs.existsSync(path.join(project, ".flower")), false);
});

test("真实 CLI 完成 add/update/verify/remove，dry-run 始终零写入", (t) => {
  const project = createPluginTestRoot(t, "flower-cli-lifecycle-");
  const packageRoot = writePluginPackage(project, "plugins/demo", pluginManifest(), {
    "skills/demo/SKILL.md": "# Demo\n",
    "skills/demo/references/nested.md": "nested\n",
  });
  const target = path.join(project, ".agents/skills/demo/SKILL.md");

  const dryAdd = runPlugin(project, [
    "add",
    "local/demo",
    "--source",
    "plugins/demo",
    "--platform",
    "codex",
    "--dry-run",
    "--json",
  ]);
  assert.equal(dryAdd.status, 0, dryAdd.stderr);
  assert.equal(JSON.parse(dryAdd.stdout).transaction.status, "dry-run");
  assert.equal(fs.existsSync(path.join(project, ".flower")), false);

  const add = runPlugin(project, [
    "add",
    "local/demo",
    "--source",
    "plugins/demo",
    "--platform",
    "codex",
    "--json",
  ]);
  assert.equal(add.status, 0, `${add.stdout}\n${add.stderr}`);
  assert.equal(fs.readFileSync(target, "utf8"), "# Demo\n");
  assert.equal(fs.existsSync(path.join(project, ".flower/plugin-lock.json")), true);
  assert.equal(fs.existsSync(path.join(project, ".trellis")), false);
  const installedState = JSON.parse(fs.readFileSync(path.join(project, ".flower/state.json"), "utf8"));
  assert.equal(installedState.plugins.some(({ id }) => id === "flower/skill-garden"), false);
  assert.deepEqual(
    installedState.plugins[0].paths.filter(({ kind }) => kind === "directory").map(({ path: targetPath }) => targetPath),
    [".agents/skills/demo", ".agents/skills/demo/references"],
  );

  const verify = runPlugin(project, ["verify", "demo", "--json"]);
  assert.equal(verify.status, 0, `${verify.stdout}\n${verify.stderr}`);
  assert.deepEqual(JSON.parse(verify.stdout).changes, []);
  assert.equal(JSON.parse(verify.stdout).ok, true);

  const list = runPlugin(project, ["list", "--json"]);
  assert.equal(list.status, 0, `${list.stdout}\n${list.stderr}`);
  assert.deepEqual(JSON.parse(list.stdout).changes, []);

  fs.writeFileSync(path.join(packageRoot, "plugin.json"), `${JSON.stringify(pluginManifest({
    version: "1.1.0",
  }), null, 2)}\n`);
  fs.writeFileSync(path.join(packageRoot, "skills/demo/SKILL.md"), "# Demo 1.1\n");
  const beforeUpdate = fs.readFileSync(target, "utf8");
  const dryUpdate = runPlugin(project, ["update", "demo", "--dry-run", "--json"]);
  assert.equal(dryUpdate.status, 0, `${dryUpdate.stdout}\n${dryUpdate.stderr}`);
  assert.equal(fs.readFileSync(target, "utf8"), beforeUpdate);
  assert.equal(JSON.parse(dryUpdate.stdout).orphans.length, 0);

  const update = runPlugin(project, ["update", "demo", "--json"]);
  assert.equal(update.status, 0, `${update.stdout}\n${update.stderr}`);
  assert.equal(fs.readFileSync(target, "utf8"), "# Demo 1.1\n");

  const beforeRemove = fs.readFileSync(target, "utf8");
  const dryRemove = runPlugin(project, ["remove", "demo", "--dry-run", "--json"]);
  assert.equal(dryRemove.status, 0, `${dryRemove.stdout}\n${dryRemove.stderr}`);
  assert.deepEqual(JSON.parse(dryRemove.stdout).orphans, ["local/demo"]);
  assert.equal(fs.readFileSync(target, "utf8"), beforeRemove);

  const remove = runPlugin(project, ["remove", "demo", "--json"]);
  assert.equal(remove.status, 0, `${remove.stdout}\n${remove.stderr}`);
  assert.equal(fs.existsSync(target), false);
  assert.equal(fs.existsSync(path.join(project, ".agents/skills/demo")), false);
  assert.equal(fs.existsSync(path.join(project, ".agents/skills")), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(project, ".flower/plugins.json"), "utf8")).plugins, []);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(project, ".flower/plugin-lock.json"), "utf8")).plugins, []);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(project, ".flower/state.json"), "utf8")).plugins, []);
});

test("受管目录新增用户文件后 verify 和 remove 都拒绝继续", (t) => {
  const project = createPluginTestRoot(t, "flower-cli-directory-drift-");
  writePluginPackage(project, "plugins/demo", pluginManifest());
  const add = runPlugin(project, [
    "add",
    "local/demo",
    "--source",
    "plugins/demo",
    "--platform",
    "codex",
    "--json",
  ]);
  assert.equal(add.status, 0, `${add.stdout}\n${add.stderr}`);
  const extra = path.join(project, ".agents/skills/demo/user.md");
  fs.writeFileSync(extra, "user\n");

  const verify = runPlugin(project, ["verify", "demo", "--json"]);
  assert.equal(verify.status, 3, `${verify.stdout}\n${verify.stderr}`);
  assert.ok(JSON.parse(verify.stdout).diagnostics.some(({ code }) => code === "verify.target-drift"));
  const remove = runPlugin(project, ["remove", "demo", "--json"]);
  assert.equal(remove.status, 3, `${remove.stdout}\n${remove.stderr}`);
  assert.equal(JSON.parse(remove.stdout).diagnostics[0].code, "PLUGIN_CONTENT_CONFLICT");
  assert.equal(fs.readFileSync(extra, "utf8"), "user\n");
});

test("verify 报告声明、lock、state 与跨 Plugin ownership 的反向不一致", (t) => {
  const project = createPluginTestRoot(t, "flower-cli-verify-reverse-");
  writePluginPackage(project, "plugins/demo", pluginManifest());
  const add = runPlugin(project, [
    "add",
    "local/demo",
    "--source",
    "plugins/demo",
    "--platform",
    "codex",
    "--json",
  ]);
  assert.equal(add.status, 0, `${add.stdout}\n${add.stderr}`);

  const lockPath = path.join(project, ".flower/plugin-lock.json");
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  lock.plugins.push({
    ...structuredClone(lock.plugins[0]),
    id: "local/orphan",
    source: { ...lock.plugins[0].source, reference: "plugins/orphan" },
  });
  lock.roots = ["local/orphan"];
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

  const statePath = path.join(project, ".flower/state.json");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  state.plugins.push({
    ...structuredClone(state.plugins[0]),
    id: "local/state-only",
  });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

  const verify = runPlugin(project, ["verify", "--json"]);
  assert.equal(verify.status, 3, `${verify.stdout}\n${verify.stderr}`);
  const codes = new Set(JSON.parse(verify.stdout).diagnostics.map(({ code }) => code));
  for (const code of [
    "verify.root-missing",
    "verify.root-extra",
    "verify.lock-orphan",
    "verify.state-extra",
    "verify.ownership-conflict",
  ]) {
    assert.equal(codes.has(code), true, `缺少诊断:${code}`);
  }
});

test("plugin --help 与人类可读 dry-run 输出包含可执行细节", (t) => {
  const project = createPluginTestRoot(t, "flower-cli-human-output-");
  writePluginPackage(project, "plugins/demo", pluginManifest());
  const help = runPlugin(project, ["--help"]);
  assert.equal(help.status, 0, `${help.stdout}\n${help.stderr}`);
  assert.match(help.stdout, /plugin add/);

  const preview = runPlugin(project, [
    "add",
    "local/demo",
    "--source",
    "plugins/demo",
    "--platform",
    "codex",
    "--dry-run",
  ]);
  assert.equal(preview.status, 0, `${preview.stdout}\n${preview.stderr}`);
  assert.match(preview.stdout, /Plugin add 预览/);
  assert.match(preview.stdout, /local\/demo@1\.0\.0/);
  assert.match(preview.stdout, /write \.agents\/skills\/demo\/SKILL\.md/);
  assert.equal(fs.existsSync(path.join(project, ".flower")), false);
});

test("Plugin parser 拒绝非法版本与命令不支持的 flag", () => {
  assert.throws(
    () => parsePluginArgs(["add", "local/demo", "--version", "not-a-range"]),
    (error) => error.code === "PLUGIN_USAGE_ERROR",
  );
  assert.throws(
    () => parsePluginArgs(["list", "--dry-run"]),
    (error) => error.code === "PLUGIN_USAGE_ERROR",
  );
  assert.throws(
    () => parsePluginArgs(["verify", "--platform", "codex"]),
    (error) => error.code === "PLUGIN_USAGE_ERROR",
  );
});

test("Application Service 在 Resolver 前校验新声明 DTO", (t) => {
  const project = createPluginTestRoot(t, "flower-service-validation-");
  writePluginPackage(project, "plugins/demo", pluginManifest());
  const registry = new SourceRegistry([
    new LocalSourceProvider({ id: "local", projectRoot: project, references: ["plugins/demo"] }),
  ]);
  const service = new PluginApplicationService(project, { registry });
  assert.throws(
    () => service.add({ id: "local/demo", version: "not-a-range", platforms: ["codex"] }),
    (error) => error.code === "PLUGIN_SCHEMA_INVALID",
  );
  assert.equal(fs.existsSync(path.join(project, ".flower")), false);
});

test("非 Skill 内容卸载后清理 Plugin 专属目录并保留共享 content root", (t) => {
  const project = createPluginTestRoot(t, "flower-cli-passive-content-");
  writePluginPackage(project, "plugins/demo", pluginManifest({
    content: { specs: ["specs/demo"] },
  }), { "specs/demo/guide.md": "guide\n" });
  const add = runPlugin(project, [
    "add",
    "local/demo",
    "--source",
    "plugins/demo",
    "--platform",
    "codex",
    "--json",
  ]);
  assert.equal(add.status, 0, `${add.stdout}\n${add.stderr}`);
  const state = JSON.parse(fs.readFileSync(path.join(project, ".flower/state.json"), "utf8"));
  assert.deepEqual(
    state.plugins[0].paths.filter(({ kind }) => kind === "directory").map(({ path: targetPath }) => targetPath),
    [
      ".flower/content/local/demo",
      ".flower/content/local/demo/specs",
      ".flower/content/local/demo/specs/demo",
    ],
  );

  const remove = runPlugin(project, ["remove", "demo", "--json"]);
  assert.equal(remove.status, 0, `${remove.stdout}\n${remove.stderr}`);
  assert.equal(fs.existsSync(path.join(project, ".flower/content/local/demo")), false);
  assert.equal(fs.existsSync(path.join(project, ".flower/content")), true);
});

test("remove 保留共享依赖，并拒绝删除用户修改过的受管文件", (t) => {
  const project = createPluginTestRoot(t, "flower-cli-shared-");
  writePluginPackage(project, "plugins/shared", pluginManifest({
    id: "shared",
    content: { skills: ["skills/shared"] },
  }), { "skills/shared/SKILL.md": "# Shared\n" });
  writePluginPackage(project, "plugins/a", pluginManifest({
    id: "a",
    dependencies: { "local/shared": "*" },
    content: { skills: ["skills/a"] },
  }), { "skills/a/SKILL.md": "# A\n" });
  writePluginPackage(project, "plugins/b", pluginManifest({
    id: "b",
    dependencies: { "local/shared": "*" },
    content: { skills: ["skills/b"] },
  }), { "skills/b/SKILL.md": "# B\n" });

  for (const pluginId of ["a", "b"]) {
    const add = runPlugin(project, [
      "add",
      `local/${pluginId}`,
      "--source",
      "plugins",
      "--platform",
      "codex",
      "--json",
    ]);
    assert.equal(add.status, 0, `${add.stdout}\n${add.stderr}`);
  }

  const removeA = runPlugin(project, ["remove", "a", "--json"]);
  assert.equal(removeA.status, 0, `${removeA.stdout}\n${removeA.stderr}`);
  assert.equal(fs.existsSync(path.join(project, ".agents/skills/a/SKILL.md")), false);
  assert.equal(fs.existsSync(path.join(project, ".agents/skills/b/SKILL.md")), true);
  assert.equal(fs.existsSync(path.join(project, ".agents/skills/shared/SKILL.md")), true);

  const sharedTarget = path.join(project, ".agents/skills/shared/SKILL.md");
  fs.appendFileSync(sharedTarget, "user change\n");
  const beforePlugins = fs.readFileSync(path.join(project, ".flower/plugins.json"), "utf8");
  const removeB = runPlugin(project, ["remove", "b", "--json"]);
  assert.equal(removeB.status, 3, `${removeB.stdout}\n${removeB.stderr}`);
  assert.equal(JSON.parse(removeB.stdout).diagnostics[0].code, "PLUGIN_CONTENT_CONFLICT");
  assert.match(fs.readFileSync(sharedTarget, "utf8"), /user change/);
  assert.equal(fs.readFileSync(path.join(project, ".flower/plugins.json"), "utf8"), beforePlugins);
});
