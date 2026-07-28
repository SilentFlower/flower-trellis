# Flower Plugin 外部格式适配与 GitHub 来源

## Goal

- 让用户在 Flower Plugin 管理器中新增 GitHub 公共仓库，并自动识别仓库内的 Flower、Claude Code、Codex Plugin/Marketplace 或独立 Skill。
- 通过统一的 Flower 内部模型展示、校验和安装可兼容内容，同时明确标识无法安全映射的平台专属能力。
- 保持现有不可变版本、完整性校验、能力授权、dry-run 和原子安装契约，不因兼容外部格式而绕过 Flower Runtime。

## Background

- 当前来源管理只支持 GitLab Marketplace，交互入口直接显示“新增 GitLab Marketplace”。
- 当前 Flower v1 的来源、Marketplace、lock 和 capability 契约只认识 `builtin`、`local`、`gitlab`，且 Flower Plugin manifest 是唯一可进入 Runtime 的包格式。
- Claude Code 使用 `.claude-plugin/plugin.json` 和 `.claude-plugin/marketplace.json`，可包含 skills、commands、agents、hooks、MCP、LSP、monitor、bin、settings 等组件。
- Codex 使用 `.codex-plugin/plugin.json` 和 `.agents/plugins/marketplace.json`，可包含 skills、hooks、MCP、app 和展示资源；Codex 还读取 legacy `.claude-plugin/marketplace.json` 入口，但不代表所有 Claude 组件可等价运行。
- GitHub 公共仓库可匿名读取；匿名 API 有速率限制，私有仓库和 GitHub 授权不属于首版必需能力。

## Requirements

### R1. 来源入口与交互

- `来源` 页的新增入口统一显示为“新增来源”，不再把新增动作绑定到 GitLab。
- 进入新增流程后选择来源类型，首版至少提供“GitHub 公共仓库”和现有“GitLab Marketplace”；现有来源管理、GitLab Device Flow 和编辑流程保持可用。
- GitHub 流程只要求用户输入公开仓库 URL 或 `owner/repo`，可选填写 ref 和仓库子目录；不要求 GitHub 登录。
- 输入来源后自动探测仓库格式，再展示来源名称、识别格式、Plugin 数量、组件清单、兼容性和风险摘要，确认后才持久化来源。
- 用户不需要预先选择“Claude Code Plugin”“Codex Plugin”或“Flower Plugin”。

### R2. 来源与格式解耦

- 来源 Provider 与包格式 Adapter 必须是两个独立维度；GitHub/GitLab/local 负责获取固定仓库内容，Flower/Claude Code/Codex/skill-only Adapter 负责识别与归一化。
- GitHub 仓库既可以是 Marketplace，也可以是单 Plugin、多个 Plugin 或独立 Skill 集合。
- 自动识别顺序必须确定且可诊断，至少覆盖：
  1. Flower Marketplace / Plugin；
  2. `.codex-plugin/plugin.json`；
  3. `.claude-plugin/marketplace.json`；
  4. `.claude-plugin/plugin.json`；
  5. `skills/*/SKILL.md` 或单个 Skill。
- 同一仓库存在多个可识别入口或结果歧义时不得静默猜测，必须展示候选并要求用户选择。

### R3. 统一兼容模型

- 外部格式必须先归一化为共享的兼容结果，再由现有 Flower Runtime 构造候选、解析依赖、生成 dry-run 和执行安装；Adapter 不得直接写项目。
- 兼容结果至少包含来源格式、外部身份、规范化身份、版本、描述、组件清单、兼容状态、诊断和风险能力。
- 外部 Plugin 缺少严格 SemVer 时，首版使用可重复的归一化版本规则，并在 UI 中明确显示来源 commit；不得伪造上游发布版本。
- 外部 Marketplace 和直连 Plugin 最终都必须解析到不可变 commit，并记录 canonical tree integrity。

### R4. 首版组件映射

- Flower Plugin 继续完整使用现有 v1 manifest 与 capability 模型。
- Claude Code/Codex 的 `skills/` 作为首版自动导入的核心能力。
- Claude Code `commands/` 可作为兼容 Skill 导入，但必须保留来源和转换诊断。
- `agents/` 只有在现有 Flower 平台投影模型能无损表达时才进入安装计划，否则只展示为“已识别、暂不安装”。
- hooks、MCP、LSP、monitors、bin、settings、themes、output styles、apps 和其它可执行或平台专属能力首版只识别并展示，不自动启用或执行。
- 外部包携带脚本、hook、二进制或远程服务配置时，兼容预览必须明确提示，不得因目录扫描而运行任何代码。

### R5. GitHub 公共来源

- 支持标准 GitHub 仓库 URL、带 `.git` 的 URL 和 `owner/repo` 简写，并规范化为无凭据的来源 descriptor。
- 允许解析默认分支、显式 branch/tag/commit 和可选安全子目录；安装和更新必须将可变 ref 解析为 40 位 commit。
- 公共仓库匿名访问不创建凭据、不进入 GitLab auth 状态，也不在普通来源列表中显示“未登录”。
- GitHub 下载、解包、缓存和路径校验必须复用 GitLab Provider 已有的大小限制、危险归档拒绝、不可变缓存和 tree hash 约束，避免形成宽松旁路。
- 匿名 API 速率限制、仓库不存在、ref 不存在、格式未识别和下载失败必须产生稳定诊断，并保持来源配置及项目文件不变。

### R6. 数据契约与兼容迁移

- 用户级 source store 升级为按 `type` 判别的 descriptor 校验，必须兼容读取当前 schemaVersion 1 的 GitLab 配置，并采用明确的 schema 迁移策略。
- `SourceDescriptor`、Marketplace source、lock 和相关 schema 增加 GitHub 类型时，所有消费者必须使用共享 DTO/validator，不得通过字符串特判复制近似结构。
- 现有 GitLab、builtin、local lock 必须继续可读、可验证和可更新；本功能不得要求用户重装现有 Plugin。
- 外部格式原始字段只保存在缓存或诊断所需的非敏感元数据中，不把任意上游 manifest 直接写入可提交 Flower lock。

### R7. 非交互入口

- 现有 `plugin source`、`plugin search`、`plugin add/update/verify/remove` 和 `--json` 行为必须扩展到 GitHub 来源，同时保持非 TTY 不进入交互 UI。
- GitHub 来源的结构化输出必须包含类型、仓库、ref、子目录、检测格式和解析 commit，不输出临时下载 URL、header 或未来可能引入的凭据。
- CLI 参数应以来源类型为入口，不新增一套与交互流程不一致的平行管理器。

### R8. Flower Plugin 作者指南 Skill

- 同步更新内置 `flower/flower-plugin-author` 所分发的 `flower-plugin-author` Skill，不另建一套重复的指南 Skill。
- 指南必须说明 Flower 原生格式、Claude Code 格式、Codex 格式与 skill-only 仓库的识别入口、兼容范围和平台专属限制。
- 指南必须提供 GitHub 公共仓库的推荐目录、来源登记、ref/commit 固定、兼容性预览和发布验证流程，同时保留现有 rd-guide GitLab Marketplace、CI、MR 与 CODEOWNERS 指引。
- 指南必须明确外部格式默认只导入被动内容，不自动执行 hooks、bin、安装脚本或连接 MCP/LSP；涉及 Flower `integration` Patch 时继续使用现有受限 Patch Engine 子协议和审批流程。
- `manifest.md`、`marketplace.md`、`capabilities.md`、`patches.md`、`gitlab-release.md`、`ci-and-review.md` 等现有 references 按职责更新，必要时新增独立的外部格式与 GitHub 发布 reference，避免把所有内容堆入 `SKILL.md`。
- 作者 Skill 的描述和触发语义应覆盖“将已有 Claude Code/Codex Plugin 接入 Flower”“发布 GitHub 公共 Plugin 来源”“检查外部格式兼容性”等请求。
- `flower-trellis plugin init` 继续只生成 Flower 原生 Plugin；首版不生成或反向导出 Claude Code/Codex 原生包。

## Acceptance Criteria

- [ ] `来源 -> 新增来源` 可选择 GitHub 公共仓库或 GitLab Marketplace；原 GitLab 新增、编辑和授权流程无回归。
- [ ] 输入公开 GitHub 仓库后，可自动识别 Flower、Claude Code、Codex Marketplace/Plugin 和 skill-only 仓库，并在持久化前展示兼容性预览。
- [ ] GitHub 仓库格式识别与来源获取彼此独立，同一个 GitHub Provider 可交给不同 Adapter 处理。
- [ ] Claude Code/Codex Skills 可通过 Flower dry-run、确认、安装、verify、update 和 remove 生命周期管理。
- [ ] 外部 hooks、MCP、LSP、bin 等能力只显示，不执行；兼容结果明确说明未安装内容和原因。
- [ ] GitHub 可变 ref 在安装时锁定到 commit，lock 同时保存 Plugin tree integrity；更新显式重新解析 ref，旧 lock 仍可离线重放。
- [ ] 匿名 GitHub 访问不要求登录；API 限流和远程错误产生稳定诊断且不写坏来源配置或项目状态。
- [ ] 现有 GitLab、builtin、local 配置和 lock 无迁移中断，完整 GitLab E2E 与 Plugin 生命周期测试继续通过。
- [ ] 内置 `flower-plugin-author` Skill 与 references 覆盖 GitHub 来源、Claude/Codex 格式适配、兼容矩阵和受限 Patch Engine 边界，并通过其 forward validation。
- [ ] 测试覆盖格式探测、歧义选择、外部 manifest 归一化、GitHub REST/archive/cache、危险归档、兼容性预览、非交互 JSON 和交互来源流程。
- [ ] 受影响定向测试、完整 `npm test`、`npm pack --dry-run --json`、`git diff --check` 和相关源码语法检查全部通过。

## Non-Goals

- 首版不支持 GitHub 私有仓库、GitHub OAuth、GitHub App 或 PAT 管理。
- 首版不承诺 Claude Code/Codex 所有组件可跨平台等价运行。
- 首版不自动执行外部 hooks、bin、安装脚本，不自动连接 MCP/LSP/monitor/app。
- 不调用 Claude Code 或 Codex 自身的插件安装命令，不修改它们的全局 Plugin cache。
- 不把 `plugin init` 扩展为 Claude Code/Codex 多格式发布器。
- 不新增批量跨 Plugin 安装事务，不改变现有 `standard/integration/system` capability 档位。
