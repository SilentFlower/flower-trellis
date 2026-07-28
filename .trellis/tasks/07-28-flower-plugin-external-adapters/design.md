# Flower Plugin 外部格式适配与 GitHub 来源技术设计

## 1. 总体架构

```text
来源管理器 / CLI
       |
 UserSourceStore (gitlab | github)
       |
 RemoteSourceProvider
       |-- GitLabSourceProvider
       `-- GitHubSourceProvider
                |
        immutable repository snapshot
                |
         PluginFormatRegistry
       /        |         |        \
   Flower     Codex     Claude   Skill-only
       \        |         |        /
          CompatibilityReport
                  |
       Normalized Flower Package Cache
                  |
 SourceRegistry -> Resolver -> InstallPlan -> TransactionWriter
```

来源 Provider 只负责远程身份、固定 commit、下载、缓存和读取；格式 Adapter 只负责检测、解析和生成规范化包；两者都不得直接写项目目标。现有 `PluginApplicationService` 继续是依赖解析、平台投影、dry-run、事务和 lifecycle 的唯一入口。

## 2. 用户来源模型

`plugin-sources.json` 升级为 schemaVersion 2，并使用 `type` 判别：

```js
// GitLab 保留现有字段与 OAuth。
{
  schemaVersion: 2,
  id: "rd-guide",
  type: "gitlab",
  name: "研发指南",
  enabled: true,
  baseUrl: "http://gitlab.example.com",
  project: "group/rd-guide",
  ref: "main",
  marketplacePath: ".flower-marketplace/marketplace.json",
  oauth: { applicationId: "...", scopes: ["read_api", "read_repository"] }
}

// GitHub 首版只接受 github.com 公共仓库，不保存凭据。
{
  schemaVersion: 2,
  id: "team-guides",
  type: "github",
  name: "Team Guides",
  enabled: true,
  repository: "owner/repository",
  ref: "main",
  subdir: "plugins",
  format: "claude-code",
  entryPath: ".claude-plugin/marketplace.json"
}
```

- 读取 schemaVersion 1 时只接受旧 GitLab descriptor，内存规范化为 v2；下一次发生用户写入时整体以 v2 原子落盘。
- `repository` 固定为 `owner/repository`，输入层负责规范化 GitHub URL、`.git` URL 与 shorthand。
- `format` 和 `entryPath` 保存用户确认后的检测结果，后续刷新不得因仓库新增另一个 manifest 而悄悄切换 Adapter。
- “重新检测格式”属于显式编辑动作；歧义检测只在首次新增或显式重新检测时要求选择。

## 3. Runtime 与锁定契约

共享 DTO 增加 `github` 判别项，不新建平行 lock：

```js
{
  id: "team-guides",
  type: "github",
  reference: "owner/repository",
  subdir: "plugins/review",
  format: "claude-code",
  entryPath: ".claude-plugin/plugin.json",
  indexReference: "owner/catalog",
  indexCommit: "<40-sha>"
}
```

- `commit` 仍表示实际 Plugin 包仓库的不可变 commit；通过 Marketplace 发现时，`indexReference/indexCommit` 固定目录仓库身份。
- 直连 Plugin 没有 index 字段；Marketplace 内的相对路径 Plugin 使用目录仓库 commit 作为 Plugin commit。
- `PluginCandidate.manifest` 始终是通过 `validatePluginManifest()` 的 Flower manifest；外部原始 manifest 不能直接进入 Resolver 或 lock。
- Project lock 继续使用 schemaVersion 1 的兼容扩展，只增加 `github` source union；现有 builtin/local/gitlab lock 字节无需迁移。

## 4. GitHub Provider

新增 `GitHubRestClient`：

```text
resolveRepository(owner/repo) -> {defaultBranch}
resolveCommit(owner/repo, ref) -> {sha, committedAt}
downloadArchive(owner/repo, sha) -> Buffer
```

- 请求只访问 `api.github.com`，archive 重定向只接受受控 GitHub/codeload host。
- 不使用 token；403/429 结合 `x-ratelimit-*` 转换为稳定 rate-limit 诊断。
- 首次准备先解析 ref，再下载一次不可变 archive，在本地完成格式探测，避免逐文件消耗匿名 API 配额。
- GitLab Provider 当前私有的 archive 条目校验、subdir 提取、大小上限和原子缓存发布下沉为共享 remote archive helper，两个 Provider 使用同一安全实现。
- cache key 绑定 provider type、repository、commit、subdir、format、entryPath 和 normalized tree integrity；metadata 不保存重定向 URL、headers 或用户信息。
- `prepareLocked()` 只恢复旧固定包；显式 update 仍重新解析当前 ref，沿用 GitLab 已有的 prepared-index 与 locked-candidate 分离规则。

## 5. 格式检测与 Adapter

### 5.1 公共接口

```js
new PluginFormatRegistry(adapters?)
PluginFormatRegistry.detect(snapshot, options?) -> DetectionResult[]
PluginFormatRegistry.normalize(selection, context) -> NormalizedPlugin[]
```

`DetectionResult` 包含 `format/kind/entryPath/displayName/components/diagnostics`；`NormalizedPlugin` 包含规范化 ID、版本、描述、Flower manifest、包文件计划和兼容性报告。

### 5.2 检测入口

- Flower：`.flower-marketplace/marketplace.json`、`.flower-plugin/plugin.json` 和已知包根 `plugin.json`。
- Codex：`.agents/plugins/marketplace.json`、`.codex-plugin/plugin.json`。
- Claude Code：`.claude-plugin/marketplace.json`、`.claude-plugin/plugin.json`。
- Skill-only：`skills/*/SKILL.md`，或所选根本身是包含 `SKILL.md` 的 Skill 目录。
- 检测返回全部有效入口；多个候选不靠遍历顺序猜测。交互模式展示候选，非交互模式返回 `PLUGIN_SOURCE_AMBIGUOUS` 并附结构化候选。

### 5.3 Marketplace source 子集

- Flower Marketplace 继续完整使用现有 source 规则，并新增 GitHub source。
- Claude/Codex Marketplace 首版支持同仓相对路径、公开 GitHub `owner/repo`、GitHub HTTPS URL 和 GitHub `git-subdir`。
- npm、私有仓库、SSH、通用 Git host 和远程 JSON URL产生“已识别、来源暂不支持”诊断，不静默跳过。

## 6. 规范化 Flower 包

Adapter 在不可变缓存下物化标准包：

```text
normalized/<cache-key>/
├── plugin.json
└── skills/
    ├── review/SKILL.md
    └── release/SKILL.md
```

- 原生 `skills/<name>/SKILL.md` 连同该 Skill 目录内普通文件复制到规范化包，继续拒绝软链和特殊文件。
- Claude legacy `commands/*.md` 转换为独立 Skill；合法 frontmatter 尽量保留，缺少 name/description 时从文件名和首段生成，并记录 `external.command-converted` 诊断。
- 外部 ID 经过同一个 Plugin/Skill ID 规范化器；规范化冲突必须失败并列出原始名称，不能自动覆盖。
- 有效严格 SemVer 原样使用。缺失或非法版本时使用 `0.0.0-git.<commit-unix-seconds>.<short-sha>` 作为 Flower 内部版本，并在报告中保留上游原始版本与完整 commit。
- 上游显式 SemVer 相同但 commit/integrity 改变时视为版本复用错误，阻止更新，要求上游提升版本。
- 生成 manifest 固定 `profile=standard`，只请求 `content.skills`；外部 manifest 的 capability、hook 或脚本声明不得提升 Flower 能力。
- 规范化包完成后运行 Flower manifest validator 和 canonical tree hash；Runtime 看到的包与原生 Flower 包没有特殊旁路。

## 7. 兼容性报告

```js
{
  status: "compatible" | "partial" | "unsupported",
  format: "flower" | "codex" | "claude-code" | "skill-only",
  imported: [{ kind, count, paths }],
  omitted: [{ kind, count, reason, risk }],
  diagnostics: PluginDiagnostic[]
}
```

- skills 与可转换 commands 进入 `imported`。
- agents 先进行结构检查；首版默认进入 `omitted`，避免绕过现有仅 Skill 的平台投影协议。
- hooks、MCP、LSP、monitor、bin、settings、themes、output styles、apps 和安装脚本进入 `omitted`，UI 标为“已识别但不会安装”。
- `unsupported` 表示没有任何可安全导入内容；来源可以保存用于诊断，但不能产生可安装候选。
- 兼容性报告只包含安全相对路径和非敏感摘要，不包含缓存绝对路径或上游任意原始对象。

## 8. CLI 与交互流程

交互来源页改为：

```text
新增来源
├── GitHub 公共仓库
└── GitLab Marketplace
```

GitHub 流程：输入仓库 -> 可选 ref/subdir -> 下载固定快照 -> 检测格式 -> 歧义选择 -> 兼容性预览 -> 确认保存。取消、检测失败和确认前都不写用户 source store。

高级 CLI 增加：

```text
flower-trellis plugin source add <id> --type github --repo owner/repo [--ref main] [--subdir path] [--format auto]
flower-trellis plugin source update <id> [...]
```

- 省略 `--type` 且出现现有 GitLab 参数时继续按 GitLab 解析，保持脚本兼容。
- GitHub 不提供 auth action；来源详情显示“公共仓库 · 无需登录”。
- search 对所有启用来源按 type 构造 Provider；来源级失败记录问题并保留其它来源结果，显式 `--source` 失败则返回错误。
- JSON 输出新增 `detectedFormat/entryPath/resolvedCommit/compatibility`，不改变非 TTY 分流和退出码大类。

## 9. 作者指南 Skill

- 更新 `flower-plugin-author/SKILL.md` 的 description、工作流与 reference 路由。
- 新增 `references/external-formats.md` 和 `references/github-release.md`，分别说明检测/兼容矩阵与 GitHub 公共发布。
- 现有 manifest、Marketplace、capability、Patch、GitLab、CI references 只补充职责内差异，不复制外部格式完整 schema。
- 指南明确 `plugin init` 只生成 Flower 原生格式；已有 Claude/Codex 包通过检测、兼容预览和 Flower validator 接入。
- 保留 integration Patch 的受限 insert、Marketplace 上限和项目批准，不允许外部 hooks 或 adapter 借“兼容”获得执行能力。

## 10. 错误、回滚与兼容

- 新增稳定诊断覆盖格式未识别、格式歧义、组件不支持、ID 冲突、GitHub 限流、仓库/ref 不存在、版本复用和 normalize 失败。
- source add/update 先完成远程检测与规范化预检，再原子写用户配置；失败保留旧配置。
- normalized cache 发布前失败只清理 staging；现有 lock、来源配置和旧不可变 cache 不变。
- GitHub 功能不可用时，GitLab、builtin、local 继续工作；GitHub 来源失败不能阻断用户浏览其它已启用来源。
- 不调用 `claude plugin`、`codex plugin`，不修改 `~/.claude/plugins` 或 `~/.codex/plugins`。

## 11. 关键取舍

- 选择“归一化标准包”而不是让 Runtime 理解三套 manifest，避免 Resolver、lock、capability 和事务出现格式分支。
- 选择“下载固定 archive 后本地检测”而不是遍历 GitHub Contents API，降低匿名请求数量并复用现有归档安全模型。
- 选择首版被动内容兼容，不自动执行外部组件；兼容范围小于上游原生能力，但可保持 Flower 的授权和零写入边界。
- 选择单向导入，不扩展 `plugin init` 为多格式生成器，避免维护三套发布 schema。
