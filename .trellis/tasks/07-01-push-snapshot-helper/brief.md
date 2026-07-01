# Brief — 设计 push snapshot helper

## Goal

- 为 `trellis-push` 的任务进度快照提供轻量 Python helper，统一 `task.json.last_push_snapshot` 的读取、校验和写入，减少 AI 手工改 JSON 的风险。

## Scope

- 新增 `.trellis/scripts/push_snapshot.py` 形态的 helper，支持 `status` 与 `write` 两个子命令。
- 更新 `trellis-push` 文案，使 Step 0 读取旧 snapshot、Step 5 写入新 snapshot 时使用 helper。
- 更新 `src/lib/copy-scripts.js`，让全装和 `--skills trellis-push` 等精细安装都能铺设 `push_snapshot.py`。
- 同步 vendor、enhancements 和当前 dogfood 副本，保持脚本与 skill 文案一致。

## Non-Goals

- 不新增完整 resume runner。
- 不替代 `trellis-push` 的计划、确认、git 安全门禁、commit / push / merge 行为。
- 不接入或修改 `session-start.py`、`inject-workflow-state.py`、`trellis-continue`。
- 不自动判断任务 phase，不根据聊天摘要或 runtime 状态推断进度。

## Key Context

- 源文件优先改 `vendor/skill-garden/.trellis/0.6/`，再运行 `npm run sync` 生成 `enhancements/0.6`。
- 当前 dogfood 也需要同步 `.trellis/scripts/push_snapshot.py` 与 `.agents` / `.claude` 的 `trellis-push/SKILL.md`。
- `push_snapshot.py write` 只更新 `last_push_snapshot` 字段；snapshot 语义仍由 `trellis-push` 计划生成并经用户确认。
- schema 校验应覆盖必填字段和明显类型错误，但不校验 git、branch、commit hash 或 phase。

## Acceptance

- PRD / design / implement 明确 helper 边界、接口和非目标。
- 新脚本通过 `python3 -m py_compile`。
- `trellis-push` Step 0 / Step 5 使用 helper 的文案完成更新。
- `copy-scripts.js` 支持 `push_snapshot.py` 的精细安装别名。
- vendor、enhancements、当前 dogfood 脚本和 skill 副本保持一致。
- 行为验证覆盖合法写入、非法 schema 拒绝、无 active task 候选查询、无 snapshot 查询降级。

## Next Step

- 用户确认 planning artifacts 和本 brief 后，运行 `task.py start`，再进入 Phase 2.1 implement route。
