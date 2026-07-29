# Flower Plugin 外部格式适配与 GitHub 来源实施计划

## 1. 前置门禁

- [ ] 当前 `flower-plugin-integration` 已有交互改动不被回退，新增流程在现有四页签管理器上扩展。
- [ ] 先更新共享 DTO/schema，再让 Provider、CLI 和 UI 消费；不得在下游复制判别结构。
- [ ] 外部格式只通过规范化 Flower package 进入 Runtime，不增加第二套 Resolver、Installer 或 Writer。

## 2. 实施步骤

### A. 契约与用户来源

- [ ] 在 `contracts.js`、Marketplace schema 和 project lock schema 增加 GitHub 判别项及稳定诊断。
- [ ] 把 `UserSourceStore` 改为 GitLab/GitHub discriminated validator，兼容读取 v1 GitLab 配置并原子迁移写入 v2。
- [ ] 增加 GitHub URL/shorthand、repository、ref、subdir、format 和 entryPath 校验。
- [ ] 更新 capability/source 策略，使 GitHub 外部来源固定最高为 `standard`，不得模拟 builtin/integration 信任。

### B. 共享远程归档与 GitHub Provider

- [ ] 从 GitLab Provider 提取安全 archive 检查、subdir 提取、大小限制和 staging 发布 helper，并保持原测试语义。
- [ ] 实现匿名 `GitHubRestClient` 的 repository/default branch、commit/date 和 archive 下载。
- [ ] 实现 `GitHubSourceProvider` 的 prepare、prepareLocked、search、candidate/cache 和显式 update 行为。
- [ ] 对 GitHub redirect host、API 限流、404/ref、超时、5xx 重试和响应大小加入稳定错误映射。

### C. 格式检测与规范化

- [ ] 实现 `PluginFormatRegistry`、公共检测/兼容 DTO 和歧义诊断。
- [ ] 实现 Flower Adapter，覆盖 Flower Marketplace、`.flower-plugin` 和标准 package。
- [ ] 实现 Codex Adapter，解析 `.codex-plugin/plugin.json` 与 `.agents/plugins/marketplace.json`。
- [ ] 实现 Claude Code Adapter，解析 `.claude-plugin/plugin.json`、Marketplace、skills 与 legacy commands。
- [ ] 实现 skill-only Adapter，并校验 Skill 目录、frontmatter、软链和名称冲突。
- [ ] 实现 normalized package builder、commit 时间版本回退、同 SemVer 内容复用阻断和 canonical digest。
- [ ] Marketplace 外部 source 首版只接受同仓路径与公开 GitHub 地址；其余来源输出 unsupported 诊断。

### D. Runtime 远程接入

- [ ] 把 `plugin-remote.js` 从 GitLab 专用编排改为按来源 type 构造 Provider，同时保持动态加载边界。
- [ ] 扩展 locked remote source 恢复、显式 prepare/update 和依赖遍历到 GitHub。
- [ ] 让外部规范化候选完整复用 `PluginApplicationService` 的 add/update/verify/remove、平台投影和事务。
- [ ] 检查 lock JSON、dry-run 和 verify 不泄漏缓存绝对路径、重定向 URL 或原始上游对象。

### E. CLI 与交互 UI

- [ ] 扩展 management args 与 `plugin source add/update` 的 `--type github --repo --subdir --format`，保留旧 GitLab 参数兼容。
- [ ] 把来源页“新增 GitLab Marketplace”改为“新增来源”，增加来源类型选择。
- [ ] 实现 GitHub 仓库输入、检测进度、歧义选择、兼容性预览、确认保存和取消零写入。
- [ ] 来源列表和详情按 type 展示；GitHub 显示公开仓库状态，不调用 auth/keyring。
- [ ] 发现、搜索、问题页展示检测格式、partial/unsupported 组件和 GitHub 限流诊断。
- [ ] 更新非 TTY 与 `--json` 输出，保持显式子命令不进入 TTY 管理器。

### F. 作者指南、README 与规范

- [ ] 更新 `flower-plugin-author/SKILL.md` description、工作流和完成门禁。
- [ ] 新增 external formats 与 GitHub release references，更新 manifest/Marketplace/capability/Patch/GitLab/CI references 的职责边界。
- [ ] 保持 `plugin init` 仅生成 Flower 原生格式，作者指南提供已有 Claude/Codex 包接入和校验流程。
- [ ] 更新 README 的来源类型、GitHub 匿名限制、格式兼容矩阵和安全边界。
- [ ] 实现完成后通过 `trellis-update-spec` 更新 contracts、runtime、remote source 和 authoring 规范。

### G. 测试与验收

- [ ] 新增 adapter fixture：Flower、Codex、Claude Code、skill-only、歧义、无安全内容、命名冲突、版本缺失和 SemVer 复用。
- [ ] 新增 GitHub REST/archive/provider tests：默认分支、commit/date、redirect、限流、危险 archive、cache、locked replay 和 update。
- [ ] 扩展 source store migration、CLI parser/JSON、interactive 来源流程和多来源容错测试。
- [ ] 覆盖外部 hooks/MCP/LSP/bin 只显示不执行，并扫描项目目标与日志无执行副作用。
- [ ] 运行作者 Skill quick validation 和至少两个隔离 forward scenario：Claude Plugin 接入、GitHub skill-only 发布。
- [ ] 运行完整质量门禁。

## 3. 预期文件范围

- `src/plugin/contracts.js`
- `src/plugin/schemas/marketplace-manifest.js`
- `src/plugin/schemas/project-files.js`
- `src/plugin/sources/user-source-store.js`
- `src/plugin/sources/gitlab-provider.js`
- `src/plugin/sources/github-provider.js`
- `src/plugin/sources/remote-archive.js`
- `src/plugin/github/rest-client.js`
- `src/plugin/formats/**`
- `src/plugin/capabilities/policy-engine.js`
- `src/commands/plugin.js`
- `src/commands/plugin-remote.js`
- `src/commands/plugin-interactive.js`
- `src/builtin-plugins/flower-plugin-author/**`
- `README.md`
- `test/js/plugin-*.test.js` 与外部格式 fixtures
- 受影响 `.trellis/spec/flower-trellis/cli/*.md`

## 4. 验证命令

```bash
node --test test/js/plugin-source-store.test.js
node --test test/js/plugin-format-adapters.test.js
node --test test/js/plugin-github-rest-client.test.js
node --test test/js/plugin-github-provider.test.js
node --test test/js/plugin-remote-cli.test.js
node --test test/js/plugin-interactive.test.js
node --test test/js/plugin-lifecycle-cli.test.js
node --test test/js/plugin-e2e-gitlab.test.js
python3 /root/.codex/skills/.system/skill-creator/scripts/quick_validate.py src/builtin-plugins/flower-plugin-author/skills/flower-plugin-author
npm test
npm run sync
npm run snapshot:check
npm run patch:targets:check
npm run check:ai-context
npm pack --dry-run --json
git diff --check
```

## 5. 高风险检查点

- [ ] 格式 Adapter 不直接写项目，不注册自定义内容投影，不取得 integration/system 信任。
- [ ] 外部 hook、MCP、LSP、monitor、bin、settings、app 和安装脚本不会被执行或复制到可执行位置。
- [ ] GitHub 匿名请求不错误进入 GitLab OAuth/keyring，也不把 URL 中潜在凭据保存到配置。
- [ ] 可变 ref 只用于发现更新，安装和 lock 一律固定 commit 与 canonical digest。
- [ ] v1 GitLab source 配置、旧 lock 和现有 GitLab E2E 保持兼容。
- [ ] 同版本不同内容、格式歧义和无兼容内容都在任何项目写入前失败。
- [ ] archive helper 重构后 GitLab 的路径、大小、重试、cache 和敏感输出语义不变。
- [ ] 交互取消、检测失败、限流和未确认预览均不写 source store 或 `.flower/`。

## 6. 回滚点

- 契约阶段可先保留 GitHub union 未注册 Provider，不影响旧来源。
- Adapter 失败只删除 normalized staging/cache 项，不修改原始 snapshot 和 project lock。
- GitHub Provider 可从远程工厂移除，GitLab/builtin/local 生命周期继续可用。
- UI 新增流程失败时恢复原来源页，现有 GitLab 管理入口仍可访问。
