# Flower Plugin 跨模块集成、打包与端到端验收实施计划

## 1. 前置门禁

- [ ] P3、P4、P5、P6 已通过各自 Check-All；P1/P2 契约已稳定。

## 2. 实施步骤

### A. CLI 与文档

- [ ] 统一 help、子命令错误、退出码、dry-run、JSON stdout/stderr。
- [ ] 收敛顶层 help 为单一 `flower-trellis plugin` 入口；完整显式命令只保留在 `plugin --help` 和 README 高级/自动化章节。
- [ ] 新增 `src/commands/plugin-interactive.js`，实现 TTY 裸 `plugin` 首页、循环导航和可注入 prompt/runner；非 TTY、显式子命令与 JSON 保持现有路径。
- [ ] 把远程搜索的结构化执行结果抽成公共 helper，使交互 UI 与 `plugin search` 输出复用同一来源，不解析 stdout。
- [ ] 实现单选浏览安装：来源、查询、Plugin/版本、平台、dry-run、认证恢复、capability 摘要和最终确认。
- [ ] 实现已安装 Plugin 的 verify/update/remove、更新检查、source/auth 管理和作者工具入口；所有写操作在确认前执行 dry-run。
- [ ] 更新 README，并用 help/example contract 测试防漂移。

### A2. Claude Code 风格交互重做

- [ ] 用 `@inquirer/core` 体系实现轻量横向页签 prompt，支持 `Tab`、左右键和数字键切换 `发现 / 已安装 / 来源 / 问题`，不引入 Ink/React/Blessed。
- [ ] `发现` 聚合已授权来源的 Plugin，并为未授权来源展示可直接进入 Device Flow 的登录项；单一未授权来源进入发现页时自动启动 Device Flow。
- [ ] 增加 Plugin 详情页，安装前展示来源、描述、版本和可用版本，再进入平台、dry-run、capability 和最终确认。
- [ ] 在进程内保留 active tab、搜索词和选中 Plugin；详情返回、授权完成和命令执行后恢复原位置。
- [ ] `已安装`、`来源`、`问题` 使用统一视觉层级、状态标签和返回语义；修复内置来源覆盖无法恢复默认配置的问题。
- [ ] 作者 init/validate 保留为高级命令，不再占用普通用户的四页签主界面。
- [ ] 更新交互单元测试和真实 PTY smoke，覆盖页签、自动 Device Flow、状态恢复、详情和零写入退出。

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
node --test test/js/plugin-interactive.test.js
node --test test/js/plugin-e2e-interactive.test.js
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
- [ ] 交互层不得解析人类 stdout 获取领域数据，不得复制 Application Service、OAuth、Keyring、source schema 或 capability 判断。
- [ ] 首页和本地管理路径保持零网络；非 TTY、显式子命令和 `--json` 不得出现 prompt 或阻塞。
- [ ] 顶层 help 不再枚举 lifecycle、authoring、source/auth/search 三组命令，同时不得删除交互层和 CI 依赖的底层命令能力。
- [ ] 搜索安装首版保持单 Plugin 事务，不实现多选批量或隐式部分成功。
- [ ] 本任务不发布、push、merge 或修改真实 rd-guide。

## 6. 回滚点

- 任一全量门禁失败则不发布包含部分 Plugin Runtime 的包。
- 集成缺陷回滚到所属模块，P7 不保留兼容性旁路。
- npm pack smoke 失败时恢复原 files/dependency 配置并重新定位缺失资产。
