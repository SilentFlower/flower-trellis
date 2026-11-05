# SessionStart 索引注入超限实施计划

## Preconditions

- [x] 完整展示基于最新 PRD、design、本计划生成的 Brief，取得当前任务的首次实施批准。
- [x] 执行 `task.py start` 后经 `trellis-route(target=implement)` 进入实施；执行方式遵守该入口，未获授权不分发子代理。
- [x] 实施前按 `trellis-before-dev` 重新确认涉及层的约定、当前源文件和相关函数定义。

## Ordered Work

1. **复现和保护既有行为**
   - [x] 从 pinned full 目标部署隔离夹具，用 499 个索引复现超限；记录三段尺寸和关键块。
   - [x] 确认既有模型、平台、首答、任务状态、条件刷新和超限诊断断言仍覆盖；建立规模用例的失败证据。
2. **修改拥有该片段的源 Patch**
   - [x] 在已有 context-trim Patch 增加精确替换，将全量路径列表改成固定发现入口。
   - [x] 复用原生计数及 Claude 包筛选；仅输出真实存在的指南路径。
   - [x] 覆盖全部现有共享目标并核对 literal 唯一匹配、语言和缩进；无需改 wrapper 或额度配置。
3. **完善最终输出回归**
   - [x] 补充下方矩阵；夹具从最新编译目标读取原生 Hook，避免依赖已更新的 dogfood。
   - [x] 预算 checker 保留十八场景和最大输出公式，加入两平台 1000 索引场景（合计二十场景）；同步 JS 断言和必要的 compiled-target 断言。
   - [x] 保留通用默认/strict 告警语义，用专门行为断言要求本次规模场景各段不超过 8000 字符。
4. **生成、同步和验证**
   - [x] 生成 compiled targets，运行 `npm run sync`；核对作者源、快照与最终目标。
   - [x] 按下方验证命令执行关联专项、完整回归及严格预算，复用当前内容下的成功证据。
   - [x] 隔离目标先预览，再应用两次；第二次目标零变化，保留额度和其它用户设置。
5. **应用与行为取证**
   - [x] 预检当前 Flower 和 `/root/project/xiaoxian-desktop` 的受管更新范围，按既有生命周期应用；记录更新前后相关文件哈希及输出体积。
   - [x] 只读核对受影响窗口的真实重建：state、rules、stages 完整且未截断；历史全文与原任务文件仍可读取。未改写该窗口 runtime。
   - [x] 经 `trellis-route(target=check)` 完成 Check-All，按流程进入 Spec 评估和 Push 计划。
   - [x] 按用户已确认的 `trellis-push` 精确计划完成两个维护仓的业务提交与推送；提交后快照 clean/pin 检查通过。
   - [x] 收集修复提交的原生平台 CI 结果：运行器调整后八项必需检查全部成功，详情见 `validation.md`。
6. **补齐发布所需的原生 CI 前置**
   - [x] 对照 GitHub Actions 官方发行清单，仅将 Linux / Python 3.8 组合固定到 Ubuntu 24.04，保留四个兼容组合及全部测试步骤。
   - [x] 解析并展开工作流矩阵，核对其它 job 和发布依赖不变；运行既有 CI 分流专项。
   - [x] 按用户后续 beta 发布请求完成 dry-run 版本号与 CHANGELOG 预览并取得明确确认；后续真实发布由项目发版 SOP 承接，以发布工作流的完整 CI 成功为前置。

## Regression Matrix

| 维度 | 必需覆盖 | 期望 |
| --- | --- | --- |
| 目录规模 | 0、少量、499、1000 | 真实计数准确，三段分别 ≤8000 字符 |
| 路径 | 普通路径、长路径、Unicode 名称 | 不输出全量清单，字符与 UTF-8 字节分别测量 |
| 指南 | 存在、缺失 | 已有入口可达，缺失时无虚构路径 |
| 状态 | 无任务、进行中任务 | 当前任务与状态信息完整，正确选择 workflow-state |
| 来源与平台 | Codex/Claude × startup/clear/compact | 重建正文完整；既有 resume、禁用、maintenance 行为不变 |
| 模型 | 保留十八场景，并在规模场景启用提示 | 提示块的数量、原文及平台边界正确 |
| 投影 | context-trim 的全部既有平台目标 | compiled 与真实安装结果一致，二次应用幂等 |
| 宿主 | 受影响 Codex 会话真实重建 | 无中间截断，完整任务块与尾部规则可核对 |

## Validation Commands

以下为本轮实施采用的验证入口，实际执行结果与复用范围见 `validation.md`。

```bash
npm run patch:targets
npm run sync
node scripts/run-python-tests.mjs test/python/test_flower_session_start.py test/python/test_skill_garden_patches.py
node --test test/js/ai-context-budget.test.js test/js/platform-patches.test.js test/js/apply-enhancements.test.js
npm run patch:targets:check
node scripts/check-ai-context-budget.mjs --strict
git diff --check
npm test
```

专项用于实现反馈，完整回归覆盖本次 Patch 配置、Hook 行为和预算夹具修改。全部当前内容检查通过后不为交接重复运行；后续变更只补跑受影响检查。

`node scripts/check-snapshot.mjs` 是要求子仓和快照均已提交的发布前置门禁，留到已批准的提交链完成后运行；当前阶段通过源/快照逐字节比较、compiled targets 和真实 Patch 冲突检查核对内容一致性，不为通过清洁状态检查提前提交。

隔离目标及已检查的真实目标使用本仓现有 CLI：

```bash
node bin/flower-trellis.js update --enhance-only --no-update-check --target <已确认目标> --dry-run
node bin/flower-trellis.js update --enhance-only --no-update-check --target <已确认目标>
```

目标先由既有安装夹具或复制的受管基线准备；不把上述占位命令当作已执行记录，不在规划阶段更新真实项目。原生 Ubuntu/Windows × Python 3.8/3.12 必需 CI 的 run 链接、head SHA、矩阵及失败/跳过原因留到实施证据中。

## Rollback Points

- 作者源尚未应用时，修正本任务的 Patch、重新生成和同步即可。
- 隔离 preflight 或验证失败时，不进入真实目标更新。
- 真实更新失败时使用既有事务补偿；出现用户文件漂移则保留文件和诊断，回到源 Patch 或范围核对。
- 宿主仍截断或任一关键块缺失时，任务保持未完成，继续定位实际接收额度和剩余动态体积，不调高阈值掩盖问题。
