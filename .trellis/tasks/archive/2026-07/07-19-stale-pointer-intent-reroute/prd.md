# 修复 stale pointer 后任务意图重路由

## Goal

修复 Trellis 会话残留 stale task pointer 时的任务意图路由缺口：AI 清理失效指针后，必须在同一轮重新把当前用户请求按 `no_task` 规则分类，在完成分类前不得直接修改代码或创建错误归属的任务。

## Background

- 已复现的 Codex session `019f7ad7-a201-7a11-a204-a5c7cfc049b1` 运行于 Flower `0.5.0-beta.2`。SessionStart 检测到已不存在的任务目录，注入 `STALE POINTER`；UserPromptSubmit 随后注入 `stale_session-fallback`，但没有匹配的 workflow-state 正文。
- shared workflow-state Hook 会把 stale 状态动态编码为 `stale_<source_type>`，当前可能得到 `stale_session` 或 `stale_session-fallback`。证据：`vendor/skill-garden/.trellis/0.6/overrides/patches/hooks/inject-workflow-state/shared-runtime/content.py:178`。
- workflow 目前只定义 `no_task`、`planning`、`planning-inline`、`in_progress`、`in_progress-inline` 等状态，没有 stale recovery 状态；未知状态会退化为 `Refer to workflow.md for current step.`。证据：`.trellis/workflow.md:329`、shared runtime Hook `content.py:330`。
- Codex SessionStart 的 stale 分支只要求执行 `task.py finish`，没有要求清理后对当前请求重新进行意图识别。证据：`.codex/hooks/session-start.py:237`。
- `task.py finish` 在 agent 执行期间只清理 session runtime pointer，不会触发同一用户轮次的第二次 UserPromptSubmit Hook。因此如果 stale breadcrumb 未明确要求“清理后重路由”，AI 会继续沿用当前轮上下文，可能直接进入 `direct_edit`。
- Flower `0.5.0-beta.1 -> beta.2` 保留了 `no_task` 的意图路由语义；beta.2 主要重组 Patch Engine 和高频提示结构。根因是近期任务意图路由与既有 stale-pointer 恢复路径之间缺少显式集成，而不是普通提示优先级覆盖。

## Requirements

### R1. 新增明确的 stale recovery 状态

- stale pointer 必须统一映射到固定、可测试的 `missing_task` workflow-state，不再依赖 `stale_<source_type>` 的动态状态名落入未知状态 fallback。
- stale recovery breadcrumb 必须明确：该状态只授权清理失效指针，不是实现、直接修改或任务创建授权。
- 清理命令保持现有 `python3 ./.trellis/scripts/task.py finish`，Hook 本身继续只读，不自动修改 runtime。

### R2. 同一轮重新执行任务意图识别

- stale pointer 清理成功后，AI 必须在同一轮把当前用户消息重新视为无活动任务请求，并按 `discuss`、`inspect`、`direct_edit`、`task_plan`、`workflow_action` 分类。
- 完成重新分类前，不得编辑代码、启动实现、调用 `task.py start`，也不得把当前请求归入已经失效的历史任务。
- 分类后的动作继续复用现有 `no_task` 契约，不复制一套新的意图判定规则。
- 如果 `task.py finish` 失败，必须报告失败并停止，不得假设指针已经清理。

### R3. SessionStart 与每轮 Hook 保持一致

- stale recovery 作为 shared workflow-state 契约覆盖所有使用该 Hook 的平台，不仅修复 Codex。
- SessionStart 的 stale 状态摘要必须提示“清理后重新分类当前请求”，避免首次启动上下文与每轮 breadcrumb 语义不一致。
- Codex 与 Claude 已存在独立 SessionStart 入口，因此同步追加一致提示；没有对应 SessionStart Patch 的平台不创建新入口。
- UserPromptSubmit / BeforeAgent workflow-state Hook 必须为 stale 状态加载 workflow 中的权威恢复正文，不得退化为泛化 fallback。
- 高频注入只保留恢复边界和 `no_task` 权威指向；确定性状态解析继续由 shared runtime Hook 负责，避免在 hub、state 和 Hook 中复制长规则。

### R4. 强化源、快照与兼容

- 先修改 `vendor/skill-garden/.trellis/0.6` 的真实 Patch 源，再运行 `npm run sync` 生成 `enhancements/0.6`。
- 同步当前 dogfood workflow、Codex/Claude Hook 副本及 Patch provenance；不得只修改生成快照或当前项目副本。
- 0.5、old 和官方 Trellis 源保持不变。
- 新增或调整的 Patch 必须支持重复应用幂等、required preflight 和现有首次备份语义。

### R5. 回归验证

- 自动化测试至少覆盖 `stale_session` 与 `stale_session-fallback` 两种来源，验证它们都进入同一稳定恢复状态。
- 验证 stale breadcrumb 包含：先执行 `task.py finish`、失败则停止、成功后同轮进入 `no_task` 意图分类、分类前禁止编辑。
- 验证普通 `no_task`、planning、in_progress 路由不受影响。
- 验证 fresh apply、精细安装、重复 apply、JS/Python consumer parity、snapshot/dogfood 一致性和 AI context budget。

## Acceptance Criteria

- [ ] 构造指向不存在任务目录的 session runtime 后，workflow-state Hook 不再输出 `Refer to workflow.md for current step.`。
- [ ] `session` 与 `session-fallback` stale 来源都输出同一稳定 stale recovery 语义。
- [ ] stale recovery 明确禁止把清理动作解释为 implementation permission。
- [ ] `task.py finish` 成功后，当前请求必须按现有 `no_task` 规则重新分类；复杂实现请求创建 planning task，检查/讨论请求保持只读，明确 direct edit 才进入未跟踪修改。
- [ ] `task.py finish` 失败时不执行后续修改或任务创建。
- [ ] Codex 和 Claude SessionStart stale 摘要与 per-turn workflow-state 保持一致。
- [ ] 现有 `no_task` 意图路由正文只有一个权威来源，没有在 stale state 中复制完整规则。
- [ ] 0.6 Patch 全装、`task-intent` / `intent-routing` 精细安装和重复安装均正确、幂等。
- [ ] `npm test`、Python 语法检查、`npm run sync`、snapshot/dogfood 一致性、默认及 strict AI context budget 全部通过。

## Out Of Scope

- 不让 SessionStart 或 UserPromptSubmit Hook 自动删除或修改 session runtime。
- 不改变 `task.py finish` 的既有生命周期语义。
- 不修改任务意图分类的五种类型及其现有产品定义。
- 不为 0.5、old 变体补同等能力。

## Notes

- 任务由 `task_intent.py create` 自动创建，dirty baseline 为空。
- 范围决策：shared workflow-state Hook 覆盖所有适用平台；Codex/Claude SessionStart 追加一致提示，不为缺失入口的平台创建新文件。
- 升级兼容：shared Hook whole-file Patch 必须同时接受 Trellis 0.6.5 上游原始内容和 Flower beta.2 旧强化内容，避免已有项目升级时发生 fingerprint drift。
- 本任务涉及 workflow/skill/hook 注入控制面，属于 complex task；在 `task.py start` 前必须补齐 `design.md` 与 `implement.md`，并执行完整 Check-All。
