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
  assert.match(agents, /低风险事实漂移进入 `DOC-\*` 通道/);
  assert.match(depthRouting, /requested_depth: auto \| light \| full/);
  assert.match(depthRouting, /effective_depth: light \| full/);
  assert.match(depthRouting, /hard-full 信号/);
  assert.match(depthRouting, /hard-full 只看行为契约变化和影响面是否闭合/);
  assert.match(depthRouting, /文件载体或主题域本身不构成 hard-full/);
  assert.match(depthRouting, /同一真实源的多个机械投影仍算一个语义范围/);
  assert.match(depthRouting, /简单检查.*轻量检查.*light check.*为 light/);
  assert.match(depthRouting, /全面检查.*全量检查.*full check.*为 full/);
  assert.match(depthRouting, /最终检查.*提交前检查.*只调用统一入口.*requested_depth=auto/s);
  assert.match(depthRouting, /深度按最后一次明确表达/);
  assert.match(depthRouting, /跨轮局部修复可重新选择 light/);
  assert.match(depthRouting, /原 finding、修复路径、引用\/回归和定向证据可闭合/);
  assert.match(depthRouting, /同一次 Check-All 执行中.*不得降回 light/s);
  assert.match(depthRouting, /结束任务、提交或已有 full 报告不触发 full/);
  assert.match(depthRouting, /既有 full 证据仍覆盖当前 diff.*后续修改已定向重检.*可复用/s);
  assert.doesNotMatch(depthRouting, /正在重检既有 full `CHK-\*` \/ `FBK-\*` 修复结果/);
  assert.doesNotMatch(depthRouting, /不在既有 full 修复\/重检链中/);
  assert.match(spec, /跨轮局部修复可重新选择 light/);
  assert.doesNotMatch(spec, /已有 full `CHK-\*` \/ `FBK-\*` 重检和未知影响面继续 full/);
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
  assert.match(reporting, /未处置 `CHK-\*` \/ `FBK-\*`、blocked、阻断型部分验证或其它未接受实质风险/);
  assert.match(reporting, /普通 interactive 检查保持原行为/);
  assert.match(reporting, /所有 interactive 标准报告都必须在末尾输出 `### 下一步`/);
  assert.match(reporting, /有 blocked、阻断型部分验证或未标记 `\[上线后验证\]` 的实质风险：指出所需决策、授权或验证/);
  assert.match(reporting, /无 direct Git intent 且 strict pass \/ 已接受风险通过：提示用户回复 `继续`/);
  assert.match(reporting, /停止边界只控制是否自动推进，不能让报告在没有下一步提示的情况下结束/);
  assert.match(reporting, /不新增 direct Git 摘要或 Git 计划/);
});

test("Check-All 深度由行为影响决定而不是文件载体", () => {
  const depthRouting = read(
    sourceRoot,
    ".agents/skills/trellis-check-all/references/depth-routing.md",
  );
  const light = read(
    sourceRoot,
    ".agents/skills/trellis-check-all/references/light-profile.md",
  );

  assert.match(depthRouting, /公共 API、CLI、schema、持久化状态、协议字段/);
  assert.match(depthRouting, /权限、安全、资金、并发、时序、状态机/);
  assert.match(depthRouting, /发布或 Git 控制门禁/);
  assert.match(depthRouting, /直接引用点、状态传播或回归路径无法完整列出/);
  assert.match(depthRouting, /无法确认是否改变行为契约.*fallback-full/s);
  assert.doesNotMatch(depthRouting, /^- workflow、skill、command、hook 注入或生成快照；$/m);
  assert.doesNotMatch(depthRouting, /^- 安装、升级、发布、push\/commit 工作流控制面；$/m);

  assert.match(
    depthRouting,
    /局部行为修改时，直接引用点和回归路径可穷举，并有可运行的定向验证；无行为变化时，仅涉及注释、错别字、排版、解释文字、示例或机械投影同步/,
  );
  assert.doesNotMatch(
    depthRouting,
    /^- 有定向验证，或仅涉及无行为变化的注释.*\n- 局部行为修改/m,
  );
  assert.match(light, /闭合的语义范围/);
  assert.match(light, /载体名称不得单独触发升级/);
  assert.match(light, /承接既有 full 报告的局部修复/);
});

test("Light 与 Full 统一按充分验证证据判断，不把自动化文件当成绝对门槛", () => {
  const light = read(
    sourceRoot,
    ".agents/skills/trellis-check-all/references/light-profile.md",
  );
  const full = read(
    sourceRoot,
    ".agents/skills/trellis-check-all/references/full-profile.md",
  );
  const reporting = read(
    sourceRoot,
    ".agents/skills/trellis-check-all/references/reporting-and-disposition.md",
  );

  for (const profile of [light, full]) {
    assert.match(profile, /自动化测试优先/);
    assert.match(profile, /可重复的手动步骤、静态检查或定向命令/);
    assert.match(profile, /仅缺少自动化测试文件不得生成 `CHK-\*`/);
    assert.match(profile, /项目 spec、风险等级或回归概率明确要求自动化覆盖/);
    assert.match(profile, /缺少完成当前结论所必需的充分证据.*`CHK-\*`/s);
  }

  assert.match(reporting, /`部分验证`：当前结论必需、提交前可完成但证据不足/);
  assert.match(reporting, /`\[上线后验证\]`：仅部署后、生产或外部系统可安全验收/);
  assert.match(reporting, /不阻断 strict pass.*strict pass 可以与其并存/s);
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
    ".agents/skills/trellis-check-all/references/code-comment-auto-remediation.md",
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
    ".claude/skills/trellis-check-all/references/code-comment-auto-remediation.md",
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
