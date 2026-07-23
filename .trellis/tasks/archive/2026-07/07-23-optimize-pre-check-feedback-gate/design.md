# Design — 优化实现后检查卡点与暂缓状态

## 1. Problem Boundary

本任务只调整 Phase 2.1 完成后、进入 Phase 2.2 Check-All 之前的交互决策。现有 Interactive Post-Check Stop Gate、Check-All audit-only 语义、修复范围确认、修复后重检、Update-Spec 和 Push 门禁保持不变。

核心行为：

```text
首次实现完成
  -> 默认进入 Check-All

首次 Check-All 后发生追加修改
  -> 写入 session-scoped hold
  -> 实现 + 定向验证
  -> 停在 Check-All 前并持续引导

用户明确继续流程
  -> 清除 hold
  -> 进入 Check-All

validated auto-loop
  -> 忽略交互 hold
  -> 服从 runner outstanding action
```

## 2. Runtime Contract

在现有 `.trellis/.runtime/sessions/<context-key>.json` 中增加可选字段：

```json
{
  "pre_check_preference": {
    "version": 1,
    "task": ".trellis/tasks/<task>",
    "mode": "hold",
    "source": "user-explicit | follow-up-edit",
    "updated_at": "<UTC ISO-8601>"
  }
}
```

约束：

- 只持久化 `hold`；字段缺失即默认继续检查。
- `task` 必须等于当前 session active task；不匹配时忽略，不跨任务继承。
- 状态只属于当前 context key，不扫描其它 session 恢复，因此覆盖压缩和 resume，但不跨全新 AI session。
- 损坏或 I/O 错误返回结构化 miss/error，不覆盖原文件。
- 写入使用同目录临时文件、flush/fsync 和 `os.replace`，与现有 route/active-task runtime 可靠性保持一致。

## 3. Helper API

新增平台无关脚本 `.trellis/scripts/pre_check_state.py`，发布源位于 `vendor/skill-garden/.trellis/0.6/scripts/pre_check_state.py`。

CLI：

```bash
python3 ./.trellis/scripts/pre_check_state.py status
python3 ./.trellis/scripts/pre_check_state.py hold --source user-explicit|follow-up-edit
python3 ./.trellis/scripts/pre_check_state.py clear
```

默认输出紧凑 JSON；诊断时支持 `--verbose`。脚本通过 `common.active_task.resolve_active_task` 获取当前 task/context key，并公开只读函数供 SessionStart hook 复用，避免 hook 手写 runtime 解析。

状态解析优先级不由 helper 决定。helper 只负责确定性读写；当前用户消息是否覆盖 hold 仍由 workflow/AI 语义判断。

## 4. Pre-Check Resolution

准备进入 Check-All 时使用以下优先级：

1. validated auto-loop outstanding action：服从 runner。
2. 当前消息明确继续检查、下一步、提交或部署：清除 hold 并继续。
3. 当前消息明确暂缓或继续调整：写入/保留 hold。
4. 当前任务存在匹配 hold：停在 Check-All 前。
5. 无匹配状态：默认进入 Check-All。

“首次实现”指从任务启动进入的首轮 Phase 2.1；其完成后不得自动写入 hold。首次 Check-All 后的第一条用户追加修改，在开始编辑前写入 `follow-up-edit` hold，确保修改过程中发生压缩也能恢复。

暂缓状态下每次交付必须附带一条简短陈述式引导，例如：

> 修改已完成并通过定向验证。你可以继续提修改；准备检查时说“下一步”或“可以检查了”。

不得把引导写成机械选择题，也不得使用“收口”等不自然表述。

## 5. Workflow Placement

- Workflow hub：只增加一条跨阶段边界，说明首次实现默认检查、匹配 hold 时停在 Phase 2.2 前、auto-loop 优先。
- Phase 2.1 walkthrough：保存完整的识别顺序、helper 调用和引导行为。
- Phase 2.2 walkthrough：进入检查前清除匹配 hold；其它 Check-All 规则不变。
- `workflow-state:in_progress*`：最多保留一句“一跳动作”，不复制 helper schema或完整优先级。

不修改 Check-All skill 的 Interactive Post-Check Stop Gate。

## 6. SessionStart Injection

Codex/Claude 等 SessionStart hook 已通过 `resolve_active_task` 获得当前 task 和 context key。在 compact current-state 构建期间调用 helper 的只读函数：

- 无匹配 hold：不输出任何新行。
- 有匹配 hold：追加一行 `Pre-check: deferred for current task; latest user intent may override.`
- helper 缺失、状态损坏或读取失败：静默省略动态提示，工作流安全退化为默认检查。

不在每轮 workflow-state 动态注入 hold 详情，避免高频 token 成本；正常对话依赖当前上下文，压缩/resume 由 SessionStart 恢复。

## 7. Auto-Loop Isolation

- `auto_loop.py` action schema和状态迁移保持不变。
- 启动或恢复 auto-loop 前，`trellis-auto-loop` skill 调用 `pre_check_state.py clear`；清理失败且状态损坏时记录诊断，但不得把交互偏好当作 runner 阻塞依据。
- validated runner 的 `run_implement -> run_check_all`、`run_fix -> run_recheck` 不读取 hold。
- auto-loop 运行期间用户明确暂缓时，使用 runner 的 blocked/retry 机制；不写交互 hold。

## 8. Distribution And Compatibility

- 先修改 `vendor/skill-garden/.trellis/0.6` 源文件和 Patch 定义。
- `npm run sync` 生成 `enhancements/0.6` 快照。
- Flower 的 `copyScriptAssets` 为 `pre_check_state.py` 增加精细安装别名，确保相关 workflow/route/auto-loop 安装路径携带 helper。
- 应用增强后验证 dogfood `.trellis/scripts`、workflow、hooks 和平台 skill 一致。
- 旧项目没有新字段时行为保持“默认进入检查”；无需 runtime migration。

## 9. Failure And Rollback

| 场景 | 行为 |
| --- | --- |
| 无 context key | helper 返回 miss；默认进入检查 |
| session runtime missing | 无法安全确认当前任务，`status/hold/clear` 返回 `miss reason=no-current-task`；默认进入检查且不创建文件 |
| session runtime corrupt/I/O error | 不覆盖；返回结构化错误；默认进入检查 |
| hold task 与 current task 不匹配 | 忽略；下一次 hold 写入当前任务状态 |
| SessionStart 无 helper | 省略动态提示，不阻断会话 |
| auto-loop 存在陈旧 hold | 启动/恢复时清除，runner 正常推进 |

回滚时删除 helper、workflow/SessionStart Patch 和 skill 调用即可；runtime 中遗留字段对旧代码无影响。

## 10. Context Budget

- Hub/state 通过替换现有相邻语义控制净增长，不复制完整流程。
- SessionStart 动态行只在 hold 存在的 fixture 中测量；默认 fixture 应保持零动态增长。
- 运行默认与 strict AI context budget，记录 workflow、workflow-control、phase-summary、session-start 和 control-context-total 的实际增量。
