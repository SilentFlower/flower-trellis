# Direct Git 检查后自动续行技术设计

## 设计目标

在不新增持久化状态、不放宽 Git 确认的前提下，为用户主动 `push` / `commit-only` 增加一条窄的 Check-All 成功续行路径：检查无问题时直接进入 Update-Spec 和 Trellis Push 计划；检查有问题时仍按普通交互报告并停止。

## 核心状态流

```text
latest user intent = push | user commit-only
  -> current Check-All valid?
     -> yes: current spec_update_result valid?
        -> yes: Trellis Push Git plan
        -> no: Update-Spec -> no-op/written -> Trellis Push Git plan
     -> no: Check-All
        -> findings/blocked/partial/material risk: report and stop
        -> strict pass: show check result -> Update-Spec
           -> no-op/written: Trellis Push Git plan
           -> needs-review: stop
```

最终 Git 计划仍等待一次显式确认。用户最初的 direct Git 请求只授权“检查通过后继续到计划”，不授权 commit message、exact files、branch、remote、commit 或 push。

## 意图边界

- direct Git intent 只读取触发本轮完成链的最新用户消息，识别普通 Push 或用户主动 `commit-only`。
- 不从历史消息、任务标题、旧摘要、Git dirty 状态或 auto-loop action 推断该意图。
- 不持久化新的 runtime 字段；若流程跨用户回合中断，后续仍按最新用户意图重新判断。
- auto-loop 内部 `commit-only` 继续使用 runner 预授权，不进入本设计。

## Owner 分工

### Phase 2.2 / Trellis Check-All

- 保留 Interactive Post-Check Stop Gate 作为默认行为。
- 不新增第二个 Gate owner；在现有 Gate 内先解析 direct Git 条件分支，再对其它 interactive 结果应用停止动作。
- 增加窄例外：匹配 direct Git intent，且 Check-All 整体状态为通过、问题数为 0、无阻塞、无部分验证、无待用户接受的实质风险时，先展示现有标准 Check-All 报告，再返回 Phase 3.3 同轮续行。
- findings、blocked、部分验证或实质剩余风险仍输出标准报告并停止。
- inline 与 subagent Check-All 采用相同结果分流；subagent 只返回 audit 结果，主会话根据原始用户意图决定是否续行。
- Check-All 不直接生成 Git 计划；同一回复内的后续计划仍由 Update-Spec disposition 和 Trellis Push owner 生成。
- 不新增 direct Git 专用摘要、报告模板或结果 schema。

### Trellis Update-Spec

- 将 interactive direct push 扩展为 direct Git intent，覆盖普通 Push 和用户主动 `commit-only`。
- 接收两类入口：已有有效 Check-All 后用户发起 direct Git；direct Git 触发的新 Check-All 刚刚 clean 通过。
- `no-op|written` 同轮加载 Trellis Push；`needs-review` 停止。

### Trellis Push

Step 0 分开处理：

1. Check-All 缺失或过期：返回 Phase 2.2；当前 direct Git 请求仅作为 clean 后条件续行。
2. Check-All 有效、spec_update_result 缺失或过期：只进入 Update-Spec，不重复 Check-All。
3. 两者均有效：进入现有 Git 预检与计划。

Push 继续独占 exact path、commit message、branch/upstream、ahead、冲突、staged 和最终确认。

### Workflow Hub / State

- Hub 只保留 owner 索引和 `Check-All -> Update-Spec -> Push` 顺序，不复制条件矩阵。
- Phase 2.2 保存完整交互完成分流；in-progress state 只保留一跳提示。

## 兼容性

- 普通“检查一下”没有 direct Git intent，仍报告后停止。
- Check-All 有问题时，原始 Push/commit-only 不构成自动修复或忽略问题授权。
- direct Git 严格通过时用户先看到检查结果，再看到 Git 计划，并通过最终计划确认决定是否执行。
- 用户在已有有效 Check-All 后说 Push/commit-only，继续复用结论，不重复检查。
- Update-Spec 写入 spec 后不触发额外人工 Check-All，保持现有契约。
- auto-loop、修复/重检和依赖型多仓确认逻辑不变。

## 预计修改边界

权威源：

- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-check-all/SKILL.md`
- `vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-check-all/SKILL.md`
- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-push/SKILL.md`
- `vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-push/SKILL.md`
- `vendor/skill-garden/.trellis/0.6/overrides/patches/skills/trellis-update-spec/autonomous-evaluation/content.md`
- `vendor/skill-garden/.trellis/0.6/overrides/patches/workflow/phase-ownership/phase-2-check-content.md`
- `vendor/skill-garden/.trellis/0.6/overrides/patches/workflow/states-in-progress/common-content.md`
- `.trellis/spec/flower-trellis/cli/enhancements-model.md`
- 相关 JS 行为/owner/快照测试。

生成物通过 `npm run sync`、workflow enhancement dogfood apply 与 `npm run patch:targets` 刷新，不手改快照。

## 风险与回滚

- 风险：direct Git intent 识别过宽会让普通 Check-All 绕过停止点。通过“最新用户消息 + 明确 Git 动作 + clean 结果”三重条件限制。
- 风险：条件续行与 Interactive Post-Check Stop Gate 形成双 owner。通过把条件分支写入同一 owner、Hub/state 仅保留指针并用 owner 唯一性测试防止重复。
- 风险：Check-All 缺失与 spec result 缺失仍被混合。通过 Push Step 0 分支测试锁定顺序。
- 风险：subagent 返回后主会话误套普通停止。通过 inline/subagent 同一 disposition 测试覆盖。
- 回滚：恢复 vendor 权威源和 spec/test，重新运行 sync、dogfood apply 与 compiled targets 生成；无数据迁移或 runtime 清理。
