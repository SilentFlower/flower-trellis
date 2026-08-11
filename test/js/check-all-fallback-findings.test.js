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

test("Check-All 按根因区分 CHK 与 FBK，并为两类问题分配严重度", () => {
  const agents = read(
    sourceRoot,
    ".agents/skills/trellis-check-all/references/fallback-findings.md",
  );
  const claude = read(
    sourceRoot,
    ".claude/skills/trellis-check-all/references/fallback-findings.md",
  );

  assert.equal(agents, claude);
  assert.match(agents, /分类发生在严重度评估之前/);
  assert.match(agents, /两类问题都根据当前实际影响分配 P0\/P1\/P2/);
  assert.match(agents, /fail-closed、异常输入、失败路径降级/);
  assert.match(agents, /即使 PRD、design、implement、spec 或公开契约已经要求某个兜底行为/);
  assert.match(agents, /该契约只用于加强证据、影响与严重度判断/);
  assert.match(agents, /具体位置/);
  assert.match(agents, /可达场景/);
  assert.match(agents, /问题证据/);
  assert.match(agents, /保护收益/);
  assert.match(agents, /验证方式/);
  assert.match(agents, /硬准入（缺一不可）/);
  assert.match(agents, /不要求异常已经在生产、测试或当前运行中实际发生/);
  assert.match(agents, /保护收益和验证方式继续作为报告完整度要求，不决定 `FBK-\*` 分类/);
  assert.match(agents, /缺少环境、工具或权限时仍保留 `FBK-\*` ID/);
  assert.doesNotMatch(agents, /每个 `FBK-\*` 必须同时具备：[\s\S]*4\. \*\*保护收益\*\*[\s\S]*5\. \*\*验证方式\*\*/);
  assert.match(agents, /泛化“更健壮”表述.*不报告/s);
  assert.match(agents, /`修复全部` 覆盖/);
  assert.match(agents, /用户可以明确接受当前报告中任一 `CHK-\*` 或 `FBK-\*` 的风险而不修复/);
  assert.match(agents, /P0 必须逐项写出精确 ID/);
  assert.match(agents, /`strict pass` 仍要求剩余 `CHK-\*` 与 `FBK-\*` 均为 0/);
  assert.match(agents, /只有未处置的 `CHK-\*` 或 `FBK-\*` 阻断交互完成链/);
  assert.match(agents, /validated auto-loop 不能代表用户接受风险/);
});

test("统一报告分别展示 CHK 与 FBK，并支持显式风险接受", () => {
  const entry = read(
    sourceRoot,
    ".agents/skills/trellis-check-all/SKILL.md",
  );
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
  const docRemediation = read(
    sourceRoot,
    ".agents/skills/trellis-check-all/references/document-drift-auto-remediation.md",
  );

  assert.equal(agents, claude);
  assert.match(entry, /不满足自动修复条件的文档问题根据根因转为 `CHK-\*`、`FBK-\*` 或剩余风险/);
  assert.match(docRemediation, /不得自动改，必须根据根因进入 `CHK-\*`、`FBK-\*`、剩余风险或阻塞/);
  assert.match(agents, /CHK <N>（接受 <N>）· FBK <N>（接受 <N>）/);
  assert.match(agents, /\| 维度 \| 状态 \| CHK \| FBK \| 验证 \|/);
  assert.match(agents, /### 主路径问题/);
  assert.match(agents, /### 兜底问题/);
  assert.match(agents, /兜底场景/);
  assert.match(agents, /保护收益/);
  assert.match(agents, /操作：`修复全部`、`修复 CHK-001,FBK-002`、`接受风险 CHK-001,FBK-002 并继续`、`仅保留报告`/);
  assert.match(agents, /`修复全部` 始终覆盖全部 `CHK-\*` 与 `FBK-\*`/);
  assert.match(agents, /仍有未处置 `CHK-\*` 或 `FBK-\*` 时停留在处置\/重检循环/);
  assert.match(agents, /有未处置 `CHK-\*`、`FBK-\*`、部分验证、阻塞或报告后的新编辑/);
  assert.match(agents, /有剩余 `CHK-\*` 或 `FBK-\*`：向 runner `record --result failed/);
  assert.match(agents, /validated auto-loop 不创建也不复用 interactive 风险接受/);
  assert.match(agents, /结论为 `通过·已接受风险`/);
  assert.match(light, /已接受风险通过：所有剩余 `CHK-\*` \/ `FBK-\*` 都有当前有效的用户风险接受/);
  assert.match(full, /已接受风险通过：所有剩余 `CHK-\*` \/ `FBK-\*` 都有当前有效的用户风险接受/);
  assert.match(agents, /`仅保留报告` 表示停止处置并等待，不等于接受风险/);
  assert.doesNotMatch(agents, /OPT-\*|可选改进|为什么可选|修复全部可选项/);
});

test("route、专用 agent、workflow 与 push 使用相同的风险接受语义", () => {
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
  const pushTemplatesAgents = read(
    sourceRoot,
    ".agents/skills/trellis-push/references/output-templates.md",
  );
  const pushTemplatesClaude = read(
    sourceRoot,
    ".claude/skills/trellis-push/references/output-templates.md",
  );

  assert.equal(routeAgents, routeClaude);
  assert.equal(pushAgents, pushClaude);
  assert.equal(pushTemplatesAgents, pushTemplatesClaude);
  assert.match(routeAgents, /`CHK-\*` \/ `FBK-\*` \/ `DOC-\*`/);
  assert.match(routeAgents, /已声明的兜底契约只影响证据和严重度，不改变 `FBK-\*` 归属/);
  assert.match(routeAgents, /泛化建议不报告/);
  assert.match(agentBody, /Classify findings by root-cause nature before severity/);
  assert.match(agentBody, /Assign P0\/P1\/P2 to both `CHK-\*` and `FBK-\*`/);
  assert.match(agentBody, /keep the `FBK-\*` ID when verification is partial/);
  assert.match(agentBody, /low-risk factual drift as `DOC-\*` candidates/);
  assert.match(agentBody, /Any remaining `CHK-\*` or `FBK-\*` blocks strict pass/);
  assert.match(agentBody, /do not infer, grant, or erase that acceptance yourself/);
  assert.match(workflow, /every remaining finding has current explicit user risk acceptance/);
  assert.match(workflow, /Any unaccepted finding.*reports and stops/);
  assert.match(pushAgents, /所有剩余问题都有当前有效的用户风险接受时标记为 `通过（已接受风险）`/);
  assert.match(pushTemplatesAgents, /任一未处置 `CHK-\*` \/ `FBK-\*`.*计入风险区/);
  assert.match(pushTemplatesAgents, /已接受风险的问题也必须按 ID、严重度和影响进入风险区/);
});

test("0.6 源与发布快照只保留 fallback findings 模型", () => {
  const paths = [
    ".agents/skills/trellis-check-all/SKILL.md",
    ".agents/skills/trellis-check-all/references/fallback-findings.md",
    ".agents/skills/trellis-check-all/references/reporting-and-disposition.md",
    ".agents/skills/trellis-check-all/references/light-profile.md",
    ".agents/skills/trellis-check-all/references/full-profile.md",
    ".agents/skills/trellis-check-all/references/code-comment-auto-remediation.md",
    ".agents/skills/trellis-route/SKILL.md",
    ".agents/skills/trellis-route/references/check-all-agent-body.md",
    ".agents/skills/trellis-push/SKILL.md",
    ".agents/skills/trellis-push/references/output-templates.md",
    ".claude/skills/trellis-check-all/SKILL.md",
    ".claude/skills/trellis-check-all/references/fallback-findings.md",
    ".claude/skills/trellis-check-all/references/reporting-and-disposition.md",
    ".claude/skills/trellis-check-all/references/light-profile.md",
    ".claude/skills/trellis-check-all/references/full-profile.md",
    ".claude/skills/trellis-check-all/references/code-comment-auto-remediation.md",
    ".claude/skills/trellis-route/SKILL.md",
    ".claude/skills/trellis-push/SKILL.md",
    ".claude/skills/trellis-push/references/output-templates.md",
    "overrides/patches/workflow/phase-ownership/phase-2-check-content.md",
  ];

  for (const relativePath of paths) {
    assert.equal(read(snapshotRoot, relativePath), read(sourceRoot, relativePath), relativePath);
  }

  for (const root of [sourceRoot, snapshotRoot]) {
    assert.equal(
      fs.existsSync(path.join(
        root,
        ".agents/skills/trellis-check-all/references/optional-findings.md",
      )),
      false,
    );
    assert.equal(
      fs.existsSync(path.join(
        root,
        ".claude/skills/trellis-check-all/references/optional-findings.md",
      )),
      false,
    );
  }
});

test("当前 dogfood 已投影 FBK 问题模型和风险接受门禁", () => {
  const exactPaths = [
    ".agents/skills/trellis-check-all/SKILL.md",
    ".agents/skills/trellis-check-all/references/fallback-findings.md",
    ".agents/skills/trellis-check-all/references/reporting-and-disposition.md",
    ".agents/skills/trellis-check-all/references/code-comment-auto-remediation.md",
    ".agents/skills/trellis-route/SKILL.md",
    ".agents/skills/trellis-route/references/check-all-agent-body.md",
    ".agents/skills/trellis-push/SKILL.md",
    ".agents/skills/trellis-push/references/output-templates.md",
    ".claude/skills/trellis-check-all/SKILL.md",
    ".claude/skills/trellis-check-all/references/fallback-findings.md",
    ".claude/skills/trellis-check-all/references/reporting-and-disposition.md",
    ".claude/skills/trellis-check-all/references/code-comment-auto-remediation.md",
    ".claude/skills/trellis-route/SKILL.md",
    ".claude/skills/trellis-push/SKILL.md",
    ".claude/skills/trellis-push/references/output-templates.md",
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
    assert.match(agent, /FBK-\*/);
    assert.match(agent, /P0\/P1\/P2/);
    assert.doesNotMatch(agent, /OPT-\*/);
  }

  const workflow = read(projectRoot, ".trellis/workflow.md");
  assert.match(workflow, /every remaining finding has current explicit user risk acceptance/);
  assert.doesNotMatch(workflow, /Eligible `OPT-\*` items do not block this path/);
});
