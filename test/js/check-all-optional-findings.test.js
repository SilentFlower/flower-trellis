import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceRoot = path.join(projectRoot, "vendor/skill-garden/.trellis/0.6");
const snapshotRoot = path.join(projectRoot, "enhancements/0.6");

/**
 * 读取指定根目录中的 UTF-8 文本文件。
 *
 * @param {string} root 文件根目录。
 * @param {string} relativePath 相对文件路径。
 * @returns {string} 文件文本。
 */
function read(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("Check-All 先分类必修与可选，再为 CHK 分配严重度", () => {
  const agents = read(
    sourceRoot,
    ".agents/skills/trellis-check-all/references/optional-findings.md",
  );
  const claude = read(
    sourceRoot,
    ".claude/skills/trellis-check-all/references/optional-findings.md",
  );

  assert.equal(agents, claude);
  assert.match(agents, /分类发生在严重度评估之前/);
  assert.match(agents, /判定为 `CHK-\*` 后，再根据当前实际影响分配 P0\/P1\/P2/);
  assert.match(agents, /最初标为 P1.*极端场景的假设后果.*重新分类为 `OPT-\*`/s);
  assert.match(agents, /P2 同样不能自动视为可选/);
  assert.match(agents, /没有失败的 lint、typecheck、测试或其它验证证据/);
  assert.match(agents, /安全、权限、隐私、数据完整性或数据破坏风险/);
  assert.match(agents, /证据不足时 fail closed/);
  assert.match(agents, /只有 `OPT-\*` 时 Check-All 仍可严格通过/);
  assert.match(agents, /`修复全部` 只覆盖 `CHK-\*`/);
});

test("统一报告独立展示 OPT 且 optional-only 不阻断完成链", () => {
  const agents = read(
    sourceRoot,
    ".agents/skills/trellis-check-all/references/reporting-and-disposition.md",
  );
  const claude = read(
    sourceRoot,
    ".claude/skills/trellis-check-all/references/reporting-and-disposition.md",
  );
  const light = read(
    sourceRoot,
    ".agents/skills/trellis-check-all/references/light-profile.md",
  );
  const full = read(
    sourceRoot,
    ".agents/skills/trellis-check-all/references/full-profile.md",
  );

  assert.equal(agents, claude);
  assert.match(agents, /CHK <N> · OPT <N> · 自动修复 DOC <N>/);
  assert.match(agents, /### 可选改进/);
  assert.match(agents, /为什么可选/);
  assert.match(agents, /收益/);
  assert.match(agents, /`修复全部`（仅 CHK）/);
  assert.match(agents, /`修复全部可选项`/);
  assert.match(agents, /只有 `OPT-\*` 时总体状态为通过/);
  assert.match(agents, /只有 `OPT-\*` 时不回到 `implement`/);
  assert.match(agents, /只有 `OPT-\*` 时不进入 fix\/recheck，也不消耗预算/);
  assert.match(agents, /允许存在合规 `OPT-\*` 和已成功验证的 `DOC-\*`/);
  assert.match(agents, /主动作仍是 `继续`/);
  assert.match(light, /允许存在满足准入条件并已完整展示的 `OPT-\*`/);
  assert.match(full, /允许存在满足准入条件并已完整展示的 `OPT-\*`/);
});

test("route、专用 agent、workflow 与 push 使用相同的非阻断 OPT 语义", () => {
  const routeAgents = read(sourceRoot, ".agents/skills/trellis-route/SKILL.md");
  const routeClaude = read(sourceRoot, ".claude/skills/trellis-route/SKILL.md");
  const agentBody = read(
    sourceRoot,
    ".agents/skills/trellis-route/references/check-all-agent-body.md",
  );
  const workflow = read(
    sourceRoot,
    "overrides/patches/workflow/phase-ownership/phase-2-check-content.md",
  );
  const pushAgents = read(sourceRoot, ".agents/skills/trellis-push/SKILL.md");
  const pushClaude = read(sourceRoot, ".claude/skills/trellis-push/SKILL.md");

  assert.equal(routeAgents, routeClaude);
  assert.equal(pushAgents, pushClaude);
  assert.match(routeAgents, /`CHK-\*` \/ `OPT-\*` \/ `DOC-\*`/);
  assert.match(routeAgents, /历史 P1 只有假设后果.*重新分类为 `OPT-\*`/s);
  assert.match(agentBody, /Classify findings before severity/);
  assert.match(agentBody, /historical P1 based only on hypothetical impact may become `OPT-\*`/);
  assert.match(workflow, /zero blocking `CHK-\*` findings/);
  assert.match(workflow, /Eligible `OPT-\*` items do not block this path/);
  assert.match(pushAgents, /只有合规 `OPT-\*` 的报告仍标记为 `通过`/);
  assert.match(pushAgents, /合规 `OPT-\*` 不单独把状态降为风险/);
});

test("0.6 发布快照包含相同的 OPT 问题模型", () => {
  const paths = [
    ".agents/skills/trellis-check-all/SKILL.md",
    ".agents/skills/trellis-check-all/references/optional-findings.md",
    ".agents/skills/trellis-check-all/references/reporting-and-disposition.md",
    ".agents/skills/trellis-check-all/references/light-profile.md",
    ".agents/skills/trellis-check-all/references/full-profile.md",
    ".agents/skills/trellis-route/SKILL.md",
    ".agents/skills/trellis-route/references/check-all-agent-body.md",
    ".agents/skills/trellis-push/SKILL.md",
    ".claude/skills/trellis-check-all/SKILL.md",
    ".claude/skills/trellis-check-all/references/optional-findings.md",
    ".claude/skills/trellis-check-all/references/reporting-and-disposition.md",
    ".claude/skills/trellis-check-all/references/light-profile.md",
    ".claude/skills/trellis-check-all/references/full-profile.md",
    ".claude/skills/trellis-route/SKILL.md",
    ".claude/skills/trellis-push/SKILL.md",
    "overrides/patches/workflow/phase-ownership/phase-2-check-content.md",
  ];

  for (const relativePath of paths) {
    assert.equal(read(snapshotRoot, relativePath), read(sourceRoot, relativePath), relativePath);
  }
});

test("当前 dogfood 入口已经应用 OPT 问题模型", () => {
  const exactPaths = [
    ".agents/skills/trellis-check-all/SKILL.md",
    ".agents/skills/trellis-check-all/references/optional-findings.md",
    ".agents/skills/trellis-check-all/references/reporting-and-disposition.md",
    ".agents/skills/trellis-route/SKILL.md",
    ".agents/skills/trellis-route/references/check-all-agent-body.md",
    ".agents/skills/trellis-push/SKILL.md",
    ".claude/skills/trellis-check-all/SKILL.md",
    ".claude/skills/trellis-check-all/references/optional-findings.md",
    ".claude/skills/trellis-check-all/references/reporting-and-disposition.md",
    ".claude/skills/trellis-route/SKILL.md",
    ".claude/skills/trellis-push/SKILL.md",
  ];

  for (const relativePath of exactPaths) {
    assert.equal(read(projectRoot, relativePath), read(sourceRoot, relativePath), relativePath);
  }

  const sharedAgentBody = read(
    sourceRoot,
    ".agents/skills/trellis-route/references/check-all-agent-body.md",
  );
  assert.equal(
    read(projectRoot, ".claude/skills/trellis-route/references/check-all-agent-body.md"),
    sharedAgentBody,
  );

  for (const relativePath of [
    ".trellis/agents/check-all.md",
    ".claude/agents/trellis-check-all.md",
    ".codex/agents/trellis-check-all.toml",
  ]) {
    const agent = read(projectRoot, relativePath);
    assert.match(agent, /OPT-\*/);
    assert.match(agent, /P0\/P1\/P2 only after|P0\/P1\/P2 只在|只为 `CHK-\*` 分配 P0\/P1\/P2/);
  }

  const workflow = read(projectRoot, ".trellis/workflow.md");
  assert.match(workflow, /zero blocking `CHK-\*` findings/);
  assert.match(workflow, /Eligible `OPT-\*` items do not block this path/);
});
