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
  assert.match(agents, /1\. 符合 `DOC-\*` 自动修复白名单/);
  assert.match(agents, /2\. 根因位于 fail-closed、异常输入、失败路径降级/);
  assert.match(agents, /3\. 根因位于主路径逻辑、非兜底需求或契约/);
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
  assert.match(agents, /环境、工具或权限不足仍保留 `FBK-\*` ID/);
  assert.doesNotMatch(agents, /每个 `FBK-\*` 必须同时具备：[\s\S]*4\. \*\*保护收益\*\*[\s\S]*5\. \*\*验证方式\*\*/);
  assert.match(agents, /泛化“更健壮”表述.*不报告/s);
  assert.match(agents, /`修复全部` 覆盖/);
  assert.match(agents, /用户可以明确接受当前报告中任一 `CHK-\*` 或 `FBK-\*` 的风险而不修复/);
  assert.match(agents, /接受当前报告全部风险.*包括 P0/s);
  assert.match(agents, /部分接受须唯一定位/);
  assert.match(agents, /报告或范围不清才追问/);
  assert.match(agents, /接受有效性与增量展示统一按 `reporting-and-disposition\.md`/);
  assert.doesNotMatch(agents, /P0 必须逐项写出精确 ID/);
  assert.match(agents, /`strict pass` 仍要求剩余 `CHK-\*` 与 `FBK-\*` 均为 0/);
  assert.match(agents, /未处置 `CHK-\*` \/ `FBK-\*`、阻断型部分验证或阻塞会阻断/);
  assert.match(agents, /auto-loop 不得接受风险/);
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
  assert.ok(
    agents.indexOf("### 主路径问题") < agents.indexOf("### 兜底问题"),
    "统一报告模板必须先展示 CHK 主路径区块，再展示 FBK 兜底区块",
  );
  assert.match(agents, /严重度排序只在各自通道内部生效/);
  assert.match(agents, /每个通道内部按 `P0 -> P1 -> P2` 展示/);
  assert.match(agents, /跨通道报告顺序固定为完整 `CHK-\*` 区块在前、完整 `FBK-\*` 区块在后/);
  assert.match(agents, /禁止因 FBK 严重度更高、分类时先判断 FBK、发现先后或 ID 分配时机而 FBK-first/);
  assert.match(agents, /不得按全局严重度排序反转或交错两个区块/);
  assert.doesNotMatch(agents, /报告按严重度排序，但不得因此/);
  assert.match(agents, /兜底场景/);
  assert.match(agents, /保护收益/);
  assert.doesNotMatch(agents, /^操作：/m);
  assert.match(agents, /处置选择统一在报告末尾“下一步”中提供一次/);
  const nextStep = agents.slice(agents.indexOf("### 交互式下一步引导"));
  assert.match(nextStep, /有未处置 findings：提示 `修复全部`、精确 ID、接受当前报告全部风险、`接受风险 <ID> 并继续` 或 `仅保留报告`/);
  assert.match(agents, /`修复全部` 始终覆盖全部 `CHK-\*` 与 `FBK-\*`/);
  assert.match(agents, /“接受当前报告全部风险”.*覆盖全部 `CHK-\*` \/ `FBK-\*`，包括 P0/s);
  assert.match(agents, /无固定句式/);
  assert.match(agents, /实质改变该问题的证据、触发条件、影响或严重度/);
  assert.match(agents, /`\[上线后验证\]`：仅部署后、生产或外部系统可安全验收/);
  assert.match(agents, /它不属于维度状态/);
  assert.match(agents, /不阻断 strict pass、Update-Spec 或 direct Git/);
  assert.match(agents, /本地 fixture、测试环境、静态契约或无副作用命令可完成的检查不得延期为 `\[上线后验证\]`/);
  assert.match(agents, /Check-All 不得执行生产或外部系统操作/);
  assert.match(agents, /仍有未处置 `CHK-\*` 或 `FBK-\*` 时停留在处置\/重检循环/);
  assert.match(agents, /未处置 `CHK-\*` \/ `FBK-\*`、阻断型部分验证、阻塞或新编辑先 `advance --stage implement`/);
  assert.match(agents, /有剩余 `CHK-\*` 或 `FBK-\*`：向 runner `record --result failed/);
  assert.match(agents, /validated auto-loop 不创建也不复用 interactive 风险接受/);
  assert.match(agents, /摘要包含自动修复和全部 `\[上线后验证\]`/);
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
  assert.match(agentBody, /post-release verification/);
  assert.match(agentBody, /must not block strict pass/);
  assert.match(agentBody, /Never execute production or external-system operations/);
  assert.match(agentBody, /low-risk factual drift as `DOC-\*` candidates/);
  assert.match(agentBody, /Any remaining `CHK-\*` or `FBK-\*`, blocker, or blocking partial verification blocks strict pass/);
  assert.match(agentBody, /do not infer, grant, or erase that acceptance yourself/);
  assert.match(workflow, /every remaining finding has current explicit user risk acceptance/);
  assert.match(workflow, /any unaccepted finding.*reports and stops/);
  assert.match(workflow, /`\[上线后验证\]` items remain visible but do not block/);
  assert.match(workflow, /does not itself force another Full/);
  assert.match(pushAgents, /所有剩余问题都有当前有效的用户风险接受时标记为 `通过（已接受风险）`/);
  assert.match(pushAgents, /`\[上线后验证\]` 不改变 Check-All 的通过状态/);
  assert.match(pushTemplatesAgents, /任一未处置 `CHK-\*` \/ `FBK-\*`.*计入风险区/);
  assert.match(pushTemplatesAgents, /未变化且接受仍有效的问题只在完成链证据中汇总数量，不再进入风险区/);
  assert.match(pushTemplatesAgents, /`\[上线后验证\]`.*非阻断风险.*`trellis-release`/s);
});

test("接受全部或部分风险只更新处置，重检和主动展开仍保留问题证据", () => {
  const reporting = read(sourceRoot, ".agents/skills/trellis-check-all/references/reporting-and-disposition.md");
  const entry = read(sourceRoot, ".agents/skills/trellis-check-all/SKILL.md");
  const disposition = reporting.slice(reporting.indexOf("### 接受后的增量展示"), reporting.indexOf("## 验证阶段"));

  assert.match(disposition, /首次报告完整展示全部问题/);
  assert.match(disposition, /若只改变处置状态，简短确认本次接受的 ID、更新后的结论和必要的下一步/);
  assert.match(disposition, /不重贴报告、维度表、问题字段或原风险说明，也不因此重跑检查/);
  assert.match(disposition, /部分接受时补充剩余待处置 ID.*不误报通过/);
  assert.match(disposition, /重检完整展示新增、实质变化、接受失效及仍待处置的问题/);
  assert.match(disposition, /只汇总数量，计入报告总数与接受数/);
  assert.match(disposition, /恢复会话、验证进展和 Update-Spec 内部沿用有效接受记录，不主动复述/);
  assert.match(disposition, /用户要求详情时再展开指定问题的原报告与当前处置/);
  assert.match(disposition, /原报告或接受依据无法恢复时.*针对受影响项目补核/);
  assert.match(disposition, /不新增展示次数、状态文件或报告附件/);
  assert.match(entry, /首次报告、接受后增量展示与分流规则/);
  assert.doesNotMatch(reporting, /已接受问题继续完整展示|有问题或已接受风险时完整展示|先输出完整标准报告/);
  assert.match(reporting, /原报告与接受记录保留完整问题、原通道、严重度和证据/);
});

test("风险有效性按问题关联证据判断，无关改动不撤销接受", () => {
  const reporting = read(sourceRoot, ".agents/skills/trellis-check-all/references/reporting-and-disposition.md");
  const fallback = read(sourceRoot, ".agents/skills/trellis-check-all/references/fallback-findings.md");

  assert.match(reporting, /实质改变该问题的证据、触发条件、影响或严重度；改变时仅该问题的原接受失效/);
  assert.match(reporting, /无关文件改动、行号移动或不改变问题语义的报告整理不使接受失效/);
  assert.match(reporting, /无法确认关联证据仍有效时明确缺口，不推断继续有效/);
  assert.match(fallback, /接受有效性与增量展示统一按 `reporting-and-disposition\.md`/);
  assert.doesNotMatch(fallback, /证据、diff、内容或严重度变化后失效/);
});

test("接受并继续承接 Update-Spec，未处置项与 Git 确认仍保留", () => {
  const reporting = read(sourceRoot, ".agents/skills/trellis-check-all/references/reporting-and-disposition.md");
  const workflow = read(sourceRoot, "overrides/patches/workflow/phase-ownership/phase-2-check-content.md");
  const updateSpec = read(sourceRoot, "overrides/patches/skills/trellis-update-spec/autonomous-evaluation/content.md");

  assert.match(reporting, /“接受并继续”等明确表达在通过门禁后同轮进入 Update-Spec，无需再回复“继续”/);
  assert.match(reporting, /仍有未处置问题或阻塞时说明剩余项并停止/);
  assert.match(reporting, /继续不替代 Push 的精确计划确认/);
  assert.match(workflow, /or the user explicitly asks to continue/);
  assert.match(workflow, /Ordinary interactive checks without continuation intent still report and stop/);
  assert.doesNotMatch(workflow, /Keep accepted findings visible in the standard report and Push risk evidence/);
  assert.match(updateSpec, /Check-All report or brief acceptance acknowledgment/);
  assert.match(updateSpec, /Reuse valid acceptance evidence internally without repeating unchanged risks/);
});

test("Push 计划仅汇总有效接受数量，成功结果不复述而异常仍展开", () => {
  const output = read(sourceRoot, ".agents/skills/trellis-push/references/output-templates.md");

  assert.match(output, /通过（N 项风险已接受）/);
  assert.match(output, /未变化且接受仍有效的问题只在完成链证据中汇总数量，不再进入风险区/);
  assert.match(output, /内部保留 ID、严重度、影响与接受依据，用户要求详情时再展开/);
  assert.match(output, /接受失效或无法验证时按实际状态进入风险区并说明变化或证据缺口/);
  assert.match(output, /顶部“风险 <N>”只统计本次风险区需展开的事项，不包含已经单独汇总的有效已接受问题/);
  assert.match(output, /成功结果省略未变化且接受仍有效的问题，不重复接受数量或原影响说明/);
  assert.match(output, /仍适用的其它完成链风险与 `\[上线后验证\]`/);
  assert.doesNotMatch(output, /已接受风险的问题也必须.*进入风险区|完成链风险、已接受问题与/);
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
  assert.match(workflow, /`\[上线后验证\]` items remain visible but do not block/);
  assert.doesNotMatch(workflow, /The final pre-commit pass must cover the whole task and cannot be downgraded to light/);
  assert.doesNotMatch(workflow, /Eligible `OPT-\*` items do not block this path/);
});
