# Brief — 让 Update-Spec 自动决策并减少流程卡点

## Goal

- 让 `trellis-update-spec` 自主返回 `no-op`、`written` 或 `needs-review`；保留 Check-All 通过后的停止点，用户回复“下一步”后同一轮自动评估 spec，并让 `no-op` / `written` 直接进入 Trellis Push，仅真实规范歧义才再次停下。

## Scope

- 新增 vendor 0.6 `trellis-update-spec` skill override，定义证据优先级、三态结果、用户 skip、允许写入路径和 written 自校验。
- 保留 interactive Check-All 的现有停止边界；新增 post-check resume chain，让用户 next/continue 后同一轮运行 Update-Spec，并在 no-op/written 后直接进入 Trellis Push 计划。
- 增加 Trellis Push 前置兜底：passed Check-All 后若缺少有效 Update-Spec outcome，先补跑 Update-Spec。
- 保持 auto-loop `run_spec_update` action：no-op/written 记录 ok 并 next，needs-review 记录 blocked。
- 扩展 flower 与独立 `install.sh` 的 Update-Spec override 全装、精细安装别名和幂等测试。
- 同步 vendor、enhancements、dogfood，并更新 Phase 3.3 与上下文预算 code-spec。

## Non-Goals

- 不把 Update-Spec 改写为纯脚本，也不让它修改 `.trellis/spec/**` 之外的文件。
- 不移除或前移 Check-All 通过后的现有用户继续卡点。
- 不改变 Trellis Push 的最终确认、精确提交和 push 安全边界。
- 不改变 auto-loop action/schema、fix/recheck 预算或 commit-only 授权。
- 不改变 0.5 / old 行为。

## Key Context

- 上游 Update-Spec 正文保留；通过 `overrides/skills/trellis-update-spec.md` 注入高优先级自主决策契约。
- `skill-override-inject.js` 已支持通用 override，但 `apply-enhancements.js` 的精细安装 gate 当前只识别 finish-work，需要增加 Update-Spec 三个别名并同步独立安装器。
- written 只允许修改 `.trellis/spec/**`，并限制为承载新契约所需的最小章节和最少文件；必须读取任务、diff、源码、测试和现有 spec 证据，并在返回前完成 `git diff --check` 与定向复核。
- Check-All 有问题时仍保留一次修复范围选择；Check-All 通过后仍等待用户回复“下一步”，只移除该回复之后 Update-Spec 与 Trellis Push 之间的机械卡点。
- 完整三态矩阵只放 override；hub/state/Check-All 使用短 disposition，默认和 strict context budget 均需通过。

## Acceptance

- Check-All 通过后仍先停止，用户回复“下一步”前不运行 Update-Spec。
- 用户回复“下一步”或同义继续意图后，同一轮自动得到 Update-Spec 三态结果，不再询问是否更新 spec。
- no-op/written 在同一轮直接展示 Trellis Push 计划；needs-review 只问一个规范歧义问题且不展示 Push 计划。
- passed Check-All 后直接要求 push 且缺少 Update-Spec outcome 时，Push 前置门禁先补跑 Update-Spec。
- 用户明确跳过 spec 时返回带原因的 no-op；written 不越过 `.trellis/spec/**` 且完成自校验。
- written 不得顺带整理、扩写或格式化与新契约无关的 spec 内容。
- auto-loop 对 no-op/written 自动续跑，对 needs-review 正确 blocked。
- agents/claude/command override 注入、三个精细安装别名、缺目标跳过和二次运行幂等均有测试。
- vendor/snapshot/dogfood 一致，0.5/old 无漂移，上下文预算不通过抬高阈值规避 warning。

## Next Step

- 用户确认 planning artifacts 与本 brief 后，运行 `task.py start update-spec-auto-decision`，再进入 implement route。
