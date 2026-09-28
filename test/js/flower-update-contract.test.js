import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("Flower 更新完成后必须加载 trellis-push", () => {
  const command = read("src/commands/self-update.js");
  const hook = read("src/assets/flower_update_hook.py");
  const sourceWorkflow = read(
    "vendor/skill-garden/.trellis/0.6/overrides/patches/workflow/hub/content.md",
  );
  const snapshotWorkflow = read(
    "enhancements/0.6/overrides/patches/workflow/hub/content.md",
  );

  assert.match(command, /必须先加载并遵循 `trellis-push`/);
  assert.match(command, /不得用自行 Git 检查或手写计划替代/);
  assert.match(command, /post_action: "run_trellis_push_confirmation"/);
  assert.match(hook, /priority: blocking_confirmation_required/);
  assert.match(hook, /普通请求路由前/);
  assert.match(hook, /确认前禁止执行 recommended_command/);
  assert.match(hook, /执行 snooze_command/);
  assert.match(hook, /执行 skip_command/);
  assert.match(sourceWorkflow, /Flower Update Confirmation \| SessionStart update context \+ Flower CLI/);
  assert.doesNotMatch(sourceWorkflow, /load and follow\s+`trellis-push` before any Git inspection/);
  assert.equal(snapshotWorkflow, sourceWorkflow);
});

test("人工 Flower 更新入口不会进入 SessionStart hook", () => {
  const command = read("src/commands/self-update.js");
  const selfCheck = read("src/commands/self-check.js");
  const hook = read("src/assets/flower_update_hook.py");

  assert.match(hook, /"self-check",\s*"--json"/);
  assert.doesNotMatch(hook, /--manual/);
  assert.doesNotMatch(hook, /--ignore-prompt-suppression/);
  assert.match(command, /ignorePromptSuppression:\s*true/);
  assert.match(selfCheck, /recordPrompt:\s*!manual/);
});

test("trellis-flower-update 明确排除发版流程", () => {
  const skillPaths = [
    "vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-flower-update/SKILL.md",
    "vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-flower-update/SKILL.md",
    "enhancements/0.6/.agents/skills/trellis-flower-update/SKILL.md",
    "enhancements/0.6/.claude/skills/trellis-flower-update/SKILL.md",
  ];

  for (const skillPath of skillPaths) {
    const skill = read(skillPath);
    assert.match(skill, /已安装 Flower\/Trellis 强化包升级/);
    assert.match(skill, /不要用于用户说想发版/);
    assert.match(skill, /npm publish/);
    assert.match(skill, /不运行 `npm run release`/);
  }
});

test("批量升级由 Flower 流程精确本地提交，单项目仍使用 Trellis Push", () => {
  const sourceRoot = "vendor/skill-garden/.trellis/0.6";
  const snapshotRoot = "enhancements/0.6";
  const skillFiles = [
    ".agents/skills/trellis-flower-update/SKILL.md",
    ".claude/skills/trellis-flower-update/SKILL.md",
  ];

  for (const relativePath of skillFiles) {
    assert.equal(read(`${snapshotRoot}/${relativePath}`), read(`${sourceRoot}/${relativePath}`));
  }

  const updateSkill = read(`${sourceRoot}/.agents/skills/trellis-flower-update/SKILL.md`);
  const command = read("src/commands/update-all.js");

  assert.match(updateSkill, /dirty_worktree.*active_task.*not_git_repo/);
  assert.match(updateSkill, /单项目.*post_action: run_trellis_push_confirmation/);
  assert.match(updateSkill, /批量升级.*本地精确提交/);
  assert.match(updateSkill, /post_action: run_flower_batch_commit/);
  assert.match(updateSkill, /不进入 `trellis-push`，不逐仓重复询问/);
  assert.match(updateSkill, /保留其余 staged、未暂存和未跟踪变更/);
  assert.match(updateSkill, /除非用户另有明确授权，不推送/);
  assert.match(command, /post_action: run_flower_batch_commit/);
  assert.doesNotMatch(command, /run_trellis_push_confirmation/);
});
