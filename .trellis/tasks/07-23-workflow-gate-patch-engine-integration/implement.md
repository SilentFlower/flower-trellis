# Implementation Plan

## 1. Freeze Behavior And Ownership Baseline

- [x] 保存迁移前 13 个 Hub Gate 正文、最终 owner 内容、Phase summary、SessionStart 和 context budget 基线。
- [x] 建立 planning、route、check、auto-loop、push、finish-work、progress、update 场景矩阵，记录确认次数与最终状态。
- [x] 增加 owner coverage 测试骨架，先证明当前 Hub 重复和 owner 缺口。
- [x] 建立原有冲突清单，覆盖上游 workflow、Hub、phase/state、skill、hook/helper、Patch target overlap 和精细 Bundle；为每项记录 chosen owner 与处理动作。

## 2. Migrate Planning And Request Gates

- [x] 把 Request Intent Routing 与 Active Task Scope 的完整规则迁入 `trellis-start`/请求入口，state 只保留一跳动作。
- [x] 把 Brainstorm Gate 与 Task Brief Handoff 收敛到 Phase 1、`trellis-brainstorm`、`trellis-task-brief` 和 `task.py start`。
- [x] 把 Project Knowledge Discovery 的触发契约放入 planning/implementation owner，复用 `spec_router.py`。
- [x] 复核 `task.py start` 与 `task_intent.py` 的确定性 hard guard，补齐缺失测试但不编码语义判断。

## 3. Migrate Execution And Check Gates

- [x] 把 Routing Gate 完整规则收敛到 Phase 2 与 `trellis-route`/`route_state.py`。
- [x] 把 Auto-Loop Return 与 Interactive Post-Check Stop 收敛到 `trellis-check-all`、Phase 2.2 和 `auto_loop.py`。
- [x] 保持 Pre-Check、repair/recheck 和 auto-loop 优先级，删除 Hub/State 中重复细节。
- [x] 补 route/action/task mismatch、record 顺序和 interactive stop 场景测试。

## 4. Migrate Update, Git And Recovery Gates

- [x] 把 Flower Update Confirmation 收敛到 SessionStart update contract 与 Flower CLI。
- [x] 把 Code Commit Confirmation 收敛到 Phase 3.4 与 `trellis-push`。
- [x] 把 Auto-loop Commit-only 收敛到 `trellis-auto-loop` 与 push internal executor。
- [x] 把 Bookkeeping Scope 收敛到 `trellis-finish-work` 与 `safe_commit.py`。
- [x] 把 Task Progress Recovery 收敛到 `trellis-push`、recovery entry 与 `task_progress.py`。
- [x] 补 Git/confirmation/exact-path/progress schema 的确定性 hard guard 测试。

## 5. Shrink Hub And Enforce Ownership

- [x] 将 `workflow/hub` 改为轻量 owner index 和跨阶段顺序，删除完整 Gate 正文。
- [x] 新增静态 owner coverage/uniqueness/forbidden-duplication 断言。
- [x] 更新 conflict policy，验证关键 owner marker、Hub 禁止签名和跨阶段顺序。
- [x] 对冲突清单逐项执行 merge/replace/remove，禁止用高优先级文案掩盖仍存在的旧规则。
- [x] 增加旧冲突签名 absent/max-occurrences 与新 owner required-literal 断言，防止上游升级回流。
- [x] 检查 full 与精细 Bundle 的 owner Patch 自包含性，不扩大无关安装范围。

## 6. Sync And Validate

- [x] 运行 `npm run sync`，比较 vendor 与 `enhancements/0.6` 快照。
- [x] 运行 JS/Python Patch consumer、task、route、auto-loop、pre-check、push/finish/progress/update 相关测试。
- [x] 运行 `node scripts/check-patch-conflicts.mjs`。
- [x] 运行 `node scripts/check-ai-context-budget.mjs --strict`，记录迁移前后 delta。
- [x] 运行 `npm test`。
- [x] 在临时 Trellis 0.6.5 项目跑完整场景矩阵。
- [x] 对当前 dogfood 连续 apply 两次，第二次 Patch 修改数为 0。
- [ ] 运行 `node scripts/check-snapshot.mjs`。当前 source/snapshot 逐字节一致；正式 checker 等待 vendor 源提交并更新 submodule pin。

## Risk And Rollback Points

- Request Intent/Active Task Scope 属于自然语言判断，不能误做成脚本硬编码。
- Hub 缩短后，任何未正确安装 owning skill 的精细 Bundle 都可能丢失规则，必须逐 alias 验证。
- Check-All 与 auto-loop 的停止/返回优先级最容易产生行为回归，应单独冻结场景。
- Git Gate 只能复用现有 `trellis-push`/`safe_commit.py` 边界，不新增隐式提交或确认状态。
- operation ID 和 managed marker 尽量保持稳定；需要回退时按 owner Patch 独立恢复。
