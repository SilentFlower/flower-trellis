# 为 No-Task 增加稳定完成流程技术设计

## 1. Scope

本任务把所有 `direct_edit` 无任务修改统一接入 session 级稳定完成链，覆盖：

- 意图路由后的状态创建与 compact/resume 恢复。
- 首次修改前的多仓 dirty baseline、事项范围和 workspace fingerprint。
- implement/check 的个人执行偏好与 untracked sub-agent 上下文。
- 定向验证、Check-All、Update-Spec、Push 的阶段推进和证据失效。
- 单活跃 work item 约束，以及显式纳管到 planning task 的事务。
- Skill-Garden Patch、helper、hook、platform agent、快照和 dogfood 分发。

不改变 task planning、Brief、`task.py start`、Check-All、Update-Spec、Push 或发布流程的既有安全门禁。

## 2. Ownership And Source Of Truth

所有产品源修改先进入 `vendor/skill-garden/.trellis/0.6/`：

```text
Skill-Garden 0.6 source
  |- scripts/untracked_flow.py          session 状态与阶段 owner
  |- scripts/pre_check_state.py         Check-All 暂缓 subject owner
  |- scripts/task_intent.py             untracked -> task 事务 owner
  |- trellis-route/route_state.py        个人 route 偏好 owner
  |- overrides/patches/**                workflow/skill/hook/agent 内容 owner
  `- overrides/bundles/**                选择与分发别名
                 |
                 | npm run sync
                 v
        enhancements/0.6 snapshot
                 |
                 | Flower Plugin Runtime
                 v
           target Trellis project
```

- Workflow state 只负责识别当前上下文和下一跳。
- route、Check-All、Update-Spec、Push 的完整执行规则继续由对应 Skill 持有。
- task workflow 继续使用 task-scoped runtime route decision；untracked 只读取个人 pref。
- 0.6 文件变更全部通过 Patch Engine，不新增平行注入协议。

## 3. Session State Model

`untracked_flow.py` 在 `.trellis/.runtime/sessions/<context-key>.json` 的 `untracked_flow` 字段保存：

```json
{
  "version": 1,
  "id": "<work-id>",
  "mode": "direct_edit",
  "source": "inferred | user-explicit",
  "summary": "<事项摘要>",
  "stage": "inspect | implement | check | spec | push",
  "baseline": null,
  "scope": [],
  "workspaceFingerprint": null,
  "evidence": {
    "focusedValidation": null,
    "checkAll": null,
    "updateSpec": null
  },
  "createdAt": "<UTC>",
  "updatedAt": "<UTC>"
}
```

### 3.1 Commands

- `begin --summary --source`：没有活动 work item 时创建 `inspect`；已有同一事项时返回 hit，已有不同事项时返回 `active-work-conflict`。
- `prepare-edit --paths ...`：首次调用捕获原始 baseline；每次文件写入前更新 scope，清理受影响的下游证据并进入 `implement`。
- `record-validation`：记录定向验证结果及对应 workspace fingerprint。
- `advance --stage check|spec|push`：只允许满足前置证据的正向转换。
- `record-check` / `record-spec`：保存 owner Skill 返回的最小结果摘要和 fingerprint。
- `status` / `session-start-hint`：校验 session、状态 schema 和 workspace fingerprint 后输出恢复信息。
- `clear --reason completed|abandoned|adopted|baseline-restored|invalidated`：只删除当前 session 的 `untracked_flow` 字段，保留 runtime 其它字段。

所有写入沿用同目录临时文件、flush、fsync、`os.replace` 的原子替换模式。损坏 runtime 不覆盖原文件，返回稳定 reason code。

### 3.2 State Machine

```text
direct_edit route
      |
      v
   inspect --prepare-edit--> implement --focused validation--> check
                                 ^                            |
                                 | new edit                   | Check-All pass
                                 +----------------------------+
                                                              v
                                                            spec
                                                              |
                                                      Update-Spec pass
                                                              v
                                                            push
                                                              |
                                                        Push success
                                                              v
                                                            clear
```

- Check-All 失败或用户未确认风险时停留 `check`。
- `check`、`spec`、`push` 阶段发生新修改时回到 `implement`，并清除 Check-All/Update-Spec 证据。
- 任意 evidence 只在记录时的 workspace fingerprint 仍匹配时有效。
- 不持久化 `done`；成功完成后清理状态，下一请求重新 triage。

## 4. Single Active Work Guard

- 每个 context key 最多一个活跃 `untracked_flow`。
- 同一事项的继续语义由 summary/scope 和当前会话上下文确认后推进现有 work item。
- 无关只读请求不调用 mutation command，因此不改变状态。
- 新的无关代码修改在 `begin` 返回 `active-work-conflict` 后停止，要求用户选择完成当前事项、`clear --reason abandoned` 后保留 dirty diff，或执行 `task_intent.py adopt`。
- 不支持 work item 数组、后台队列或自动 baseline 合并，避免状态和 Git 证据失去可解释性。

## 5. Multi-Repository Baseline And Fingerprint

仓库集合为以下并集并去重：

1. 当前 Trellis 根仓。
2. 已初始化的递归 Git submodule。
3. `.trellis/config.yaml` 中通过 `common.config.get_git_packages()` 解析出的 `git: true` package。

每个仓库记录相对路径、HEAD、`git status --porcelain=v1 -z --untracked-files=all` 结构化条目，以及 dirty/untracked 内容指纹。指纹必须能识别开始前已 dirty 文件在工作期间被再次修改，不能只比较 porcelain 路径集合。

Git 仓库发现、porcelain 解析和 fingerprint 计算提取为共享模块，再由 auto-loop、task intent 和 untracked helper 复用。已有 staged 内容作为 baseline 的一部分原样记录，不由无任务 helper 重置；读取失败、冲突或未完成 Git 集成会阻止首次写入，不把不完整 baseline 写入 session。Push 阶段继续使用既有 Git 安全门禁判断 staged 内容能否进入提交。

原始 baseline 首次 `prepare-edit` 后保持不变；后续只更新 scope 和 current fingerprint。工作区完全恢复原始 baseline 时允许清理当前状态。

## 6. Route Preference Contract

`route_state.py` 增加不要求 current task 的 pref-only CLI：

```text
route_state.py read-pref  --target implement|check
route_state.py write-pref --target implement|check --mode <valid-mode>
route_state.py clear-pref --target implement|check
```

- 命令复用现有 `_read_prefs`、`_write_prefs` 和 `_normalize_mode`，返回稳定 JSON 状态。
- `.trellis/.route-prefs.tmp` 的写入改为原子替换；非法、损坏或不适用于平台的值返回 miss。
- untracked implement/check 每次直接调用 `read-pref`。命中则使用该模式；miss 时显示现有选项。
- “仅本次”只传给当前调用，不写 runtime 或 pref；“保存默认”调用 `write-pref`。
- 现有 task `resolve/write/clear` 及 runtime -> prefs -> auto-loop 顺序不改变。

## 7. Pre-Check And Evidence

`pre_check_state.py` 的 hold 从固定 task 字段升级为 subject：

```json
{
  "version": 2,
  "subject": {"kind": "task", "id": ".trellis/tasks/..."},
  "mode": "hold",
  "source": "user-explicit | follow-up-edit",
  "updated_at": "<UTC>"
}
```

untracked 使用 `{"kind":"untracked","id":"<work-id>"}`。读取时同时校验 context key、subject 和当前状态；旧 version 1 task hold 只读兼容，下一次 task 写入升级为 version 2。清理只删除匹配 subject，避免误清其它上下文。

Check-All、Update-Spec、Push 的业务判断仍由原 Skill 完成。untracked 状态只保存结果类别、时间、摘要和 fingerprint，用于恢复、前置条件和失效判断。

## 8. Workflow, Hook And Agent Integration

### 8.1 Workflow State

- 新增 `[workflow-state:untracked]`：没有 active task 且 `untracked_flow.py status` 命中时使用。
- `inject-workflow-state` 先处理 stale/missing task，再解析合法 untracked，最后回退 `no_task`。
- runtime contract 把 `untracked` 登记为固定 pseudo-status；breadcrumb 显示 work id、stage 和下一跳。
- Request Triage 明确 direct_edit 后调用 `begin`，首次写入前必须调用 `prepare-edit`。
- Phase 2/3 允许 task context 或 untracked context，具体 owner gate 不复制到 Hub。

### 8.2 SessionStart

Codex 与 Claude SessionStart 调用 `session-start-hint`，只追加一条紧凑提示。提示失败属于非致命读取，不阻断启动，也不覆盖 runtime。

### 8.3 Sub-Agent Dispatch

untracked dispatch 首行固定为：

```text
Untracked work: <work-id>
```

其后携带事项摘要、scope、baseline 摘要、current fingerprint、stage、验证证据和相关 spec 路径。implement/check agents 必须显式接受 task artifacts 或 untracked context 二选一；不得为 untracked 伪造 `Active task:` 或要求 task JSONL。

## 9. Adoption Transaction

`task_intent.py adopt` 接受 title、slug 和现有 task create 可选参数：

1. 解析当前 context key，并校验存在唯一合法 untracked work item。
2. 校验当前 workspace fingerprint 与状态一致。
3. 调用现有 `task.py create` 创建 planning task。
4. 在 `task.json.meta.intentRouting` 写入：
   - `adoptedUntracked: true`
   - `untrackedWorkId`
   - 原始多仓 baseline
   - adopted stage 与 evidence
   - `implementationStarted`
5. 确认当前 session 指针已经指向新 task。
6. 最后清理 untracked 字段。

创建、meta 写入或 session 切换失败时，补偿删除本次新建 task、恢复 parent/session 原文，并保留原 untracked 状态。接管成功只进入 planning；仍需三件套、Brief review 和 `task.py start`。

## 10. Patch And Distribution

- 在 intent-routing owner Patch 中更新 Request Triage、Phase 2/3、runtime contract、`no_task` 相邻 state 和 owner map。
- 新增 untracked state Patch，以及 Codex/Claude workflow-state 与 SessionStart hook Patch。
- 更新 trellis-start、trellis-route、trellis-check-all、trellis-update-spec、trellis-push 和相关 implement/check agent 的上下文边界。
- `untracked_flow.py` 加入 `src/lib/copy-scripts.js` 与 builtin `SCRIPT_ALIASES`，至少覆盖 `workflow-enhancement`、`task-intent`、`intent-routing`、route/check/update-spec/push 相关精细安装入口。
- 更新 `intent-routing.json` 等 Bundle，保证 full install 和选择性安装都获得完整 helper + Patch 集。
- 运行 `npm run sync`，再刷新 compiled targets 和当前 Flower dogfood；第二次应用必须 unchanged。

## 11. Compatibility And Failure Handling

- 没有 `untracked_flow` 字段的项目继续走现有 `no_task`。
- runtime 中未知字段完整保留；损坏 runtime 返回诊断，不自动覆盖。
- route pref 缺失或非法时进入选择，不猜测平台默认。
- untracked state 与 workspace 不匹配时停止修改并回到 Request Triage，不自动清理 dirty diff。
- 不支持 sub-agent 的平台沿用 route 现有 fallback/阻断规则。
- Patch selector、baseline 或 conflict 失败时保持 Plugin transaction 零写入。

## 12. Validation Design

### Python

- 新增 `test_untracked_flow.py`：状态创建、单活跃冲突、首次 baseline、多仓/独立 package、阶段转换、证据失效、原子写、损坏 runtime、跨 session 隔离和清理。
- 扩展 `test_route_state.py`：无 task pref hit/miss/write/clear、非法 mode、原子写和 task resolve 无回归。
- 扩展 `test_pre_check_state.py` / SessionStart 测试：task v1 兼容、v2 subject、untracked hold、subject mismatch。
- 扩展 `test_task_intent.py`：adopt 成功、meta、现有 diff 保留、各失败点补偿、stale fingerprint 拒绝。
- 扩展 workflow-state hook 测试：untracked 优先于 no_task、无 task 回退、损坏状态降级、紧凑 breadcrumb。

### JavaScript And Patch

- 新增 untracked workflow gate 测试，断言 owner 分布、单活跃 guard、完成链和 agent dispatch 契约。
- 扩展 apply-enhancements、Bundle alias、Patch conflict 和 platform skill distribution 测试。
- 验证 fresh install、upgrade、Codex/Claude SessionStart、per-turn hook 与 selective Bundle。
- 执行 `npm test`、`npm run sync`、`npm run patch:targets`、`npm run patch:targets:check`、`git diff --check`，并审查 vendor/snapshot/compiled targets 一致性。

## 13. Rollback

- 发布前回滚：撤销新增 helper、Patch、Bundle、测试和生成快照，再刷新 compiled targets。
- 已安装项目升级回滚：旧版本无法识别 `untracked_flow` 时会忽略未知 runtime 字段并继续 `no_task`；新版卸载或覆盖不得删除用户 dirty diff。
- adoption 事务只允许补偿本次新建且未进入历史的 planning task，沿用 `task_intent.py` 的安全路径检查，禁止手工递归删除未知 task。
