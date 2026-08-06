import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceRoot = path.join(projectRoot, "vendor/skill-garden/.trellis/0.6");
const snapshotRoot = path.join(projectRoot, "enhancements/0.6");

function read(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("Check-All 双平台副本统一智能深度契约", () => {
  const relativePath = ".agents/skills/trellis-check-all/SKILL.md";
  const agents = read(sourceRoot, relativePath);
  const claude = read(sourceRoot, ".claude/skills/trellis-check-all/SKILL.md");
  const depthRouting = read(
    sourceRoot,
    ".agents/skills/trellis-check-all/references/depth-routing.md",
  );
  const reporting = read(
    sourceRoot,
    ".agents/skills/trellis-check-all/references/reporting-and-disposition.md",
  );
  const spec = read(
    projectRoot,
    ".trellis/spec/flower-trellis/cli/enhancements-model.md",
  );

  assert.equal(agents, claude);
  assert.match(agents, /本 skill 是 \*\*薄入口\*\*/);
  assert.match(agents, /不要提前读取未命中的 profile/);
  assert.match(agents, /低风险文档漂移进入 `DOC-\*` 通道/);
  assert.match(depthRouting, /requested_depth: auto \| light \| full/);
  assert.match(depthRouting, /effective_depth: light \| full/);
  assert.match(depthRouting, /hard-full 信号/);
  assert.match(depthRouting, /简单检查.*轻量检查.*light check.*表示 light/);
  assert.match(depthRouting, /全面检查.*最终检查.*提交前检查.*full check.*表示 full/);
  assert.match(depthRouting, /以最后一次明确表达为准/);
  assert.match(depthRouting, /正在重检既有 full `CHK-\*` \/ `FBK-\*` 修复结果/);
  assert.match(spec, /已有 full `CHK-\*` \/ `FBK-\*` 重检/);
  assert.match(reporting, /light 通过正式满足 Phase 2\.2 检查门禁/);
  assert.ok(
    reporting.indexOf("## Auto-Loop Return Gate")
      < reporting.indexOf("## Interactive Post-Check Stop Gate"),
  );
  const autoLoopGate = reporting.slice(
    reporting.indexOf("## Auto-Loop Return Gate"),
    reporting.indexOf("## Interactive Post-Check Stop Gate"),
  );
  const interactiveGate = reporting.slice(
    reporting.indexOf("## Interactive Post-Check Stop Gate"),
    reporting.length,
  );
  assert.match(autoLoopGate, /validated auto-loop 不渲染交互式下一步段/);
  assert.match(autoLoopGate, /record 成功后立即 `next`/);
  assert.doesNotMatch(autoLoopGate, /提示用户回复 `继续`/);
  assert.match(interactiveGate, /非 validated auto-loop 先输出完整标准报告/);
  assert.match(interactiveGate, /提示用户回复 `继续`/);
  assert.match(reporting, /只从当前完成链证据识别 direct Git intent/);
  assert.match(reporting, /未处置 `CHK-\*` \/ `FBK-\*`、blocked、部分验证或未接受的实质剩余风险/);
  assert.match(reporting, /普通 interactive 检查保持原行为/);
  assert.match(reporting, /所有 interactive 标准报告都必须在末尾输出 `### 下一步`/);
  assert.match(reporting, /有 blocked、部分验证或实质剩余风险：指出解除阻塞所需的精确决策、授权或验证/);
  assert.match(reporting, /无 direct Git intent 且 strict pass \/ 已接受风险通过：提示用户回复 `继续`/);
  assert.match(reporting, /停止边界只控制是否自动推进，不能让报告在没有下一步提示的情况下结束/);
  assert.match(reporting, /不新增 direct Git 专用摘要/);
});

test("route 只决定 Check-All 执行位置", () => {
  const agents = read(sourceRoot, ".agents/skills/trellis-route/SKILL.md");
  const claude = read(sourceRoot, ".claude/skills/trellis-route/SKILL.md");
  const routeState = read(
    sourceRoot,
    ".agents/skills/trellis-route/scripts/route_state.py",
  );
  const catalog = JSON.parse(read(
    sourceRoot,
    ".agents/skills/trellis-route/references/platform-dispatch.json",
  ));

  assert.equal(agents, claude);
  assert.doesNotMatch(agents, /隐藏逃生口/);
  assert.doesNotMatch(agents, /`inline check`/);
  assert.doesNotMatch(agents, /`subagent check`/);
  assert.doesNotMatch(agents, /check-inline|check-subagent/);
  assert.match(routeState, /"check-inline": "check-all-inline"/);
  assert.match(routeState, /"check-subagent": "check-all-subagent"/);
  assert.match(routeState, /def _normalize_mode/);
  assert.match(agents, /light\/full 是 Check-All 的 requested depth/);
  assert.doesNotMatch(agents, /Step 0\.25: 识别当前平台能力/);
  assert.doesNotMatch(agents, /删除所有 Subagent 选项及对应编号/);
  assert.doesNotMatch(agents, /当前平台只能 inline/);
  assert.match(agents, /仅当 route 已选中 subagent 时/);
  assert.match(agents, /inline 路径不读取 catalog，也不预先过滤 route 选项/);
  assert.equal(catalog.schemaVersion, 1);
  assert.equal(catalog.platforms.length, 21);
  assert.equal(new Set(catalog.platforms.map(({ id }) => id)).size, 21);
  assert.match(catalog.platforms.find(({ id }) => id === "pi").implement.launch, /trellis_subagent/);
  assert.match(catalog.platforms.find(({ id }) => id === "grok").implement.launch, /spawn_subagent/);
  assert.match(catalog.platforms.find(({ id }) => id === "kimi").implement.launch, /coder/);
  assert.match(catalog.platforms.find(({ id }) => id === "kimi").checkAll.launch, /explore/);
  assert.equal(
    catalog.platforms.filter(({ checkAll }) => checkAll.eligible).length,
    17,
  );
  assert.doesNotMatch(agents, /\| Codex \|/);
  assert.match(agents, /workspace-write `trellis-check`/);
});

test("auto-loop 与 workflow 先续跑再应用交互停止门禁", () => {
  const workflow = read(sourceRoot, "overrides/patches/workflow/hub/content.md");
  const state = read(
    sourceRoot,
    "overrides/patches/workflow/states-in-progress/common-content.md",
  );
  const inlineState = state;
  const autoLoop = read(sourceRoot, ".agents/skills/trellis-auto-loop/SKILL.md");
  const docRemediation = read(
    sourceRoot,
    ".agents/skills/trellis-check-all/references/document-drift-auto-remediation.md",
  );
  const reporting = read(
    sourceRoot,
    ".agents/skills/trellis-check-all/references/reporting-and-disposition.md",
  );
  const runner = read(sourceRoot, "scripts/auto_loop.py");

  assert.match(
    workflow,
    /A validated auto-loop result returns through matching `record` \+ `next` before the interactive post-check stop applies/,
  );
  assert.match(state, /validated auto-loop immediately records and advances/);
  assert.match(inlineState, /validated auto-loop immediately records and advances/);
  assert.match(autoLoop, /--check-depth auto\|light\|full/);
  assert.match(autoLoop, /--doc-remediation-file/);
  assert.match(autoLoop, /status=retryable reason=artifact-drift/);
  assert.match(autoLoop, /不得运行 `next`/);
  assert.match(docRemediation, /只有当前任务的 `implement\.md` 与 `brief\.md`/);
  assert.match(reporting, /record 成功后立即 `next`/);
  assert.match(reporting, /若返回 `status=retryable reason=artifact-drift`，不得 `next`/);
  assert.match(runner, /legacy-default-full/);
  assert.match(runner, /MAX_ARTIFACT_RECONCILE = 3/);
  assert.match(runner, /doc-remediation-file/);
});

test("0.6 发布快照与智能检查源保持一致", () => {
  const paths = [
    ".agents/skills/trellis-check-all/SKILL.md",
    ".claude/skills/trellis-check-all/SKILL.md",
    ".agents/skills/trellis-check-all/references/depth-routing.md",
    ".agents/skills/trellis-check-all/references/document-drift-auto-remediation.md",
    ".agents/skills/trellis-check-all/references/full-profile.md",
    ".agents/skills/trellis-check-all/references/light-profile.md",
    ".agents/skills/trellis-check-all/references/fallback-findings.md",
    ".agents/skills/trellis-check-all/references/reporting-and-disposition.md",
    ".claude/skills/trellis-check-all/references/depth-routing.md",
    ".claude/skills/trellis-check-all/references/document-drift-auto-remediation.md",
    ".claude/skills/trellis-check-all/references/full-profile.md",
    ".claude/skills/trellis-check-all/references/light-profile.md",
    ".claude/skills/trellis-check-all/references/fallback-findings.md",
    ".claude/skills/trellis-check-all/references/reporting-and-disposition.md",
    ".agents/skills/trellis-route/SKILL.md",
    ".agents/skills/trellis-route/scripts/route_state.py",
    ".agents/skills/trellis-route/references/platform-dispatch.json",
    ".agents/skills/trellis-route/references/check-all-agent-body.md",
    ".claude/skills/trellis-route/SKILL.md",
    ".claude/skills/trellis-route/scripts/route_state.py",
    ".agents/skills/trellis-auto-loop/SKILL.md",
    ".claude/skills/trellis-auto-loop/SKILL.md",
    "overrides/patches/workflow/hub/content.md",
    "overrides/patches/workflow/states-in-progress/common-content.md",
    "overrides/patches/workflow/states-in-progress/subagent-content.md",
    "overrides/patches/workflow/states-in-progress/inline-content.md",
    "scripts/auto_loop.py",
  ];

  for (const relativePath of paths) {
    assert.equal(read(snapshotRoot, relativePath), read(sourceRoot, relativePath), relativePath);
  }
});
