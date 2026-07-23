# Brief — 修复 Workflow Gate 迁移兼容性回归

## Goal

- 修复 Gate 原生所有权迁移造成的全部已确认入口回归，并用真实状态、动作链与平台矩阵测试替代仅验证文字存在的假通过。

## Scope

- 把 Project Knowledge Discovery 和 Active Task Scope Guard 的完整 policy 收敛到所有请求都会经过的 `Request Triage`。
- 让 no-task workflow action 先发现项目 SOP，再进入准确 Trellis capability；避免把“发 beta”误路由到只生成上线操作单的 `trellis-release`。
- 为 planning/planning-inline 补齐与 in-progress 等价的 active-task 无关请求隔离。
- 把 Task Progress Recovery 的读取 owner 调整到 `trellis-continue`，在 Phase 判断前读取并克制展示 progress；`trellis-push` 继续只负责写入。
- 恢复 Brainstorm semantic readiness 与 Task Brief 显式确认：artifact 存在不等于 planning ready，刷新 brief 不等于用户确认。
- 让 implement route 完成后回到 Phase 2.1 Pre-Check；让普通 direct push 在 Git 动作前经过当前 Update-Spec 结果门禁。
- 把 Flower Gate Skill 分发到所有已安装平台的原生 skill root，并覆盖 Update-Spec/Finish-Work 的 17 平台原生入口。
- 更新 Hub owner 索引、workflow states、before-dev/brainstorm 指针、continue Patch、Bundle、conflict assertions、JS/Python consumer 测试和最终 dogfood。
- 同步 Skill-Garden 源、`enhancements/0.6` 快照和当前项目最终副本，并复核全部 Workflow Gate 无回退。

## Non-Goals

- 不修改 `spec_router.py` 的匹配算法或输出结构，不新增自动执行 Hook。
- 不恢复 Hub 完整 Gate 正文，不新增 Gate controller、平行状态机或持久 Gate 状态。
- 不新增通用 Gate controller，不改变上游平台的原生文件格式。
- 本任务不创建 release commit/tag，也不触发 npm/GitHub 发布。

## Key Context

- 根因是 owner 文字存在但真实请求/恢复状态不可达；现有测试只匹配 marker 和关键字符串。
- Skill-Garden vendor 是真实源；修改后必须 `npm run sync`，再更新 dogfood，禁止只改 `enhancements/` 或最终 `.trellis/.agents/.claude`。
- Request Triage 会进入 Phase summary 和 SessionStart，新增规则必须通过去重控制 context budget，不能提高阈值。
- progress recovery 只允许 relay `partialStep`、`nextStep`、必要 notes 和 helper candidates/warnings；不得自动 rebind、由 progress 推断 Phase、恢复旧 push mode 或 Git 编排。
- `intent-routing` 和 continue/progress 的选择性安装必须同时具备 policy、breadcrumb 和 runtime helper。
- planning readiness 与 brief confirmation 必须绑定当前 artifact 内容；artifact 变化后旧结论自动失效。
- 平台 root 映射必须集中复用；平台原生 skill/command/workflow/prompt/TOML 都要从真实入口验证。
- `0.6.0-beta.0` 发布保持暂停；完成修复、检查和推送后需重新 dry-run 并再次确认。

## Acceptance

- `Request Triage` 成为 Project Knowledge Discovery 与 Active Task Scope Guard 的唯一完整 policy owner。
- no_task、planning 两种变体和 in-progress 两种变体都能在正确时机进入对应一跳门禁。
- `trellis-continue` 在 Phase 判断前调用 `task_progress.py status --json`，且不越过恢复边界。
- auto-loop 在 planning semantic readiness 未通过或 brief 未显式确认时不能启动任务。
- implement route 必须回到 Pre-Check；普通 direct push 缺少当前 Update-Spec 结果时不能进入 Git 提交。
- Kiro-only 与 17 平台安装中，Flower Gate Skill 和 Update-Spec/Finish-Work 原生入口都使用当前策略。
- Hub owner 行、before-dev/brainstorm/state/push 内容与新所有权一致，不存在第二份完整 policy。
- reachability tests 能在旧实现上捕获全部已知回归，并覆盖 request、planning、brief、implement return、direct push、progress resume 和平台原生入口。
- Bundle 自包含、Patch conflict、strict context budget、源/快照/dogfood 一致性、两次应用幂等、`npm test`、snapshot 和 `git diff --check` 全部通过。
- 修复期间 npm `beta` 仍为 `0.5.0-beta.7`，没有生成或推送 release tag。

## Next Step

- 当前任务已在 `in_progress`，按已确认的全量修复范围继续实现；完成后回到 Phase 2.1 Pre-Check，再进入 Check-All。
