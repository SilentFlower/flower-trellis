import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectPlatformTemplates } from "@mindfoldhq/trellis/dist/configurators/index.js";
import { computeHash } from "@mindfoldhq/trellis/dist/utils/template-hash.js";
import { plugin } from "../../src/commands/plugin.js";
import { parseTrellisControlArgs } from "../../src/commands/trellis.js";
import {
  disableTrellis,
  enableTrellisExact,
  finalizeTrellisEnable,
  inspectTrellisControl,
  materializeTrellis,
  runWithTrellisIntegrationEnabled,
} from "../../src/lib/trellis-control.js";
import {
  validateTrellisControlState,
  validateTrellisDetachedManifest,
} from "../../src/plugin/schemas/trellis-control.js";
import { ProjectStore } from "../../src/plugin/state/project-store.js";
import {
  pluginManifest,
  writePluginPackage,
} from "./plugin-test-helpers.js";

const CLI = path.resolve("src/cli.js");
const AGENTS_BLOCK = `<!-- TRELLIS:START -->
# Trellis Instructions

Managed by Trellis.
<!-- TRELLIS:END -->`;

function createProject(t) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "flower-trellis-control-"));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  fs.mkdirSync(path.join(project, ".trellis/tasks"), { recursive: true });
  fs.writeFileSync(path.join(project, ".trellis/.version"), "0.6.12\n");
  fs.writeFileSync(path.join(project, ".trellis/tasks/keep.md"), "keep\n");

  const templates = collectPlatformTemplates("codex");
  const config = templates.get(".codex/config.toml");
  const hooksTemplate = templates.get(".codex/hooks.json");
  const agent = templates.get(".codex/agents/trellis-implement.toml");
  const hooks = JSON.parse(hooksTemplate);
  hooks.user = { keep: true };
  const agents = `# Project Rules\n\n${AGENTS_BLOCK}\n\n# Local Rules\n`;

  fs.mkdirSync(path.join(project, ".codex/agents"), { recursive: true });
  fs.writeFileSync(path.join(project, ".codex/config.toml"), config);
  fs.writeFileSync(path.join(project, ".codex/hooks.json"), `${JSON.stringify(hooks, null, 2)}\n`);
  fs.writeFileSync(path.join(project, ".codex/agents/trellis-implement.toml"), agent);
  fs.writeFileSync(path.join(project, "AGENTS.md"), agents);
  fs.writeFileSync(
    path.join(project, ".trellis/.template-hashes.json"),
    `${JSON.stringify({
      __version: 2,
      hashes: {
        ".codex/config.toml": computeHash(config),
        ".codex/hooks.json": computeHash(hooksTemplate),
        ".codex/agents/trellis-implement.toml": computeHash(agent),
        "AGENTS.md": computeHash(agents),
      },
    }, null, 2)}\n`,
  );
  return { project, config, hooks, agent, agents };
}

function createMultiPlatformProject(t) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "flower-trellis-control-multi-"));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  fs.mkdirSync(path.join(project, ".trellis/tasks"), { recursive: true });
  fs.writeFileSync(path.join(project, ".trellis/.version"), "0.6.12\n");
  fs.writeFileSync(path.join(project, ".trellis/tasks/keep.md"), "keep\n");
  const templates = new Map();
  for (const platform of ["claude-code", "codex"]) {
    for (const [relativePath, content] of collectPlatformTemplates(platform)) {
      templates.set(relativePath, content);
    }
  }
  const hashes = {};
  for (const [relativePath, content] of templates) {
    const target = path.join(project, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    hashes[relativePath] = computeHash(content);
  }
  const claudeSettingsPath = path.join(project, ".claude/settings.json");
  const claudeSettings = JSON.parse(fs.readFileSync(claudeSettingsPath, "utf8"));
  claudeSettings.userSetting = { name: "trellis-dashboard", keep: true };
  const expectedClaudeSettings = `${JSON.stringify(claudeSettings, null, 2)}\n`;
  fs.writeFileSync(claudeSettingsPath, expectedClaudeSettings);
  templates.set(".claude/settings.json", expectedClaudeSettings);
  const agents = `# Project Rules\n\n${AGENTS_BLOCK}\n\n# Local Rules\n`;
  fs.writeFileSync(path.join(project, "AGENTS.md"), agents);
  hashes["AGENTS.md"] = computeHash(agents);
  fs.writeFileSync(
    path.join(project, ".trellis/.template-hashes.json"),
    `${JSON.stringify({ __version: 2, hashes }, null, 2)}\n`,
  );
  const store = new ProjectStore(project);
  store.writePlugins({ schemaVersion: 1, plugins: [] });
  store.writeLock({ schemaVersion: 1, roots: [], plugins: [] });
  store.writeState({ schemaVersion: 1, transactionVersion: 1, plugins: [] });
  return { project, templates, agents };
}

test("Trellis 控制参数拒绝平台级开关并解析 dry-run", () => {
  assert.deepEqual(parseTrellisControlArgs(["disable", "--dry-run", "--json"]), {
    command: "disable",
    dryRun: true,
    force: false,
    json: true,
    help: false,
  });
  assert.throws(
    () => parseTrellisControlArgs(["disable", "--platform", "codex"]),
    (error) => error.code === "TRELLIS_CONTROL_USAGE_ERROR",
  );
  assert.throws(
    () => parseTrellisControlArgs(["status", "--force"]),
    (error) => error.code === "TRELLIS_CONTROL_USAGE_ERROR",
  );
});

test("控制 schema 拒绝事务身份漂移和恢复材料路径逃逸", (t) => {
  const { project } = createProject(t);
  const disabled = disableTrellis(project);
  const control = JSON.parse(fs.readFileSync(
    path.join(project, ".flower/trellis-control.json"),
    "utf8",
  ));
  const manifest = JSON.parse(fs.readFileSync(
    path.join(project, ...disabled.manifestPath.split("/")),
    "utf8",
  ));

  assert.throws(() => validateTrellisControlState({
    ...control,
    manifestPath: `.flower/trellis-detached/${"b".repeat(24)}/manifest.json`,
  }));
  const escaped = structuredClone(manifest);
  escaped.entries[0].backupPath = "../outside.bin";
  assert.throws(() => validateTrellisDetachedManifest(escaped));
});

test("disable 真正移除入口并保留 Trellis 数据与共享 JSON 用户配置", (t) => {
  const { project } = createProject(t);
  const result = disableTrellis(project);

  assert.equal(result.status, "disabled");
  assert.deepEqual(result.configuredPlatforms, ["codex"]);
  assert.equal(fs.existsSync(path.join(project, ".codex/config.toml")), false);
  assert.equal(fs.existsSync(path.join(project, ".codex/agents/trellis-implement.toml")), false);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(project, ".codex/hooks.json"), "utf8")),
    { user: { keep: true } },
  );
  const agents = fs.readFileSync(path.join(project, "AGENTS.md"), "utf8");
  assert.doesNotMatch(agents, /TRELLIS:START/);
  assert.match(agents, /# Project Rules/);
  assert.match(agents, /# Local Rules/);
  assert.equal(fs.readFileSync(path.join(project, ".trellis/tasks/keep.md"), "utf8"), "keep\n");
  assert.equal(fs.existsSync(path.join(project, ".flower/plugins.json")), false);
  assert.equal(fs.existsSync(path.join(project, ".flower/plugin-lock.json")), false);
  assert.equal(fs.existsSync(path.join(project, ".flower/state.json")), false);
  assert.equal(inspectTrellisControl(project).status, "disabled");
  assert.equal(disableTrellis(project).status, "unchanged");
});

test("enable 三方恢复共享 JSON 和 AGENTS，同时保留关闭期间用户修改", (t) => {
  const { project, config } = createProject(t);
  disableTrellis(project);

  const hooksPath = path.join(project, ".codex/hooks.json");
  const disabledHooks = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
  disabledHooks.user.afterDisable = true;
  fs.writeFileSync(hooksPath, `${JSON.stringify(disabledHooks, null, 2)}\n`);
  fs.appendFileSync(path.join(project, "AGENTS.md"), "\n# Added While Disabled\n");

  const materialized = materializeTrellis(project);
  assert.equal(materialized.status, "materialized");
  assert.equal(fs.readFileSync(path.join(project, ".codex/config.toml"), "utf8"), config);
  const restoredHooks = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
  assert.equal(restoredHooks.user.keep, true);
  assert.equal(restoredHooks.user.afterDisable, true);
  assert.ok(restoredHooks.hooks.UserPromptSubmit.length > 0);
  const agents = fs.readFileSync(path.join(project, "AGENTS.md"), "utf8");
  assert.match(agents, /TRELLIS:START/);
  assert.match(agents, /# Added While Disabled/);

  assert.equal(finalizeTrellisEnable(project).status, "enabled");
  assert.equal(inspectTrellisControl(project).status, "enabled");
});

test("修改过的独占入口在 preflight 阶段阻断且零写入", (t) => {
  const { project, config } = createProject(t);
  const agentPath = path.join(project, ".codex/agents/trellis-implement.toml");
  fs.appendFileSync(agentPath, "\n# user change\n");
  const beforeAgent = fs.readFileSync(agentPath);
  const beforeConfig = fs.readFileSync(path.join(project, ".codex/config.toml"));

  assert.throws(
    () => disableTrellis(project),
    (error) => error.code === "TRELLIS_CONTROL_CONFLICT",
  );
  assert.deepEqual(fs.readFileSync(agentPath), beforeAgent);
  assert.deepEqual(fs.readFileSync(path.join(project, ".codex/config.toml")), beforeConfig);
  assert.equal(fs.readFileSync(path.join(project, ".codex/config.toml"), "utf8"), config);
  assert.equal(fs.existsSync(path.join(project, ".flower/trellis-control.json")), false);
});

test("disable 中途失败会逆序恢复全部已完成入口", (t) => {
  const { project, config, agent } = createProject(t);
  let operations = 0;
  assert.throws(
    () => disableTrellis(project, {
      onOperation: ({ phase }) => {
        if (phase === "before-disable" && ++operations === 2) throw new Error("fault");
      },
    }),
    /已恢复原状态/,
  );
  assert.equal(fs.readFileSync(path.join(project, ".codex/config.toml"), "utf8"), config);
  assert.equal(fs.readFileSync(path.join(project, ".codex/agents/trellis-implement.toml"), "utf8"), agent);
  assert.match(fs.readFileSync(path.join(project, "AGENTS.md"), "utf8"), /TRELLIS:START/);
  assert.equal(fs.existsSync(path.join(project, ".flower/trellis-control.json")), false);
});

test("enable 中途失败会逆序恢复完整 disabled 状态", (t) => {
  const { project } = createProject(t);
  disableTrellis(project);
  let operations = 0;

  assert.throws(
    () => materializeTrellis(project, {
      onOperation: ({ phase }) => {
        if (phase === "before-enable" && ++operations === 2) throw new Error("fault");
      },
    }),
    /已恢复 disabled 状态/,
  );
  assert.equal(inspectTrellisControl(project).status, "disabled");
  assert.equal(fs.existsSync(path.join(project, ".codex/config.toml")), false);
  assert.equal(fs.existsSync(path.join(project, ".codex/agents/trellis-implement.toml")), false);
  assert.doesNotMatch(fs.readFileSync(path.join(project, "AGENTS.md"), "utf8"), /TRELLIS:START/);
});

test("上游重建入口后 status 报告 drifted，损坏 manifest 报告 repair-required", (t) => {
  const { project, config } = createProject(t);
  const disabled = disableTrellis(project);
  fs.writeFileSync(path.join(project, ".codex/config.toml"), config);
  const drifted = inspectTrellisControl(project);
  assert.equal(drifted.status, "drifted");
  assert.ok(drifted.driftedPaths.includes(".codex/config.toml"));
  assert.throws(
    () => disableTrellis(project),
    (error) => error.code === "TRELLIS_CONTROL_CONFLICT",
  );

  fs.writeFileSync(path.join(project, ...disabled.manifestPath.split("/")), "{broken\n");
  assert.equal(inspectTrellisControl(project).status, "repair-required");
});

test("disabled Flower 写链临时恢复后自动重新关闭", async (t) => {
  const { project } = createProject(t);
  disableTrellis(project);
  let callbackStatus = null;
  const result = await runWithTrellisIntegrationEnabled(project, () => {
    callbackStatus = inspectTrellisControl(project).status;
    assert.equal(fs.existsSync(path.join(project, ".codex/config.toml")), true);
    return "ok";
  });
  assert.equal(result, "ok");
  assert.equal(callbackStatus, "drifted");
  assert.equal(inspectTrellisControl(project).status, "disabled");
  assert.equal(fs.existsSync(path.join(project, ".codex/config.toml")), false);
});

test("disabled 项目执行真实 Plugin add 后保留外部内容并自动重新关闭", (t) => {
  const { project } = createProject(t);
  writePluginPackage(project, "plugins/demo", pluginManifest(), {
    "skills/demo/SKILL.md": "# Demo\n",
  });
  disableTrellis(project);

  const result = spawnSync(process.execPath, [
    CLI,
    "plugin",
    "add",
    "local/demo",
    "--source",
    "plugins/demo",
    "--platform",
    "codex",
    "--json",
    "--target",
    project,
  ], { cwd: project, encoding: "utf8" });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(inspectTrellisControl(project).status, "disabled");
  assert.equal(fs.existsSync(path.join(project, ".codex/config.toml")), false);
  assert.equal(fs.readFileSync(path.join(project, ".agents/skills/demo/SKILL.md"), "utf8"), "# Demo\n");
  const state = JSON.parse(fs.readFileSync(path.join(project, ".flower/state.json"), "utf8"));
  assert.equal(state.plugins.some(({ id }) => id === "local/demo"), true);
});

test("enable 规范化阶段的 Plugin 写链不会重复进入 disabled 包装", async (t) => {
  const { project } = createProject(t);
  writePluginPackage(project, "plugins/demo", pluginManifest(), {
    "skills/demo/SKILL.md": "# Demo\n",
  });
  disableTrellis(project);
  materializeTrellis(project);

  const code = await plugin({
    target: project,
    trellisControlMode: "restoring",
    passthrough: [
      "add",
      "local/demo",
      "--source",
      "plugins/demo",
      "--platform",
      "codex",
      "--json",
    ],
  }, {
    interactive: false,
    cwd: project,
    output: { log: () => {}, error: () => {} },
  });

  assert.equal(code, 0);
  assert.equal(fs.readFileSync(path.join(project, ".agents/skills/demo/SKILL.md"), "utf8"), "# Demo\n");
  assert.equal(inspectTrellisControl(project).status, "drifted");
});

test("force disable 会保留用户改动并由 exact enable 原样恢复", (t) => {
  const { project } = createProject(t);
  const agentPath = path.join(project, ".codex/agents/trellis-implement.toml");
  fs.appendFileSync(agentPath, "\n# user change\n");
  const expected = fs.readFileSync(agentPath);

  const disabled = disableTrellis(project, { force: true });
  assert.equal(disabled.status, "disabled");
  assert.equal(fs.existsSync(agentPath), false);

  const enabled = enableTrellisExact(project);
  assert.equal(enabled.status, "enabled");
  assert.equal(enabled.manifestPath, null);
  assert.deepEqual(fs.readFileSync(agentPath), expected);
});

test("force enable 覆盖冲突前保存当前现场", (t) => {
  const { project, config } = createProject(t);
  disableTrellis(project);
  const configPath = path.join(project, ".codex/config.toml");
  fs.writeFileSync(configPath, "user replacement\n");

  assert.throws(
    () => enableTrellisExact(project),
    (error) => error.code === "TRELLIS_CONTROL_CONFLICT",
  );
  assert.equal(fs.readFileSync(configPath, "utf8"), "user replacement\n");

  const enabled = enableTrellisExact(project, { force: true });
  assert.equal(enabled.status, "enabled");
  assert.equal(enabled.manifestPath, null);
  assert.equal(fs.readFileSync(configPath, "utf8"), config);
  const retained = enabled.warnings.find((warning) => warning.startsWith("强制恢复的冲突现场已保留:"));
  assert.ok(retained);
  assert.equal(fs.existsSync(path.join(project, ...retained.split(":")[1].split("/"))), true);
});

test("受管目标为软链时 fail closed 且不创建控制状态", (t) => {
  const { project } = createProject(t);
  const agentPath = path.join(project, ".codex/agents/trellis-implement.toml");
  fs.unlinkSync(agentPath);
  try {
    fs.symlinkSync(path.join(project, ".codex/config.toml"), agentPath);
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
      t.skip(`当前环境不允许创建软链:${error.code}`);
      return;
    }
    throw error;
  }

  assert.throws(() => disableTrellis(project), /普通文件/);
  assert.equal(fs.existsSync(path.join(project, ".flower/trellis-control.json")), false);
  assert.equal(fs.lstatSync(agentPath).isSymbolicLink(), true);
});

test("真实 CLI status 和 disable dry-run 保持零写入", (t) => {
  const { project } = createProject(t);
  const before = fs.statSync(path.join(project, ".codex/config.toml"), { bigint: true }).mtimeNs;
  const preview = spawnSync(process.execPath, [
    CLI,
    "trellis",
    "disable",
    "--dry-run",
    "--json",
    "--target",
    project,
  ], { cwd: project, encoding: "utf8" });
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(JSON.parse(preview.stdout).status, "dry-run");
  assert.equal(fs.statSync(path.join(project, ".codex/config.toml"), { bigint: true }).mtimeNs, before);
  assert.equal(fs.existsSync(path.join(project, ".flower")), false);

  const status = spawnSync(process.execPath, [
    CLI,
    "trellis",
    "status",
    "--json",
    "--target",
    project,
  ], { cwd: project, encoding: "utf8" });
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).status, "enabled");
});

test("顶层 status/disable/enable 与 trellis 子命令写法完全等价", (t) => {
  const { project } = createProject(t);
  const run = (args) => spawnSync(
    process.execPath,
    [CLI, ...args, "--target", project],
    { cwd: project, encoding: "utf8" },
  );

  const status = run(["status", "--json"]);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).status, "enabled");

  const before = fs.statSync(path.join(project, ".codex/config.toml"), { bigint: true }).mtimeNs;
  const preview = run(["disable", "--dry-run", "--json"]);
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(JSON.parse(preview.stdout).status, "dry-run");
  assert.equal(fs.statSync(path.join(project, ".codex/config.toml"), { bigint: true }).mtimeNs, before);
  assert.equal(fs.existsSync(path.join(project, ".flower")), false);

  const disabled = run(["disable", "--json"]);
  assert.equal(disabled.status, 0, disabled.stderr);
  assert.equal(JSON.parse(disabled.stdout).status, "disabled");
  assert.equal(fs.existsSync(path.join(project, ".codex/config.toml")), false);

  // 旧写法必须继续等价：同一项目上读到同一状态。
  const legacy = run(["trellis", "status", "--json"]);
  assert.equal(legacy.status, 0, legacy.stderr);
  assert.deepEqual(JSON.parse(legacy.stdout), JSON.parse(run(["status", "--json"]).stdout));

  const enablePreview = run(["enable", "--dry-run", "--json"]);
  assert.equal(enablePreview.status, 0, enablePreview.stderr);
  assert.equal(JSON.parse(enablePreview.stdout).status, "dry-run");
  assert.equal(inspectTrellisControl(project).status, "disabled");

  // 顶层写法沿用同一套用法校验与退出码。
  const usage = run(["status", "--force", "--json"]);
  assert.equal(usage.status, 2, usage.stderr);
  assert.equal(JSON.parse(usage.stdout).diagnostics[0].code, "TRELLIS_CONTROL_USAGE_ERROR");

  const help = spawnSync(process.execPath, [CLI, "disable", "--help"], { cwd: project, encoding: "utf8" });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /flower-trellis disable \[--dry-run\]/);
});

test("漂移后的 force disable 保留完整旧证据并恢复全部入口", (t) => {
  const { project, config, agent } = createProject(t);
  const first = disableTrellis(project);
  fs.writeFileSync(path.join(project, ".codex/config.toml"), config);
  assert.equal(inspectTrellisControl(project).status, "drifted");

  const second = disableTrellis(project, { force: true });
  const manifest = JSON.parse(fs.readFileSync(
    path.join(project, ...second.manifestPath.split("/")),
    "utf8",
  ));
  assert.ok(manifest.entries.some(({ path: entryPath }) => (
    entryPath === ".codex/agents/trellis-implement.toml"
  )));
  assert.equal(fs.existsSync(path.join(project, ...first.manifestPath.split("/"))), false);

  const enabled = enableTrellisExact(project);
  assert.equal(enabled.status, "enabled");
  assert.equal(fs.readFileSync(path.join(project, ".codex/config.toml"), "utf8"), config);
  assert.equal(
    fs.readFileSync(path.join(project, ".codex/agents/trellis-implement.toml"), "utf8"),
    agent,
  );
  assert.ok(enabled.warnings.some((warning) => warning.startsWith("强制恢复的冲突现场已保留:")));
});

test("已经中和的共享 JSON 不会在 force disable 时被整文件删除", (t) => {
  const { project } = createProject(t);
  const hooksPath = path.join(project, ".codex/hooks.json");
  fs.writeFileSync(hooksPath, `${JSON.stringify({ user: { keep: true } }, null, 2)}\n`);

  const result = disableTrellis(project, { force: true });
  assert.equal(result.status, "disabled");
  assert.deepEqual(JSON.parse(fs.readFileSync(hooksPath, "utf8")), { user: { keep: true } });
  const manifest = JSON.parse(fs.readFileSync(
    path.join(project, ...result.manifestPath.split("/")),
    "utf8",
  ));
  assert.equal(manifest.entries.some(({ path: entryPath }) => entryPath === ".codex/hooks.json"), false);
  assert.equal(inspectTrellisControl(project).status, "disabled");
  assert.equal(disableTrellis(project).status, "unchanged");
});

test("共享 JSON 不按 trellis 名称猜测并删除用户配置", (t) => {
  const { project } = createProject(t);
  const hooksPath = path.join(project, ".codex/hooks.json");
  const hooks = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
  hooks.userTool = { name: "trellis-dashboard", keep: true };
  fs.writeFileSync(hooksPath, `${JSON.stringify(hooks, null, 2)}\n`);

  disableTrellis(project);
  const disabled = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
  assert.deepEqual(disabled.userTool, { name: "trellis-dashboard", keep: true });
});

test("共享 JSON 拆除 Trellis hook 后保留用户扩展组的 matcher", (t) => {
  const { project } = createProject(t);
  const hooksPath = path.join(project, ".codex/hooks.json");
  const hooks = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
  const group = hooks.hooks.SubagentStart[0];
  const matcher = group.matcher;
  const trellisCommand = group.hooks[0].command;
  group.hooks.push({ type: "command", command: "node user-hook.js" });
  fs.writeFileSync(hooksPath, `${JSON.stringify(hooks, null, 2)}\n`);

  disableTrellis(project);
  const disabled = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
  assert.equal(disabled.hooks.SubagentStart.length, 1);
  assert.equal(disabled.hooks.SubagentStart[0].matcher, matcher);
  assert.deepEqual(
    disabled.hooks.SubagentStart[0].hooks.map(({ command }) => command),
    ["node user-hook.js"],
  );
  disabled.hooks.SubagentStart[0].hooks.push({
    type: "command",
    command: "node added-while-disabled.js",
  });
  fs.writeFileSync(hooksPath, `${JSON.stringify(disabled, null, 2)}\n`);

  materializeTrellis(project);
  const restored = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
  assert.equal(restored.hooks.SubagentStart.length, 1);
  assert.equal(restored.hooks.SubagentStart[0].matcher, matcher);
  assert.deepEqual(
    restored.hooks.SubagentStart[0].hooks.map(({ command }) => command),
    [trellisCommand, "node user-hook.js", "node added-while-disabled.js"],
  );
});

test("共享 JSON 按 hook group 身份恢复且 status 识别同组漂移", (t) => {
  const { project } = createProject(t);
  const hooksPath = path.join(project, ".codex/hooks.json");
  const hooks = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
  const trellisHook = structuredClone(hooks.hooks.UserPromptSubmit[0].hooks[0]);
  hooks.hooks.UserPromptSubmit[0].hooks.push({
    type: "command",
    command: "node user-hook.js",
  });
  fs.writeFileSync(hooksPath, `${JSON.stringify(hooks, null, 2)}\n`);

  disableTrellis(project);
  const disabled = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
  disabled.hooks.UserPromptSubmit[0].hooks.push({
    type: "command",
    command: "node added-while-disabled.js",
  });
  fs.writeFileSync(hooksPath, `${JSON.stringify(disabled, null, 2)}\n`);
  materializeTrellis(project);
  const restored = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
  assert.equal(restored.hooks.UserPromptSubmit.length, 1);
  assert.deepEqual(
    restored.hooks.UserPromptSubmit[0].hooks.map(({ command }) => command),
    [
      trellisHook.command,
      "node user-hook.js",
      "node added-while-disabled.js",
    ],
  );

  const driftProject = createProject(t).project;
  const driftHooksPath = path.join(driftProject, ".codex/hooks.json");
  const driftHooks = JSON.parse(fs.readFileSync(driftHooksPath, "utf8"));
  const driftTrellisHook = structuredClone(driftHooks.hooks.UserPromptSubmit[0].hooks[0]);
  driftHooks.hooks.UserPromptSubmit[0].hooks.push({
    type: "command",
    command: "node user-hook.js",
  });
  fs.writeFileSync(driftHooksPath, `${JSON.stringify(driftHooks, null, 2)}\n`);
  disableTrellis(driftProject);
  const current = JSON.parse(fs.readFileSync(driftHooksPath, "utf8"));
  current.hooks.UserPromptSubmit[0].hooks.push(
    driftTrellisHook,
    { type: "command", command: "node later.js" },
  );
  fs.writeFileSync(driftHooksPath, `${JSON.stringify(current, null, 2)}\n`);
  const status = inspectTrellisControl(driftProject);
  assert.equal(status.status, "drifted");
  assert.ok(status.driftedPaths.includes(".codex/hooks.json"));

  const newVersionProject = createProject(t).project;
  const newVersionHooksPath = path.join(newVersionProject, ".codex/hooks.json");
  disableTrellis(newVersionProject);
  const newVersionHooks = JSON.parse(fs.readFileSync(newVersionHooksPath, "utf8"));
  newVersionHooks.hooks = {
    SessionStart: [{
      hooks: [{ type: "command", command: "python3 .trellis/scripts/new-hook.py" }],
    }],
  };
  fs.writeFileSync(newVersionHooksPath, `${JSON.stringify(newVersionHooks, null, 2)}\n`);
  const newVersionStatus = inspectTrellisControl(newVersionProject);
  assert.equal(newVersionStatus.status, "drifted");
  assert.ok(newVersionStatus.driftedPaths.includes(".codex/hooks.json"));
});

test("AGENTS 恢复保留管理块前后同时发生的用户修改", (t) => {
  const { project } = createProject(t);
  disableTrellis(project);
  const agentsPath = path.join(project, "AGENTS.md");
  const disabled = fs.readFileSync(agentsPath, "utf8")
    .replace("# Local Rules", "# Local Rules Updated");
  fs.writeFileSync(agentsPath, `# Added While Disabled\n${disabled}`);

  enableTrellisExact(project);
  const restored = fs.readFileSync(agentsPath, "utf8");
  assert.match(restored, /^# Added While Disabled/m);
  assert.match(restored, /# Local Rules Updated/);
  assert.match(restored, /TRELLIS:START/);
});

test("control 与 manifest 的跨文件证据漂移进入 repair-required", (t) => {
  const { project } = createProject(t);
  const result = disableTrellis(project);
  const controlPath = path.join(project, ".flower/trellis-control.json");
  const manifestPath = path.join(project, ...result.manifestPath.split("/"));
  const originalControl = fs.readFileSync(controlPath, "utf8");
  const control = JSON.parse(originalControl);
  control.expectedDisabled = [];
  fs.writeFileSync(controlPath, `${JSON.stringify(control, null, 2)}\n`);
  assert.equal(inspectTrellisControl(project).status, "repair-required");

  const platformControl = JSON.parse(originalControl);
  platformControl.configuredPlatforms = [];
  fs.writeFileSync(controlPath, `${JSON.stringify(platformControl, null, 2)}\n`);
  assert.equal(inspectTrellisControl(project).status, "repair-required");

  fs.writeFileSync(controlPath, originalControl);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.completed = [];
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  assert.equal(inspectTrellisControl(project).status, "repair-required");
});

test("软链祖先不影响普通项目根，项目内软链仍保持拒绝", (t) => {
  const { project } = createProject(t);
  const alias = path.join(os.tmpdir(), `flower-trellis-parent-link-${process.pid}-${Date.now()}`);
  try {
    fs.symlinkSync(path.dirname(project), alias, "dir");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
      t.skip(`当前环境不允许创建目录软链:${error.code}`);
      return;
    }
    throw error;
  }
  t.after(() => fs.rmSync(alias, { force: true }));
  const aliasProject = path.join(alias, path.basename(project));
  assert.equal(disableTrellis(aliasProject).status, "disabled");
});

test("disable 与 enable 回滚不完整时保留 repair-required 证据", (t) => {
  const disableProject = createProject(t).project;
  assert.throws(
    () => disableTrellis(disableProject, {
      onOperation: ({ phase, index }) => {
        if (phase === "before-disable" && index === 1) throw new Error("apply fault");
        if (phase === "rollback-disable") throw new Error("rollback fault");
      },
    }),
    (error) => error.code === "TRELLIS_CONTROL_REPAIR_REQUIRED",
  );
  assert.equal(inspectTrellisControl(disableProject).status, "repair-required");

  const enableProject = createProject(t).project;
  disableTrellis(enableProject);
  assert.throws(
    () => materializeTrellis(enableProject, {
      onOperation: ({ phase, index }) => {
        if (phase === "before-enable" && index === 1) throw new Error("apply fault");
        if (phase === "rollback-enable") throw new Error("rollback fault");
      },
    }),
    (error) => error.code === "TRELLIS_CONTROL_REPAIR_REQUIRED",
  );
  assert.equal(inspectTrellisControl(enableProject).status, "repair-required");
});

test("disable 与 enable 的每个入口写入点失败都回到调用前状态", (t) => {
  const previewProject = createProject(t).project;
  const disableCount = disableTrellis(previewProject, { dryRun: true }).changed.length;
  for (let failureIndex = 0; failureIndex < disableCount; failureIndex += 1) {
    const project = createProject(t).project;
    assert.throws(
      () => disableTrellis(project, {
        onOperation: ({ phase, index }) => {
          if (phase === "before-disable" && index === failureIndex) throw new Error("fault");
        },
      }),
      /Trellis disable 事务失败，已恢复原状态/,
    );
    assert.equal(inspectTrellisControl(project).status, "enabled");
    assert.equal(fs.existsSync(path.join(project, ".flower/trellis-control.json")), false);
  }

  const enablePreviewProject = createProject(t).project;
  disableTrellis(enablePreviewProject);
  const enableCount = materializeTrellis(enablePreviewProject, { dryRun: true }).changed.length;
  for (let failureIndex = 0; failureIndex < enableCount; failureIndex += 1) {
    const project = createProject(t).project;
    disableTrellis(project);
    assert.throws(
      () => materializeTrellis(project, {
        onOperation: ({ phase, index }) => {
          if (phase === "before-enable" && index === failureIndex) throw new Error("fault");
        },
      }),
      /Trellis enable 事务失败，已恢复 disabled 状态/,
    );
    assert.equal(inspectTrellisControl(project).status, "disabled");
  }
});

test("repair-required 即使显式 force 也拒绝覆盖证据", (t) => {
  const { project } = createProject(t);
  const result = disableTrellis(project);
  const manifestPath = path.join(project, ...result.manifestPath.split("/"));
  fs.writeFileSync(manifestPath, "{broken\n");
  assert.equal(inspectTrellisControl(project).status, "repair-required");
  assert.throws(
    () => disableTrellis(project, { force: true }),
    (error) => error.code === "TRELLIS_CONTROL_REPAIR_REQUIRED",
  );
  assert.throws(
    () => enableTrellisExact(project, { force: true }),
    (error) => error.code === "TRELLIS_CONTROL_REPAIR_REQUIRED",
  );
  assert.equal(fs.readFileSync(manifestPath, "utf8"), "{broken\n");
});

test("真实 CLI 对 usage 和 preflight 冲突返回稳定退出码", (t) => {
  const { project } = createProject(t);
  const usage = spawnSync(process.execPath, [
    CLI,
    "trellis",
    "status",
    "--force",
    "--json",
    "--target",
    project,
  ], { cwd: project, encoding: "utf8" });
  assert.equal(usage.status, 2, usage.stderr);
  assert.equal(JSON.parse(usage.stdout).diagnostics[0].code, "TRELLIS_CONTROL_USAGE_ERROR");

  fs.appendFileSync(path.join(project, ".codex/agents/trellis-implement.toml"), "\n# user change\n");
  const conflict = spawnSync(process.execPath, [
    CLI,
    "trellis",
    "disable",
    "--json",
    "--target",
    project,
  ], { cwd: project, encoding: "utf8" });
  assert.equal(conflict.status, 3, conflict.stderr);
  assert.equal(JSON.parse(conflict.stdout).diagnostics[0].code, "TRELLIS_CONTROL_CONFLICT");
});

test("Claude 与 Codex 同项目一次关闭并完整恢复全部平台", (t) => {
  const { project, templates, agents } = createMultiPlatformProject(t);
  const pluginsBefore = fs.readFileSync(path.join(project, ".flower/plugins.json"));
  const lockBefore = fs.readFileSync(path.join(project, ".flower/plugin-lock.json"));
  const stateBefore = fs.readFileSync(path.join(project, ".flower/state.json"));

  const disabled = disableTrellis(project);
  assert.deepEqual(disabled.configuredPlatforms, ["claude-code", "codex"]);
  for (const relativePath of templates.keys()) {
    const target = path.join(project, ...relativePath.split("/"));
    if (!relativePath.endsWith(".json")) assert.equal(fs.existsSync(target), false, relativePath);
  }
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(project, ".claude/settings.json"), "utf8")).userSetting,
    { name: "trellis-dashboard", keep: true },
  );
  assert.doesNotMatch(fs.readFileSync(path.join(project, "AGENTS.md"), "utf8"), /TRELLIS:START/);
  assert.equal(fs.readFileSync(path.join(project, ".trellis/tasks/keep.md"), "utf8"), "keep\n");
  assert.deepEqual(fs.readFileSync(path.join(project, ".flower/plugins.json")), pluginsBefore);
  assert.deepEqual(fs.readFileSync(path.join(project, ".flower/plugin-lock.json")), lockBefore);
  assert.deepEqual(fs.readFileSync(path.join(project, ".flower/state.json")), stateBefore);

  enableTrellisExact(project);
  for (const [relativePath, content] of templates) {
    assert.equal(
      fs.readFileSync(path.join(project, ...relativePath.split("/")), "utf8"),
      content,
      relativePath,
    );
  }
  assert.equal(fs.readFileSync(path.join(project, "AGENTS.md"), "utf8"), agents);
});

test("enable dry-run 零写入且重复 enable 幂等", (t) => {
  const { project } = createProject(t);
  const disabled = disableTrellis(project);
  const controlPath = path.join(project, ".flower/trellis-control.json");
  const controlBefore = fs.readFileSync(controlPath);
  const manifestBefore = fs.readFileSync(path.join(project, ...disabled.manifestPath.split("/")));

  const preview = enableTrellisExact(project, { dryRun: true });
  assert.equal(preview.status, "dry-run");
  assert.equal(fs.existsSync(path.join(project, ".codex/config.toml")), false);
  assert.deepEqual(fs.readFileSync(controlPath), controlBefore);
  assert.deepEqual(
    fs.readFileSync(path.join(project, ...disabled.manifestPath.split("/"))),
    manifestBefore,
  );

  assert.equal(enableTrellisExact(project).status, "enabled");
  assert.equal(enableTrellisExact(project).status, "unchanged");
});

test("disabled 写链失败后恢复调用前完整关闭状态", async (t) => {
  const { project } = createProject(t);
  disableTrellis(project);

  await assert.rejects(
    () => runWithTrellisIntegrationEnabled(project, () => {
      fs.writeFileSync(path.join(project, ".codex/config.toml"), "operation drift\n");
      throw new Error("operation failed");
    }),
    /operation failed/,
  );
  assert.equal(inspectTrellisControl(project).status, "disabled");
  assert.equal(fs.existsSync(path.join(project, ".codex/config.toml")), false);
  assert.equal(fs.existsSync(path.join(project, ".codex/agents/trellis-implement.toml")), false);
  assert.doesNotMatch(fs.readFileSync(path.join(project, "AGENTS.md"), "utf8"), /TRELLIS:START/);
});

test("disabled 写链可扩展快照并恢复通常排除的 Plugin spec 目标", async (t) => {
  const { project } = createProject(t);
  const specPath = path.join(project, ".trellis/spec/guide.md");
  fs.mkdirSync(path.dirname(specPath), { recursive: true });
  fs.writeFileSync(specPath, "original spec\n");
  disableTrellis(project);

  await assert.rejects(
    () => runWithTrellisIntegrationEnabled(project, ({ extendSnapshot }) => {
      assert.deepEqual(extendSnapshot([".trellis/spec/guide.md"]), [
        ".trellis/spec/guide.md",
      ]);
      fs.writeFileSync(specPath, "changed spec\n");
      throw new Error("operation failed");
    }),
    /operation failed/,
  );
  assert.equal(fs.readFileSync(specPath, "utf8"), "original spec\n");
  assert.equal(inspectTrellisControl(project).status, "disabled");
});

test("disabled 写链外层回滚不完整时持久化 repair-required", {
  skip: process.platform === "win32",
}, async (t) => {
  const { project } = createProject(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "flower-trellis-control-outside-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  disableTrellis(project);

  await assert.rejects(
    () => runWithTrellisIntegrationEnabled(project, () => {
      fs.symlinkSync(outside, path.join(project, ".codex/rollback-blocker"), "dir");
      throw new Error("operation failed");
    }),
    (error) => error.code === "TRELLIS_CONTROL_REPAIR_REQUIRED" &&
      error.details.controlStateMarked === true,
  );
  assert.equal(inspectTrellisControl(project).status, "repair-required");
});
