# Implementation Plan

## 1. 锁定基线与测试边界

- [x] 在 Check-All 专项测试中登记主入口 `7,916` bytes 和默认必读集合 `39,696` bytes 基线。
- [x] 增加 canonical `.agents` / `.claude` 字节一致性与条件加载文件独立计量断言。
- [x] 先补 depth、FBK、注释事实自动修复的正反场景断言，确保后续规则替换可验证。

## 2. 重写 light/full 深度判定

- [x] 在 canonical agents/claude `references/depth-routing.md` 原位替换主题域 hard-full 和重复 eligibility 文本。
- [x] 将 hard-full 收敛为公共契约、状态与数据、安全与时序、控制门禁、独立行为边界、未知影响和 full 重检等行为信号。
- [x] 明确载体中性规则：workflow/skill/command/hook/快照本身不决定深度。
- [x] 更新 `light-profile.md` 的适用边界，复用新的闭合范围与定向验证语义。
- [x] 保持 requested/effective/confidence/reasons schema 和单向升级规则不变。

## 3. 解耦 FBK 分类与验证完备度

- [x] 在 canonical agents/claude `references/fallback-findings.md` 把五项严格准入替换为三项硬准入。
- [x] 保留保护收益和验证方式作为报告字段，缺少验证环境时标记部分验证，不丢失 FBK ID。
- [x] 更新 light/full profile 中绑定旧五项准入的摘要文字。
- [x] 最小更新 reporting、route agent body 和其它消费者中明确写死“五项严格准入”的内容，不复制完整新规则。

## 4. 增加条件加载的注释事实自动修复

- [x] 新增 canonical agents/claude `references/code-comment-auto-remediation.md`，定义机械引用、局部实现事实、双重证据、语义黑名单、执行位置和验证流程。
- [x] 收缩 `document-drift-auto-remediation.md` 的重复说明，以一条条件路由接入新 reference，并登记现有 `DOC-*` 子类型。
- [x] 更新主 `SKILL.md` 的核心边界和 Step 3 摘要，但保持入口不超过基线。
- [x] 明确 subagent 永远只返回候选，interactive 与 validated auto-loop 的主会话都可落地。
- [x] 限制自动写入为事实片段替换，不整句润色、不删除注释，并排除整个公共 API Javadoc/docstring。
- [x] 明确源码注释不使用 `--doc-remediation-file`，修复后必须重算范围、复核画像并重跑定向验证。

## 5. 同步下游消费者

- [x] 核对 route 专用 Check-All agent、workflow Phase 2 ownership、reporting/disposition 与新契约一致。
- [x] 不新增报告通道、编号、持久化状态或独立深度 router。
- [x] 运行 canonical agents/claude parity 测试，删除任何重复或失效旧规则。

## 6. 生成与 dogfood 同步

- [x] 运行 `npm run patch:targets` 刷新适用 compiled targets。
- [x] 运行 `npm run sync` 生成 `enhancements/0.6` 发布快照。
- [x] 使用本仓 CLI 的 enhance-only 0.6 流程更新当前项目 dogfood 副本。
- [x] 重复执行 dogfood 更新，确认第二次零额外修改。
- [x] 逐字节核对 canonical、snapshot、compiled target 和当前 dogfood 的适用文件。

## 7. 验证

- [x] `node --test test/js/check-all-smart-depth.test.js`
- [x] `node --test test/js/check-all-fallback-findings.test.js`
- [x] 运行新增的注释自动修复和 Check-All 专项预算测试。
- [x] `npm run patch:targets:check`
- [x] `node scripts/check-patch-conflicts.mjs`
- [x] `node scripts/check-ai-context-budget.mjs`
- [x] `node scripts/check-ai-context-budget.mjs --strict`
- [x] `npm test`
- [x] `git diff --check`
- [x] `git -C vendor/skill-garden diff --check`

## Review Gates

- [x] 默认必读集合大于 `39,696` bytes 时停止，先删除或替换重复文本，不提高预算。
- [x] 任一 light 样例仍因载体名称直接 full 时停止，检查是否残留主题域判据。
- [x] 任一 FBK 因缺少运行环境而丢失分类时停止，检查分类与证据状态是否仍耦合。
- [x] 任一注释修复缺少本轮有意变化证据、可能改变可执行代码/工具指令或需要整句重写时停止，收紧白名单或转普通 finding。

## Rollback

- 恢复 canonical Check-All、route agent 和 Phase 2 owner 文件，删除新增条件 reference 与专项测试。
- 重新运行 `npm run patch:targets`、`npm run sync` 和 dogfood enhance-only 更新，确保派生产物回到同一基线。
