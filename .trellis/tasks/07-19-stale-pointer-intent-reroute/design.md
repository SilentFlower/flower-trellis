# stale pointer 后任务意图重路由设计

## 1. 设计目标

把失效任务指针从“未知 workflow 状态”改为明确的恢复状态。恢复只负责清理 pointer；清理成功后，当前用户请求必须在同一轮重新进入既有 `no_task` 任务意图路由，不能沿用失效任务，也不能把 `task.py finish` 误解成实现授权。

本次不修改 `task.py finish` 的生命周期语义，不让 Hook 写 runtime，不新增任务意图类别。

## 2. 根因与边界

当前 shared per-turn Hook 在 `active.stale` 时返回动态状态 `stale_<source_type>`。`session` 与 `session-fallback` 因此分别生成 `stale_session`、`stale_session-fallback`，但 `.trellis/workflow.md` 没有对应标签，最终落入泛化 fallback。

SessionStart 只提示执行 `task.py finish`：

- Codex 没有说明清理后如何处理当前请求。
- Claude 要求清理后再询问用户下一步，反而跳过了已经存在的自动任务意图识别。
- `task.py finish` 在 agent 执行期间不会让当前用户轮次重新触发 UserPromptSubmit / BeforeAgent Hook。

因此修复必须同时覆盖状态归一、权威 workflow 恢复正文和 SessionStart 提示，单改其中一层都不能闭环。

## 3. 状态模型

新增固定伪状态：

```text
missing_task
```

shared Hook 的 `get_active_task()` 保留原 `task_id` 与 `source`，但所有 `active.stale` 都返回 `status=missing_task`。`source_type=session` 和 `source_type=session-fallback` 不再参与 workflow-state 名称生成。

状态流转：

```text
stale session pointer
  -> per-turn Hook emits missing_task
  -> AI runs task.py finish
  -> failure: report and stop
  -> success: treat the same user request as no_task
  -> existing Request Intent Routing classifies the request
  -> discuss / inspect / direct_edit / task_plan / workflow_action
```

`missing_task` 不复制五种意图的完整规则，只引用 `[workflow-state:no_task]` 和 `Request Intent Routing` 作为权威来源。恢复正文只保留四个一跳门禁：

1. `missing_task` 状态只授权清理失效指针。
2. 先运行 `python3 ./.trellis/scripts/task.py finish`。
3. 清理失败立即停止并报告。
4. 清理成功后，在任何编辑、任务创建、`task.py start` 或历史任务归属前，对当前请求同轮执行 `no_task` 路由。

## 4. Patch 设计

### 4.1 Workflow stale 状态

新增 Patch leaf：

```text
overrides/patches/workflow/state-missing-task/
├── patch.json
├── selector.md
└── content.md
```

Patch 使用 `literal insert after`，selector 为唯一的 `[/workflow-state:no_task]`，content 包含完整的 `[workflow-state:missing_task]` 标签块。原因是 Core `workflow-state` selector 只支持替换已有 state body，不能创建新状态。

operation 使用 HTML managed marker、`expectedMatches=1`、`required=true`。首次安装从精确 selector 插入，重复安装从 managed marker 原位升级；selector 漂移时 required preflight 阻断并保持零写入。

### 4.2 Shared per-turn Hook

继续使用现有 whole-file Patch `hooks/inject-workflow-state/shared-runtime`，改动包括：

- 把动态 `stale_<source_type>` 归一为 `missing_task`。
- 把目标扩展到上游实际分发 per-turn Hook 的九个平台：Claude、Codex、Gemini、Qoder、Copilot、CodeBuddy、Droid、Kiro、Trae。
- 每个目标继续使用 `missing=skip` 与 `targetPolicy=each-existing`，不创建未启用平台目录。
- Cursor 当前没有分发 per-turn workflow-state Hook，不列入目标。

whole-file Patch 必须同时接受两类 baseline：

- 上游 Trellis 0.6.5 原始 shared Hook，即现有 `selector.py`。
- Flower beta.2 已安装的旧强化版 Hook，新增历史 baseline 文件后再修改 `content.py`。

这是已有用户从 beta.2 升级到修复版的必要兼容条件；只保留上游 baseline 会把旧 Flower 产物误判为用户漂移。

### 4.3 Codex / Claude SessionStart

分别新增 SessionStart stale Patch leaf，精确替换现有 stale 分支返回正文：

```text
hooks/codex-session-start/missing-task-routing/
hooks/claude-session-start/missing-task-routing/
```

两处提示统一为：执行 `task.py finish`；失败停止；成功后把当前请求视为无活动任务并按 `no_task` 规则重新分类，在分类前不得编辑或创建/启动任务。

只修改已存在的 `.codex/hooks/session-start.py` 与 `.claude/hooks/session-start.py`，目标缺失时跳过；不为其它平台创建新的 SessionStart 文件。

### 4.4 Bundle 归属

把以下 Patch 加入 `intent-routing` Bundle：

- workflow `missing_task` 状态。
- shared per-turn Hook runtime。
- Codex SessionStart stale 提示。
- Claude SessionStart stale 提示。

`shared-hook-runtime` full-only Bundle 继续保留对同一 shared runtime Patch 的引用。Patch loader 会按 Patch ID 去重：全装仍只应用一次；`task-intent` / `intent-routing` 精细安装也能获得完整 stale 修复。

## 5. 数据与兼容性

不新增持久化字段，不修改 session runtime schema。Hook 继续通过 `common.active_task.resolve_active_task()` 读取 `ActiveTask.task_path`、`source_type`、`source` 与 `stale`，不猜测字段或绕过公共 resolver。

兼容边界：

- Trellis 0.6.5 上游原始 Hook可首次强化。
- Flower beta.2 旧 shared Hook 可升级到新版本。
- 已是新版本时 whole-file desired-content 命中，重复运行零变更。
- 0.5、old、上游 Trellis 源与 `node_modules` 不修改。
- 平台 Hook 不存在时只报告 missing-target，不创建平台入口。

## 6. 源、快照与 dogfood

真实源只修改 `vendor/skill-garden/.trellis/0.6`。完成源修改后运行 `npm run sync` 生成 `enhancements/0.6`，再直接调用本仓的 `applyEnhancements()` 更新当前 dogfood，避免 `update` 命令额外同步全局 Trellis：

- `.trellis/workflow.md`
- `.codex/hooks/inject-workflow-state.py`
- `.claude/hooks/inject-workflow-state.py`
- `.codex/hooks/session-start.py`
- `.claude/hooks/session-start.py`

Patch provenance 由现有全装 pipeline 自动记录；精细安装继续不写 manifest。

## 7. 验证设计

### 7.1 Hook 行为

新增 Python 单元测试直接加载 shared runtime 源，用受控 `ActiveTask` 替身覆盖：

- `source_type=session` + `stale=true` -> `status=missing_task`。
- `source_type=session-fallback` + `stale=true` -> `status=missing_task`。
- `build_breadcrumb()` 能从 workflow 模板加载 stale 恢复正文，不出现泛化 fallback。
- 普通 no_task、planning、in_progress 的解析路径保持原行为。

### 7.2 Patch 与安装

扩展 JS apply 测试：

- `minimalWorkflow()` 能插入唯一 `missing_task` 状态。
- fresh full apply 同时更新 workflow、九个平台已有 shared Hook 和 Codex/Claude SessionStart。
- 未启用平台不被创建，特别断言 Cursor 不出现 per-turn Hook。
- beta.2 旧强化 Hook baseline 可升级。
- 第二次 apply 文件树不变。
- `task-intent`、`intent-routing` 精细安装包含 workflow + shared Hook + SessionStart stale 修复。

扩展 Python consumer 的真实 catalog preflight：核对新增 Patch/operation 数量、`task-intent` 选择集合和当前 dogfood desired-content，保持 JS/Python Bundle 选择与 whole-file baseline 语义一致。

### 7.3 同步与上下文

- `npm run sync` 后检查 vendor、snapshot、dogfood 对应文件一致。
- 运行默认与 strict AI context budget，确保新增 stale state 没有把长意图规则复制进高频注入。
- 执行 Python/JS 语法检查、`npm test`、snapshot 检查和 `git diff --check`。

## 8. 风险与缓解

- 风险：whole-file shared Hook 漏掉旧强化 baseline，升级时 required preflight 失败。
  - 缓解：先保存 beta.2 `content.py` 为历史 baseline，并增加升级测试。
- 风险：只在 workflow 新增状态，但精细安装没有升级 Hook。
  - 缓解：shared runtime Patch 同时归入 `intent-routing` Bundle，并测试两个 alias。
- 风险：stale state 复制完整 no_task 规则，未来两处漂移。
  - 缓解：stale 正文只引用权威 state/section，保留恢复门禁。
- 风险：扩大 shared Hook 目标后覆盖用户自改 Hook。
  - 缓解：whole-file baseline/desired-content fingerprint 继续严格阻断未知内容，不做模糊覆盖。
