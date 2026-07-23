# Design - 修复 Workflow Gate 迁移兼容性回归

## Root Cause Model

这些回归具有同一个模式：规则被移动到“保存了正文但不是实际入口”的 owner，或只在 canonical source 中存在；静态测试只证明文件或文字存在，没有证明当前状态、动作和平台原生入口会加载它。

```text
policy text exists
    -> owner index points somewhere
    -> actual request/resume state does not enter that owner
    -> capability silently narrows
```

## Target Control Flow

### Request Decision Boundary

```text
current request
    -> Request Triage
       -> Project Knowledge Discovery when applicable
          -> spec_router.py
          -> read high-confidence / relevant medium matches
       -> Active Task Scope Guard when an active task exists
       -> discuss / inspect / direct_edit / task_plan / workflow_action
          -> matched project SOP or exact Trellis capability
```

`Request Triage` 是所有新请求都会经过的语义入口，适合保存两个全局 policy。`spec_router.py` 和 `task_intent.py` 继续只承担确定性 helper 边界。

### Task Resume

```text
trellis-continue
    -> get_context.py
    -> task_progress.py status --json
       -> relay partialStep / nextStep / notes or candidates
       -> never auto-rebind or infer phase from progress
    -> task status + artifacts
    -> phase step selection
```

`trellis-push` 仍负责 progress write；read/recovery 与 write 分离，避免恢复能力只能在提交阶段出现。

## Ownership Matrix Changes

| Gate | New primary policy owner | Runtime owner | Breadcrumb consumers |
| --- | --- | --- | --- |
| Project Knowledge Discovery | workflow `Request Triage` | `spec_router.py` | no_task、brainstorm、before-dev |
| Active Task Scope Guard | workflow `Request Triage` | `task_intent.py` safety | planning/in-progress states |
| Task Progress Recovery | `trellis-continue` | `task_progress.py` | Hub/continue entry |

新增审计项不改变既有 primary owner，而是恢复 owner 的真实入口、返回边和平台分发。

### Planning Readiness And Brief Handoff

```text
planning artifacts
    -> deterministic artifact checks
    -> content-bound semantic readiness review
       -> blocking/ambiguous: return to brainstorm
       -> ready: continue
    -> refresh brief when missing/stale
    -> display current brief
    -> content-bound explicit confirmation
    -> task.py start
```

auto-loop 记录的 readiness 与 confirmation 都保存当前 authoritative artifacts 摘要；任一 artifact 变化后旧结论失效。`refresh_brief` 只生成交接材料，不隐含用户确认。

### Implement Return And Interactive Push

```text
trellis-route(target=implement)
    -> before-dev -> implementation -> focused validation
    -> return Phase 2.1 completion contract
    -> Pre-Check decision

interactive direct push
    -> current Check-All evidence
    -> current spec_update_result
       -> missing/stale: trellis-update-spec
       -> valid: trellis-push Git safety checks
```

完整 Pre-Check 策略保留在 Phase 2.1；state 和 route Skill 只携带返回边。auto-loop commit-only 仍走内部预授权分支。

### Platform-Native Distribution

集中平台映射描述每个平台的原生 skill root，以及 enhancement canonical source。copy、installed detection、managed-root 清理和 uninstall 共用这份映射。Patch Engine 继续对 command/workflow/prompt/TOML 使用显式 target，保证平台从任何原生入口进入时策略一致。

## Patch Strategy

- 原位扩展 `workflow/intent-routing/request-triage/content.md`，加入两个全局 policy。
- 原位更新 `workflow/state-no-task/content.md`，区分“明确命名 capability”和“项目 SOP 驱动 workflow action”。
- 把 Active Task Scope 的短门禁放进 `states-planning/common-content.md`；`states-in-progress/common-content.md` 保持等价一跳内容。
- 更新 `workflow/hub/content.md` 的三条 owner 映射。
- 保留 `before-dev-project-knowledge-discovery` operation ID，但把完整触发矩阵收敛为对 Request Triage owner 的一跳引用和 before-dev 后续 package/spec 读取。
- 更新 `trellis-brainstorm/planning-authorization` 的 owner 指针。
- 为 `trellis-continue` 新增目标明确的 `task-progress-recovery` Patch；Patch 到各平台存在的 continue skill/command，缺失平台按既有 target policy 跳过。
- 更新相关 Bundle，使 continue recovery Patch 与 `task_progress.py` 同时铺设。
- 更新 `conflicts.json` required/absent/max-occurrences 断言。
- 扩展 auto-loop planning gate，加入内容绑定的 readiness review 与 brief confirmation record。
- 更新 in-progress state、`trellis-route` 和 `trellis-push` 的一跳顺序门禁。
- 集中 17 平台 skill root 映射，并扩展 Update-Spec/Finish-Work 的平台原生 Patch targets。

## Reachability Test Model

新增场景矩阵，以“入口输入 + 当前 state -> 必须先后出现的 owner/action”为断言，不再只检查某个文件含关键词：

| Scenario | Entry | Required path |
| --- | --- | --- |
| beta release | no_task + workflow_action | Request Triage -> spec_router -> SOP/capability |
| non-trivial inspect/direct edit | no_task | Request Triage -> conditional discovery -> action |
| unrelated planning request | planning/planning-inline | scope guard -> stop/switch decision |
| unrelated implementation request | in_progress variants | scope guard -> stop/switch decision |
| resume with progress | trellis-continue | progress status -> relay -> phase decision |
| resume without active task | trellis-continue | candidates -> suggest rebind only |
| planning artifacts present but semantics incomplete | auto-loop | readiness review -> brainstorm/stop |
| brief refreshed but unconfirmed | auto-loop | display brief -> wait confirmation |
| implementation finished | route implement | Phase 2.1 completion -> Pre-Check |
| direct interactive push | push | Check-All -> Update-Spec -> Git safety |
| Kiro-only/full platform install | native entry | copied skill + patched native command/workflow |

静态 owner 测试仍保留，但只有 reachability scenario 同时通过才能判定 Gate 迁移兼容。

## Bundle Compatibility

- `intent-routing` Bundle 已包含 Request Triage、no_task、planning/in-progress states、before-dev、brainstorm 和 `spec_router.py` 的现有选择链路；本轮保持自包含并增加顺序断言。
- progress recovery 必须确认 full install 和选择性安装 `trellis-continue`/相关别名时同时铺设 `task_progress.py`。若现有 Bundle/脚本 aliases 不覆盖，最小补齐对应映射，不扩大无关资产。

## Context Budget

完整全局 policy 进入 Request Triage 会增加 workflow control/SessionStart；同时删除 before-dev 中重复正文、缩短 state 指针，并把 progress 细节留在按需加载的 continue Skill。最终以 dogfood 和真实 SessionStart 输出计量，不调整阈值。

## Compatibility And Rollback

- 保持五类请求意图、task status 和公开 helper CLI 兼容；auto-loop 只增加新的明确 action/record 握手。
- 允许的行为变化仅为恢复被绕过的知识发现、active scope、planning/brief、Pre-Check、Update-Spec 和平台原生入口。
- 回滚按 request gates、planning handoff、execute/finish 顺序和平台分发四组执行；无数据库或用户数据迁移。
