# Trellis Meta Skill-Garden Overlay 实施计划

## 1. Patch Source

- [x] 在 `vendor/skill-garden/.trellis/0.6/overrides/patches/skills/trellis-meta/` 创建四个职责单一的 Patch 叶子。
- [x] 从 `@mindfoldhq/trellis@0.6.5` 当前 meta 提取精确 selector/baseline，逐项覆盖入口、架构、所有权、定制路由和 workflow owner 冲突。
- [x] 显式列出 `ENHANCEMENT_SKILL_TARGETS` 对应的各平台 `trellis-meta` 目标，使用 `each-existing` 和 `missing: skip`。
- [x] Patch content 保持英文目标风格，不新增 Markdown target，不复制 owner skill 的完整流程。

## 2. Bundle And Policy

- [x] 新增 `overrides/bundles/trellis-meta.json`，支持全量、`trellis-meta`、`meta-architecture`、`trellis-create-command` 和 `create-command` 选择。
- [x] 更新 `overrides/conflicts.json`，为全部新增 operation 增加 required/absent final-output assertions。
- [x] 验证新 Bundle 未把 `intent-routing`、finish-work、update-spec 或其它无关 Patch 带入精细计划。

## 3. Tests

- [x] 扩展 JS real catalog/apply tests，覆盖全量安装、四个选择别名、多平台 target、缺失平台、幂等和最终冲突原文消失。
- [x] 扩展 Python consumer tests，覆盖 Bundle/alias 选择、operation/provenance 和 conflict rule 完整性。
- [x] 增加 target root 与 `ENHANCEMENT_SKILL_TARGETS` 的一致性断言，防止未来新增平台漏补 meta Patch。
- [x] 验证 `trellis-create-command` 精细安装同时得到 skill 内容与 meta 依赖 Patch，且不扩大其它 Bundle。

## 4. Sync And Generated Evidence

- [x] 运行 `npm run sync`，把 vendor 源同步到 `enhancements/0.6`。
- [x] 逐字节比较 vendor 与 snapshot 的 Patch、Bundle、policy 文件。
- [x] 运行 `npm run patch:targets` 刷新 canonical compiled targets。
- [x] 运行 `npm run patch:targets:check`，确认生成结果零漂移。
- [x] 通过本地 Flower enhance/update 链同步当前 `.agents`、`.claude` dogfood meta 副本，禁止手工把 dogfood 当作者源。

## 5. Verification

- [x] 运行 Patch catalog/conflict 定向测试与 Python consumer 测试。
- [x] 运行 `npm test`。
- [x] 运行 `node scripts/check-ai-context-budget.mjs` 和 `--strict`，审阅增量且不调整阈值。
- [x] 运行 `git diff --check` 与 `git -C vendor/skill-garden diff --check`。
- [x] 对隔离 Trellis 0.6.5 目标执行 full、`trellis-meta`、`trellis-create-command`、二次应用和 dry-run 验证。
- [x] 检查最终 meta：保留 task/spec/workspace/channel/mem 等上游事实，冲突的直接编辑、二分类 ownership 和直接 check 派发描述已消失。

## 6. Risk And Rollback Points

- [x] 若任一 selector/baseline 不稳定，停止并缩小 section，不改用模糊 literal 或顶部追加。
- [x] 若 Bundle alias 造成范围扩大，拆分依赖或调整 alias，不把 meta Patch 塞入无关 Bundle。
- [x] 若最终 meta 体积明显增长，优先压缩入口并把细节留在既有 references，不新增第二套流程正文。
- [x] 若上游 0.6.5 canonical target 与 dogfood 不一致，先恢复标准 upstream baseline，再应用 Patch，不以当前受管结果反推 baseline。

## 7. Auto-Loop DOC And Retry Repair

- [x] 扩展 `auto_loop.py` action snapshot，给 check/recheck 保存逐文件 planning/handoff baseline。
- [x] 新增 record DOC remediation 精确文件参数，验证当前任务、白名单、实际变化集合和 protected 边界。
- [x] 合法 DOC 修复重算 hash 并追加带来源与文件列表的 manifest revision/audit event。
- [x] 将 Check record 阶段未声明 artifact drift 改为有预算的 `retryable`，保留 outstanding action；其它 action 继续失败关闭，成功后重置计数。
- [x] 支持 agent 明确判定无法安全归因时用 `blocked + artifact-drift` 结束，不自动接受外部变化。
- [x] 更新 Auto-Loop 与 Check-All canonical skill/reference，说明 DOC record 参数、retryable 自纠和 terminal retry-blocked 边界。
- [x] 扩展 Python runner tests：DOC 成功重绑、非法路径、声明/实际不一致、retryable 后成功、预算耗尽、显式 blocked。
- [x] 扩展 JS control-plane tests，确保最终 skill、snapshot 和 dogfood 使用新合同且不把细节复制进 workflow hub/state。
- [x] 运行 `npm run sync`、定向测试、`npm test`、context budget、compiled targets、dogfood 幂等和双仓 diff check。

## 8. Meta Impact Review Gate

- [x] 在 `enhancements-model.md` 增加七段式 `Trellis Meta Synchronization Gate` 场景，定义 `no-op | patch-required` 双态合同。
- [x] 明确 owner 内部 SOP 不复制进 meta，owner/架构/所有权/发现/分发变化才触发 canonical meta Patch 更新。
- [x] 增加 JS 回归测试，验证 Planning Brief 仍可从 meta 路由到 `trellis-task-brief`，同时不复制显式预授权细节。
- [x] 复核 Brief 提交与当前任务共享路径，确认共享聚合文件保留双方语义且没有覆盖同一 owner 正文。
- [x] 运行定向测试、完整测试、context budget 与双仓 diff check。
