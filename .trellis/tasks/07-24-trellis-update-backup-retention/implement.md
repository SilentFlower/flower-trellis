# Trellis 升级备份保留实施计划

## 1. CLI 与上下文

- [x] 在 `src/constants.js` 增加默认保留数量常量，并把 `--backup-retention` 登记为带值的
  Flower 自有参数。
- [x] 在 `src/cli.js` 提取参数原始值并写入 `ctx.backupRetention`，在 `update()` 入口归一化为非负整数；
  非法值由现有 CLI 错误捕获路径在任何升级副作用前失败。
- [x] 更新 CLI help 和 README，说明默认 3、`0` 关闭、dry-run 与 `.backup-flower` 排除语义。

## 2. 安全清理 Helper

- [x] 新增 `src/lib/update-backups.js`，实现合法目录发现、真实路径边界校验、更新前快照、
  保留计划和逐项清理。
- [x] 公开函数和参数使用完整中文 JSDoc；非显然安全判断添加说明“为什么”的中文注释。
- [x] 对单项删除失败返回结构化 warning，继续处理剩余目录，不抛出到升级主流程。
- [x] dry-run 复用同一计划函数但不调用删除，保证预览和真实行为一致。

## 3. Update 编排

- [x] `src/commands/update.js` 在真实上游 update 前记录合法备份集合。
- [x] 在既有 `try/finally` 完整结束后计算本轮新增保护集合并执行或预览清理。
- [x] `--enhance-only`、`--backup-retention 0` 跳过发现和清理；`--no-enhance` 仍在 Trellis update
  成功后清理。
- [x] 统一打印保留、删除和 warning 汇总，避免无变化时产生冗长输出。

## 4. 测试

- [x] 新增 helper 单元测试：默认/覆盖数量、排序、本轮保护、非法名称、文件、软链接、
  `.backup-flower`、路径逃逸、dry-run 和删除失败继续。
- [x] 新增 CLI/编排契约测试：默认值、合法与非法参数、`OWN_FLAGS`、passthrough 隔离、
  成功后调用顺序和失败跳过。
- [x] 扩展 self-update 参数测试，验证 `--backup-retention` 经 `--` 进入项目 Flower update。
- [x] 运行 `node --test test/js/update-backups.test.js` 做聚焦验证。
- [x] 运行 `npm test` 做完整回归。

## 5. 文档与最终检查

- [x] 核对 README、CLI help、PRD 验收标准与实际行为一致。
- [x] 检查 `git diff --check`、新增源码中文 JSDoc/注释、显式 imports 和原文件缩进。
- [ ] Phase 2 检查通过后，由主会话在 Phase 3.3 判断并更新相关项目 spec。

## 风险文件与回滚点

- `src/commands/update.js`：调用位置决定失败时是否误清理；回滚时优先移除该调用。
- `src/lib/update-backups.js`：删除安全边界核心；任何路径断言不确定都应降级为 warning + 零删除。
- `src/cli.js` / `src/constants.js`：参数若未完整剔除会污染上游 Trellis；测试必须同时覆盖解析与透传。
- 回滚不删除任何现存备份，只撤销自动清理能力。
