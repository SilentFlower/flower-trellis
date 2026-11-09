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
import { ConfirmationStore, prepareConfirmation, runConfirmationWorker, cancelConfirmation } from "../../src/lib/codex-confirmation.js";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

/** 读取平台配置中的确认 Hook 数量。 */
function hookCounts(target) {
  const hooks = JSON.parse(fs.readFileSync(path.join(target, ".claude/settings.json"), "utf8")).hooks;
  return Object.fromEntries(["UserPromptSubmit", "Stop", "SessionEnd"].map(event => [event, (hooks[event] || []).flatMap(group => group.hooks).filter(hook => hook.command.includes("flower_confirmation_hook.py")).length]));
}

test("实际安装及重复叠加保留用户 Hook，卸载只清理自有确认事件", t => {
  const target = fs.mkdtempSync(path.join(tmpdir(), "flower-confirm-install-"));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  execFileSync(process.execPath, [resolveTrellisBin(), "init", "--claude", "--codex", "--no-monorepo", "-y", "-u", "probe"], { cwd: target, env: { ...process.env, FLOWER_NO_TELEMETRY: "1" }, stdio: "ignore" });
  const file = path.join(target, ".claude/settings.json");
  const settings = JSON.parse(fs.readFileSync(file, "utf8"));
  settings.hooks.Stop = [{ hooks: [{ type: "command", command: "echo 用户自有Hook", timeout: 3 }] }];
  fs.writeFileSync(file, JSON.stringify(settings));
  applyEnhancements(target, { variant: "0.6" });
  assert.deepEqual(hookCounts(target), { UserPromptSubmit: 1, Stop: 1, SessionEnd: 1 });
  assert.ok(fs.existsSync(path.join(target, ".trellis/scripts/confirmation_policy.py")));
  assert.ok(fs.existsSync(path.join(target, ".trellis/scripts/confirmation.md")));
  assert.ok(fs.existsSync(path.join(target, ".trellis/scripts/flower_confirmation_hook.py")));
  const config = path.join(target, ".trellis/config.yaml");
  fs.appendFileSync(config, "\nconfirmation_timeout:\n  enabled: false\n  push:\n    seconds: 317\n");
  applyEnhancements(target, { variant: "0.6" });
  assert.deepEqual(hookCounts(target), { UserPromptSubmit: 1, Stop: 1, SessionEnd: 1 });
  assert.match(fs.readFileSync(config, "utf8"), /seconds: 317/);
  assert.match(fs.readFileSync(file, "utf8"), /用户自有Hook/);
  const plan = planSkillGardenUninstall(target);
  assert.equal(plan.confirmationHooks, true);
  assert.equal(applySkillGardenUninstall(target, plan).status, "applied");
  assert.deepEqual(hookCounts(target), { UserPromptSubmit: 0, Stop: 0, SessionEnd: 0 });
  assert.match(fs.readFileSync(file, "utf8"), /用户自有Hook/);
});

test("清理不存在的平台不重建目录；旧后台 worker 不能在卸载后复活运行目录", async t => {
  const root = fs.mkdtempSync(path.join(tmpdir(), "flower-confirm-uninstall-race-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new ConfirmationStore(root, randomUUID(), { platform: "codex" });
  const client = new EventEmitter();
  client.snapshot = async () => ({ humanId: "human", turn: { id: "origin", status: "completed" } });
  client.add = async () => ({ id: "owned-queue" }); client.remove = async () => "deleted";
  const request = prepareConfirmation(store, { seconds: 0.1, message: "卸载竞争夹具", snapshot: await client.snapshot() }).request;
  const worker = runConfirmationWorker({ store, client, requestId: request.id });
  const end = Date.now() + 5000;
  while (store.read().request.state !== "queued") { if (Date.now() > end) throw new Error("未进入排队状态"); await sleep(15); }
  fs.rmSync(path.join(root, ".trellis"), { recursive: true });
  assert.equal((await worker).state, "replaced");
  assert.equal(fs.existsSync(path.join(root, ".trellis")), false);
  await cancelConfirmation({ store, requestId: request.id });
  assert.equal(fs.existsSync(path.join(root, ".trellis")), false);
});

test("确认 Hook 帮助零写入，未支持的原生平台忽略事件", t => {
  const target = fs.mkdtempSync(path.join(tmpdir(), "flower-confirm-hook-help-"));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  // 帮助属于两平台共同契约：即使未安装项目或没有会话也应零写入。
  const result = spawnSync(process.execPath, [path.resolve("bin/flower-trellis.js"), "confirm", "hook", "--help", "--target", target], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readdirSync(target), []);
  if (process.platform !== "linux") {
    const ignored = spawnSync(process.execPath, [path.resolve("bin/flower-trellis.js"), "confirm", "hook", "--target", target], { encoding: "utf8", input: "{}" });
    assert.equal(ignored.status, 0, ignored.stderr);
    assert.deepEqual(fs.readdirSync(target), []);
  }
});
