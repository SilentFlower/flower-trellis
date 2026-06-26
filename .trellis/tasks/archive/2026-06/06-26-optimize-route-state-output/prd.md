# 优化 route_state 输出冗余

## Goal

降低 `.agents/skills/trellis-route/scripts/route_state.py` 命令输出进入 AI 上下文时的 token 噪音，同时保留 route 决策恢复、调试定位和现有 runtime 文件兼容性。

## Requirements

- 默认命令输出应只包含主 agent 执行 route 决策所必需的信息。
- 诊断类字段应有明确用途；若默认输出不需要，应通过可选方式查看。
- 不改变 `.trellis/.runtime/sessions/<context-key>.json` 的持久化结构和 route 决策校验语义。
- 不降低压缩恢复后复用 route 决策的可靠性。
- 同步检查 `trellis-route/SKILL.md` 对 helper 输出字段的描述，避免文档要求和脚本输出不一致。
- 失败、未命中、命中 runtime、命中个人偏好、写入和清除偏好等路径都应保持机器可解析。
- 输出优化应保持向后兼容或提供清晰迁移边界，避免破坏现有 skill 调用流程。

## Acceptance Criteria

- [ ] `route_state.py resolve --target implement|check` 的默认输出比当前少返回非必要诊断字段。
- [ ] 需要排查 session/path/prefs 时，仍可通过明确方式获得这些诊断信息。
- [ ] runtime state 写入内容保持不变，已有 `route_decisions` 数据仍可读取和校验。
- [ ] `trellis-route/SKILL.md` 与 helper 实际输出保持一致。
- [ ] 至少验证无 active task、active task miss、runtime hit、prefs hit、write、clear-pref 这些主要分支的输出可解析。

## Notes

- 当前讨论判断：单次 helper 输出通常低于 200 token，但 route 流程会重复进入上下文，仍有优化价值。
- 候选方向：保留默认精简输出，并提供类似 `--verbose` 的诊断输出模式。
- 本任务范围是本项目内 Trellis route skill 和关联说明，不默认修改 npm 包缓存或上游源码。
