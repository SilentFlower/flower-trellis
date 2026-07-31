import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { copyScriptAssets } from "../../src/lib/copy-scripts.js";


const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceRoot = path.join(projectRoot, "vendor/skill-garden/.trellis/0.6");
const snapshotRoot = path.join(projectRoot, "enhancements/0.6");


function read(root, relativePath) {
  return fs.readFileSync(path.join(root, ...relativePath.split("/")), "utf8");
}


test("Pre-Check workflow 默认检查、软暂缓与 auto-loop 优先级完整", () => {
  const hub = read(sourceRoot, "overrides/patches/workflow/hub/content.md");
  const implement = read(
    sourceRoot,
    "overrides/patches/workflow/phase-ownership/phase-2-implement-content.md",
  );
  const check = read(
    sourceRoot,
    "overrides/patches/workflow/phase-ownership/phase-2-check-content.md",
  );
  const state = read(
    sourceRoot,
    "overrides/patches/workflow/states-in-progress/common-content.md",
  );
  const route = read(sourceRoot, ".agents/skills/trellis-route/SKILL.md");

  assert.match(hub, /A validated auto-loop result returns through matching `record` \+ `next` before the interactive post-check stop applies/);
  assert.match(implement, /validated auto-loop outstanding action wins/);
  assert.match(implement, /hold --source follow-up-edit/);
  assert.match(implement, /whether it passed cleanly or reported findings/);
  assert.doesNotMatch(implement, /already passed Check-All once/);
  assert.match(implement, /immediately enter `trellis-route\(target=check\)`/);
  assert.match(implement, /Do not end the turn by presenting Check-All as an optional next step/);
  assert.match(implement, /do not ask a binary question or use closure jargon/);
  assert.match(
    implement,
    /你可以继续提修改；准备检查时，使用 check-all，也可以直接说“下一步”或“可以检查了”。/,
  );
  assert.match(check, /pre_check_state\.py clear/);
  assert.match(check, /damaged runtime.*safely defaults to checking/);
  assert.doesNotMatch(state, /pre_check_state\.py|Pre-Check hold/);
  assert.match(state, /return to the Phase 2\.1 completion contract/);
  assert.match(route, /implement 路由只决定执行位置，不拥有实现后的停止策略/);
  assert.match(route, /返回 workflow Phase 2\.1 的 completion contract/);
});


test("SessionStart Patch 仅通过 helper 条件恢复 hold", () => {
  const declaration = JSON.parse(
    read(sourceRoot, "overrides/patches/hooks/session-start/pre-check-hold/patch.json"),
  );
  const codex = read(
    sourceRoot,
    "overrides/patches/hooks/session-start/pre-check-hold/codex-content.py",
  );
  const claude = read(
    sourceRoot,
    "overrides/patches/hooks/session-start/pre-check-hold/claude-content.py",
  );

  assert.deepEqual(
    declaration.operations.map((operation) => operation.id),
    ["codex-session-start-pre-check-hold", "claude-session-start-pre-check-hold"],
  );
  assert.match(codex, /from pre_check_state import session_start_hint/);
  assert.match(claude, /from pre_check_state import session_start_hint/);
  assert.match(codex, /if pre_check_hint:\n        lines\.append\(pre_check_hint\)/);
  assert.match(claude, /if pre_check_hint:\n        lines\.append\(pre_check_hint\)/);
});


test("auto-loop 启动和恢复清除交互 hold，runner 不读取该状态", () => {
  const agents = read(sourceRoot, ".agents/skills/trellis-auto-loop/SKILL.md");
  const claude = read(sourceRoot, ".claude/skills/trellis-auto-loop/SKILL.md");
  const runner = read(sourceRoot, "scripts/auto_loop.py");

  assert.equal(agents, claude);
  assert.match(agents, /启动或恢复前静默清除交互式 pre-check hold/);
  assert.ok((agents.match(/pre_check_state\.py clear/g) || []).length >= 1);
  assert.match(agents, /损坏诊断不阻断 runner/);
  assert.doesNotMatch(runner, /pre_check_(state|preference)/);
});


test("选择性 workflow 和 auto-loop 安装都会携带 pre-check helper", () => {
  for (const skill of ["workflow-enhancement", "task-intent", "auto-loop", "trellis-auto-loop"]) {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), "flower-pre-check-copy-"));
    const variant = path.join(target, "variant");
    fs.mkdirSync(path.join(variant, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(variant, "scripts/pre_check_state.py"), "# helper\n");

    const result = copyScriptAssets(target, variant, [skill]);

    assert.deepEqual(result.installed, ["script:pre_check_state.py"], skill);
    assert.equal(
      fs.existsSync(path.join(target, ".trellis/scripts/pre_check_state.py")),
      true,
      skill,
    );
  }
});


test("选择性 auto-loop 和 finish-work 安装都会携带 decision log helper", () => {
  for (const skill of ["auto-loop", "trellis-auto-loop", "finish-work", "trellis-finish-work"]) {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), "flower-decision-log-copy-"));
    const variant = path.join(target, "variant");
    fs.mkdirSync(path.join(variant, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(variant, "scripts/decision_log.py"), "# helper\n");

    const result = copyScriptAssets(target, variant, [skill]);

    assert.deepEqual(result.installed, ["script:decision_log.py"], skill);
    assert.equal(
      fs.existsSync(path.join(target, ".trellis/scripts/decision_log.py")),
      true,
      skill,
    );
  }
});


test("0.6 发布快照与 Pre-Check 源保持一致", () => {
  const paths = [
    "scripts/pre_check_state.py",
    "overrides/bundles/intent-routing.json",
    "overrides/patches/hooks/session-start/pre-check-hold/patch.json",
    "overrides/patches/hooks/session-start/pre-check-hold/codex-selector.py",
    "overrides/patches/hooks/session-start/pre-check-hold/codex-content.py",
    "overrides/patches/hooks/session-start/pre-check-hold/claude-selector.py",
    "overrides/patches/hooks/session-start/pre-check-hold/claude-content.py",
    "overrides/patches/workflow/hub/content.md",
    "overrides/patches/workflow/phase-ownership/phase-2-implement-content.md",
    "overrides/patches/workflow/phase-ownership/phase-2-check-content.md",
    "overrides/patches/workflow/states-in-progress/common-content.md",
    ".agents/skills/trellis-auto-loop/SKILL.md",
    ".claude/skills/trellis-auto-loop/SKILL.md",
  ];

  for (const relativePath of paths) {
    assert.equal(read(snapshotRoot, relativePath), read(sourceRoot, relativePath), relativePath);
  }
});
