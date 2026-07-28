# Flower Plugin 跨模块集成、打包与端到端验收实施计划

## 1. 前置门禁

- [ ] P3、P4、P5、P6 已通过各自 Check-All；P1/P2 契约已稳定。

## 2. 实施步骤

### A. CLI 与文档

- [ ] 统一 help、子命令错误、退出码、dry-run、JSON stdout/stderr。
- [ ] 更新 README，并用 help/example contract 测试防漂移。

### B. 打包

- [ ] 复核 package files、dependencies、optional keyring 和运行资产。
- [ ] 增加 tarball allow/deny 清单与安装后 smoke。

### C. 场景 Harness

- [ ] 建立真实 CLI subprocess、隔离 XDG/HOME、文件树和网络请求捕获。
- [ ] 建立 Plugin/Marketplace/legacy/GitLab fixture。
- [ ] 覆盖无 Trellis、新旧项目、多平台、多依赖、capability、OAuth、作者工具和 uninstall。

### D. 安全与恢复

- [ ] 增加零网络、敏感扫描、preflight 零写入和 writer 故障恢复场景。
- [ ] 增加两次应用幂等和 mtime/lock/state 断言。

### E. 父任务审查

- [ ] 建立父验收 evidence matrix 并扫描共享契约漂移。
- [ ] 缺陷回流所属子任务，修复后重跑相关定向测试和全量门禁。
- [ ] 执行真实 GitLab 人工 smoke，不保存凭据或响应。

## 3. 文件所有权

- `README.md`
- `package.json`、`package-lock.json` 最终复核
- `src/cli.js`、`src/commands/plugin.js` 的 help/输出集成
- `test/fixtures/plugin/**`
- `test/js/plugin-e2e-*.test.js`
- npm pack 与父验收 evidence 脚本
- 前序模块只允许针对集成暴露的契约缺陷做最小修复

## 4. 验证命令

```bash
node --test test/js/plugin-e2e-local.test.js
node --test test/js/plugin-e2e-gitlab.test.js
node --test test/js/plugin-e2e-migration.test.js
node --test test/js/plugin-e2e-capabilities.test.js
node --test test/js/plugin-e2e-authoring.test.js
npm run sync
node scripts/check-snapshot.mjs
node scripts/check-patch-conflicts.mjs
npm run patch:targets:check
node scripts/check-ai-context-budget.mjs --strict
npm test
npm pack --dry-run --json
git diff --check
```

## 5. 高风险检查点

- [ ] CLI harness 不得读取真实 HOME/XDG/keyring 凭据。
- [ ] fixture、snapshot、日志和 tarball 不得包含真实 secret/token。
- [ ] 不得通过放宽 schema、digest、capability、selector 或 required 语义修复集成。
- [ ] optional keyring 缺失必须可运行，但不得生成明文 fallback。
- [ ] P7 不新增平行 DTO、错误码、状态 schema 或 writer。
- [ ] 本任务不发布、push、merge 或修改真实 rd-guide。

## 6. 回滚点

- 任一全量门禁失败则不发布包含部分 Plugin Runtime 的包。
- 集成缺陷回滚到所属模块，P7 不保留兼容性旁路。
- npm pack smoke 失败时恢复原 files/dependency 配置并重新定位缺失资产。
