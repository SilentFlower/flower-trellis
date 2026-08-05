# Check-All 可选改进技术设计

## 设计目标

在不弱化现有质量门禁的前提下，把“必须修复的问题”和“当前行为正确时的额外兜底建议”拆成两个处置通道。分类依据使用可验证契约和影响，而不是仅看严重度或审查者的主观偏好。

## 问题模型

### CHK

`CHK-*` 保持现有字段和 `P0/P1/P2` 严重度，代表修复前不能视为严格通过的发现。严重度只在发现已经被判定为 `CHK-*` 后计算，不能反过来决定是否必修。

### OPT

`OPT-*` 使用独立编号和以下字段：

```text
id             OPT-001
title          可选改进标题
source         spec/assumption/verification
evidence       当前契约、代码位置或验证结果
optionalWhy    为什么当前不构成错误或发布风险
benefit        修复后增加的 defense-in-depth 收益
locations      受影响位置
validation     可选修复后的验证方式
```

`OPT-*` 不使用 P0/P1/P2，避免把“假设后果严重”“优先级低”和“当前不是错误”混为一谈。历史 P1 只是旧分类结果，不是阻止重新归类为 `OPT-*` 的证据。

### DOC

`DOC-*` 继续只承担白名单内低风险任务文档漂移自动修复，不与 `OPT-*` 合并。

## 分类决策

```text
发现候选
  -> 是否违背 PRD / spec / 契约 / 支持范围？是 -> CHK
  -> 是否存在失败验证或真实可达故障证据？是 -> CHK
  -> 是否涉及安全、数据、兼容或发布风险？是 -> CHK / 阻塞
  -> 不处理是否改变当前验收结论？是或未知 -> CHK / 部分验证
  -> 是否有具体、可验证的额外兜底收益？否 -> 不报告
  -> OPT

已判定 CHK
  -> 再按当前实际影响分配 P0 / P1 / P2
```

分类采用 fail-closed：无法证明可选时不进入 `OPT-*`。严重度评估后置，能同时防止两类误判：把难修或验证不足的问题包装成可选项，以及把只有假设严重后果的纯兜底误打成 P1 必修项。

## 报告与交互

总览增加 `OPT <N>`，报告结构调整为：

1. 总览、工作、范围、画像、结论；
2. 三个维度结果；
3. `DOC-*` 自动修复；
4. `CHK-*` 问题清单；
5. `OPT-*` 可选改进；
6. 未覆盖与风险；
7. 仅针对 `CHK-*` 的修复批次；
8. 单一主动作的下一步。

只有 `OPT-*` 时：

- 总体状态为通过；
- “可选改进”区明确不影响当前验收和发布；
- 主动作仍是 `继续` 或 direct Git completion chain；
- 可附带“需要处理时回复精确 OPT ID”的非阻断说明。

同时存在 `CHK-*` 和 `OPT-*` 时，`修复全部` 只修复 `CHK-*`。用户可显式追加 `OPT-*` ID，或明确要求修复全部可选项。

## 状态与自动流程

### Interactive

- `CHK > 0`：保持现有修复/重检循环。
- `CHK = 0` 且只有 `OPT > 0`：按严格通过处理。
- `OPT-*` 不构成“待用户接受的实质剩余风险”；若实际存在这种风险，分类应回退为 `CHK-*` 或剩余风险。

### Auto-Loop

- `CHK > 0`：`record failed`。
- 真正阻塞：`record blocked`。
- `CHK = 0`：`record ok`，摘要可包含 `OPT` 数量、ID 和简短收益；runner 不进入 fix/recheck。

### Untracked

仅 `CHK-*`、阻塞、部分验证或新编辑把游标设回 `implement`。只有 `OPT-*` 时保留通过路径，是否推进到 `spec` 仍由现有 disposition 决定。

## 修改边界

### Skill-Garden 0.6 源

- `.agents` / `.claude` 的 `trellis-check-all` 入口、light/full profile、reporting reference。
- `.agents` / `.claude` 的 `trellis-route` dispatch 语义，以及共享专用 check-all agent body。
- workflow Phase 2.2 Patch 内容。
- `.agents` / `.claude` 的 `trellis-push` 完成链状态说明。

### 派生产物

- `enhancements/0.6/`：由 `npm run sync` 生成。
- `vendor/skill-garden/compiled-targets/`：由 `npm run patch:targets` 生成。
- 当前项目 `.agents/`、`.claude/` 和 workflow dogfood 副本：按既有 Flower 同步链更新。

## 兼容性与取舍

- 保留 `CHK-*` 原编号和修复语义，已有报告消费者无需迁移持久状态。
- `OPT-*` 是新增的报告通道，不新建运行时文件，也不跨会话保证编号稳定。
- 不复用任何 P 级别作为可选标记：历史 P1 可能只是对假设后果的高估，P2 也仍包含必须修复的测试、规范和维护性契约问题。
- 不把 `OPT-*` 放入“剩余风险”，否则 strict pass 仍会被间接阻断；分类不确定时应直接使用 `CHK-*` 或部分验证。

## 回滚

恢复 `CHK-*` / `DOC-*` 双通道文本并重新生成 sync、compiled targets 和 dogfood 副本即可；不涉及数据迁移或运行时状态清理。
