# Check-All Collect-All 技术设计

## 设计目标

在不改变 Check-All 三维检查模型的前提下，统一 inline 与 subagent 的审查语义：检查阶段只读收集，普通模式在报告后确认一次修复范围，auto-loop 由 runner 继续修复循环。

## 修改边界

### 源文件

- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-check-all/SKILL.md`
- `vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-check-all/SKILL.md`
- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/SKILL.md`
- `vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-route/SKILL.md`

### 派生产物

- `enhancements/0.6/` 中对应 skill，由 `npm run sync` 生成。
- 当前 dogfood 的 `.agents/skills/` 与 `.claude/skills/` 对应副本，在快照生成后同步。

不修改 0.5、old、Trellis npm 包内置 `trellis-check`、平台 agent 模板或 Phase 3.4 提交流程。

## 状态流

### 普通模式

```text
check route
  -> audit-only Check-All
  -> 收集全部可继续问题
  -> 统一检查报告
  -> 用户一次选择修复范围
  -> 复用 implement route 批量修复
  -> 复用 check route 重检
  -> 统一修复结果
  -> 通过后进入 Phase 3.3
```

检查与修复是两个独立权限边界。继续只读检查不需要用户确认；写代码、补测试或改配置必须等待修复范围确认。

### Auto-Loop

```text
run_check_all
  -> audit-only Check-All
  -> 有问题：record failed + 标准化摘要
  -> runner run_fix（implement route）
  -> runner run_recheck（check route）
  -> 无问题：record ok -> spec update
```

auto-loop 已有当前 run 的自动修复授权，不展示普通模式的修复选择，也不改变三轮 fix/recheck 预算。

## 检查执行模型

### 1. 范围与适用性

检查开始时先确定：

- 实际变更文件与层级；
- 受影响的 PRD / Design / Implement 条目；
- Step 2 的 A-E 维度是否适用；
- 哪些验证可运行、哪些因环境受阻。

低风险局部改动只展开受影响条目和直接回归点。不适用维度标记 `N/A`；缺少环境证据时标记“部分验证”或“阻塞”。

### 2. Collect-All

所有问题先进入内存中的统一问题集合，字段固定为：

```text
id          CHK-001
severity    P0 | P1 | P2
title       根因标题
source      prd/design/implement/spec/assumption/verification
evidence    file:line 或命令结果
impact      用户、数据或工程影响
suggestion  推荐修复方式
locations   全部受影响位置
validation  修复后的验证命令或步骤
```

同一根因的多个位置合并到一个 ID。仅业务歧义、检查前提失效或破坏性风险允许中途停止。

### 3. 委托 Trellis-Check

Step 3 只复用 `trellis-check` 的规范、跨层和验证清单，不继承其中任何自动修改指令：

- 不执行“Fix any failures before proceeding”；
- 不执行“fix them directly”；
- 缺少测试只记录问题，确认修复范围后再新增；
- 所有命令按只读或测试执行，可能写业务数据的验证必须先阻塞说明。

## Subagent 路由契约

0.6 `trellis-route` 的 `subagent check-all` 映射调整为：

1. 平台存在专用且明确 audit-only 的 `trellis-check-all` agent 时使用它。
2. 否则使用平台通用 subagent，并在 dispatch prompt 中完整声明：
   - 第一行 `Active task: <task path>`；
   - 读取 `check.jsonl`、任务三件套和相关 spec；
   - 加载并执行本地 `trellis-check-all`；
   - 禁止编辑、写文件或自修复；
   - 使用统一问题模型和报告结构；
   - 真正阻塞条件返回主会话，不代替用户决策。
3. 不得回退到带强制自修复指令的 `trellis-check` agent。
4. 平台没有兼容的专用或通用 subagent 时停止，提示用户重新选择 check-all inline，不得静默更改路由。

主会话收到 subagent 报告后负责展示统一报告、询问一次修复范围，并按既有 implement route 执行修复。

## 标准输出契约

### 检查报告

```markdown
## Trellis Check-All 结果

[<通过/未通过/阻塞>] <N> 个维度 · <N> 个问题 · P0 <N> / P1 <N> / P2 <N> · 验证 <通过>/<总数>

任务：<任务名称或无活动任务>
范围：<文件数与层级摘要>
结论：<一句话结论>

### 维度结果

| 维度 | 状态 | 问题 | 验证 |
| --- | --- | ---: | --- |
| 三件套实现 | <状态> | <N> | <摘要> |
| 实现假设 | <状态> | <N> | <摘要> |
| 完整性与规范 | <状态> | <N> | <摘要> |

### 问题清单

- [ ] `CHK-001` `[P1]` <标题>
  - 来源：<来源>
  - 证据：<file:line / 命令结果>
  - 影响：<影响>
  - 建议：<修复建议>
  - 位置：<受影响位置>
  - 验证：<验证命令或步骤>

### 未覆盖与风险

- [<部分验证/阻塞/N/A>] <说明>

### 修复批次

批次 1：<问题 ID> · <目标>
修复后：定向验证 -> Check-All 重检

操作：`修复全部`、`修复 CHK-001,CHK-003`、`仅保留报告`
```

没有问题时省略“问题清单”“修复批次”和修复操作，直接给出通过结论与剩余风险。

### 修复结果

```markdown
## Trellis Check-All 修复结果

[<完成/部分完成/失败>] 修复 <完成>/<计划> · 验证 <通过>/<总数> · 剩余问题 <N>

| 问题 | 修复 | 验证 |
| --- | --- | --- |
| CHK-001 | <状态> | <状态> |

### 未修复与风险

- <问题或风险>

结论：<重检结论与下一步>
```

原问题在重检中保留 ID；新根因继续递增编号。

## 兼容性与回滚

- Post-check Stop Gate 保持不变：检查报告不包含 commit message、文件提交计划或提交确认。
- 通过后才指向 Phase 3.3 / Phase 3.4；未通过时停留在修复/重检循环。
- route 决策继续按当前任务复用；修复使用 implement route，重检使用 check route。
- 回滚只需恢复四个 0.6 源 skill 文件并重新运行 `npm run sync`，不涉及数据迁移或运行时状态迁移。

## 双仓交付顺序

`enhancements/MANIFEST.json.sourceCommit` 来自 `vendor/skill-garden` 的当前 HEAD，因此不能用一个静态多仓计划同时提交 vendor 和父仓：vendor 产生新 commit 后，manifest 必须重新生成。

Phase 3.4 固定分为两段：

1. 先通过 `trellis-push` 仅交付 vendor 中的 0.6 源改动，父仓 dirty 保持原状。
2. vendor HEAD 更新后重新运行 `npm run sync`，确认 `MANIFEST.json.sourceCommit` 等于新的 vendor HEAD，并重新同步 dogfood 副本。
3. 重新执行源、快照、dogfood 一致性与 `git diff --check`。
4. 再通过 `trellis-push` 交付父仓改动。
5. 两个仓库都干净后运行 `node scripts/check-snapshot.mjs` 作为 Phase 3.4 最终交付验证。

不得在 vendor commit 前预写未来的 sourceCommit，也不得跳过中间的重新 sync。

## 设计取舍

- 不新增专用 agent 安装链路：通用 subagent 已能承载 audit-only prompt，改动更小且避免扩展多平台资产复制。
- 不复用自修复 `trellis-check` agent：其高优先级角色指令与单次修复确认不可兼容。
- 不持久化检查报告文件：问题 ID 在当前检查/修复会话中稳定即可，避免任务目录产生新的状态文件和同步协议。
