# 当前规则与维护范围

## 检查后推进

- 详细规则位于 `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-check-all/references/reporting-and-disposition.md`，Claude 副本逐字节一致。
- 当前 Interactive Post-Check Stop Gate 只有 direct Git 或显式继续意图才在通过后进入 Update-Spec；普通检查通过后停止。
- 同文件的 untracked 规则要求普通通过后保持 `stage=check`，也需要同步改为服从默认推进和显式停止分支。
- Workflow Phase 2.2、in-progress 公共状态和 Update-Spec Patch 重复表达当前分支，需同步修改但不扩张其职责。
- `test/js/update-spec-auto-decision.test.js` 明确断言普通检查默认停止；`apply-enhancements.test.js`、`workflow-gate-ownership.test.js` 和 `check-all-smart-depth.test.js` 有相关最终产物/owner 断言。

## Brief 与变更评审

- `trellis-task-brief` 的 agents/claude 作者源已经禁止实现和恢复阶段例行重新生成、展示和确认。
- `overrides/patches/skills/trellis-brainstorm/planning-handoff/readiness-content.md` 仍要求 artifacts materially change 后 refresh and repeat Brief review，未区分用户已经明确的调整和新增待决事项。
- completed 状态和 Meta 的 continue-recovery 说明仍笼统要求 material scope changes 的 Brief approval，需改为引用同一个增量确认 owner。
- `task.py start` 的机械 Brief 校验只在 planning 状态运行，验证存在性和 artifact mtime；本任务不改变该 helper，也不把文档新旧判定当成用户审批事实。
- `test/js/brief-preauthorization.test.js` 与 Python `test_task_start_brief_gate.py` 覆盖完整首次展示、预授权边界、恢复行为和 stale Brief guard。

## 来源与分发

- `.flower/plugins.json` / `plugin-lock.json` / `state.json` 确认当前由 `flower/skill-garden@0.6.11` 管理；运行目录是投影产物。
- 作者源：`vendor/skill-garden/.trellis/0.6/`；快照：`enhancements/0.6/`；canonical 产物：`vendor/skill-garden/compiled-targets/0.6.14/`。
- 修改需经 `npm run sync`、`npm run patch:targets`、Patch conflict 和最终产物一致性验证，再通过 Plugin 生命周期应用到当前项目。
- 父仓和 Skill-Garden 子仓创建任务前均为干净状态；子仓 HEAD 为 `7d02e3d812cd817db285fc51a4656c55b497452b`。

## 已查阅历史

- `07-24-optimize-direct-push-continuation` 的 PRD 明确保留人工 Git 计划确认，旧 AC7 将普通检查保持停止；本次用户明确选择改变该旧行为。
- `07-29-brief-start-preauthorization` 的 PRD 保留首次完整 Brief 评审且不增加授权 runtime；本次延续首次评审，只澄清其后的变化判断。
- `trellis mem search` 返回 2026-09-15 风险接受展示简化会话 `01a0a2f4-b485-7fb0-a4c1-4212ccd25b92`；既有风险接受应保留原记录，后续仅展示新增或变化项。
- 历史仅用于解释既有约束；当前实现范围与授权以本次用户明确决定为准。
