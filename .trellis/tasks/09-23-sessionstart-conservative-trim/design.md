# SessionStart 保守精简设计

## 1. 目标与边界

在不改变 Trellis 路由、授权、任务生命周期、auto-loop、更新确认和物理 GC 行为的前提下，减少
SessionStart 常驻上下文。修改只处理已经确认的五类内容：普通重复说明、平台派发说明、步骤编号历史、
更新事件顺序和 GC 机制介绍。

本任务不通过提高预算、截断正文或删除 owner 索引换取通过。完成态以真实生成结果和行为回归为准，
1,089 字节仅是规划估算。

## 2. 所有权与数据流

最终 SessionStart 内容来自四层，必须按作者源修改后再生成，不直接把部署副本当作真源：

```text
Trellis 上游 workflow / 原生 SessionStart Hook
  -> Skill-Garden Patch（workflow、Hook、平台入口）
  -> compiled targets
  -> Flower enhancements 快照
  -> 当前项目 dogfood 投影
  -> Flower 分段包装器（Codex / Claude state、rules、stages）
```

所有权固定如下：

| 内容 | 作者源 | 设计动作 |
| --- | --- | --- |
| owner 表与跨阶段摘要 | Skill-Garden workflow Hub Patch | 保留 17 项 owner 行，只移除更新与 GC 的常驻机制句 |
| Phase 摘要、Guardrails、3.1 历史说明 | Skill-Garden workflow Patch | 使用有 baseline 的精确替换或删除，不改阶段详情正文 |
| `<ready>` | 原生 SessionStart Hook Patch | 删除重复块，保留 current-state、task-status、guidelines 和首答提醒 |
| 平台派发摘要 | 原生 SessionStart 摘要生成函数 + 平台入口 | 已识别平台只输出共同协议和本平台补充；未知平台保留完整原文 |
| 更新确认顺序 | `src/assets/flower_update_hook.py` | 仅在真实更新事件块中补足先后顺序和授权说明 |
| GC 执行与结果 | `src/assets/flower_session_start.py` / `task_lifecycle.py` | 不改执行；继续仅在 moved、migrated、deferred 或 error 时输出结果 |

## 3. 常驻 workflow 精简

新增一个窄的 workflow 精简 Patch，避免把这些变更塞进无关 owner：

- Phase 1.3 改为“子代理派发前配置任务上下文；inline 跳过”，移除常驻平台枚举。
- 删除 Phase 3 中步骤 3.1 的历史解释，保留 3.2、3.3、3.4、3.5 的编号和阶段详情加载方式。
- 删除 Guardrails 中重复的 PRD-only 句；`Planning Artifacts` 仍保留轻量任务与复杂任务的完整产物契约。
- Hub 的 `Flower Update Confirmation`、`Deferred Physical GC` 两行及其 runtime owner 原样保留；
  `Cross-stage ordering` 只移除第 1 条更新说明和第 5 条 GC 机制说明，其余顺序重新编号但语义不变。

Patch 使用原文 baseline 和唯一匹配断言。这样上游文案变化时会失败关闭，不会模糊删除相似规则。

## 4. 平台派发摘要

原生 Hook 已负责从 `## Phase Index` 构造开场摘要，共享 Hook 也已有 `_detect_platform()`。在该层增加
一个纯文本裁剪函数，并让摘要 builder 接受可选平台标识：

- 共同文本始终保留：全部子代理（包括 `trellis-research`）的首行使用
  `Active task: <task path from task.py current>`；implement/check 先进入 `trellis-route` 并遵循结果。
- Codex 追加原生 `SubagentStart` 注入与 child-side pull fallback。
- 共享 Hook 根据现有 `_detect_platform(hook_input)` 选择本平台内容；不新增第二套平台探测。
- 未识别平台或缺少平台信号时返回原完整派发段落，保证 fail-safe，不静默丢规则。
- Flower 包装器在生成 Codex/Claude 的 `rules`、`stages` 时显式传入其白名单平台，避免脱离原生
  `main()` 后失去探测上下文。

Grok 与 Kimi 没有走这条 SessionStart Hook；它们的实际调用要求继续由
`trellis-route/references/platform-dispatch.json`、`.grok/agents/*` 与 `.kimi-code/skills/*` 持有。
生成目标测试必须证明 `spawn_subagent subagent_type=...` 和内置 `coder` / `explore` 契约仍存在。

该裁剪只改变说明呈现，不参与 inline/subagent 路由决策，也不改变 agent 名称、launch 配方或任务前缀。

## 5. 条件事件边界

### 5.1 Flower 更新

Hub 不再常驻“先处理更新，再路由普通请求”的句子。`flower_update_hook.py` 只在存在可处理更新、版本
不同步或 CLI 引导事件时输出动态块，并在现有 `ai_instruction` 中明确：

- 先展示版本、release notes 和推荐命令，再处理普通请求路由。
- 普通更新按 self-check 产生的最终 `ai.mode` 处理：`ask` 等待确认，安全条件满足的 `auto` 可执行，
  `notify` 只通知而不询问或执行；`auto` 降级为 `ask` 后同样等待确认。
- 用户可暂缓或跳过，拒绝后本次对话不重复追问。
- 成功结果继续使用 `self-update.js` 的 `post_action: run_trellis_push_confirmation`，由
  `trellis-push` 接管提交确认，Hook 本身不做 Git 写入。

无事件时 Hook 保持零输出，不新增占位块。CLI bootstrap 保留独立确认边界：先取得当前成员确认，当前
对话已明确授权本次安装时不重复确认；普通更新不复用该边界，继续按最终 `ai.mode` 处理。

### 5.2 物理 GC

仅移除 Hub 的常驻机制介绍，不修改 `_run_task_maintenance()`、`session-start --before 3d`、锁、恢复、
精确提交或错误处理。startup/resume 的触发边界保持不变；clear/compact 不扩大维护范围。无动作保持
静默，真实迁移、GC、延后和错误继续形成紧凑诊断。

## 6. 兼容性与失败策略

- `state / rules / stages` 和 `### Planning Artifacts` 分界不变；任何分界缺失继续可见失败。
- Astra 提示、workflow-state 刷新、心跳与各段 `additionalContextLimit` 不变。
- 平台裁剪只接受已知平台值；未知值回退完整段落，绝不返回空派发契约。
- Hook Patch 对每个存在的目标执行，缺失的可选平台跳过；已存在目标必须唯一匹配。
- 源 Patch、compiled target、`enhancements/0.6` 和 dogfood 最终内容必须一致；禁止手改生成目标掩盖源漂移。

## 7. 验证设计

测试分四层：

1. 结构测试：owner 17 行完整，两个常驻机制句消失，其余跨阶段顺序不变；规划产物、路由、授权、
   auto-loop、提交、父子任务和规范发现等关键锚点仍存在。
2. Hook 单元测试：`<ready>` 消失；Codex、Claude、共享已识别平台和未知平台得到预期派发文本；
   `rules/stages` 分段及错误降级不变。
3. 事件测试：无更新零动态块；需要确认、snooze/skip、成功 post-action 均保持边界；GC 无动作静默，
   moved/deferred/error 仍报告。
4. 生成与预算测试：刷新 compiled targets、Flower 快照和 dogfood，运行默认与 strict 预算；记录最终
   Codex/Claude 各段与场景字节数，并与 19,177 B 基线比较。

历史易回归路径以结构/入口夹具为主，真实宿主对话作为补充证据单独记录。模型一次遵循或未遵循都不
替代确定性合同测试，也不据此宣称统计意义上的行为改善。

## 8. 发布与回退

本任务不执行 npm 发布或打 tag。实现顺序固定为 Skill-Garden 作者源、compiled targets、Flower 快照、
隔离安装、当前 dogfood。回退时按同一链恢复源 Patch 和 Flower 资产后重新生成；没有数据迁移，也不需要
回滚任务生命周期记录。
