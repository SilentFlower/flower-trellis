# Brief — 修复 stale pointer 后任务意图重路由

## Goal

- 修复失效 task pointer 被注入为未知 workflow 状态的问题：清理 pointer 后，当前用户请求必须在同一轮重新进入既有 `no_task` 任务意图路由，不能直接编辑、误建任务或沿用历史任务归属。

## Scope

- 新增固定的 `missing_task` workflow-state，恢复正文只授权清理、失败停止和成功后同轮重分类。
- shared per-turn Hook 将 `stale_session`、`stale_session-fallback` 等动态状态统一为 `missing_task`。
- shared Hook whole-file Patch 覆盖上游实际分发 per-turn Hook 的 Claude、Codex、Gemini、Qoder、Copilot、CodeBuddy、Droid、Kiro、Trae 九个平台；缺失入口只跳过。
- 更新现有 Codex / Claude SessionStart stale 提示，移除清理后再次询问用户的旧行为，改为按 `no_task` 处理当前请求。
- 将 workflow、shared Hook、Codex/Claude SessionStart 修复纳入 `intent-routing` Bundle，使全装和 `task-intent` / `intent-routing` 精细安装都完整生效。
- 从 Skill-Garden 0.6 真实源生成 `enhancements/0.6`，再更新当前 dogfood 与 Patch provenance。
- 增加 fresh apply、beta.2 升级、精细安装、重复 apply、双 stale 来源、九平台目标、JS/Python consumer parity、snapshot 和上下文预算测试。
- 在 `enhancements-model.md` 沉淀 stale pointer intent recovery 契约。

## Non-Goals

- 不让 SessionStart 或 per-turn Hook 自动删除、修改 session runtime。
- 不改变 `task.py finish` 的生命周期语义。
- 不新增或修改 `discuss`、`inspect`、`direct_edit`、`task_plan`、`workflow_action` 五类意图定义。
- 不修改 0.5、old、上游 Trellis 源或 `node_modules`。
- 不为缺失的平台创建新的 SessionStart 或 per-turn Hook 文件。

## Key Context

- 根因是 shared Hook 返回动态 `stale_<source_type>`，workflow 没有对应标签，breadcrumb 退化为 `Refer to workflow.md for current step.`；`task.py finish` 又不会在当前用户轮次重新触发 Hook。
- `workflow-state` selector 只能替换已有 state body，因此新增 `missing_task` 必须使用带 managed marker 的 `literal insert after`，锚定唯一 `[/workflow-state:no_task]`。
- stale 正文不能复制完整 no_task 规则，只引用 `[workflow-state:no_task]` / `Request Intent Routing`，避免高频上下文与未来规则漂移。
- shared Hook 是 whole-file Patch。除上游 Trellis 0.6.5 `selector.py` 外，必须把 beta.2 旧强化版 Hook 保存为历史 baseline，否则已有项目升级会被 fingerprint drift 阻断。
- 扩大平台目标仍使用 `missing=skip`、`targetPolicy=each-existing` 和严格 whole-file fingerprint；未知用户改动必须失败，不能模糊覆盖。
- 真实源是 `vendor/skill-garden/.trellis/0.6`；`enhancements/0.6` 和当前 `.trellis` / `.codex` / `.claude` 都是派生产物，禁止先手改快照。
- 本任务涉及 workflow/hook 控制面，实施后必须走 full Check-All。

## Acceptance

- `session` 与 `session-fallback` stale 来源都输出同一 `missing_task`，不再出现泛化 fallback。
- stale breadcrumb 明确先执行 `python3 ./.trellis/scripts/task.py finish`；失败停止；成功后对当前请求同轮执行现有 `no_task` 分类；分类前禁止编辑、创建/启动任务或归入历史任务。
- Codex 与 Claude SessionStart stale 提示与 per-turn workflow-state 语义一致。
- fresh full apply、beta.2 旧 Hook 升级、两个精细 alias 和第二次重复应用全部通过；缺失平台不被创建。
- 普通 no_task、planning、in_progress 路由不回归，0.5/old 不漂移。
- JS/Python consumer、Patch provenance、vendor/snapshot/dogfood、默认及 strict AI context budget 全部一致并通过验证。
- `npm test`、相关 Python 语法检查、Patch conflict、snapshot 和 `git diff --check` 全部通过。

## Next Step

- 用户确认本 brief 与三件套后，运行 `task.py start`，随后先进入 `trellis-route(target=implement)`，按实施计划从 Skill-Garden 真实 Patch 源开始实现。
