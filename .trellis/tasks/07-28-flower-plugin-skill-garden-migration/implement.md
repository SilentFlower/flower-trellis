# 内置 skill-garden 与旧 CLI 迁移实施计划

## 1. 前置门禁

- [ ] P2 Runtime、InstallPlan、transaction writer 已通过验收。
- [ ] P4 system capability、PatchMutation 和统一 preflight 已通过验收。

## 2. 实施步骤

### A. Builtin Plugin

- [ ] 新增 `flower/skill-garden` manifest 和 builtin payload adapter。
- [ ] 复用现有 variant、snapshot、catalog、asset 和平台映射。
- [ ] 保持 local operation ID、marker 和最终字节兼容。

### B. Facade 与 Init

- [ ] 将 `applyEnhancements()` 收敛为 application service facade。
- [ ] `init` 默认声明 skill-garden；实现 `--no-enhance`/`--enhance-only` 映射。
- [ ] 确认 plugin add 不隐式声明 skill-garden。

### C. Update 与状态迁移

- [ ] 普通 update 重放 lock，skill-garden variant按 Trellis 兼容线适配。
- [ ] 实现旧 manifest 只读迁移、目标 hash 核对、幂等和失败零写入。
- [ ] 停止旧 manifest 写链，保留只读证据。

### D. Update-check 与 Self-check

- [ ] 增加 `.flower/settings.json` 和新 cache 读写。
- [ ] 实现旧策略/cache fallback 与单向迁移。
- [ ] self-check 报告新 Plugin 状态并保持旧项目兼容。

### E. Uninstall

- [ ] 按 state ownership/hash 生成 dry-run 和删除计划。
- [ ] 保留其它 Plugin、共享路径和用户修改内容。
- [ ] 仅在 Runtime 空且安全时清理空 `.flower/`。

### F. 回归

- [ ] 建立 old/0.5/0.6 新旧最终树与 provenance 对比。
- [ ] 覆盖 init/update/migration/self-check/update-check/uninstall 幂等。
- [ ] 运行 sync、snapshot、Patch、context budget 和完整测试。

## 3. 文件所有权

- `src/builtin-plugins/skill-garden/**`
- `src/lib/apply-enhancements.js`
- `src/lib/enhancement-catalog.js`
- `src/lib/manifest.js` 的只读兼容适配
- `src/commands/init.js`
- `src/commands/update.js`
- `src/commands/uninstall.js`
- `src/commands/self-check.js`
- `src/commands/update-check.js`
- `src/lib/update-check.js` 的状态迁移适配
- 对应迁移与兼容测试

## 4. 验证命令

```bash
node --test test/js/plugin-skill-garden.test.js
node --test test/js/plugin-legacy-migration.test.js
node --test test/js/apply-enhancements.test.js
node --test test/js/platform-skill-distribution.test.js
node --test test/js/update-check.test.js test/js/update-backups.test.js
npm run sync
node scripts/check-snapshot.mjs
node scripts/check-patch-conflicts.mjs
npm run patch:targets:check
node scripts/check-ai-context-budget.mjs
npm test
git diff --check
```

## 5. 高风险检查点

- [ ] 不能同时保留旧 manifest 与新 state 两条成功写链。
- [ ] 不得仅为迁移修改 enhancement 快照最终字节或 marker。
- [ ] `--no-enhance` 不得隐式删除已声明 Plugin 或提权。
- [ ] update 不得升级外部 Plugin 版本。
- [ ] 损坏/漂移旧 manifest 不得按当前快照猜测 ownership。
- [ ] uninstall 不得删除其它 Plugin、共享或用户修改路径。

## 6. 回滚点

- facade 接管失败时恢复旧调用链，不留下部分 `.flower/` 状态。
- 迁移失败保留旧 manifest 与目标原状。
- update-check 新位置失败时继续只读旧配置，不写损坏的新策略。
