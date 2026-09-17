# workflow-state 条件注入与低频心跳技术设计

## 1. Scope

本任务调整 Codex 与 Claude 主会话中的 workflow-state 注入节奏：

- `startup`、`clear`、`compact` 继续运行现有三段 SessionStart，并在 `state` 分段中附带完整的当前 workflow-state。
- 普通 `UserPromptSubmit` 只在当前完整状态发生变化时重新注入。
- 状态连续 5 次未变化时注入一次包含当前动作的短心跳。
- Gemini、Qoder、Copilot、CodeBuddy、Droid、Kiro、Trae、ZCode 等共享 Python Hook 平台保持逐轮完整注入。

不改变 Trellis 状态机、状态正文的业务规则、任务生命周期或各阶段 owner。

## 2. Ownership And Distribution

workflow-state Hook 的持久修改入口仍是 Skill-Garden 0.6 source：

```text
vendor/skill-garden/.trellis/0.6/
  overrides/patches/hooks/inject-workflow-state/shared-runtime/
                         |
                         | npm run sync
                         v
              enhancements/0.6 snapshot
                         |
                         | Patch Engine / Flower Plugin Runtime
                         v
              compiled targets + dogfood hooks
```

SessionStart 包装器的持久修改入口是 `src/assets/flower_session_start.py`，由 Flower builtin Plugin 投影到 `.trellis/scripts/flower_session_start.py`。不得只修改当前 `.codex/`、`.claude/`、`.trellis/scripts/` 或 `enhancements/` 部署结果。

共享 Python Hook 文件继续保持字节一致；运行时仅在检测到 `codex` 或 `claude` 时启用条件注入，其他平台沿用原输出路径。

## 3. Runtime Record

条件注入状态写入独立的 gitignored 目录：

```text
.trellis/.runtime/workflow-state/<sha256(platform:context-key)>.json
```

不复用 `.trellis/.runtime/sessions/*.json`，避免高频计数写入与 active task、untracked flow 更新发生读改写覆盖。记录结构为：

```json
{
  "version": 1,
  "platform": "codex",
  "fingerprint": "<sha256-of-full-context>",
  "unchangedTurns": 0,
  "heartbeatTurns": 5,
  "updatedAt": "<UTC>"
}
```

- context key 复用 `common.active_task.resolve_context_key()`，保证会话窗口隔离。
- 文件名只保存摘要，不暴露原始 session ID。
- 写入采用同目录临时文件、flush、fsync、`os.replace` 的原子替换方式。
- 无法解析 context key 时不共享记录，当前轮完整注入。
- 记录缺失、损坏、版本不支持或写入失败时完整注入；可安全写入时重建记录。

## 4. Full-State Fingerprint

指纹输入是该平台本轮准备交付的完整 `additionalContext`：

- Claude：完整 `<workflow-state>`。
- Codex：必要的 `<trellis-bootstrap>`、`<codex-mode>` 与完整 `<workflow-state>` 拼接结果。

因此以下变化会自然改变指纹：

- active task ID 或 task status；
- untracked work ID、阶段或摘要；
- 当前 `[workflow-state:*]` 正文；
- Codex `dispatch_mode`；
- fallback、missing-task 或相关动态标题内容。

心跳间隔不进入完整状态指纹。配置变化时更新记录中的 `heartbeatTurns` 并重置计数，不为此重复完整业务规则。

## 5. Event Flow

### 5.1 SessionStart

`flower_session_start.py --part state` 完成原生 state 构建后，以内部参数调用对应平台的 `inject-workflow-state.py`：

```text
--trellis-session-start-refresh
```

该模式复用与 `UserPromptSubmit` 完全相同的状态解析和渲染逻辑，执行两件事：

1. 无条件返回完整当前 workflow-state 上下文，由包装器追加到 `state` 分段。
2. 写入当前指纹并把 `unchangedTurns` 重置为 0。

仅 `state` 分段执行该副作用；`rules`、`stages` 仍可独立并行。`resume` 保持零输出并沿用已有运行记录。内部刷新失败时保留原生 SessionStart 内容并输出可见诊断；下一次普通输入通过完整注入降级恢复。

### 5.2 UserPromptSubmit

Codex 与 Claude 的决策顺序：

```text
解析当前完整上下文
       |
       v
记录缺失/损坏/无 context key/写入失败? --是--> 完整注入
       |
       否
       v
fingerprint 变化? ---------------------是--> 完整注入，计数归零
       |
       否
       v
heartbeatTurns == 0? -----------------是--> 静默
       |
       否
       v
unchangedTurns + 1 达到阈值? ----------是--> 短心跳，计数归零
       |
       否
       v
静默并保存累计值
```

`no-trellis` 在读取和更新计数之前返回，因此跳过轮次不计入 5 次心跳周期。

其他平台不读取或写入该记录，继续输出完整 breadcrumb。

## 6. Heartbeat Contract

心跳不能只提供机器标签。输出必须同时包含当前 subject、动作摘要和完整规则指向：

```xml
<workflow-state-heartbeat>
Task: workflow-state-heartbeat (planning)
Action: Planning is not implementation permission. Load `trellis-brainstorm` and stay in planning while requirements remain unclear.
State unchanged for 5 user turns. Continue following the latest full <workflow-state> block.
</workflow-state-heartbeat>
```

动作摘要从当前选中的 `[workflow-state:*]` 正文提取第一条非空、非 HTML 注释行。现有各状态的第一条可见行均是当前阶段的一跳动作；这种约定继续保持 `.trellis/workflow.md` 为唯一规则来源，不增加脚本内状态文案映射。找不到有效正文时使用现有 `Refer to workflow.md for current step.` 降级文本。

untracked heartbeat 额外保留当前 work summary；task heartbeat 保留 task ID 和 status。Codex inline 状态使用实际选中的 `planning-inline` 或 `in_progress-inline` 正文。

## 7. Configuration

在现有配置段增加：

```yaml
prompt_injection:
  skip_keyword: "no-trellis"
  heartbeat_turns: 5
```

- 缺省值为 `5`。
- 正整数表示连续多少次未变化输入后发送心跳。
- `0` 关闭心跳，但状态变化和 SessionStart 完整刷新仍生效。
- 非整数或负数回退默认值，不改变现有 `skip_keyword` 语义。

## 8. Compatibility And Failure Handling

- 已安装的其他 Python 平台输出保持逐轮完整注入，Hook 文件仍可共享同一 Patch 结果。
- 没有 SessionStart 记录的 Codex/Claude 会在首个用户输入完整注入并建立记录。
- `clear`、`compact` 使用同一 session ID 时覆盖记录并归零；session ID 改变时自然进入新的隔离记录。
- tracker 属于可重建的提示优化状态，损坏时允许在完整注入后覆盖，不影响任务 runtime。
- SessionStart 刷新失败不能吞掉原生 state、Astra 提示或既有诊断。
- 全局 Hook 禁用、Codex non-interactive 和 `resume` 的现有零输出边界保持不变。

## 9. Context Budget

当前实测 state 分段约为：Codex 默认 1944 字符、Codex Astra 3956 字符、Claude 1951 字符。当前最长 `no_task` 完整 Codex 上下文约 2965 字符；追加后约 6921 字符，仍低于现有 8000 字符分段告警线。

验证必须测真实最终 Hook 输出：

- SessionStart 的三段最终 `additionalContext`；
- 状态变化时的完整输出；
- 第 5 次未变化输入的心跳输出；
- 其他平台逐轮完整输出不变。

## 10. Rollback

- 发布前回滚：撤销 Skill-Garden source Patch、Flower SessionStart asset、测试与生成产物，再重新同步 compiled targets 和 dogfood。
- 已安装项目回滚：旧 Hook 忽略 `.trellis/.runtime/workflow-state/`，残留记录为 gitignored 可重建缓存，不影响任务状态。
- 单个项目临时关闭心跳可设置 `prompt_injection.heartbeat_turns: 0`；条件注入仍保留状态变化与生命周期刷新。
