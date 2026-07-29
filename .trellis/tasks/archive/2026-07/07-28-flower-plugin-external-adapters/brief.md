# Brief — Flower Plugin 外部格式适配与 GitHub 来源

## Goal

- 为 Flower Plugin 增加 GitHub 公共仓库来源与 Flower、Claude Code、Codex、skill-only 格式自动识别，通过标准化 Flower package 安全复用现有安装生命周期。

## Scope

- `来源 -> 新增来源` 改为先选择“GitHub 公共仓库”或“GitLab Marketplace”，GitHub 输入 URL/`owner/repo` 后自动检测格式、处理歧义并展示兼容性预览，确认后才保存。
- 来源 Provider 与格式 Adapter 解耦：GitHub/GitLab 固定远程仓库字节，Flower/Codex/Claude/skill-only Adapter 负责检测和归一化。
- GitHub 首版匿名访问公开仓库，支持默认分支、branch/tag/commit、可选 subdir，并把安装锁定到完整 commit 与 canonical tree integrity。
- 外部 Plugin 先物化为通过 Flower validator 的标准 package，再复用 `SourceRegistry`、Resolver、平台投影、dry-run、InstallPlan、TransactionWriter、verify/update/remove。
- 首版自动导入 `skills/` 与可转换的 Claude legacy `commands/`；agents 和 hooks、MCP、LSP、monitor、bin、settings、themes、output styles、apps 等只进入兼容性报告，不执行或安装。
- 用户 source store 升级为 GitLab/GitHub 判别模型，兼容读取现有 v1 GitLab 配置；现有 builtin/local/gitlab lock 和生命周期保持可用。
- 扩展非交互 source/search/add/update/verify/remove 与 JSON 输出，保持非 TTY、退出码和旧 GitLab 参数兼容。
- 更新内置 `flower-plugin-author` Skill、references 与 README，覆盖 GitHub 发布、Claude/Codex 接入、兼容矩阵和受限 Patch Engine 边界。

## Non-Goals

- 不支持 GitHub 私有仓库、GitHub OAuth、GitHub App、PAT、SSH、npm 或通用 Git host 安装。
- 不承诺 Claude Code/Codex 所有组件等价运行，不自动执行外部 hook、bin、安装脚本或连接 MCP/LSP/monitor/app。
- 不调用 Claude Code/Codex 原生插件管理器，不修改其全局 cache。
- `flower-trellis plugin init` 仍只生成 Flower 原生格式，不成为 Claude/Codex 多格式发布器。
- 不新增批量安装事务，不改变 `standard/integration/system` capability 档位。

## Key Context

- `PluginCandidate.manifest` 必须始终是合法 Flower manifest；外部原始 manifest 不得进入 Resolver、lock 或项目事务。
- 新增 `GitHubSourceProvider`、`GitHubRestClient`、`PluginFormatRegistry` 和格式 Adapter；GitLab 的 archive 安全、subdir 提取、大小限制与不可变缓存下沉为共享 helper。
- GitHub source 固定最高为 `standard`；外部 Adapter 不得注册自定义内容投影或取得 builtin/integration/system 信任。
- 缺少合法 SemVer 时使用 commit 时间和 short SHA 生成可重复内部版本；显式同 SemVer 不同内容按版本复用错误阻断。
- source add/update 必须先完成下载、格式检测和规范化预检，再原子写用户配置；取消、限流、歧义或失败保持零写入。
- 实施涉及共享 DTO/schema、source store、远程 Provider、CLI/UI、作者 Skill、README 和测试；必须保留当前四页签管理器已有改动。

## Acceptance

- GitHub 公共仓库可被新增、自动识别和搜索，Flower/Codex/Claude/skill-only 结果在保存前展示格式、组件、兼容状态和风险摘要。
- Claude Code/Codex Skills 可完整走 Flower dry-run、确认、安装、verify、update 和 remove；不支持组件明确显示且没有执行副作用。
- GitHub 可变 ref 安装时固定 commit/integrity，旧 lock 可离线重放，显式 update 才重新解析 ref。
- 匿名访问不要求登录；限流、仓库/ref 不存在、格式歧义、命名冲突和版本复用产生稳定诊断且不破坏来源或项目状态。
- v1 GitLab source、现有 GitLab Device Flow、GitLab E2E、builtin/local 和旧 lock 无回归。
- `flower-plugin-author` Skill 与 references 覆盖外部格式、GitHub 发布和受限 Patch，并通过 quick validation 与隔离 forward scenarios。
- 定向测试、完整 `npm test`、sync、snapshot、Patch targets、AI context、npm pack、语法检查和 `git diff --check` 全部通过。

## Next Step

- 规划确认后运行 `task.py start`，再通过 `trellis-route(target=implement)` 进入实现；优先完成共享契约、source store 与格式 Adapter 基础，再接 GitHub Provider、CLI/UI 和指南 Skill。
