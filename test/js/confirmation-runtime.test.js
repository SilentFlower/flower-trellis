/** @module confirmation-runtime-test 正式策略、材料绑定与原生流程入口的行为验证。 */
import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync, spawnSync, spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { resolvePythonExecutable } from "../../scripts/python-runtime.mjs";
import { ConfirmationStore, inspectConfirmation, prepareFormalConfirmation, waitFormalConfirmation, claimFormalConfirmation, recordConfirmationResult, renderConfirmation } from "../../src/lib/confirmation-runtime.js";
import { cancelConfirmation } from "../../src/lib/codex-confirmation.js";
import { captureConfigPreserveSnapshot, restoreConfigPreserveSnapshot } from "../../src/lib/config-preserver.js";
import { ClaudeConfirmationClient, recordClaudeConfirmationEvent } from "../../src/lib/claude-confirmation-client.js";

const ROOT = path.resolve(".");
const PYTHON = resolvePythonExecutable();

/** 创建具备实际 Python helper 和会话任务绑定的隔离项目。 */
function fixture(t, platform = "codex") {
  const root = mkdtempSync(path.join(tmpdir(), "flower-formal-confirm-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sessionId = randomUUID();
  const task = ".trellis/tasks/test";
  for (const relative of [task, ".trellis/scripts", ".trellis/.runtime/sessions"]) mkdirSync(path.join(root, relative), { recursive: true });
  cpSync(path.join(ROOT, ".trellis/scripts/common"), path.join(root, ".trellis/scripts/common"), { recursive: true });
  cpSync(path.join(ROOT, "vendor/skill-garden/.trellis/0.6/scripts/confirmation_policy.py"), path.join(root, ".trellis/scripts/confirmation_policy.py"));
  writeFileSync(path.join(root, ".trellis/config.yaml"), "session_auto_commit: false\n");
  writeFileSync(path.join(root, task, "task.json"), JSON.stringify({ name: "test", status: "planning" }));
  for (const name of ["prd.md", "design.md", "implement.md", "brief.md"]) writeFileSync(path.join(root, task, name), "确认正文");
  writeFileSync(path.join(root, `.trellis/.runtime/sessions/${platform}_${sessionId}.json`), JSON.stringify({ current_task: task }));
  writeFileSync(path.join(root, ".gitignore"), ".trellis/.runtime/\n");
  const input = ".trellis/.runtime/input.json";
  const material = { kind: "brief", task };
  const save = () => writeFileSync(path.join(root, input), JSON.stringify(material));
  save();
  const store = new ConfirmationStore(root, sessionId, { platform });
  const runId = randomUUID();
  store.update(() => ({ version: 2, sessionId, generation: 0, lastHumanMessageId: null, request: null,
    native: { version: 1, project: root, sessionId, runId, tasks: {} } }));
  const client = new EventEmitter();
  client.captureWindow = async () => ({ version: 1, origin: "http://127.0.0.1:1", pid: 123 });
  client.verifyWindow = async () => {};
  client.observeWindow = async () => {};
  client.humanId = "native-human";
  client.runId = runId;
  client.turn = { id: "native-origin", status: "inProgress" };
  client.snapshot = async () => ({ humanId: client.humanId, turn: { ...client.turn }, runId, wake: { requestId: store.read()?.request?.id, turnId: client.turn.id } });
  client.assistantText = async () => renderConfirmation(store.read().request.contract.frozen);
  client.added = [];
  client.add = async id => { client.added.push(id); return { id: `queue-${id}` }; };
  client.remove = async () => "deleted";
  const inspect = seconds => {
    const old = process.env.TRELLIS_PYTHON_CMD;
    process.env.TRELLIS_PYTHON_CMD = PYTHON;
    try { return inspectConfirmation({ project: root, input, sessionId, platform, seconds }); }
    finally { if (old === undefined) delete process.env.TRELLIS_PYTHON_CMD; else process.env.TRELLIS_PYTHON_CMD = old; }
  };
  // 正式命令使用目标项目的已物化解释器；Windows 夹具同样不依赖 python3 别名。
  writeFileSync(path.join(root, ".trellis/workflow.md"), `${PYTHON.includes(" ") ? `"${PYTHON}"` : PYTHON} -X utf8 .trellis/scripts/confirmation_policy.py\n`);
  const prepare = seconds => prepareFormalConfirmation({ store, client, input, platform, seconds });
  const finish = () => { client.turn.status = "completed"; client.emit("notification", { method: "turn/completed", params: { turn: client.turn } }); };
  return { root, sessionId, task, input, material, save, store, client, platform, inspect, prepare, finish };
}

/** 在明确预算内等待异步状态。 */
async function until(condition) {
  const end = Date.now() + 6000;
  while (!condition()) { if (Date.now() > end) throw new Error("正式确认状态等待超时"); await sleep(15); }
}

test("Brief 按 Unicode 规范化计数；Check 去重并排除 DOC 和已处置项；Push 默认 200 秒", t => {
  const f = fixture(t);
  for (const [characters, seconds] of [[1000, 100], [1001, 130], [1501, 160]]) {
    writeFileSync(path.join(f.root, f.task, "brief.md"), `\r\n${"😀".repeat(characters)}\r\n`);
    assert.equal(f.inspect().seconds, seconds);
  }
  Object.assign(f.material, { kind: "check", body: "完整检查报告", reportVersion: "1", dispositionVersion: "1", findings: [] });
  f.save();
  assert.equal(f.inspect().enabled, false);
  f.material.findings = [{ id: "CHK-001" }, { id: "CHK-001" }, { id: "DOC-001" }, { id: "FBK-001", status: "accepted" }];
  f.save();
  assert.equal(f.inspect().seconds, 100);
  f.material.findings.push({ id: "FBK-002" }); f.save();
  assert.equal(f.inspect().seconds, 130);
  writeFileSync(path.join(f.root, ".trellis/config.yaml"), "confirmation_timeout:\n  check:\n    base_seconds: 12\n    increment_seconds: 4\n");
  assert.equal(f.inspect().seconds, 16);
  assert.equal(f.inspect(9).seconds, 9);
});

test("配置关闭和坏配置不会放行；更新保留原用户策略", async t => {
  const f = fixture(t);
  const config = path.join(f.root, ".trellis/config.yaml");
  for (const text of ["confirmation_timeout:\n  enabled: false\n", 'confirmation_timeout:\n  brief:\n    enabled: "false"\n']) {
    writeFileSync(config, text);
    assert.equal(f.inspect(1).enabled, false);
    assert.equal((await f.prepare(1)).prepared, false);
  }
  for (const text of ["confirmation_timeout:\n  enabled: true\n  enabled: false\n", "confirmation_timeout:\n  push:\n    seconds: -1\n", "confirmation_timeout:\n  enabled: maybe\n"]) {
    writeFileSync(config, text); assert.throws(() => f.inspect(), /确认|策略|必须|重复字段|超出/);
  }
  const original = "confirmation_timeout:\n  enabled: false\n  push:\n    seconds: 312\n";
  writeFileSync(config, original);
  const captured = captureConfigPreserveSnapshot(f.root);
  writeFileSync(config, "session_auto_commit: false\n");
  restoreConfigPreserveSnapshot(f.root, captured);
  assert.ok(readFileSync(config, "utf8").includes(original.trim()));
});

test("完整展示只兼容标题后的空行，正文、时间、默认动作和围栏内容仍须完整", async t => {
  const body = "# Brief\n\n## Goal\n\n- 编写说明。\n\n```md\n## 代码内标题\n\n保留代码空行\n```\n\n正文第一段。\n\n正文第二段。";
  const changes = [
    [true, value => "来源说明\n\n" + value.replace("## Goal\n\n", "## Goal\n")],
    [false, value => value.replace("- 编写说明。", "")],
    [false, value => value.replace("等待 1 秒", "等待 2 秒")],
    [false, value => value.replace("按当前完整 Brief 开工", "执行另一任务")],
    [false, value => value.replace("## 代码内标题\n\n", "## 代码内标题\n")],
    [false, value => value.replace("正文第一段。\n\n", "正文第一段。\n")],
  ];
  for (const [valid, transform] of changes) {
    const f = fixture(t);
    writeFileSync(path.join(f.root, f.task, "brief.md"), body);
    const prepared = await f.prepare(1);
    f.client.assistantText = async () => transform(prepared.display);
    const options = { store: f.store, client: f.client, platform: f.platform, requestId: prepared.requestId };
    const worker = waitFormalConfirmation(options);
    f.finish();
    if (valid) {
      await until(() => f.store.read().request.state === "queued");
      assert.equal(f.client.added.length, 1);
      await cancelConfirmation(options);
    }
    const result = await worker;
    if (!valid) {
      assert.equal(result.state, "failed");
      assert.match(f.store.read().request.error, /未完整展示/);
      assert.equal(f.client.added.length, 0);
    }
  }
});

test("完整展示后才计时，重复 worker 和领取只授权一次，执行结果据实记录", async t => {
  const f = fixture(t);
  const prepared = await f.prepare(1);
  const options = { store: f.store, client: f.client, platform: f.platform, requestId: prepared.requestId };
  const worker = waitFormalConfirmation(options);
  await sleep(80);
  assert.equal(f.store.read().request.deadline, null);
  assert.equal((await waitFormalConfirmation(options)).state, "duplicate_worker");
  f.finish();
  await until(() => f.store.read().request.state === "queued");
  const results = await Promise.all([claimFormalConfirmation(options), claimFormalConfirmation(options)]);
  const claimed = results.find(result => result.claimed);
  assert.equal(results.filter(result => result.claimed).length, 1);
  assert.equal(claimed.source, "policy_timeout");
  assert.equal(claimed.action, "implement");
  assert.equal(f.store.read().request.receipt.source, "policy_timeout");
  const record = state => recordConfirmationResult({ ...options, receipt: claimed.receipt.id, state });
  assert.equal((await record("started")).recorded, true);
  await assert.rejects(f.prepare(1), /上一超时动作尚未记录终态/);
  assert.equal((await record("started")).recorded, false);
  assert.equal((await record("completed")).recorded, true);
  assert.equal((await worker).state, "consumed");
  assert.equal(f.client.added.length, 1);
});

test("领取后新消息先于 started 落盘，锁内复核必须拒绝旧动作", async t => {
  const f = fixture(t, "claude");
  f.client.snapshot = async () => ({ humanId: f.client.humanId, turn: { ...f.client.turn }, runId: f.client.runId,
    notification: { requestId: f.store.read()?.request?.id, taskId: f.store.read()?.request?.queueId } });
  const prepared = await f.prepare(1);
  const options = { store: f.store, client: f.client, platform: f.platform, requestId: prepared.requestId };
  const worker = waitFormalConfirmation(options); f.finish();
  await until(() => f.store.read().request.state === "queued");
  const claimed = await claimFormalConfirmation(options);
  assert.equal(claimed.claimed, true);
  const change = f.store.change.bind(f.store);
  f.store.change = (id, mutate) => {
    f.store.change = change;
    // 把真实 Hook 精确插入最后一次原生快照与 started 写锁之间，避免靠随机延时碰竞态。
    recordClaudeConfirmationEvent({ hook_event_name: "UserPromptSubmit", cwd: f.root, session_id: f.sessionId,
      transcript_path: path.join(f.root, `${f.sessionId}.jsonl`), prompt_id: randomUUID(), prompt: "取消旧动作" });
    return change(id, mutate);
  };
  const result = await recordConfirmationResult({ ...options, receipt: claimed.receipt.id, state: "started" });
  assert.equal(result.recorded, false);
  assert.equal(f.store.read().request.execution, undefined);
  assert.notEqual(f.store.read().lastHumanMessageId, f.store.read().request.baselineMessageId);
  assert.equal((await worker).state, "consumed");
});

test("已开始的动作遇到新消息后仍可据实记为中断，不能重复开始", async t => {
  const f = fixture(t);
  const prepared = await f.prepare(1);
  const options = { store: f.store, client: f.client, platform: f.platform, requestId: prepared.requestId };
  const worker = waitFormalConfirmation(options); f.finish();
  await until(() => f.store.read().request.state === "queued");
  const claimed = await claimFormalConfirmation(options);
  const record = state => recordConfirmationResult({ ...options, receipt: claimed.receipt.id, state });
  assert.equal((await record("started")).recorded, true);
  f.store.update(state => { state.generation += 1; state.lastHumanMessageId = "new-human"; return state; });
  assert.equal((await record("interrupted")).recorded, true);
  assert.equal(f.store.read().request.execution.state, "interrupted");
  assert.equal((await record("started")).recorded, false);
  assert.equal((await worker).state, "consumed");
});

test("未完整展示、任务材料变化或输入材料变化均拒绝旧默认动作", async t => {
  for (const kind of ["display", "task", "input", "state"]) {
    const f = fixture(t);
    const prepared = await f.prepare(1);
    if (kind === "display") f.client.assistantText = async () => "没有展示正文或默认动作";
    if (kind === "task") writeFileSync(path.join(f.root, f.task, "prd.md"), "修改后的范围");
    if (kind === "input") { f.material.manualOnly = true; f.save(); }
    if (kind === "state") f.store.change(prepared.requestId, request => { request.contract.frozen.plan.task = "伪造上下文"; });
    const worker = waitFormalConfirmation({ store: f.store, client: f.client, platform: f.platform, requestId: prepared.requestId });
    f.finish();
    assert.equal((await worker).state, "failed");
    assert.equal(f.client.added.length, 0);
  }
});

test("排队后新人工输入或显式取消仍阻止领取", async t => {
  for (const cancel of [false, true]) {
    const f = fixture(t);
    const prepared = await f.prepare(1);
    const options = { store: f.store, client: f.client, platform: f.platform, requestId: prepared.requestId };
    const worker = waitFormalConfirmation(options); f.finish();
    await until(() => f.store.read().request.state === "queued");
    if (cancel) await cancelConfirmation({ store: f.store });
    else { f.client.humanId = "new-user"; f.client.emit("human", { id: f.client.humanId }); }
    assert.equal((await claimFormalConfirmation(options)).claimed, false);
    assert.equal((await worker).state, "cancelled");
  }
});

test("冻结窗口在派发或领取时失效均拒绝旧动作，恢复不能迁移绑定", async t => {
  for (const stage of ["dispatch", "claim"]) {
    const f = fixture(t);
    const prepared = await f.prepare(1);
    const options = { store: f.store, client: f.client, platform: f.platform, requestId: prepared.requestId };
    const worker = waitFormalConfirmation(options);
    f.finish();
    await until(() => f.store.read().request.state === (stage === "claim" ? "queued" : "waiting"));
    f.client.verifyWindow = async () => { throw new Error("原前台窗口已经失效"); };
    if (stage === "claim") await assert.rejects(claimFormalConfirmation(options), /原前台/);
    assert.equal((await worker).state, "failed");
    assert.equal(f.store.read().request.execution, undefined);
  }
});

test("worker 观察到原窗口退出会取消排队请求，迟到提醒不能领取", async t => {
  const f = fixture(t);
  const prepared = await f.prepare(1);
  const options = { store: f.store, client: f.client, platform: f.platform, requestId: prepared.requestId };
  const worker = waitFormalConfirmation(options);
  f.finish();
  await until(() => f.store.read().request.state === "queued");
  f.client.failure = new Error("frontend_exited");
  f.client.emit("disconnect", f.client.failure);
  assert.equal((await worker).state, "cancelled");
  assert.equal((await claimFormalConfirmation(options)).claimed, false);
});

test("两端 Check 到期领取完整报告与全部处置，默认动作只进入修复流程一次", async t => {
  for (const platform of ["codex", "claude"]) {
    const f = fixture(t, platform);
    Object.assign(f.material, { kind: "check", body: "完整报告：CHK-001 待修复；FBK-002 已接受；DOC-003 已同步。",
      reportVersion: "report-1", dispositionVersion: "disposition-1",
      findings: [{ id: "CHK-001", status: "pending" }, { id: "FBK-002", status: "accepted" }, { id: "DOC-003", status: "resolved" }] });
    f.save();
    f.client.snapshot = async () => ({ humanId: f.client.humanId, turn: f.client.turn, runId: f.client.runId,
      wake: { requestId: f.store.read()?.request?.id, turnId: f.client.turn.id },
      notification: { requestId: f.store.read()?.request?.id, taskId: f.store.read()?.request?.queueId } });
    const prepared = await f.prepare(1);
    const options = { store: f.store, client: f.client, platform, requestId: prepared.requestId };
    const worker = waitFormalConfirmation(options);
    f.finish();
    await until(() => f.store.read().request.state === "queued");
    const claimed = await claimFormalConfirmation(options);
    assert.equal(claimed.action, "repair_all_and_recheck");
    assert.equal(claimed.context.body, f.material.body);
    assert.deepEqual(claimed.context.findings, f.material.findings);
    assert.equal((await claimFormalConfirmation(options)).claimed, false);
    assert.equal((await recordConfirmationResult({ ...options, receipt: claimed.receipt.id, state: "started" })).recorded, true);
    assert.equal((await recordConfirmationResult({ ...options, receipt: claimed.receipt.id, state: "completed" })).recorded, true);
    assert.equal((await worker).state, "consumed");
  }
});

test("准备时的新输入与领取时的非内部消息不能取得许可", async t => {
  const f = fixture(t);
  f.client.captureWindow = async () => {
    f.store.update(state => { state.generation += 1; return state; });
    return { version: 1, pid: 123 };
  };
  await assert.rejects(f.prepare(1), /代次已变化/);
  assert.equal(f.store.read().request, null);
  f.client.captureWindow = async () => ({ version: 1, pid: 123 });
  const prepared = await f.prepare(1);
  const options = { store: f.store, client: f.client, platform: f.platform, requestId: prepared.requestId };
  const worker = waitFormalConfirmation(options);
  f.finish();
  await until(() => f.store.read().request.state === "queued");
  f.client.snapshot = async () => ({ humanId: f.client.humanId, turn: f.client.turn });
  await assert.rejects(claimFormalConfirmation(options), /原生队列消息/);
  assert.equal((await worker).state, "failed");
});

test("Push 快照绑定真实 HEAD、索引、目标内容、模式和远端配置", t => {
  const f = fixture(t);
  const git = args => execFileSync("git", ["-C", f.root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git(["init", "--quiet", "--initial-branch=main"]);
  git(["config", "user.name", "确认测试"]); git(["config", "user.email", "confirmation@example.invalid"]);
  writeFileSync(path.join(f.root, "file.txt"), "before\n");
  git(["add", "."]); git(["commit", "--quiet", "-m", "fixture"]);
  Object.assign(f.material, { kind: "push", body: "完整精确 Git 计划", mode: "commit-only", evidence: { check: "passed", spec: "no-op", unresolvedRisks: 0 }, repositories: [{ root: ".", branch: "main", head: git(["rev-parse", "HEAD"]), upstream: null, files: ["file.txt"], message: "本次提交" }] }); f.save();
  const before = f.inspect();
  assert.equal(before.seconds, 200);
  writeFileSync(path.join(f.root, "file.txt"), "after\n");
  assert.notEqual(f.inspect().materialHash, before.materialHash);
  const changed = f.inspect(); git(["add", "file.txt"]);
  assert.notEqual(f.inspect().materialHash, changed.materialHash);
  f.material.repositories[0].files = ["../outside"]; f.save();
  assert.throws(() => f.inspect(), /路径/);
});

test("commit-only 领取保留原模式，隔离 owner 只提交精确文件且不推进远端", async t => {
  const f = fixture(t);
  const git = args => execFileSync("git", ["-C", f.root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git(["init", "--quiet", "--initial-branch=main"]);
  git(["config", "user.name", "确认测试"]); git(["config", "user.email", "confirmation@example.invalid"]);
  writeFileSync(path.join(f.root, "file.txt"), "before\n");
  git(["add", "."]); git(["commit", "--quiet", "-m", "fixture"]);
  const baseline = git(["rev-parse", "HEAD"]);
  const remote = path.join(f.root, ".trellis/.runtime/remote.git");
  git(["init", "--bare", "--quiet", remote]);
  git(["remote", "add", "origin", remote]); git(["push", "--quiet", "-u", "origin", "main"]);
  writeFileSync(path.join(f.root, "file.txt"), "after\n");
  Object.assign(f.material, { kind: "push", body: "仅提交 file.txt，不推送。", mode: "commit-only",
    evidence: { check: "passed", spec: "no-op", unresolvedRisks: 0 },
    repositories: [{ root: ".", branch: "main", head: baseline, upstream: "origin/main", files: ["file.txt"], message: "本次提交" }] });
  f.save();
  const prepared = await f.prepare(1);
  const options = { store: f.store, client: f.client, platform: f.platform, requestId: prepared.requestId };
  const worker = waitFormalConfirmation(options); f.finish();
  await until(() => f.store.read().request.state === "queued");
  const claimed = await claimFormalConfirmation(options);
  assert.equal(claimed.claimed, true);
  assert.equal(claimed.context.mode, "commit-only");
  assert.equal((await recordConfirmationResult({ ...options, receipt: claimed.receipt.id, state: "started" })).recorded, true);
  const plan = claimed.context.repositories[0];
  // 模拟既有 owner 消费冻结计划；共享确认运行时本身不执行任何 Git 副作用。
  git(["add", "--", ...plan.files]); git(["commit", "--quiet", "--only", "-m", plan.message, "--", ...plan.files]);
  if (claimed.context.mode === "push") git(["push", "origin", "main"]);
  assert.notEqual(git(["rev-parse", "HEAD"]), baseline);
  assert.equal(git(["--git-dir", remote, "rev-parse", "refs/heads/main"]), baseline);
  assert.equal(git(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]), "file.txt");
  assert.equal((await recordConfirmationResult({ ...options, receipt: claimed.receipt.id, state: "completed" })).recorded, true);
  assert.equal((await worker).state, "consumed");
});

test("真实 CLI 帮助先于依赖、目标校验及写盘，空状态不创建运行记录", t => {
  const root = mkdtempSync(path.join(tmpdir(), "flower-confirm-help-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [path.join(ROOT, "bin/flower-trellis.js"), "confirm", "--help", "--target", path.join(root, "missing")], { encoding: "utf8", env: { ...process.env, FLOWER_NO_TELEMETRY: "1" } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /自|原生后台|后台超时/);
  assert.deepEqual(readdirSync(root), []);
});

for (const removed of [false, true]) test(`真实 CLI 收到 SIGINT 后退出 130${removed ? "，卸载后的清理不重建目录" : "，先取消等待再退出"}`, { skip: process.platform !== "linux" }, async t => {
  const f = fixture(t, "claude");
  const promptId = randomUUID();
  const transcript = path.join(f.root, `${f.sessionId}.jsonl`);
  writeFileSync(transcript, JSON.stringify({ type: "user", sessionId: f.sessionId, promptId,
    origin: { kind: "human" }, turnOrigin: "human", message: { content: "确认信号夹具" } }) + "\n");
  recordClaudeConfirmationEvent({ hook_event_name: "UserPromptSubmit", cwd: f.root, session_id: f.sessionId,
    transcript_path: transcript, prompt_id: promptId, prompt: "确认信号夹具" });
  const client = new ClaudeConfirmationClient({ project: f.root, sessionId: f.sessionId });
  t.after(() => client.close());
  await client.connect();
  const prepared = await prepareFormalConfirmation({ store: f.store, client, input: f.input, platform: "claude", seconds: 30 });
  const child = spawn(process.execPath, [path.join(ROOT, "bin/flower-trellis.js"), ...(!removed ? ["--target", f.root] : []), "confirm", "wait", "--platform", "claude", "--session", f.sessionId, "--request", prepared.requestId, ...(removed ? ["--target", f.root] : [])], { env: { ...process.env, CLAUDE_CODE_SESSION_ID: f.sessionId, FLOWER_NO_TELEMETRY: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", bytes => { output += bytes; });
  const exited = new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", code => resolve(code)); });
  t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
  await until(() => output.includes('"event":"prepared"'));
  if (removed) {
    // 暂停自有子进程后卸载，确保信号清理看到缺失状态，不依赖 50ms 轮询的偶然顺序。
    child.kill("SIGSTOP");
    await until(() => readFileSync(`/proc/${child.pid}/stat`, "utf8").split(") ").at(-1).startsWith("T "));
    rmSync(path.join(f.root, ".trellis"), { recursive: true });
  }
  child.kill("SIGINT");
  if (removed) child.kill("SIGCONT");
  assert.equal(await exited, 130);
  if (removed) assert.equal(readdirSync(f.root).includes(".trellis"), false);
  else assert.equal(f.store.read().request.state, "cancelled");
});
