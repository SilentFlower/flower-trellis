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
  assert.match(hook, /确认前禁止执行 recommended_command/);
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
