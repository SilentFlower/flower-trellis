import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { flowerVersion } from "../../src/lib/versions.js";
import { createPluginTestRoot } from "./plugin-test-helpers.js";
import { runFlower, snapshotProjectFiles } from "./plugin-e2e-helpers.js";

test("真实升级后提交并克隆的项目复用启动 hook 引导安装", { skip: process.platform === "win32" }, (t) => {
  const workspace = createPluginTestRoot(t, "flower-e2e-team-clone-");
  const project = path.join(workspace, "project");
  fs.mkdirSync(project);
  const initial = runFlower(project, ["init", "-y", "--codex", "--no-update-check"], { timeout: 60_000 });
  assert.equal(initial.status, 0, initial.stderr);
  fs.writeFileSync(path.join(project, ".gitignore"), ".flower/\n");
  fs.writeFileSync(path.join(project, ".trellis/.flower-manifest.json"), '{"flowerVersion":"0.1.0","paths":[]}\n');
  const updated = runFlower(project, ["update", "--enhance-only", "-y", "--no-update-check"], { timeout: 60_000 });
  assert.equal(updated.status, 0, `${updated.stdout}\n${updated.stderr}`);
  execFileSync("git", ["init", "-q"], { cwd: project });
  execFileSync("git", ["add", "."], { cwd: project });
  execFileSync("git", ["-c", "user.name=Flower Test", "-c", "user.email=flower@example.invalid", "-c", "commit.gpgSign=false", "commit", "-qm", "fixture"], { cwd: project });
  const clone = path.join(workspace, "clone");
  execFileSync("git", ["clone", "-q", "--no-hardlinks", project, clone]);
  assert.ok(fs.existsSync(path.join(clone, ".flower/plugin-lock.json")));
  assert.ok(fs.existsSync(path.join(clone, ".flower/plugins.json")));
  assert.equal(fs.existsSync(path.join(clone, ".flower/state.json")), false);
  assert.equal(fs.existsSync(path.join(clone, ".trellis/.flower-manifest.json")), false);
  const bin = path.join(workspace, "bin");
  fs.mkdirSync(bin);
  fs.symlinkSync(process.execPath, path.join(bin, "node"));
  fs.writeFileSync(path.join(bin, "npm"), "#!/bin/sh\nexit 99\n", { mode: 0o755 });
  const python = execFileSync("python3", ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" }).trim();
  const env = { ...process.env, PATH: bin, CLAUDE_PROJECT_DIR: clone, CODEX_PROJECT_DIR: clone, TRELLIS_HOOKS: "1", TRELLIS_DISABLE_HOOKS: "0", CODEX_NON_INTERACTIVE: "0" };
  const invoke = (args = []) => spawnSync(python, [path.join(clone, ".trellis/scripts/flower_update_hook.py"), ...args], { cwd: clone, input: JSON.stringify({ cwd: clone }), encoding: "utf8", env, timeout: 10_000 });
  const before = snapshotProjectFiles(clone);
  const missing = invoke();
  assert.equal(missing.status, 0, missing.stderr);
  const context = JSON.parse(missing.stdout).hookSpecificOutput.additionalContext;
  assert.ok(context.includes(`npm install -g flower-trellis@${flowerVersion()}`));
  assert.match(context, /确认前禁止执行/);
  assert.match(context, /<flower-cli-bootstrap>/);
  assert.deepEqual(snapshotProjectFiles(clone), before);
  const lockPath = path.join(clone, ".flower/plugin-lock.json");
  const originalLock = fs.readFileSync(lockPath, "utf8");
  for (const reference of [[], {}]) {
    const invalidLock = JSON.parse(originalLock);
    invalidLock.plugins.find(({ id }) => id === "flower/skill-garden").source.reference = reference;
    fs.writeFileSync(lockPath, JSON.stringify(invalidLock));
    for (const args of [[], ["--bootstrap-only", "--target", clone]]) {
      const beforeInvalid = snapshotProjectFiles(clone);
      const invalid = invoke(args);
      assert.equal(invalid.status, 0, invalid.stderr);
      assert.equal(invalid.stderr, "");
      const diagnostic = JSON.parse(invalid.stdout).hookSpecificOutput.additionalContext;
      assert.match(diagnostic, /status: project_version_unavailable/);
      assert.match(diagnostic, /请维护者补齐有效项目锁/);
      assert.doesNotMatch(diagnostic, /recommended_command:|npm install/);
      assert.deepEqual(snapshotProjectFiles(clone), beforeInvalid);
    }
  }
  fs.writeFileSync(lockPath, originalLock);
  // 模拟成员已完成外部安装，下一次启动必须回到原有 self-check 分支。
  fs.writeFileSync(path.join(bin, "flower-trellis"), '#!/bin/sh\nprintf \'{"status":"up_to_date"}\\n\'\n', { mode: 0o755 });
  const installed = invoke();
  assert.equal(installed.status, 0, installed.stderr);
  assert.equal(installed.stdout, "");
});

test("真实完整 init 创建 Trellis 并默认锁定 skill-garden", (t) => {
  const workspace = createPluginTestRoot(t, "flower-e2e-full-init-");
  const project = path.join(workspace, "project");
  fs.mkdirSync(project);
  const result = runFlower(project, [
    "init", "-y", "--codex", "--no-update-check",
  ], { timeout: 60_000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(fs.existsSync(path.join(project, ".trellis")), true);
  assert.equal(fs.existsSync(path.join(
    workspace,
    ".flower-e2e-env/config/flower-trellis/telemetry.json",
  )), false);
  const lock = JSON.parse(fs.readFileSync(path.join(project, ".flower/plugin-lock.json"), "utf8"));
  assert.deepEqual(lock.roots, ["flower/skill-garden"]);
  assert.equal(lock.plugins[0].id, "flower/skill-garden");

  const sessionContext = fs.readFileSync(
    path.join(project, ".trellis/scripts/common/session_context.py"),
    "utf8",
  );
  assert.doesNotMatch(sessionContext, /def _get_update_hint\(/);
  assert.doesNotMatch(sessionContext, /def _mark_update_check_attempted\(/);
  assert.doesNotMatch(sessionContext, /def _update_marker_path\(/);
  assert.doesNotMatch(sessionContext, /\["trellis", "--version"\]/);
});

test("真实完整 init 将 Flower 识别的 Git 身份透传给 Trellis", (t) => {
  const workspace = createPluginTestRoot(t, "flower-e2e-developer-");
  const project = path.join(workspace, "project");
  fs.mkdirSync(project);
  const result = runFlower(project, [
    "init", "-y", "--codex", "--no-update-check",
  ], {
    timeout: 60_000,
    env: {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "user.name",
      GIT_CONFIG_VALUE_0: "huajiwuyan",
    },
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(fs.readFileSync(path.join(project, ".trellis/.developer"), "utf8"), /^name=huajiwuyan$/m);
  assert.match(result.stdout, /Plugin add 完成，目标变化 \d+ 项/);
  assert.doesNotMatch(result.stdout, /^\s+(?:write|patch|remove) /m);
  assert.match(result.stdout, /flower-trellis init 安装成功/);
});

test("真实完整 init 支持 Windows 风格 Python 命令渲染", (t) => {
  for (const [slug, command] of [["python", "python"], ["py-launcher", "py -3"]]) {
    const workspace = createPluginTestRoot(t, `flower-e2e-${slug}-`);
    const project = path.join(workspace, "project");
    fs.mkdirSync(project);
    const result = runFlower(project, [
      "init", "-y", "--codex", "--no-update-check",
    ], {
      timeout: 60_000,
      env: { TRELLIS_PYTHON_CMD: command },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

    const workflow = fs.readFileSync(path.join(project, ".trellis/workflow.md"), "utf8");
    const hooks = fs.readFileSync(path.join(project, ".codex/hooks.json"), "utf8");
    assert.ok(workflow.includes(`${command} ./.trellis/scripts/`));
    assert.ok(hooks.includes(`${command} -X utf8 .codex/hooks/`));
    assert.doesNotMatch(workflow, /python3 \.\/\.trellis\/scripts\//);
  }
});

test("enhance-only init 默认安装 skill-garden 并迁移旧 manifest", (t) => {
  const workspace = createPluginTestRoot(t, "flower-e2e-migration-");
  const project = path.join(workspace, "project");
  fs.mkdirSync(path.join(project, ".trellis"), { recursive: true });
  fs.mkdirSync(path.join(project, ".claude/skills"), { recursive: true });
  fs.mkdirSync(path.join(project, ".agents"), { recursive: true });
  fs.writeFileSync(path.join(project, ".trellis/.version"), "0.5.9\n");
  const initArgs = [
    "init", "--enhance-only", "--variant", "0.5",
    "--skills", "trellis-route", "-y", "--no-update-check",
  ];
  const initial = runFlower(project, initArgs, { timeout: 60_000 });
  assert.equal(initial.status, 0, `${initial.stdout}\n${initial.stderr}`);
  const plugins = JSON.parse(fs.readFileSync(path.join(project, ".flower/plugins.json"), "utf8"));
  assert.deepEqual(plugins.plugins.map(({ id }) => id), ["flower/skill-garden"]);

  fs.rmSync(path.join(project, ".flower"), { recursive: true, force: true });
  const legacy = {
    flowerVersion: flowerVersion(),
    variant: "0.5",
    version: "0.5.9",
    skills: ["trellis-route"],
    paths: [".claude/skills/trellis-route"],
  };
  const legacyPath = path.join(project, ".trellis/.flower-manifest.json");
  const legacyText = `${JSON.stringify(legacy, null, 2)}\n`;
  fs.writeFileSync(legacyPath, legacyText);

  const migration = runFlower(project, initArgs, { timeout: 60_000 });
  assert.equal(migration.status, 0, `${migration.stdout}\n${migration.stderr}`);
  const state = JSON.parse(fs.readFileSync(path.join(project, ".flower/state.json"), "utf8"));
  assert.deepEqual(state.migration, { source: "legacy-flower-manifest", schemaVersion: 1 });
  assert.equal(fs.existsSync(legacyPath), false);

  const beforeReplay = snapshotProjectFiles(project);
  const replay = runFlower(project, initArgs, { timeout: 60_000 });
  assert.equal(replay.status, 0, `${replay.stdout}\n${replay.stderr}`);
  assert.deepEqual(snapshotProjectFiles(project), beforeReplay);
});
