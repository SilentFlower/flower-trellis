# Implementation Plan

## 1. Restore Global Request Gates

- [x] 在 vendor `workflow/intent-routing/request-triage/content.md` 中加入 Project Knowledge Discovery 和 Active Task Scope Guard 的完整 policy。
- [x] 更新 `workflow/state-no-task/content.md`，让非平凡 workflow action 先发现项目知识，并区分准确 capability 与项目 SOP。
- [x] 更新 `workflow/states-planning/common-content.md`，补齐 planning/planning-inline 的无关请求隔离。
- [x] 复核 `workflow/states-in-progress/common-content.md` 与 planning 的 scope 行为等价但不复制完整 policy。
- [x] 更新 Hub 三条 owner 映射、before-dev 一跳入口和 brainstorm owner 指针。

## 2. Restore Progress Recovery Entry

- [x] 检查 vendor 中所有平台的 `trellis-continue` 目标定义和现有 Patch/Bundle 模式。
- [x] 新增最小 `skills/trellis-continue/task-progress-recovery` Patch，在 Phase 判断前调用 `task_progress.py status --json`。
- [x] 只 relay `partialStep`、`nextStep`、必要 notes 和 helper candidates/warnings；禁止 auto-rebind、progress 推断 phase 或恢复 Git 编排。
- [x] 补齐 full/selected Bundle 与脚本 alias，使 continue owner 和 `task_progress.py` 同时安装。

## 3. Replace Presence-Only Checks With Reachability Coverage

- [x] 扩展 `test/js/workflow-gate-ownership.test.js`，加入 no_task release/inspect/direct-edit、planning scope、in-progress scope 和 continue recovery 场景。
- [x] 更新 JS apply 与 Python Patch consumer 测试，验证最终计划而不是只读取 source marker。
- [x] 更新 `conflicts.json`，断言新 owner、入口顺序、planning/in-progress 覆盖、continue recovery 和旧错误 owner 缺失。
- [x] 保留其余 10 个 Gate 的现有回归断言，避免本轮修复造成新的所有权漂移。

## 4. Restore Planning And Brief Gates

- [x] 为 auto-loop 增加内容绑定的 planning semantic readiness review，覆盖可测试验收标准、关键决策收敛和真实剩余问题。
- [x] artifact 变化时使旧 readiness 结论失效，并返回 brainstorm/review，而不是直接启动任务。
- [x] brief 刷新后增加展示和显式确认 action；确认绑定当前 brief 与 authoritative artifacts。
- [x] 补齐缺失、过期、拒绝/阻塞、确认和确认后 artifact 变化的 Python 状态机测试。
- [x] 更新 `trellis-continue` planning 恢复入口，禁止按 artifact presence 绕过 Brainstorm Quality Bar 与当前 brief 确认。

## 5. Restore Execute And Finish Ordering

- [x] 更新 in-progress 高频 state 与 `trellis-route`，保证实现完成后返回 Phase 2.1 completion contract 和 Pre-Check。
- [x] 更新 `trellis-push`，让普通 direct push 在 Git 动作前验证当前 `spec_update_result`，缺失时进入 Update-Spec。
- [x] 保持 auto-loop internal commit-only 预授权例外，并补顺序回归测试。

## 6. Restore Platform-Native Distribution

- [x] 集中定义 17 平台原生 skill root/canonical source 映射。
- [x] 让 copy、installed detection、apply managed roots 和 uninstall 共同使用集中映射；保留无平台时 Claude fallback。
- [x] 扩展 Update-Spec 与 Finish-Work Patch 到 skill、command、workflow、prompt 和 Gemini TOML 的真实原生 targets。
- [x] 补 Kiro-only 和 17 平台矩阵测试，断言最终平台原生产物而非只读 `.agents`。

## 7. Sync Source, Snapshot And Dogfood

- [ ] 在 `vendor/skill-garden` 提交源变更并更新父仓 submodule pin。
- [x] 运行 `npm run sync` 同步 `enhancements/0.6` 和 `enhancements/MANIFEST.json`。
- [x] 使用本地 flower-trellis 更新当前 dogfood 的 workflow、skills 和 scripts。
- [x] 连续应用两次，确认第二次 Patch 修改数为 0。

## 8. Validate

- [x] `python3 ./.trellis/scripts/spec_router.py "beta release publish tag changelog npm"`
- [x] 定向运行 workflow owner、apply enhancements、progress 和 Python consumer 测试。
- [x] `node scripts/check-patch-conflicts.mjs`
- [x] `node scripts/check-ai-context-budget.mjs --strict`
- [x] `npm test`
- [ ] `node scripts/check-snapshot.mjs`
- [x] 源/快照/dogfood 一致性比较与 `git diff --check`。
- [x] 对全部 Workflow Gate 重新执行状态、动作和平台可达性矩阵，确认所有已知回归修复且没有新回退。

## 9. Release Handoff

- [ ] 完成 Check-All、Update-Spec 和 Trellis Push 后，重新获取 npm `beta` 与远端 tag 状态。
- [ ] 重新执行 `0.6.0-beta.0` release dry-run，展示包含本次修复的 CHANGELOG 并等待新的明确发版确认。
- [ ] 本任务内不创建 release commit/tag。

## Risk And Rollback Points

- Request Triage 进入 Phase summary 和 SessionStart，必须重点审查 context budget delta。
- Active Scope 的完整 policy 只能有一个 owner；planning/in-progress state 只保留一跳动作。
- progress 不能用于推断 phase 或 Git 动作；continue 只消费 helper 的恢复展示字段。
- planning readiness 与 brief confirmation 必须绑定 artifact 内容，不能用文件存在或一次性全局布尔值代替。
- Phase 2.1 与 Phase 3.3 继续是完整策略 owner；state/route/push 只保留真实可达的一跳边。
- 平台映射只能有一个源码定义；Patch target 必须显式且保留 Markdown/TOML 原生格式。
- source、snapshot、dogfood 三层必须按顺序同步，禁止只改最终文件。
- 回滚按 request gates、progress recovery、planning handoff、execute/finish ordering、platform distribution 和 tests 分组独立恢复。
