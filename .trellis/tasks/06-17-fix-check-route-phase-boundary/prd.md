# 修正 2.2/3.1 检查路由边界

## Goal

修正 flower-trellis / skill-garden 对 Trellis 0.6 workflow 的覆盖语义：保持 upstream Trellis 的 Phase 2.2 为 `trellis-check` 执行点，并把 `trellis-route(check)` 绑定到 Phase 2.2；Phase 3.1 不再强制触发 check 路由，只做提交前最终确认，避免实现后出现两次独立 check 选择或 2.2 绕过 route 直接派子代理。

## Requirements

- R1: Phase 2.2 必须恢复为 check 执行边界；在 sub-agent 平台可派 `trellis-check`，但必须由 `trellis-route(check)` 或等价编号 fallback 决定 inline/subagent。
- R2: Phase 3.1 不得再要求先执行 `trellis-route(check)`；它应表达为 final/pre-commit verification：确认 2.2 已通过，只有代码在 2.2 后又变化、用户明确要求复查、或存在高风险时才再次运行检查。
- R3: `trellis-route` skill 的适用范围必须改为 Phase 2.1 `target=implement` 与 Phase 2.2 `target=check`；普通 check 路由仍默认提供 check-all inline/subagent，轻量 `trellis-check` 仍保留为用户显式要求时的隐藏逃生口。
- R4: 0.6 覆盖源、发布快照、当前本地 workflow 和平台 skill 副本必须保持一致，避免 `flower-trellis update` 后再次注入错误语义。
- R5: 不修改 upstream Trellis 原生 workflow 正文的 2.2 check agent 能力；本任务只修正 skill-garden/flower 的高优先级覆盖与路由说明。
- R6: 保留 post-check stop gate、Phase 3.4 `trellis-push` 门禁和 `/trellis:finish-work` explicit-only 规则。

## Acceptance Criteria

- [ ] `.trellis/workflow.md` 的 skill-garden hub 与 `workflow-state:in_progress` 明确：2.1 route implement，2.2 route/check 执行，3.1 不强制 route check。
- [ ] `enhancements/0.6/overrides/workflow.md`、`workflow-states/in_progress.md`、`workflow-states/in_progress-inline.md` 与本地 workflow 语义一致。
- [ ] `vendor/skill-garden/.trellis/0.6/overrides/**` 中对应文件与 `enhancements/0.6/overrides/**` 保持一致。
- [ ] `.agents/skills/trellis-route/SKILL.md` 与 `.claude/skills/trellis-route/SKILL.md` 不再声明 Phase 3.1 是普通 check route 入口，改为 Phase 2.2。
- [ ] `enhancements/0.6/.agents/skills/trellis-route/SKILL.md` 与 `enhancements/0.6/.claude/skills/trellis-route/SKILL.md` 同步更新。
- [ ] 搜索 0.6 主路径时，不再出现“Phase 2.2 不是 standalone route entry / Phase 3.1 final check route”这类与目标相反的文案。
- [ ] 语法/一致性检查通过，至少运行 `node --check` 相关 JS 文件，并比较 vendor 与 enhancements 对应覆盖文件一致。

## Notes

- 已核对 Trellis upstream 当前 `main`：Phase 2.2 是 `Spawn the check sub-agent` / inline `trellis-check` 执行点；Phase 3.1 是 final verification。
- 本任务修正的是 `da8ffe7b` 后的方向偏差：该提交把 2.2 从 route 中移除，并把 check route 放到 3.1，导致 2.2 仍按 upstream 正文直接派 `trellis-check`，但缺少 route gate。
