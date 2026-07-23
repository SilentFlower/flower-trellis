# Brief — Workflow Hub Gate 原生流程融合

## Goal

- 通过现有 Patch Engine 把 Workflow Hub 中全部 13 个 Gate/Guard 下沉到 Trellis 原生 phase、state、skill、hook 或 helper；Hub 收敛为轻量 owner 索引和必要跨阶段顺序。

## Scope

- 为 13 个 Gate 建立唯一 primary policy owner，并为可确定性判断的 Gate指定 runtime owner。
- 把 Request Intent、Active Task Scope、Brainstorm、Task Brief、Knowledge Discovery、Flower Update、Routing、Auto-Loop Return、Interactive Stop、Commit、Commit-only、Bookkeeping 和 Task Progress 规则迁移到现有 Trellis owner。
- 使用现有 Patch/Bundle schema 和 target-oriented Patch 目录修改 workflow、skill、hook 与 helper，不扩展 Patch Engine 协议。
- 对 task、route、auto-loop、Git、archive/progress 等确定性非法状态补硬阻断；自然语言与产品判断继续由 owning skill/phase 负责。
- 缩短 Hub，增加 owner coverage、唯一性、禁止重复、场景兼容、context budget 和幂等测试。
- 盘点并解决上游 Workflow、现有 Hub/phase/state/skill Patch、Flower Patch 与 runtime helper 的原有冲突；每项冲突选择唯一 owner，并通过 merge/replace/remove 消除旧实现。
- 同步 Skill-Garden 源、`enhancements/0.6` 快照与当前 dogfood。

## Non-Goals

- 不新增 Gate Engine、`gates.json`、Gate provenance、通用 workflow controller、task status 或 workflow phase。
- 不把需求清晰度、任务语义归属、spec 必要性等 AI 判断强行编码成脚本状态。
- 不修改 `node_modules` 上游 Trellis 源，不新增 Patch Engine 之外的写入通道。
- 不恢复 0.5/old legacy 注入器。

## Key Context

- 上一版安装完整性方案已整体回滚并保存在 Git stash，不作为实现基础。
- 现有 `workflow/phase-ownership`、`task.py start`、`route_state.py`、`auto_loop.py`、`trellis-check-all`、`trellis-push`、`trellis-finish-work` 和 `task_progress.py` 已提供部分原生 owner，实施重点是补齐所有权并删除 Hub 重复。
- 每个 Gate 分为 primary policy owner、可选 runtime owner 和一句 Hub residue；完整规则不能有两个 primary owner。
- 冲突按最终产物收敛，不能依赖“新规则优先级更高”保留双轨；必须同时证明新 owner 签名存在、旧冲突签名缺失且上游非冲突内容保留。
- 正常 phase 顺序、用户确认次数和合法路径保持兼容；允许的变化只有 Hub/上下文缩小、owner 内容补齐和确定性非法路径更早失败。
- 0.6 最终修改必须通过 Patch Engine；Skill-Garden 是真实源，运行 `npm run sync` 后生成 Flower 快照。
- Check-All/auto-loop 的返回与交互停止优先级、普通 push/commit-only 授权边界是最高风险区域。

## Acceptance

- 13 个 Gate 全部有唯一 primary owner，确定性 Gate 有明确 runtime owner。
- Hub 不再保存完整 Gate 正文，只保留轻量索引和跨阶段短边界。
- task start、route、auto-loop、push、finish-work 和 progress 的非法确定性状态有零副作用硬阻断测试。
- policy-only Gate 的完整规则位于实际执行动作的 phase/skill/state。
- full 与主要精细 alias 的正常场景、phase 顺序和确认次数兼容，Patch 漂移或 owner 缺失在写盘前失败。
- 原有同义、矛盾、重复和授权边界冲突都有清单、chosen owner、处理动作和最终产物正反断言。
- 最终 workflow、Phase summary、SessionStart 和 states 满足 context budget，Hub/control-context 应下降或有明确抵消证据。
- JS/Python 测试、Patch conflict、strict context budget、源/快照一致性、场景矩阵和两次 dogfood 通过，第二次 Patch 修改数为 0。

## Next Step

- 用户确认本 brief 后运行 `task.py start`，再进入 `trellis-route(target=implement)`；实现从冻结迁移前 owner/行为/context 基线开始。
