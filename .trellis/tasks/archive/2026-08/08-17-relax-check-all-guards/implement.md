# Implementation Plan

## 1. 更新契约测试

- [x] 修改 `test/js/check-all-fallback-findings.test.js`，删除 P0 固定 ID 口令断言，增加当前报告全部风险语义接受、部分接受唯一定位和漂移失效断言。
- [x] 修改 `test/js/check-all-smart-depth.test.js`，覆盖跨轮局部 light 重检、单次升级不降级、完成/提交不强制 full、证据失效时 full、上线后验证非阻断和阻断型部分验证反例。
- [x] 增加 Light/Full 充分验证证据正反断言：自动化、可重复手动/静态证据有效；缺少充分证据或 spec 明确要求自动化时仍产生 CHK。
- [x] 更新 workflow / Push / dogfood 一致性断言，确保上线后验证保持可见且不成为 silent bypass。

## 2. 修改 Check-All canonical

- [x] 在 agents/claude `fallback-findings.md` 和 `reporting-and-disposition.md` 原位替换 P0 精确 ID 特例，改为当前报告语义绑定。
- [x] 定义 `部分验证` 与 `[上线后验证]` 的边界、报告位置、通过条件、interactive 和 auto-loop disposition。
- [x] 在 agents/claude `depth-routing.md` 移除跨轮 full 锁定，保留单次 light->full 单向升级，并增加局部修复定向重检条件。
- [x] 在 agents/claude `light-profile.md` / `full-profile.md` 统一充分验证证据口径，消除“缺少自动化测试即 CHK”的绝对规则。
- [x] 核对主 `SKILL.md` 是否只需一跳摘要；优先替换旧句，不复制 reference 细则。

## 3. 同步下游 owner

- [x] 更新 route Check-All agent body，使 subagent 区分阻断型部分验证与上线后验证。
- [x] 更新 workflow Phase 2 Check owner：仅阻断型部分验证阻断完成链，完成/提交不再无条件触发 Full，范围扩大或证据失效时仍回到 Full。
- [x] 更新 Push 完成链摘要/模板，使上线后验证作为非阻断风险继续展示并交给 release 流程。
- [x] 更新 `.trellis/spec/flower-trellis/cli/enhancements-model.md` 的 Audit-First Check-All 长期契约。

## 4. 同步生成物

- [x] 同步 canonical `.agents` / `.claude` 对等副本。
- [x] 运行 `npm run patch:targets` 刷新 Skill-Garden compiled targets。
- [x] 运行 `npm run sync` 刷新 `enhancements/0.6` 与 manifest。
- [x] 通过 Flower Plugin 生命周期更新当前项目 dogfood；重复执行确认第二次零额外变化。
- [x] 比较 canonical、snapshot、compiled target 和 dogfood 的适用文件。

## 5. 验证

- [x] `node --test test/js/check-all-fallback-findings.test.js`
- [x] `node --test test/js/check-all-smart-depth.test.js`
- [x] 运行受影响的 workflow、Push、分发与输出模板定向测试。
- [x] `npm run patch:targets:check`
- [x] `node scripts/check-patch-conflicts.mjs`
- [x] `node scripts/check-ai-context-budget.mjs`
- [x] `node scripts/check-ai-context-budget.mjs --strict`
- [x] `node scripts/check-output-templates.mjs`
- [x] `npm test`
- [x] `git diff --check`
- [x] `git -C vendor/skill-garden diff --check`

## Review Gates

- [x] 任何可在提交前无副作用完成的验证被误归为上线后验证时停止并修正规则。
- [x] 任何跨轮 light 重检缺少闭合范围、原 finding 映射或定向证据时停止并升级 full。
- [x] 任何“明确接受当前报告全部风险”仍触发第二次口令确认时停止。
- [x] 任何缺少自动化测试但已有充分可重复证据的场景仍被无条件记录 CHK 时停止。
- [x] 不通过提高上下文预算阈值消除告警。

## Rollback

- 恢复 Skill-Garden canonical Check-All、route、workflow、Push 和测试文件。
- 重新运行 `npm run patch:targets`、`npm run sync` 与 dogfood replay，使所有派生产物恢复同一基线。
