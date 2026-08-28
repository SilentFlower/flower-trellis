# Design

## Current State

- `src/plugin/contracts.js` 目前把 `PluginContent` 定义为 manifest 发布内容路径，`ProjectPluginDeclaration` 只含 `id/source/version/platforms?`，`ResolvedPlugin` 与 `PluginStateEntry` 没有选择字段。
- `src/plugin/schemas/project-files.js` 对 `.flower/plugins.json`、`.flower/plugin-lock.json`、`.flower/state.json` 都开启 `additionalProperties:false`，新增持久字段必须同步 schema 和测试。
- `src/plugin/application-service.js` 的生命周期路径是 `plugins.json` 声明 -> `resolvePluginGraph` -> `buildPluginLock` -> `projectPluginContent` -> `TransactionWriter`；selection 需要从声明一路穿透到投影与 state。
- `src/plugin/install/content-projector.js` 当前对普通 Plugin 的 `manifest.content.skills` 全量投影到平台 Skill root，只有 `flower/skill-garden` 通过可信 builtin provider 做自定义投影。
- `src/commands/plugin-interactive.js` 只有内置 `flower/skill-garden` 会生成 `skill-manager` action；普通 Marketplace Plugin 的发现页安装流程只做版本、平台、dry-run 和确认。
- `src/plugin/sources/gitlab-provider.js` / `github-provider.js` 的 `search()` 结果只包含 `id/description/versions/source`，TUI 要展示 Skill 列表必须在用户选中具体 Plugin/版本后准备包并读取 manifest。

## Data Model

- 新增 `PluginContentSelection` DTO：
  - `skills?: string[]`
  - 值为 Skill 名称，也就是 manifest `content.skills` 条目的 `path.posix.basename(entry)`。
  - 字段缺失表示兼容旧行为：安装全部 manifest `content.skills`。
  - 数组存在时必须非空、唯一、稳定排序；如果用户想完全移除该 Plugin，应走 `plugin remove`，不保留空 selection。
- 在以下 DTO/schema 中加入可选 `contentSelection`：
  - `ProjectPluginDeclaration.contentSelection`：项目声明意图，可提交。
  - `ResolvedPlugin.contentSelection`：本次解析图使用的选择，写入 `plugin-lock.json` 以便回读。
  - `PluginStateEntry.contentSelection`：本机实际投影时使用的选择，写入 `state.json`。
- `plugin-lock.json` 不保存平台、本机路径或用户身份；`contentSelection` 是项目级内容选择，不含秘密材料，也不是平台检测态。若实现中发现 lock 冗余导致验证收益不足，不得静默删除该字段，需要同步更新本设计和验收。

## Selection Semantics

- `contentSelection` 只影响 `content.skills`；`specs/assets/scripts/tests` 仍按现有 manifest 内容投影规则处理。
- selection 匹配 manifest `content.skills` 的 basename，不匹配完整路径；这样 rd-guide 调整 Skill 根目录时，只要目录名不变，用户选择可以继续生效。
- 同一 manifest 中两个 `content.skills` 条目 basename 相同会导致目标 Skill root 冲突，应按内容冲突失败。
- selection 中出现 manifest 当前版本没有声明的 Skill 名称时，应返回稳定错误并保持零写入。该情况可能来自手写 `.flower/plugins.json` 或远端新版本删除 Skill。
- TUI 不硬编码 rd-guide 的隐藏名单；“只显示 GitLab collaboration”由 rd-guide 包 manifest 当前只声明该 Skill 来控制。

## CLI And Service Flow

- `parsePluginArgs()` 增加可重复/逗号分隔的 `--content-skill <name>` 参数，只允许用于 `plugin add` 和单个 `plugin update <id>`。
- `plugin add` 把解析后的 `contentSelection` 写入新的直接声明；未传该参数时省略字段，保持全量安装。
- `plugin update <id> --content-skill ...` 更新该直接声明的 selection 并执行完整生命周期；`plugin update` 不带该参数时保留现有声明。
- `plugin update --widen ...` 仍只负责批量放宽版本约束，不与 selection 变更混用。
- `plugin replay` 从 `.flower/plugins.json` 读取 selection，不接受新的 selection 参数。
- `PluginApplicationService` 在构造或更新声明后通过 `validatePluginsFile()` 校验，再进入 resolver。
- `resolvePluginGraph()` 将直接声明的 selection 带入对应 root 的 `ResolvedPlugin`；传递依赖默认没有 selection，仍安装其全部 manifest skills。
- `projectPluginContent()` 根据 `resolved.contentSelection.skills` 过滤普通 Plugin 的 `manifest.content.skills`，并把实际 selection 写入 state entry。
- `verify()` 增加声明、lock、state selection 一致性检查；读取固定包时复核 selected Skill 是否仍由当前 manifest 声明。

## TUI Flow

- 发现页保持当前 Marketplace 搜索轻量结果；只有用户进入某个普通 Plugin 安装流程并选定版本后，才准备该 Plugin 包读取 manifest。
- 新增 UI inspection 入口，默认由 `plugin-remote.js` 通过现有 Source Provider `prepare/readPackage` 获取 `{ skills: [{ name, path }] }`；测试可注入该函数，避免真实网络。
- 对 source id 为 `rd-guide` 的 Plugin，Skill 选择页标题使用 `RD Guide 技能管理`；其它普通 Plugin 使用来源名或 Plugin ID 生成标题。
- Skill 选择页使用 checkbox，choices 只来自 manifest `content.skills`。当前只有一个 Skill 时也展示一项并默认选中，以便用户理解这是 Skill 管理而不是整包安装。
- 安装确认前，dry-run 命令和真实命令都携带相同 `--content-skill` 参数。
- 已安装页的管理菜单对带 `contentSelection` 或当前包含 `content.skills` 的普通 Plugin 增加“管理 Skill 选择”；选择变化后执行 `plugin update <id> --content-skill ... --dry-run`，确认后执行真实 update。
- 内置 `flower/skill-garden` 仍走 `context.openSkillManager()`，不复用普通 Marketplace selection 流。

## Compatibility And Risks

- 旧 `.flower/plugins.json` 没有 `contentSelection` 时必须继续通过 schema 并全量安装。
- 对 selection 字段的 canonical JSON 排序不能改变现有数组语义；新增数组在写入前排序，避免重复 dry-run 抖动。
- selection 缩小时会触发旧受管路径删除，必须复用已有 ownership/hash 检查，不能绕过 `TransactionWriter`。
- UI inspection 不能在发现页批量下载 Marketplace 包，避免启动慢和无谓网络请求。
- rd-guide 只有一个 active Skill 的场景需要单测固定，防止未来有人用目录扫描把其它 Skill 或测试脚本展示出来。
