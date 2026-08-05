# 实施计划：Check-All 兜底通道

## 1. 重构 Check-All 分类源

- [x] 将 `.agents` / `.claude` 的 `references/optional-findings.md` 替换为 `references/fallback-findings.md`。
- [x] 定义 `CHK-*` / `FBK-*` 根因边界、FBK 准入条件、主观建议不报告规则和两类严重度分配。
- [x] 更新 `trellis-check-all/SKILL.md` 的描述、入口职责、核心边界、执行模式、收集结果和报告字段。
- [x] 更新 light/full profile 与 DOC 自动修复引用，strict pass 要求 CHK/FBK 均为 0。

## 2. 收敛报告与处置

- [x] 更新 `reporting-and-disposition.md` 的摘要、维度、CHK/FBK 字段、统一修复批次和修复结果。
- [x] 删除 `可选改进`、`为什么可选`、`修复全部可选项`、optional-only 通过和单独授权分支。
- [x] 让 `修复全部` 默认覆盖 CHK/FBK，精确修复支持混合 ID。
- [x] 更新 interactive、untracked、auto-loop 和 direct Git 判定，使任一剩余 FBK 都进入未通过或 fix/recheck。

## 3. 同步 route、agent、workflow 与 push

- [x] 更新 `trellis-route/SKILL.md` 和 `references/check-all-agent-body.md`，subagent 返回 CHK/FBK/DOC。
- [x] 更新 workflow Phase 2.2 Patch，strict pass 要求 zero CHK and zero FBK。
- [x] 更新 `trellis-push/SKILL.md`，未解决 FBK 与 CHK 一样标为阻断 findings。
- [x] 更新当前项目 `.trellis/agents`、Claude/Codex 专用 agent 与 workflow 投影。

## 4. 更新规范与测试

- [x] 重写 `enhancements-model.md` 中 Check-All、auto-loop、untracked、direct Git 和 push 的 OPT 契约。
- [x] 将 `test/js/check-all-optional-findings.test.js` 替换为 `test/js/check-all-fallback-findings.test.js`。
- [x] 覆盖分类优先级、FBK 准入、两类严重度、统一修复全部、FBK 阻断完成链和三层一致性。
- [x] 更新 `check-all-smart-depth.test.js` 等对分类引用文件名的断言。

## 5. 同步发布树

- [x] 在 skill-garden 真实源完成语义修改并确认 `.agents` / `.claude` 一致。
- [x] 运行 `npm run sync` 生成 `enhancements/0.6`，再运行项目 dogfood update 投影链，不手工维护生成副本。
- [x] 刷新需要更新的 compiled targets，并验证 0.5/old 无漂移。

## 6. 验证

- [x] 运行 fallback findings 聚焦测试、smart depth、route、workflow、push 和 Patch 冲突测试。
- [x] 搜索 0.6 源、快照、dogfood 和当前规范，确认无 `OPT-*`、`optional-findings.md`、`修复全部可选项` 残留。
- [x] 实现阶段运行 `npm test`、语法检查、`git diff --check` 和 context budget strict。
- [ ] skill-garden 提交、父仓 pin 更新并重新同步后，在 Phase 3.4 运行 `node scripts/check-snapshot.mjs`。
- [x] 对比 skill-garden 源、Flower 快照和 dogfood 对应文件逐字一致。
- [x] 使用 `skill-creator` 的校验原则确认 Skill frontmatter、引用和目录结构有效；现有 Skill 不重新初始化。

## 7. 回滚点

- [ ] source/snapshot/dogfood 同步前保留清晰 diff，若新模型跨 owner 不一致则不发布生成树。
- [ ] 若完整测试发现完成链回归，整体回滚 CHK/FBK 模型，不保留半套 OPT/FBK 并行语义。
