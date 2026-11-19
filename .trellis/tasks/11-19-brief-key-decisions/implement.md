# 实施与验证计划

## Implementation

- [x] 读取任务三件套及命中规范，完成 Brief 首次展示与适用确认后激活任务。
- [x] 进入 `trellis-route(target=implement)`，按路由执行 `trellis-before-dev`。
- [x] 调整 Brief 两端作者源：提取优先级、具体影响、加粗标签、软展示建议和模板。
- [x] 调整 Brainstorm handoff Quality Bar 与 summary-shape，保持限制审查与 Brief owner 分工；同步 conflicts 的 required-literal 断言。
- [x] 补齐既有规则专项的必要契约断言，保留首次/增量确认、runner 与 fresh brief 守卫。
- [x] 同步快照、compiled targets 和当前项目受管投影。

## Validation

- [x] `node scripts/ci-impact.mjs --rules`：114 项 JavaScript、79 项 Python 全部通过。
- [x] `node scripts/check-patch-conflicts.mjs`：60 Patch、251 operation、1391 ready target，warning 0。
- [x] `npm run patch:targets:check`：937 个文件零漂移。
- [x] `node scripts/check-ai-context-budget.mjs --strict`：退出 0；states-total 既有普通 warning，未超过 review ceiling。
- [x] `node scripts/check-output-templates.mjs`：36 个 Skill 文档通过。
- [x] 对照当前任务的派生 Brief，检查摘要长度、章节职责、重要决定和限制的实际影响：保留八段，三项关键决定标亮。
- [x] 核对各平台最终内容、两端一致性及当前项目 Plugin ownership；两次 enhance-only 分别变更 4 项、0 项。
- [x] 作者源与发布快照相关文件逐字节一致；两端 Brief 与 dogfood 一致，Brainstorm 与 compiled targets 一致。
- [x] 提交后执行发布洁净门禁 `node scripts/check-snapshot.mjs`：来源 `2f28268c4f` 一致，源码与快照洁净，Patch 冲突门禁通过。实施阶段的未提交检查已由实际提交后结果闭合。

## Review And Completion

- [x] 进入 `trellis-route(target=check)` 完成 Check-All；requested=auto、effective=full，适用维度全部通过，CHK/FBK/DOC 均为 0。
- [x] 进入 `trellis-update-spec`：written，最小更新 `enhancements-model.md` 的 Planning Brief Review Gate 场景，`git diff --check -- .trellis/spec` 通过。
- [x] 由 `trellis-push` 展示多仓精确计划，用户确认后按精确范围完成两仓业务提交推送；当前任务记录随最终完成态独立提交。

## Rollback Points

作者源审查完成后再同步；产物一致性通过后再刷新投影。出现语义或投影问题时按本次精确变更集合修复，并保留工作区已有的其他任务变更。

## Push Generation Order

1. Skill-Garden 作者源与 compiled targets 精确提交推送。
2. 在 Flower 根运行 `npm run sync`，刷新 `enhancements/MANIFEST.json` 的来源 SHA。
3. 在 Flower 根运行 `node bin/flower-trellis.js update --target . --enhance-only --no-update-check -y`，同步来源摘要产生的 Plugin lock；内容投影已在实施阶段验证。
4. 复核仅预期快照、Plugin lock 和子模块 pin 随生成变化，提交推送 Flower 本轮精确业务文件。
5. 运行 `node scripts/check-snapshot.mjs` 复核发布来源和洁净状态，再写完成进度与 Close，独立提交推送当前任务七个记录文件。

## Delivery Evidence

- Skill-Garden 业务提交 `2f28268c4fdb5ed52a232194d2a9135bb447b2a9` 已推送。
- Flower 业务提交 `338ceaf94afca8f66a35e33b94d7941ca065e2e9` 已推送；生成后 14 个精确文件、快照来源及项目投影核对通过。
- GitHub CI `44432186110` 对应 Flower 业务提交，判断验证范围与规则/产物两项 job 均为 success；Python/Node 原生矩阵按本次文案和产物范围分流跳过。
- CI 链接：https://github.com/SilentFlower/flower-trellis/actions/runs/44432186110
