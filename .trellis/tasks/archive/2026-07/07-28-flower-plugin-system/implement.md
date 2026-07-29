# Flower Plugin 体系实施计划

## 1. 执行策略

这是父任务，只负责统一架构、任务图、跨模块契约和最终集成验收。实际实现通过七个子任务完成；每个子任务独立补齐 PRD、design、implement、上下文和测试后再启动。

当前阶段只完成规划，不创建实现分支、不修改产品代码。父任务规划经用户审阅后再创建子任务，避免 `task.py create` 自动切换当前 planning 指针导致本轮父任务上下文丢失。

## 2. 任务图

```text
P1 契约与 Project Store
 ├──> P2 Runtime、依赖与生命周期 CLI
 ├──> P3 GitLab Marketplace、OAuth、keyring
 └──> P4 Capability 与 Patch 集成

P2 + P4 ──> P5 skill-garden 与旧 CLI 迁移
P1 + P2 + P3 ──> P6 作者工具、Skill、rd-guide CI 契约
P3 + P4 + P5 + P6 ──> P7 集成、打包与端到端验收
```

P2、P3、P4 在 P1 的 schema 与 store API 稳定后可以并行。P5 必须等待 Runtime 生命周期和 Patch 权限模型；P7 最后执行。

## 3. 子任务规划

已创建的子任务目录：

| 编号 | 子任务目录 | 依赖 |
| --- | --- | --- |
| P1 | `07-28-flower-plugin-contract-state` | 无 |
| P2 | `07-28-flower-plugin-runtime-lifecycle` | P1 |
| P3 | `07-28-flower-plugin-gitlab-marketplace` | P1 |
| P4 | `07-28-flower-plugin-patch-capabilities` | P1 |
| P5 | `07-28-flower-plugin-skill-garden-migration` | P2、P4 |
| P6 | `07-28-flower-plugin-authoring` | P1、P2、P3 |
| P7 | `07-28-flower-plugin-integration` | P3、P4、P5、P6 |

### P1. Plugin 契约与 Project Store

建议 slug：`flower-plugin-contract-state`

交付范围：

- [ ] 定义并实现 Plugin manifest、Marketplace manifest、`plugins.json`、lockfile、state schema v1。
- [ ] 建立 canonical Plugin ID、SemVer、不可变 commit 和 canonical tree hash 契约。
- [ ] 实现安全路径归一化、稳定 JSON 序列化和 schema 错误模型。
- [ ] 实现 `.flower/` Project Store、局部 `.gitignore`、原子单文件写和容错读取。
- [ ] 定义 Source、Package、ResolvedGraph、CapabilityGrant、InstallState 等内部 DTO/JSDoc 契约，供后续子任务复用。

文件所有权：

- `src/plugin/schemas/**`
- `src/plugin/state/project-store.js`
- `src/plugin/integrity/**`
- 对应 `test/js/plugin-*-schema.test.js`、`plugin-project-store.test.js`

不包含：依赖求解、远端访问、Patch 应用、旧 manifest 迁移。

验收：所有 schema 正反例、稳定序列化、路径逃逸、损坏文件容错和 `.flower/.gitignore` 测试通过。

### P2. Runtime、依赖解析与生命周期 CLI

建议 slug：`flower-plugin-runtime-lifecycle`

依赖：P1。

交付范围：

- [ ] 实现 Source Registry 接口、内置/local provider 最小能力和 application service。
- [ ] 实现直接/传递依赖图、SemVer 求解、锁定保持、共享依赖、循环/冲突诊断和 orphan 计算。
- [ ] 实现平台检测、canonical Skill 内容投影和共享 `.agents/skills` 去重。
- [ ] 实现普通内容 unified preflight、路径冲突检查和 transaction writer。
- [ ] 实现 `plugin list/add/update/remove/verify` 与 `--dry-run`、`--json`。
- [ ] `plugin add` 在无 Trellis 项目中建立最小 `.flower/`，不生成 `.trellis/`。

文件所有权：

- `src/plugin/application-service.js`
- `src/plugin/resolver/**`
- `src/plugin/install/platform-detector.js`
- `src/plugin/install/content-projector.js`
- `src/plugin/install/install-planner.js`
- `src/plugin/install/transaction-writer.js`
- `src/plugin/sources/source-registry.js`
- `src/plugin/sources/builtin-provider.js`
- `src/plugin/sources/local-provider.js`
- `src/commands/plugin.js` 中非远端、非作者工具部分
- `src/cli.js`、`src/lib/cli-args.js` 的 Plugin 命令接管

不包含：GitLab/OAuth、Patch capability、skill-garden 迁移。

验收：无 Trellis 标准 Plugin add/update/remove、依赖冲突零写入、共享依赖和事务恢复测试通过。

### P3. GitLab Marketplace、OAuth 与 Keyring

建议 slug：`flower-plugin-gitlab-marketplace`

依赖：P1。

交付范围：

- [ ] 实现用户级 Source Registry 持久化、内置 `rd-guide` 来源和 enable/disable。
- [ ] 实现 GitLab Marketplace 索引读取、仓库 archive 下载、subdir 提取、commit/digest 校验和缓存。
- [ ] 实现 Authorization Code + PKCE loopback callback。
- [ ] 实现 Device Authorization Grant 的 pending、slow_down、expired、denied 状态机。
- [ ] 实现 token refresh、logout、status 和 Bearer header 注入。
- [ ] 固定申请 `read_repository read_api`，分别覆盖 Git-over-HTTP、Repository Files、tree/archive REST，并断言不具备写 API 权限。
- [ ] 实现 `CredentialStore` 与 `@napi-rs/keyring` optional adapter；无 keyring 时只保留进程内 token。
- [ ] 实现 `plugin source ...`、`plugin auth ...` 和远端 `plugin search`。
- [ ] 确保未使用 `rd-guide` 时没有 GitLab 网络访问。

文件所有权：

- `src/plugin/sources/gitlab-provider.js`
- `src/plugin/auth/**`
- `src/plugin/sources/source-registry.js` 的用户级实现部分
- `src/builtin-marketplaces/rd-guide.json`
- `package.json` 的 keyring optional dependency 由本子任务添加，最终打包变更由 P7 复核

不包含：Plugin 内容写盘、Patch capability、作者 Skill。

验收：HTTP mock 覆盖 OAuth/刷新/下载/缓存，token 泄漏断言通过，内置来源惰性访问成立。

### P4. Capability Policy 与 Patch Engine 集成

建议 slug：`flower-plugin-patch-capabilities`

依赖：P1；与 P2 通过 InstallPlan DTO 对接。

交付范围：

- [ ] 实现 `standard`、`integration`、`system` profile 和 capability negotiation。
- [ ] 实现 Plugin 请求、Marketplace 上限、Runtime 硬限制、项目批准四层交集。
- [ ] 实现 `integration` operation/selector/target allowlist，拒绝 replace/remove/hook/create/adapter。
- [ ] 将外部 catalog 规范化为 qualified identity，阻止伪造内置 catalog/marker。
- [ ] 合并全部 Plugin catalog 后一次调用现有 `preparePatchPlan()`。
- [ ] 合并 Patch target 与普通内容 target，执行跨 Plugin 路径冲突检查。
- [ ] 实现 capability 摘要、首次确认、frozen lock 复用和变化后重新确认。
- [ ] 把 Patch Engine 写盘接入统一事务；必要时提取 mutation API，但不复制 selector 实现。

文件所有权：

- `src/plugin/capabilities/**`
- `src/plugin/install/patch-planner.js`
- `src/lib/patch-engine.js` 的最小事务适配扩展
- `src/lib/patch-conflicts.js` 的 Plugin catalog evidence 扩展
- Patch capability 与多 Plugin 集成测试

不包含：GitLab 下载、旧增强链迁移、第三方 lifecycle hook。

验收：三档权限正反例、越权拒绝、跨 catalog 冲突、required 失败零写入、批准摘要漂移测试通过。

### P5. 内置 `skill-garden` 与旧 CLI 迁移

建议 slug：`flower-plugin-skill-garden-migration`

依赖：P2、P4。

交付范围：

- [ ] 新增 `flower/skill-garden` 内置 manifest 和 builtin provider payload adapter。
- [ ] 继续复用 `enhancements/<variant>`、`skill-garden`/`flower` catalog 和现有平台资产，不先搬迁快照。
- [ ] 将 `applyEnhancements()` 收敛为 Plugin application service 的兼容 facade。
- [ ] `flower-trellis init` 默认声明并安装 `flower/skill-garden`；`plugin add` 不隐式安装。
- [ ] 普通 `update` 重放锁定 Plugin，`plugin update` 才变更外部版本。
- [ ] 实现 `.trellis/.flower-manifest.json` 到 `.flower/` 的只读迁移、重放和旧证据保留。
- [ ] 更新 update-check 策略/缓存位置并保持旧读取兼容。
- [ ] 重构 uninstall 按 state 所有权清理，不再按当前快照猜测名称。
- [ ] 保持 `--no-enhance` 作为旧 CLI 的紧急兼容入口，内部语义映射为不声明/不应用默认 Plugin。

文件所有权：

- `src/builtin-plugins/skill-garden/**`
- `src/lib/apply-enhancements.js`
- `src/lib/enhancement-catalog.js`
- `src/lib/manifest.js`
- `src/commands/init.js`
- `src/commands/update.js`
- `src/commands/uninstall.js`
- `src/commands/self-check.js`、`update-check.js` 的迁移适配

不包含：作者工具、GitLab provider。

验收：新旧最终文件、provenance、update-check 和 uninstall 行为对比通过；旧 manifest 重复迁移幂等。

### P6. 作者工具、作者 Skill 与 `rd-guide` 注册契约

建议 slug：`flower-plugin-authoring`

依赖：P1、P2、P3 的 Marketplace DTO/来源契约。

交付范围：

- [ ] 新增 `flower/flower-plugin-author` 内置 `standard` Plugin，不依赖 `skill-garden`。
- [ ] 实现 `plugin init` scaffold，生成 manifest、目录、示例测试和 Marketplace entry 模板。
- [ ] 实现 `plugin validate`，直接复用 P1/P2/P4 的真实 schema、resolver 和 capability validator。
- [ ] 编写 `flower-plugin-author` 的 `SKILL.md` 与 references：manifest、能力、Patch、Marketplace、GitLab MR、CI。
- [ ] 定义 `rd-guide` CI 命令和校验结果格式，覆盖可变 ref、摘要、依赖闭包和越权能力。
- [ ] 定义 `integration` 条目 CODEOWNERS 审核要求及示例 MR 流程。

文件所有权：

- `src/builtin-plugins/flower-plugin-author/**`
- `src/plugin/authoring/**`
- `src/commands/plugin.js` 的 init/validate 部分
- Marketplace 示例、fixture 和作者工作流测试

不包含：真实 `rd-guide` 仓库变更；本仓只交付可被其消费的契约、命令和模板。

验收：从空目录 scaffold 一个示例 Plugin，validate 通过，并生成可由 Marketplace CI 验证的注册条目。

### P7. 跨模块集成、打包与端到端验收

建议 slug：`flower-plugin-integration`

依赖：P3、P4、P5、P6。

交付范围：

- [ ] 统一 CLI help、README、错误码和 JSON 输出契约。
- [ ] 补齐 package files、optional native packages、npm pack 与发布检查。
- [ ] 建立 GitLab mock Marketplace + 外部 Plugin fixture，跑 search/add/update/remove/verify 全链路。
- [ ] 建立无 Trellis、完整 Trellis、新项目、旧 manifest 项目和多平台组合矩阵。
- [ ] 验证 `rd-guide` 未使用时零网络、OAuth 两种 flow、token 无泄漏。
- [ ] 验证 Patch preflight、事务恢复、跨 Plugin 冲突和 capability 重新确认。
- [ ] 连续应用两次，第二次目标、lock 和 state 无变化。
- [ ] 运行完整测试、snapshot、conflict、context budget 和 npm pack 检查。
- [ ] 由父任务执行跨子任务最终设计一致性审查。

文件所有权：

- `README.md`
- `package.json` 最终 files/scripts/dependency 复核
- CLI help 与跨模块集成测试/fixture
- 仅为集成修复触碰前序模块；发现契约问题优先回滚到对应子任务修正

验收：父 PRD 全部验收项有自动化证据或明确人工步骤，现有 `npm test` 回归通过。

## 4. 跨子任务共享契约

P1 完成前必须冻结以下 JSDoc/DTO，并由后续子任务导入，不允许各自定义近似对象：

- `PluginManifest`
- `MarketplaceManifest`
- `SourceDescriptor`
- `PluginCandidate`
- `ResolvedPlugin`
- `ResolvedGraph`
- `CapabilityRequest`
- `CapabilityGrant`
- `ContentMutation`
- `PatchMutation`
- `InstallPlan`
- `PluginLock`
- `PluginState`

项目采用 JavaScript ESM，不为本任务引入 TypeScript 编译链。公共类、接口式工厂和 public function 必须按项目规则补齐 JSDoc、参数和返回值。

## 5. 实施波次

### Wave 1：基础契约

- [ ] 完成 P1。
- [ ] 评审 schema、DTO、错误码和稳定序列化。
- [ ] 创建后续子任务并把 P1 产出的 research/spec 路径写入各自 JSONL。

### Wave 2：可并行 Runtime 能力

- [ ] 并行完成 P2、P3、P4。
- [ ] 以共享 fixture 验证 Provider、Resolver、Capability 和 InstallPlan 能组合，不提前写 skill-garden 兼容代码。

### Wave 3：内置迁移与作者生态

- [ ] 完成 P5，将现有 init/update/uninstall 收敛到新 Runtime。
- [ ] 完成 P6，交付作者 Skill、scaffold、validate 和 Marketplace MR 契约。

### Wave 4：集成发布

- [ ] 完成 P7。
- [ ] 父任务逐项核对 PRD、设计、子任务验收和真实 diff。
- [ ] 更新 `.trellis/spec/flower-trellis/cli/` 中 Plugin Runtime、状态和 Patch capability 的长期规范。

## 6. 验证命令基线

各子任务按范围选择，P7 全量执行：

```bash
node --test test/js/plugin-*.test.js
node --test test/js/patch-engine.test.js test/js/patch-conflicts.test.js
node --test test/js/apply-enhancements.test.js test/js/cli-args.test.js
python3 -m unittest discover -s test/python -p 'test_*.py'
npm run sync
node scripts/check-patch-conflicts.mjs
npm run patch:targets:check
node scripts/check-ai-context-budget.mjs
npm test
npm pack --dry-run --json
git status --short
```

OAuth 与 GitLab 测试默认使用本地 HTTP mock，不依赖真实凭据。真实自建 GitLab 只在最终人工 smoke test 使用，并且不得把 token、Application Secret 或授权响应写入 fixture/日志。

## 7. 高风险检查点

- [ ] P1 schema 不得把平台检测结果写入 lockfile。
- [ ] P2 transaction writer 不得用现有 `copyPath()` 的无条件覆盖作为 Plugin 写盘实现。
- [ ] P3 不得把 token 放入 URL、子进程参数、项目文件或 JSON 输出。
- [ ] P4 不得为外部 Plugin 暴露 `flowerPatchAdapters()` 或 legacy marker identity。
- [ ] P5 不得同时保留旧 manifest 写链和新 state 写链两个成功来源。
- [ ] P6 Skill 不得复制 schema 规则，校验必须调用 CLI。
- [ ] P7 不得通过放宽 preflight、capability 或 digest 校验来让集成测试通过。

## 8. 回滚策略

- P1/P2 未接管 init 前，可以整体移除新 `plugin` 命令，不影响现有增强链。
- P3 失败时保留 local/builtin provider，GitLab 来源保持不可用，不降级为明文 token。
- P4 失败时只允许 `standard` 内容分发，禁用外部 Patch，不回退到任意 adapter。
- P5 迁移失败时旧 manifest 保持原样，兼容 facade 可临时继续旧 apply 路径；不得写半成品新 state。
- P7 发布检查失败时不发布包含部分 Plugin Runtime 的 npm 包。

## 9. 启动前门禁

- [x] 父任务 `prd.md`、`design.md`、`implement.md` 经用户审阅确认。
- [x] 通过 `trellis-task-brief` 生成并展示父任务 brief，但父任务本身不作为主要实现目标。
- [x] 创建 P1-P7 子任务并建立父子关系；当前进入 P1 独立规划与启动门禁。
- [ ] 补齐 P1 三件套和 JSONL，展示 P1 brief，用户确认后启动 P1。
- [ ] 后续子任务只能在其依赖验收完成后启动。
