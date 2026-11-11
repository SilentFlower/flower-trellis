/** @module confirmation-install-test 原生确认的安装、重复更新、配置保护与卸载行为。 */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { resolveTrellisBin } from "../../src/lib/trellis-runner.js";
import { applyEnhancements } from "../../src/lib/apply-enhancements.js";
import { planSkillGardenUninstall, applySkillGardenUninstall } from "../../src/builtin-plugins/skill-garden/uninstall.js";
import { randomUUID } from "node:crypto";
import { hashContent } from "../../src/plugin/install/content-hash.js";
import { resolvePythonExecutable } from "../../scripts/python-runtime.mjs";
import { disableTrellis } from "../../src/lib/trellis-control.js";
import { SKILL_GARDEN_PLUGIN_ID, SkillGardenBuiltinProvider } from "../../src/builtin-plugins/skill-garden/provider.js";
import { PluginApplicationService } from "../../src/plugin/application-service.js";
import { ProjectStore } from "../../src/plugin/state/project-store.js";
import { SourceRegistry } from "../../src/plugin/sources/source-registry.js";
import { TransactionWriter } from "../../src/plugin/install/transaction-writer.js";
import { PLUGIN_RUNTIME_ERROR_CODES } from "../../src/plugin/runtime-errors.js";
import { migrateLegacyConfirmationConfig } from "../../src/lib/legacy-confirmation-config.js";
import { isolatedGlobalTrellis } from "../helpers/update-performance.js";
import { runFlower } from "./plugin-e2e-helpers.js";

/** 读取平台配置中的确认 Hook 数量。 */
function hookCounts(target, platform) {
  const file = platform === "codex" ? ".codex/hooks.json" : ".claude/settings.json";
  const hooks = JSON.parse(fs.readFileSync(path.join(target, file), "utf8")).hooks;
  const events = ["SessionStart", "UserPromptSubmit", "Stop", "SessionEnd", ...(platform === "codex" ? ["Interrupt"] : [])];
  return Object.fromEntries(events.map(event => [event, (hooks[event] || []).flatMap(group => group.hooks).filter(hook => hook.command.includes("flower_confirmation_hook.py")).length]));
}

test("实际安装及重复叠加保留用户 Hook，卸载只清理自有确认事件", t => {
  const target = fs.mkdtempSync(path.join(tmpdir(), "flower-confirm-install-"));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  execFileSync(process.execPath, [resolveTrellisBin(), "init", "--claude", "--codex", "--no-monorepo", "-y", "-u", "probe"], { cwd: target, env: { ...process.env, FLOWER_NO_TELEMETRY: "1" }, stdio: "ignore" });
  const file = path.join(target, ".claude/settings.json");
  const settings = JSON.parse(fs.readFileSync(file, "utf8"));
  settings.hooks.Stop = [{ hooks: [{ type: "command", command: "echo 用户自有Hook", timeout: 3 }] }];
  fs.writeFileSync(file, JSON.stringify(settings));
  const codexFile = path.join(target, ".codex/hooks.json");
  const codex = fs.existsSync(codexFile) ? JSON.parse(fs.readFileSync(codexFile, "utf8")) : {};
  codex.hooks = { ...codex.hooks, Interrupt: [{ hooks: [{ type: "command", command: "echo Codex用户自有Hook", timeout: 3 }] }] };
  fs.writeFileSync(codexFile, JSON.stringify(codex));
  applyEnhancements(target, { variant: "0.6" });
  const counts = { SessionStart: 1, UserPromptSubmit: 1, Stop: 1, SessionEnd: 1 };
  assert.deepEqual(hookCounts(target, "claude"), counts);
  assert.deepEqual(hookCounts(target, "codex"), { SessionStart: 0, UserPromptSubmit: 1, Stop: 0, SessionEnd: 0, Interrupt: 1 });
  assert.ok(fs.existsSync(path.join(target, ".trellis/scripts/confirmation_policy.py")));
  assert.ok(fs.existsSync(path.join(target, ".trellis/scripts/confirmation.md")));
  for (const asset of ["flower_confirmation_hook.py", "flower_confirmation.py", "flower_tui_lifetime.py", "flower_confirmation_runtime/runtime.py"]) {
    assert.ok(fs.existsSync(path.join(target, ".trellis/scripts", asset)), asset);
  }
  assert.equal(fs.existsSync(path.join(target, ".trellis/scripts/codex-local.sh")), false);
  assert.match(fs.readFileSync(codexFile, "utf8"), /flower_confirmation_hook.py --platform codex/);
  const config = path.join(target, ".trellis/config.yaml");
  fs.appendFileSync(config, "\nconfirmation_timeout:\n  enabled: false\n  push:\n    seconds: 317\n");
  applyEnhancements(target, { variant: "0.6" });
  assert.deepEqual(hookCounts(target, "claude"), counts);
  assert.deepEqual(hookCounts(target, "codex"), { SessionStart: 0, UserPromptSubmit: 1, Stop: 0, SessionEnd: 0, Interrupt: 1 });
  assert.match(fs.readFileSync(config, "utf8"), /seconds: 317/);
  assert.match(fs.readFileSync(file, "utf8"), /用户自有Hook/);
  const plan = planSkillGardenUninstall(target);
  assert.equal(plan.confirmationHooks, true);
  // 正式生命周期先由上游卸载 .trellis，再按冻结计划清理尚存在的平台 Hook。
  execFileSync(process.execPath, [resolveTrellisBin(), "uninstall", "-y"], { cwd: target, env: { ...process.env, FLOWER_NO_TELEMETRY: "1" }, stdio: "ignore" });
  assert.equal(applySkillGardenUninstall(target, plan).status, "applied");
  const removed = { SessionStart: 0, UserPromptSubmit: 0, Stop: 0, SessionEnd: 0 };
  assert.deepEqual(hookCounts(target, "claude"), removed);
  assert.deepEqual(hookCounts(target, "codex"), { ...removed, Interrupt: 0 });
  assert.match(fs.readFileSync(file, "utf8"), /用户自有Hook/);
  assert.match(fs.readFileSync(codexFile, "utf8"), /Codex用户自有Hook/);
  for (const asset of ["confirmation.md", "confirmation_policy.py", "flower_confirmation_hook.py", "codex-local.sh"]) {
    assert.equal(fs.existsSync(path.join(target, ".trellis/scripts", asset)), false, asset);
  }
});

test("项目 Python 帮助零写入；Flower 帮助清理旧命令", t => {
  const target = fs.mkdtempSync(path.join(tmpdir(), "flower-confirm-hook-help-"));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  const result = spawnSync(resolvePythonExecutable(), ["-X", "utf8", path.resolve("src/assets/flower_confirmation.py"), "--help", "--target", path.join(target, "missing")], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readdirSync(target), []);
  const help = spawnSync(process.execPath, [path.resolve("bin/flower-trellis.js"), "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0, help.stderr);
  assert.doesNotMatch(help.stdout, /flower-trellis confirm/);
});

test("关闭项目先作废两平台现有请求，dry-run 不改变代次", t => {
  const target = fs.mkdtempSync(path.join(tmpdir(), "flower-confirm-disable-"));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  execFileSync(process.execPath, [resolveTrellisBin(), "init", "--claude", "--codex", "--no-monorepo", "-y", "-u", "probe"], { cwd: target, env: { ...process.env, FLOWER_NO_TELEMETRY: "1" }, stdio: "ignore" });
  const files = ["codex", "claude"].map(platform => {
    const session = randomUUID();
    const file = path.join(target, ".trellis/.runtime", `confirmation-${platform}`, `${session}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: 2, sessionId: session, generation: 1,
      request: { id: randomUUID(), generation: 1, state: "prepared" } }));
    return file;
  });
  disableTrellis(target, { dryRun: true });
  for (const file of files) assert.equal(JSON.parse(fs.readFileSync(file)).request.state, "prepared");
  disableTrellis(target);
  for (const file of files) {
    const state = JSON.parse(fs.readFileSync(file));
    assert.equal(state.request.state, "cancelled");
    assert.equal(state.request.error, "project_disabled");
    assert.notEqual(state.generation, state.request.generation);
  }
});

test("实际运行时升级取消旧请求，预览和重复更新保持原代次", t => {
  const target = fs.mkdtempSync(path.join(tmpdir(), "flower-confirm-upgrade-"));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  execFileSync(process.execPath, [resolveTrellisBin(), "init", "--claude", "--codex", "--no-monorepo", "-y", "-u", "probe"], { cwd: target, env: { ...process.env, FLOWER_NO_TELEMETRY: "1" }, stdio: "ignore" });
  applyEnhancements(target, { variant: "0.6" });
  const relative = ".trellis/scripts/flower_confirmation_hook.py";
  const previous = "# 旧版安装资产\n";
  fs.writeFileSync(path.join(target, relative), previous);
  const stateFile = path.join(target, ".flower/state.json");
  const state = JSON.parse(fs.readFileSync(stateFile));
  state.plugins.find(({ id }) => id === "flower/skill-garden").paths.find(({ path: entry }) => entry === relative).hash = hashContent(previous);
  fs.writeFileSync(stateFile, JSON.stringify(state));
  const session = randomUUID();
  const requestFile = path.join(target, ".trellis/.runtime/confirmation-codex", `${session}.json`);
  fs.mkdirSync(path.dirname(requestFile), { recursive: true });
  fs.writeFileSync(requestFile, JSON.stringify({ version: 2, sessionId: session, generation: 1,
    request: { id: randomUUID(), generation: 1, state: "prepared" } }));
  applyEnhancements(target, { variant: "0.6", dryRun: true });
  assert.equal(JSON.parse(fs.readFileSync(requestFile)).request.state, "prepared");
  applyEnhancements(target, { variant: "0.6" });
  const cancelled = fs.readFileSync(requestFile, "utf8");
  assert.equal(JSON.parse(cancelled).request.error, "project_updated");
  applyEnhancements(target, { variant: "0.6" });
  assert.equal(fs.readFileSync(requestFile, "utf8"), cancelled);
});

test("真实升级预览并清理历代确认配置，回滚恢复原文件", t => {
  const target = fs.mkdtempSync(path.join(tmpdir(), "flower-confirm-legacy-"));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  const env = { ...process.env, FLOWER_NO_TELEMETRY: "1" };
  execFileSync(process.execPath, [resolveTrellisBin(), "init", "--claude", "--codex", "--no-monorepo", "-y", "-u", "probe"], { cwd: target, env, stdio: "ignore" });
  applyEnhancements(target, { variant: "0.6" });
  const store = new ProjectStore(target);
  const legacyName = "flower_confirmation_0123abcd";
  const nearName = "flower_confirmation_0123abce";
  const market = "flower-trellis-confirm-0123456789abcdef01234567";
  const marketPlugin = `flower-confirmation@${market}`;
  const permission = `mcp__${legacyName}__wait`;
  const userPermission = `mcp__${nearName}__wait`;
  const script = ".trellis/scripts/confirmation.py";
  const active = ".trellis/scripts/flower_confirmation_hook.py";
  const secret = "不应出现在预演输出的测试描述符";
  const oldHook = { type: "command", command: "ftl confirm hook", timeout: 2 };
  const userHook = { type: "command", command: "echo 'ftl confirm hook'", timeout: 2 };
  const read = (file) => fs.readFileSync(path.join(target, file), "utf8");
  const write = (file, content) => fs.writeFileSync(path.join(target, file), content);
  const readJson = (file) => JSON.parse(read(file));
  const writeJson = (file, value) => write(file, JSON.stringify(value, null, 2) + "\n");
  const settings = readJson(".claude/settings.json");
  settings.hooks.PreToolUse = [
    { matcher: "Bash", hooks: [{ ...oldHook, if: "Bash(ftl confirm *)" }, userHook] },
    { matcher: "Other", hooks: [oldHook] },
  ];
  settings.hooks.UserPromptSubmit.find(({ matcher }) => matcher === "*").hooks.push(oldHook);
  settings.permissions = { allow: [permission, userPermission] };
  settings.enabledPlugins = { [marketPlugin]: true, "flower-confirmation@flower-probe-market": true };
  settings.extraKnownMarketplaces = {
    [market]: { source: { source: "directory", path: path.join(target, "native-confirmation", "claude") } },
    "flower-probe-market": { source: { source: "directory", path: path.join(target, "user-marketplace") } },
  };
  writeJson(".claude/settings.json", settings);
  const server = { type: "stdio", command: "node", args: ["/legacy/confirmation-mcp.js"], env: { FLOWER_CONFIRMATION_SESSION: secret } };
  writeJson(".mcp.json", { mcpServers: { [legacyName]: server, [nearName]: { ...server, args: ["user.js"] } } });
  const originalToml = read(".codex/config.toml");
  const codexToml = [
    originalToml.trimEnd(),
    "# 用户保留的注释",
    `[mcp_servers."${legacyName}"]`,
    'command = "node"',
    'args = ["/legacy/confirmation-mcp.js"]',
    `[mcp_servers."${legacyName}".env]`,
    `FLOWER_CONFIRMATION_SESSION = "${secret}"`,
    "[mcp_servers.codex_tui]",
    'command = "user-managed"',
    "[shell_environment_policy.set]",
    `FLOWER_CONFIRMATION_SESSION = "${secret}"`,
    'KEEP = "yes"',
    "",
  ].join("\n");
  write(".codex/config.toml", codexToml);
  write(".claude/settings.local.json", "{ 不是合法的 JSON");
  write(script, "# 已由历史 state 明确登记的旧脚本\n");
  write(active, '# 旧后台入口\ncommand = ["ftl", "confirm", "hook"]\n');
  const state = store.readState();
  const paths = state.plugins.find(({ id }) => id === SKILL_GARDEN_PLUGIN_ID).paths;
  paths.push({ path: script, kind: "file", hash: hashContent(read(script)), ownership: "exclusive" });
  paths.find(({ path: relative }) => relative === active).hash = hashContent(read(active));
  store.writeState(state);
  write(".trellis/.version", "0.6.13\n");

  const files = [".mcp.json", ".claude/settings.json", ".claude/settings.local.json", ".codex/config.toml", script, active, ".flower/state.json"];
  const contents = () => files.map(read);
  const before = contents();
  const prefix = path.join(target, "global-prefix");
  isolatedGlobalTrellis(prefix);
  const run = (...args) => {
    const result = runFlower(target, ["update", "--no-update-check", "-y", ...args], {
      env: { npm_config_prefix: prefix },
      envRoot: path.join(target, "cli-env"),
      timeout: 60_000,
    });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    return result.stdout;
  };
  const preview = run("--skip-all", "--dry-run");
  assert.match(preview, /\.mcp\.json.*mcpServers\.flower_confirmation_0123abcd/);
  assert.match(preview, /\.claude\/settings\.json.*permissions\.allow: mcp__flower_confirmation_0123abcd__wait/);
  assert.match(preview, /旧确认脚本 \.trellis\/scripts\/confirmation\.py/);
  assert.doesNotMatch(preview, new RegExp(secret));
  assert.deepEqual(contents(), before);

  const provider = new SkillGardenBuiltinProvider({ projectRoot: target, previousState: store.readState() });
  const writer = new TransactionWriter(target, {
    store,
    onOperation(event) {
      if (event.phase === "before-write" && event.kind === "lock") throw new Error("模拟迁移后事务失败");
    },
  });
  const service = new PluginApplicationService(target, { store, writer, registry: new SourceRegistry([provider]) });
  assert.throws(
    () => service.update({ id: SKILL_GARDEN_PLUGIN_ID, platforms: ["codex", "claude"], nonInteractive: true }),
    (error) => error.code === PLUGIN_RUNTIME_ERROR_CODES.TRANSACTION_FAILED,
  );
  assert.deepEqual(contents(), before);

  const output = run("--skip-all");
  assert.doesNotMatch(output, new RegExp(secret));
  assert.deepEqual(readJson(".mcp.json").mcpServers, { [nearName]: { ...server, args: ["user.js"] } });
  const updated = readJson(".claude/settings.json");
  assert.deepEqual(updated.permissions.allow, [userPermission]);
  assert.deepEqual(updated.enabledPlugins, { "flower-confirmation@flower-probe-market": true });
  assert.deepEqual(Object.keys(updated.extraKnownMarketplaces), ["flower-probe-market"]);
  assert.deepEqual(updated.hooks.PreToolUse, [{ matcher: "Bash", hooks: [userHook] }, { matcher: "Other", hooks: [oldHook] }]);
  assert.ok(!updated.hooks.UserPromptSubmit.flatMap(({ hooks }) => hooks).some(({ command }) => command === "ftl confirm hook"));
  assert.deepEqual(hookCounts(target, "claude"), { SessionStart: 1, UserPromptSubmit: 1, Stop: 1, SessionEnd: 1 });
  assert.doesNotMatch(read(".codex/config.toml"), /FLOWER_CONFIRMATION_SESSION|flower_confirmation_0123abcd/);
  assert.match(read(".codex/config.toml"), /# 用户保留的注释\n\[mcp_servers\.codex_tui\]/);
  assert.match(read(".codex/config.toml"), /KEEP = "yes"/);
  assert.equal(read(".claude/settings.local.json"), "{ 不是合法的 JSON");
  assert.equal(fs.existsSync(path.join(target, script)), false);
  assert.match(read(active), /\.trellis\/scripts\/flower_confirmation\.py/);

  const retained = files.slice(0, 4).map(read);
  assert.doesNotMatch(run("--enhance-only"), /旧确认配置|旧确认脚本/);
  assert.deepEqual(files.slice(0, 4).map(read), retained);

  write(script, "# 用户改过的脚本\n");
  const next = store.readState();
  next.plugins.find(({ id }) => id === SKILL_GARDEN_PLUGIN_ID).paths.push({
    path: script, kind: "file", hash: hashContent(before[4]), ownership: "exclusive",
  });
  store.writeState(next);
  run("--enhance-only");
  assert.equal(read(script), "# 用户改过的脚本\n");
  run("--enhance-only");
  assert.equal(read(script), "# 用户改过的脚本\n");
});

test("旧确认 TOML 仅删除能完整核对的语句和配套变量", () => {
  const targetSpec = { kind: "toml", path: ".codex/config.toml" };
  const server = 'command = "node", args = ["/legacy/confirmation-mcp.js"], env = { FLOWER_CONFIRMATION_SESSION = "same" }';
  const legacy = 'mcp_servers.flower_confirmation_0123abcd = { ' + server + " }";
  const extra = 'mcp_servers.flower_confirmation_0123abce = { ' + server + ', cwd = "/user" }';
  const policy = 'shell_environment_policy.set.FLOWER_CONFIRMATION_SESSION = "same"';
  const keep = "# 用户的注释";
  const value = [legacy, extra, policy, keep, ""].join("\r\n");
  const result = migrateLegacyConfirmationConfig({ value, targetSpec });
  assert.equal(result.value, [extra, policy, keep, ""].join("\r\n"));
  const ambiguous = "mcp_servers = { flower_confirmation_0123abcd = { " + server + " } }";
  assert.deepEqual(migrateLegacyConfirmationConfig({ value: ambiguous, targetSpec }), { unchanged: true });
});

test("旧确认 JSON 迁移保留无法无损重写的项目配置", () => {
  const targetSpec = { kind: "json", path: ".mcp.json" };
  const config = '{"mcpServers":{"flower_confirmation_0123abcd":{"command":"node","args":["/legacy/confirmation-mcp.js"],"env":{"FLOWER_CONFIRMATION_SESSION":"fixture"}}}';
  for (const extra of [
    '"metadata":{"value":9007199254740993}',
    '"metadata":{"value":1.00000000000000001}',
    '"metadata":{"value":"first","v\\u0061lue":"second"}',
  ]) {
    const value = `${config},${extra}}\n`;
    assert.deepEqual(migrateLegacyConfirmationConfig({ value, targetSpec }), { unchanged: true });
  }
  const value = `${config},"metadata":[{"value":0.25},{"value":"9007199254740993"}]}\n`;
  const result = migrateLegacyConfirmationConfig({ value, targetSpec });
  assert.deepEqual(JSON.parse(result.value), { mcpServers: {}, metadata: [{ value: 0.25 }, { value: "9007199254740993" }] });
  assert.deepEqual(migrateLegacyConfirmationConfig({
    value, original: `${config},"metadata":[9007199254740993]}\n`, targetSpec,
  }), { unchanged: true });
});
