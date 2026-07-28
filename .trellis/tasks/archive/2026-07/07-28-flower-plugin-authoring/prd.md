# Flower Plugin 作者工具、作者 Skill 与 rd-guide 注册契约

## 目标

交付一个不依赖 `skill-garden` 的内置 `flower-plugin-author` standard Plugin，以及确定性的 `plugin init`、`plugin validate` 工具和 `rd-guide` Marketplace CI/MR 契约，使外部团队能够创建、校验、测试、发布并注册受限 Flower Plugin。

本任务是父任务 P6，依赖 P1 schema、P2 Runtime/Resolver 和 P3 Marketplace DTO；能力校验复用 P4 的真实 validator，不在 Skill 中复制规则。

## 需求

### R1. 内置作者 Plugin

- canonical ID 固定为 `flower/flower-plugin-author`，profile 为 `standard`，不依赖 `flower/skill-garden` 或 Trellis。
- 随 npm 包离线分发，可在普通项目通过 Plugin Runtime 安装并投影到已选择平台。
- Plugin 至少包含 `skills/flower-plugin-author/SKILL.md` 与按需 references，不包含自动执行 hook。
- 作者 Plugin 本身使用与第三方相同的 P1 manifest 和 P2 builtin provider 校验流程。

### R2. 作者 Skill

- Skill 名称为 `flower-plugin-author`，description 同时描述能力和触发场景：创建、更新、校验、发布 Flower Plugin 或 Marketplace 条目。
- `SKILL.md` 保持精简，只保存工作流、决策顺序和 references 路由，详细 schema/示例放在一层 `references/`。
- references 至少覆盖 manifest、能力档位、受限 Patch、Marketplace entry、GitLab 不可变发布、CI/MR/CODEOWNERS。
- Skill 指导作者先运行 CLI scaffold/validate，再解释错误和修复；不能在提示词中复制 Ajv schema、Resolver 或 capability 实现。
- Skill 明确外部 `scripts/` 只被动分发、v1 无 lifecycle hook、外部不能申请 system。
- 不创建 README、quick reference、changelog 等与 Skill 执行无关的附加文档。

### R3. `plugin init`

- 从空目录生成最小 `.flower-plugin/plugin.json`、canonical skill 目录、测试目录和可选 Marketplace entry 模板。
- 支持非交互参数至少包括 Plugin ID、name、version、profile 和是否包含 patches；缺失时可交互询问。
- 默认生成 `standard` Plugin，不生成 Patch；选择 `integration` 时只生成允许的 insert 示例和说明，不自动获得授权。
- 已存在文件默认拒绝覆盖；`--force` 也只能覆盖本次 scaffold 明确拥有且未被用户修改的文件。
- 输出稳定且可重复；相同输入在空目录生成相同内容，不包含时间戳、用户名或绝对路径。

### R4. `plugin validate`

- 直接调用 P1 manifest/Marketplace schema、P2 package/Resolver、P3 source DTO 和 P4 capability validator。
- 校验目录安全、tree hash、SemVer、依赖闭包、兼容范围、固定 commit/ref、Marketplace 上限和 capability 越权。
- 支持校验单 Plugin、Marketplace entry 及完整 Marketplace；CI 模式必须禁止交互和网络隐式授权。
- JSON 输出具有稳定 schema，至少包含 `ok`、`subject`、`digest`、`issues[]` 和依赖/capability 摘要。
- issue 使用真实 Runtime 错误码、JSON path 和来源文件，不复制第二套错误定义。

### R5. rd-guide 注册条目

- scaffold 可生成 Marketplace entry 草稿，包含 Plugin ID、描述、GitLab project/subdir、版本、固定 ref/commit、digest 和 `maxProfile`。
- 外部团队先发布不可变 tag/commit，再向 `rd-guide` 的 `.flower-marketplace/marketplace.json` 提交 MR。
- CI 必须拒绝可变 ref、commit 不匹配、digest 不匹配、manifest/entry 版本不一致、依赖不闭合、兼容范围无效和 capability 超上限。
- CI 不使用开发者本机 keyring；私有依赖访问通过 CI 受控只读凭据注入，凭据不得进入输出。
- 只有 MR 合并后的索引版本进入默认搜索结果。

### R6. CODEOWNERS 与 Integration 审核

- `standard` 条目通过常规 Marketplace review。
- 新增或扩大 `integration`、目标白名单、operation 或 capability 上限的变更必须命中指定 CODEOWNERS 审核。
- 普通提交者不能通过修改 Marketplace entry 自行获得 system 或扩大 Runtime hard limits。
- CI 输出明确标记是否需要 integration owner review，供 GitLab protected approval rule 使用。

### R7. 作者工作流验证

- 从空目录运行 scaffold，补充一个示例 Skill，生成固定版本与 Marketplace entry，再运行 validate。
- forward-test 作者 Skill：给独立 agent 一个真实创建或修复 Plugin 的请求，只提供 Skill 和原始需求，不泄漏预期答案。
- forward-test 只操作临时目录和 fixture，不访问生产仓库、不提交 MR。

## 验收标准

- [ ] `flower/flower-plugin-author` 可在无 Trellis、无 skill-garden 项目安装并投影 Skill。
- [ ] `plugin init` 交互/非交互、standard/integration、幂等和已有文件保护测试通过。
- [ ] 生成目录立即通过 `plugin validate`，且无时间戳、用户名或绝对路径。
- [ ] validate 对 schema、digest、依赖、compatibility、commit、Marketplace 上限和 capability 越权使用 Runtime 真源。
- [ ] JSON 输出稳定，CI 可直接消费；敏感值不进入 issues 或日志。
- [ ] rd-guide CI fixture 拒绝可变 ref、摘要错误、依赖不闭合和越权，接受合法共仓/外部仓库条目。
- [ ] integration 变更可被 CI 标记并由 CODEOWNERS/protected approval 契约阻断未审核合并。
- [ ] Skill frontmatter、目录命名和 references 路由通过 `quick_validate.py` 或等价校验。
- [ ] 至少两个隔离 forward-test 覆盖新建 standard Plugin 和修复 integration 越权 Plugin。
- [ ] 完整 `npm test` 和 npm pack 检查通过。

## 非目标

- 不修改真实 `rd-guide` 仓库、创建 MR、发布 tag 或配置 GitLab approval rule。
- 不在 Skill 中实现 schema、Resolver、hash 或 Patch Engine。
- 不提供外部 lifecycle hook、JavaScript adapter 或 system Plugin scaffold。
- 不兼容 Codex Plugin manifest。
