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
