# Brief — 优化 Check-All 检查与修复体验

## Goal

- 将 0.6 `trellis-check-all` 调整为 collect-all 审查：一次完成可继续的只读检查，统一输出问题清单，并在进入修改前仅确认一次修复范围。

## Scope

- 为低风险局部变更增加适用维度快速路径，支持通过、未通过、部分验证、阻塞和 `N/A`。
- 以稳定 `CHK-*` ID、影响级 P0/P1/P2、固定证据字段和修复批次统一检查报告。
- 增加与检查报告对称的修复结果，并让批量修复复用 implement route、重检复用 check route。
- 让 inline 与 subagent 使用相同的 audit-only 语义；subagent 不再回退到强制自修复的 `trellis-check` agent。
- 修改 skill-garden 0.6 的 `trellis-check-all` / `trellis-route` 双平台源副本，生成 `enhancements/0.6` 快照并同步当前 dogfood 副本。

## Non-Goals

- 不修改 0.5 或 old 变体。
- 不修改 Trellis npm 包内置 `trellis-check`、平台 agent 模板或新增专用 agent 安装链路。
- 不重设计 route 偏好机制、auto-loop runner、Phase 3.4 提交推送流程或 Check-All 三维核心模型。
- 不引入新的自动化测试框架，也不持久化新的检查报告状态文件。

## Key Context

- 当前 Step 1/2 的“发现问题立即暂停”造成逐项询问；Step 3 委托的 `trellis-check` 及现有 check agent 又带有自动修复语义。
- 普通模式必须区分只读检查与写入修复：检查跑完后只确认一次；auto-loop 则沿用 `record failed -> run_fix -> run_recheck`。
- `subagent check-all` 优先使用明确 audit-only 的专用 agent，否则使用通用只读 subagent；没有兼容 subagent 时阻塞并要求改选 inline，禁止静默回退到 `trellis-check`。
- 源文件位于 `vendor/skill-garden/.trellis/0.6/`，必须先改源再运行 `npm run sync`，不能直接把 `enhancements/0.6` 当作源。
- Post-check 报告不得包含 commit message、拟提交文件、暂存计划或提交确认；只有检查通过后才进入 Phase 3.3 / Phase 3.4。
- vendor 与父仓是两个 Git 仓库；`node scripts/check-snapshot.mjs` 需在双仓提交完成后验证。
- Phase 3.4 必须先通过 `trellis-push` 交付 vendor，再运行 `npm run sync` 更新 manifest 和快照，最后交付父仓；不能用一个静态多仓计划跳过中间重新生成。

## Acceptance

- 普通问题全部进入统一清单，不在检查过程中逐项询问；只有业务歧义、检查前提失效或破坏性风险会立即暂停。
- 小型文案或普通配置变更能跳过不适用维度，未验证环境不会被误报为通过。
- 每个独立根因具有稳定 `CHK-*` ID、影响级严重度、来源、证据、影响、建议、位置和验证方式。
- 检查报告顺序固定，末尾仅提供一次 `修复全部`、按 ID 修复或仅保留报告的选择。
- 确认后批量修复并统一重检；修复结果沿用原问题 ID，新根因继续编号。
- inline、subagent、普通流程和 auto-loop 均遵守各自授权边界，且不破坏 route 复用与 Post-check Stop Gate。
- 0.6 双平台源、发布快照和 dogfood 副本一致，0.5/old 无变化，context manifest 与静态检查通过；Phase 3.4 双仓交付后 `check-snapshot` 通过。

## Next Step

- 用户确认本 brief 和 planning artifacts 后运行 `task.py start`，随后进入 `trellis-route(implement)`，按选定模式实施。
