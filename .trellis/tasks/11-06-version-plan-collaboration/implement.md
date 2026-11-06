# 实施与验证安排

## Preconditions

- 完整 Brief 已展示；用户确认 Wave 业务操作边界并明确要求开始改造，本轮先同步 Brief，再执行 `task.py start` 并进入 `trellis-route(target=implement)`。
- 预期内联实施，不主动调度子 Agent；进入实施阶段重新遵循 route 的实际结果和适用指令。
- 开始写 Skill 前加载 `trellis-before-dev`，复用本任务研究、design 和相关规范，核对所有目标最新内容和所有权。

## Steps

- [x] 1. 更新 0.6 `trellis-plan-version` 的核心语义，先将业务操作与可验收结果映射为 Wave，再确定工作包、依赖／容量及集成验收责任；工时按当前人＋Agent 方式使用小时区间、明确口径和依据，保留现有覆盖和评审门禁。
- [x] 2. 同步 `trellis-extract-prd` 的继承内容与 PRD 模板，区分原始业务 AC 和工程完成／交接；使用现有 task 字段，不扩展 schema。
- [x] 3. 同步 `trellis-verify-task` 对候选、实际关联任务及子任务的校验，纳入协作缺口、粒度依据、旧格式与滚动规划兼容。
- [x] 4. 同步三项 `.agents`／`.claude` 维护源；检查表格、描述和按需参考入口，不将案例特有信息写成通用要求。
- [x] 5. 按 `design.md` 的八个场景回放，保存输入、实际产物和结论，检查三项 Skill 是否能连续传递信息；同时确认 Brief 原有模板可承接关键条件。
- [x] 6. `npm run sync` 刷新发布快照；核对实际 diff，按需更新 compiled targets，再通过受管生命周期的 dry-run／事务刷新本项目副本。
- [x] 7. 执行下列关联验证；当前实现检查通过，发布前清洁门禁单独保留待提交后复验。
- [x] 8. Check-All、Spec 评估、精确 Push 计划及两个业务仓库推送已完成；主仓必需 CI 全部通过，任务记录与 Close 按 Push owner 同步。

## Validation

### Skill 与场景

- 对 `.agents`／`.claude` 中本轮修改的三个维护源分别运行 `/root/.codex/skills/.system/skill-creator/scripts/quick_validate.py`，核对 frontmatter、名称和未完成脚手架。
- 按八场景观察实际规划／PRD／校验产物，不新增只匹配本轮措辞的测试；若实施确需修改 helper 或命令，另补真实行为回归并同步规划。
- 核对 Wave 的业务角色／起始条件／操作／结果／验收映射、原文保真、工程标准的依据、责任与依赖的传递、逻辑顺序和兼容处理，不以表头齐全替代语义通过。

### 既有项目门禁

```bash
node scripts/ci-impact.mjs --rules
node scripts/check-snapshot.mjs
npm run patch:targets:check
node scripts/check-ai-context-budget.mjs --strict
node scripts/check-output-templates.mjs
git diff --check
git -C vendor/skill-garden diff --check
```

只在确需刷新 Patch 最终产物时运行 `npm run patch:targets`。复用同一内容和环境下已通过的验证，不因阶段交接重复执行；实际命令、退出状态与覆盖范围以研究目录日志及执行记录为准，不将未执行项写成通过。

`check-snapshot.mjs` 是发布前的已提交快照门禁。首次因未提交改动未通过；获准完成两个业务仓库提交后已复验通过，包含快照来源／清洁门禁和 Patch 冲突检查。原失败日志与通过日志均保留，最终以提交后结果为准。

## Review And Rollback Points

- 三项维护源同步后审阅语义一致性，再生成快照，避免只改一个入口就更新安装副本。
- 受管副本更新前核对 preflight 精确范围，不能手工覆盖其他 Plugin、用户改动或 `.flower` 状态。
- 发现原始来源、Task 边界或验收语义仍有用户待决取舍时暂停受影响部分，先更新材料；不以实现细节替用户作决定。
- 回退仅涉及本轮 Skill 源与派生产物；不修改外部项目，不重开或迁移其历史任务。

## Delivery Evidence

- Skill-Garden 源提交 `a6eb24b6f76fe2e3db6ed7992a87a41891b09db8` 已推送。
- Flower-Trellis 业务提交 `70c96ee463a85ebead84626f5c2cc6ae6faf6d14` 已推送。
- 提交后 `node scripts/check-snapshot.mjs` 通过，包含快照来源／清洁门禁及 Patch 冲突复验。
- [业务提交 CI](https://github.com/SilentFlower/flower-trellis/actions/runs/42153539199)：通过；headSha=`70c96ee463a85ebead84626f5c2cc6ae6faf6d14`，8 个 job 均为 completed／success，无跳过项。
- Skill-Garden 未配置 Actions workflow，此提交无独立 CI run；源变更由主仓递归检出的业务 CI 覆盖。

### CI Jobs

| 检查 | 结果 |
| --- | --- |
| 判断验证范围 | success |
| 规则与产物 | success |
| windows-latest / Node 22 | success |
| windows-latest / Python 3.8 | success |
| windows-latest / Python 3.12 | success |
| ubuntu-latest / Node 22 | success |
| ubuntu-24.04 / Python 3.8 | success |
| ubuntu-latest / Python 3.12 | success |
