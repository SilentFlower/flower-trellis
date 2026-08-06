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
      widen: {},
      platforms: ["codex", "gemini", "zcode"],
      dryRun: true,
      json: true,
      help: false,
    },
  );
  // --widen 可重复；range 自身含 `=` 时按第一个 `=` 切分不受影响。
  assert.deepEqual(
    parsePluginArgs([
      "update",
      "--widen", "local/alpha=^0.4.0",
      "--widen", "local/beta=>=0.2.2 <0.3.0",
    ]).widen,
    { "local/alpha": "^0.4.0", "local/beta": ">=0.2.2 <0.3.0" },
  );
});

test("Plugin parser 校验 --widen 的取值与命令边界", () => {
  const usage = (error) => error.code === "PLUGIN_USAGE_ERROR";
  assert.throws(() => parsePluginArgs(["update", "--widen", "no-equals"]), usage);
  assert.throws(() => parsePluginArgs(["update", "--widen", "local/a=not-a-range"]), usage);
  assert.throws(() => parsePluginArgs(["update", "--widen", "local/a=^1.0.0", "--widen", "local/a=^2.0.0"]), usage);
  assert.throws(() => parsePluginArgs(["remove", "local/a", "--widen", "local/a=^1.0.0"]), usage);
  assert.throws(() => parsePluginArgs(["update", "local/a", "--widen", "local/a=^1.0.0"]), usage);
  assert.throws(
    () => parsePluginArgs(["update", "--version", "^1.0.0", "--widen", "local/a=^1.0.0"]),
    usage,
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
  // --source 仍只属于 add；--version 放开到 update 以便放宽存量精确锁。
  assert.throws(
    () => parsePluginArgs(["update", "local/demo", "--source", "plugins/demo"]),
    (error) => error.code === "PLUGIN_USAGE_ERROR",
  );
  assert.throws(
    () => parsePluginArgs(["remove", "local/demo", "--version", "^1.0.0"]),
    (error) => error.code === "PLUGIN_USAGE_ERROR",
  );
  assert.equal(parsePluginArgs(["update", "local/demo", "--version", "^1.1.0"]).version, "^1.1.0");
});

test("精确锁在 Marketplace 只保留新版时靠 update --version 放宽后继续更新", (t) => {
  const project = createPluginTestRoot(t, "flower-cli-widen-");
  const publish = (version) => writePluginPackage(project, "plugins/demo", pluginManifest({ version }), {
    "skills/demo/SKILL.md": `# Demo ${version}\n`,
  });
  const declaration = () => JSON.parse(
    fs.readFileSync(path.join(project, ".flower", "plugins.json"), "utf8"),
  ).plugins[0].version;
  const lockedVersion = () => JSON.parse(
    fs.readFileSync(path.join(project, ".flower", "plugin-lock.json"), "utf8"),
  ).plugins[0].version;

  publish("1.0.0");
  assert.equal(runPlugin(project, [
    "add", "local/demo", "--source", "plugins/demo", "--version", "1.0.0", "--platform", "claude",
  ]).status, 0);
  assert.equal(declaration(), "1.0.0");

  // Marketplace 发新版并移除旧版：精确锁筛不到任何候选，直接 update 必然冲突。
  publish("1.1.0");
  const blocked = runPlugin(project, ["update", "local/demo", "--dry-run"]);
  assert.equal(blocked.status, 3);
  assert.match(blocked.stderr, /版本约束无法同时满足/);
  assert.equal(lockedVersion(), "1.0.0");

  assert.equal(runPlugin(project, ["update", "local/demo", "--version", "^1.1.0"]).status, 0);
  assert.equal(declaration(), "^1.1.0");
  assert.equal(lockedVersion(), "1.1.0");

  // 放宽后，落在范围内的后续版本无需再传 --version。
  publish("1.1.3");
  assert.equal(runPlugin(project, ["update", "local/demo"]).status, 0);
  assert.equal(declaration(), "^1.1.0");
  assert.equal(lockedVersion(), "1.1.3");
});

test("多个精确锁同时落后时，批量 --widen 解开解析器互锁", (t) => {
  const project = createPluginTestRoot(t, "flower-cli-widen-multi-");
  const publish = (id, version) => writePluginPackage(
    project,
    `plugins/${id}`,
    pluginManifest({ id, version, content: { skills: [`skills/${id}`] } }),
    { [`skills/${id}/SKILL.md`]: `# ${id} ${version}\n` },
  );
  const declarations = () => Object.fromEntries(JSON.parse(
    fs.readFileSync(path.join(project, ".flower", "plugins.json"), "utf8"),
  ).plugins.map(({ id, version }) => [id, version]));
  const locked = () => Object.fromEntries(JSON.parse(
    fs.readFileSync(path.join(project, ".flower", "plugin-lock.json"), "utf8"),
  ).plugins.map(({ id, version }) => [id, version]));

  for (const [id, version] of Object.entries({ alpha: "0.3.0", beta: "0.2.1", gamma: "0.4.2" })) {
    publish(id, version);
    assert.equal(runPlugin(project, [
      "add", `local/${id}`, "--source", `plugins/${id}`, "--version", version, "--platform", "claude",
    ]).status, 0);
  }
  // alpha 与 beta 都发新版并移除旧版；gamma 仍是 Marketplace 当前版。
  publish("alpha", "0.4.0");
  publish("beta", "0.2.2");

  // 逐个放宽会被对方的不可重放锁定包挡住，两个方向都失败。
  const single = runPlugin(project, ["update", "local/alpha", "--version", "^0.4.0", "--dry-run"]);
  assert.equal(single.status, 3);
  assert.match(single.stderr, /已锁定 Plugin 包不可重放:local\/beta@0\.2\.1/);

  const args = ["update", "--widen", "local/alpha=^0.4.0", "--widen", "local/beta=^0.2.2"];
  const preview = runPlugin(project, [...args, "--dry-run"]);
  assert.equal(preview.status, 0, preview.stderr);
  assert.deepEqual(declarations(), {
    "local/alpha": "0.3.0",
    "local/beta": "0.2.1",
    "local/gamma": "0.4.2",
  }, "dry-run 必须零写入");

  assert.equal(runPlugin(project, args).status, 0);
  assert.deepEqual(declarations(), {
    "local/alpha": "^0.4.0",
    "local/beta": "^0.2.2",
    "local/gamma": "0.4.2",
  }, "只放宽被阻塞的声明，未越界的 gamma 保持原样");
  assert.deepEqual(locked(), {
    "local/alpha": "0.4.0",
    "local/beta": "0.2.2",
    "local/gamma": "0.4.2",
  });

  // 放宽后，落在范围内的后续版本靠普通 update 自动跟进。
  publish("alpha", "0.4.3");
  assert.equal(runPlugin(project, ["update"]).status, 0);
  assert.equal(locked()["local/alpha"], "0.4.3");
});

test("空项目下缺少 Plugin ID 的 update --version 返回用法错误", (t) => {
  const project = createPluginTestRoot(t, "flower-cli-widen-usage-");
  const result = runPlugin(project, ["update", "--version", "^1.0.0"]);
  assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /必须指定 Plugin ID/);
  assert.equal(fs.existsSync(path.join(project, ".flower")), false);
});

test("--widen 指向未声明 Plugin 时报用法错误", (t) => {
  const project = createPluginTestRoot(t, "flower-cli-widen-unknown-");
  writePluginPackage(project, "plugins/demo", pluginManifest());
  assert.equal(runPlugin(project, [
    "add", "local/demo", "--source", "plugins/demo", "--platform", "claude",
  ]).status, 0);
  const result = runPlugin(project, ["update", "--widen", "local/missing=^1.0.0"]);
  assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /项目未声明 Plugin:local\/missing/);
});

test("生命周期输出默认只列真实改动，--json 仍返回全量 changes", (t) => {
  const project = createPluginTestRoot(t, "flower-cli-noise-");
  for (const id of ["alpha", "beta"]) {
    writePluginPackage(project, `plugins/${id}`, pluginManifest({
      id,
      content: { skills: [`skills/${id}`] },
    }), {
      [`skills/${id}/SKILL.md`]: `# ${id}\n`,
      [`skills/${id}/extra.md`]: `# ${id} extra\n`,
    });
    assert.equal(runPlugin(project, [
      "add", `local/${id}`, "--source", `plugins/${id}`, "--platform", "claude",
    ]).status, 0);
  }

  // 卸载 beta 会连带重新投影 alpha；alpha 的幂等重写不该出现在默认的改动清单里。
  const human = runPlugin(project, ["remove", "local/beta", "--dry-run"]);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /remove .claude\/skills\/beta\/SKILL\.md/);
  assert.match(human.stdout, /· 另有 \d+ 项目标无变化/);
  // 解析图摘要行仍应保留 alpha，被隐藏的只是它的逐文件幂等写入。
  assert.match(human.stdout, /^local\/alpha@1\.0\.0 /m);
  assert.doesNotMatch(human.stdout, /^\s+(?:write|ensure-directory) .*alpha/m);

  const verbose = spawnSync(
    process.execPath,
    [CLI, "plugin", "remove", "local/beta", "--dry-run", "--target", project],
    { cwd: project, encoding: "utf8", env: { ...process.env, FLOWER_DEBUG: "1" } },
  );
  assert.equal(verbose.status, 0, verbose.stderr);
  assert.match(verbose.stdout, /write .claude\/skills\/alpha\/SKILL\.md/);

  const json = JSON.parse(runPlugin(project, ["remove", "local/beta", "--dry-run", "--json"]).stdout);
  const alphaChanges = json.changes.filter(({ target }) => target.includes("alpha"));
  assert.ok(alphaChanges.length > 0, "--json 必须保留全量 changes");
  assert.ok(json.transaction.changed.every((target) => !target.includes("alpha")));
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
