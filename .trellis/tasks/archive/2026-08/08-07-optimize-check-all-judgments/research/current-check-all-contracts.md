# Current Check-All Contracts

## Canonical And Distribution

- Check-All 0.6 真实源位于 `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-check-all/` 与对应 `.claude` 目录。
- `enhancements/0.6/` 由 `npm run sync` 从 vendor 源生成，不得直接作为修改源。
- `vendor/skill-garden/compiled-targets/` 由 `npm run patch:targets` 生成，并由 `npm run patch:targets:check` 做逐文件零漂移检查。
- 当前项目 `.agents/`、`.claude/` 和适用 workflow/agent 文件是 dogfood 投影，必须在 canonical 与 snapshot 完成后更新并验证二次应用零变化。
- 0.5 和 old 变体不属于本任务范围。

依据：

- `.trellis/spec/flower-trellis/cli/enhancements-model.md`
- `.trellis/spec/flower-trellis/cli/trellis-patch-engine.md`
- `package.json`

## Context Budget

- 项目规范要求优先 `replace/remove` 旧规则，禁止保留旧规则后追加高优先级覆盖段。
- 预算必须看 canonical/final 产物和真实运行输出，不能只测 Patch source。
- 不得通过提高 target 或 review ceiling 掩盖重复内容。
- 本任务开始时 Check-All canonical `.agents` 默认必读集合为 39,696 UTF-8 bytes，其中主 `SKILL.md` 为 7,916 bytes。
- 现有全局 `check-ai-context-budget.mjs` 不单独统计 Check-All，因此本任务需要专项测试守卫上述基线。

依据：

- `.trellis/spec/flower-trellis/cli/ai-context-budget.md`
- canonical Check-All 文件的 `wc -c` 结果

## Current Routing And Findings

- `depth-routing.md` 当前先处理显式 full，再处理任一 hard-full；只有未命中 hard-full 才可能进入显式 light 或 auto light eligibility。
- 当前 hard-full 直接列出 workflow、skill、command、hook、生成快照以及安装、升级、发布、push/commit 控制面等主题域。
- 当前 `fallback-findings.md` 要求具体位置、可达场景、问题证据、保护收益和验证方式全部满足后才生成 `FBK-*`。
- 当前 reporting 使用既有 `CHK-*`、`FBK-*`、`DOC-*`、验证字段、维度状态和未覆盖风险；本任务不新增平行报告模型。

依据：

- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-check-all/references/depth-routing.md`
- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-check-all/references/fallback-findings.md`
- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-check-all/references/reporting-and-disposition.md`

## Auto Remediation And Runner

- 专用 Check-All subagent 是严格 audit-only，只返回 `CHK-*`、`FBK-*` 和 `DOC-*` 候选，不写工作区。
- 主会话负责应用允许的 `DOC-*` 自动修复。
- auto-loop 的 `--doc-remediation-file` 只允许当前任务 `implement.md` 与 `brief.md`，用于 planning/handoff artifact 重绑定。
- 源码注释变化不属于该参数；注释修复后仍必须重新核对实际 diff、检查画像和定向验证。

依据：

- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/references/check-all-agent-body.md`
- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-check-all/references/document-drift-auto-remediation.md`
- `vendor/skill-garden/.trellis/0.6/scripts/auto_loop.py`
