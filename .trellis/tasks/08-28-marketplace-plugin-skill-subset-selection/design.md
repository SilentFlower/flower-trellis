# Design

## Current State

- `src/plugin/contracts.js` 目前把 `PluginContent` 定义为 manifest 发布内容路径，`ProjectPluginDeclaration` 只含 `id/source/version/platforms?`，`ResolvedPlugin` 与 `PluginStateEntry` 没有选择字段。
- `src/plugin/schemas/project-files.js` 对 `.flower/plugins.json`、`.flower/plugin-lock.json`、`.flower/state.json` 都开启 `additionalProperties:false`，新增持久字段必须同步 schema 和测试。
- `src/plugin/application-service.js` 的生命周期路径是 `plugins.json` 声明 -> `resolvePluginGraph` -> `buildPluginLock` -> `projectPluginContent` -> `TransactionWriter`；selection 需要从声明一路穿透到投影与 state。
- `src/plugin/install/content-projector.js` 当前对普通 Plugin 的 `manifest.content.skills` 全量投影到平台 Skill root，只有 `flower/skill-garden` 通过可信 builtin provider 做自定义投影。
- `src/commands/plugin-interactive.js` 只有内置 `flower/skill-garden` 会生成 `skill-manager` action；普通 Marketplace Plugin 的发现页安装流程会先显示 Plugin 详情再做版本、平台、dry-run 和确认。该模型对 rd-guide 不合适，因为 rd-guide 希望呈现为一个来源下的一组可选 Skill。
- `src/plugin/sources/gitlab-provider.js` / `github-provider.js` 的 `search()` 结果只包含 `id/description/versions/source`，TUI 要展示 Skill 列表必须在用户选中具体 Plugin/版本后准备包并读取 manifest。

## Data Model

- `PluginContent.skills` 不再是字符串路径列表，固定为 `PluginContentSkillEntry[]`：
  - `name: string`：TUI 与 `contentSelection.skills` 使用的单段 Skill 名称。
  - `path: string`：运行时包内来源路径。
  - `version: string`：单个 Skill 版本，用于 TUI 行内展示和用户判断升级，不从 bundle 版本代填。
  - `description?: string`：TUI 行内用途说明。
- 新增 `PluginContentSelection` DTO：
  - `skills?: string[]`
  - 值为 Skill 名称，也就是 manifest `content.skills[].name`。
  - 字段缺失表示安装全部 manifest `content.skills`。
  - 数组存在时必须非空、唯一、稳定排序；如果用户想完全移除该 Plugin，应走 `plugin remove`，不保留空 selection。
- 在以下 DTO/schema 中加入可选 `contentSelection`：
  - `ProjectPluginDeclaration.contentSelection`：项目声明意图，可提交。
  - `ResolvedPlugin.contentSelection`：本次解析图使用的选择，写入 `plugin-lock.json` 以便回读。
  - `PluginStateEntry.contentSelection`：本机实际投影时使用的选择，写入 `state.json`。
- `plugin-lock.json` 不保存平台、本机路径或用户身份；`contentSelection` 是项目级内容选择，不含秘密材料，也不是平台检测态。若实现中发现 lock 冗余导致验证收益不足，不得静默删除该字段，需要同步更新本设计和验收。

## Selection Semantics

- `contentSelection` 只影响 `content.skills`；`specs/assets/scripts/tests` 仍按现有 manifest 内容投影规则处理。
- selection 匹配 manifest `content.skills[].name`，不匹配完整路径；rd-guide 调整 Skill 根目录时，只要 `name` 不变，用户选择可以继续生效。
- 同一 manifest 中两个 `content.skills` 条目 `name` 或 `path` 重复都按 schema/内容冲突失败。
- selection 中出现 manifest 当前版本没有声明的 Skill 名称时，应返回稳定错误并保持零写入。该情况可能来自手写 `.flower/plugins.json` 或远端新版本删除 Skill。
- TUI 不硬编码 rd-guide 的隐藏名单；“只显示 GitLab collaboration”由 rd-guide 包 manifest 当前只声明该 Skill 来控制。

## Package Layout

- rd-guide 仓库根维护 `.flower-plugin/marketplace.json` 与 `.flower-plugin/plugin.json`；`marketplace.json` 只发布聚合包 `rd-guide`，具体可安装 Skill 由 `plugin.json` 的 `content.skills` entry 控制。
- Marketplace entry source 可通过 `manifestPath: ".flower-plugin/plugin.json"` 指向仓库根 metadata；`type:"path"` 的 `path` 可省略，表示包内容从仓库根声明式构建。
- Provider/Adapter 准备固定包时，不把整个仓库根当 Plugin 包直接哈希；运行时包只包含顶层 `plugin.json`、manifest 显式声明的 `content`/`patches` 路径和匹配的 platform override。
- `.flower-plugin/marketplace.json` 是索引文件，不能进入聚合 Plugin 包哈希；未声明的 `README`、验证脚本、测试目录或其它 Skill 也不得进入包。
- 旧的 `content.skills: ["skills/foo"]` manifest 形态直接 schema 失败；旧 `.flower-marketplace/marketplace.json` 不再作为 Flower Marketplace 探测路径。

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

- 发现页保持当前 Marketplace 搜索轻量结果；只有用户选中某个普通 Plugin 并选定版本后，才准备该 Plugin 包读取 manifest，仍不得在发现页批量下载包。
- 新增 UI inspection 入口，默认由 `plugin-remote.js` 通过现有 Source Provider `prepare/readPackage` 获取 `{ skills: [{ name, path, description?, version }] }`；description/version 只来自 manifest `content.skills` entry，测试可注入该函数避免真实网络。
- UI inspection 的 Skill metadata 必须包含 `version`，表示单个 Skill 自己声明的版本，不能由 rd-guide bundle / Plugin 包版本代填。
- UI inspection 优先调用远程 Provider 的可选 `prepareVersion(canonicalId, version)` 只准备当前要展示的一个版本；Provider 不支持时回退完整 `prepare()`。同一轮 TUI 对相同 Plugin/version/lock integrity 复用内存缓存。
- 对 source id 为 `rd-guide` 的 Plugin，发现页动作直接进入 `RD Guide 技能管理`，跳过普通 `Plugin 详情` / `安装到当前项目` 菜单；其它普通 Plugin 保持现有详情页。
- 对 source id 为 `rd-guide` 的已安装条目，如果项目已经存在显式 `contentSelection`，按 Enter 直接进入 Skill 管理；旧的无 selection 安装仍保留普通管理菜单，避免丢失更新/卸载入口。
- Skill 选择页使用 checkbox，choices 只来自 manifest `content.skills`。当前只有一个 Skill 时也展示一项；rd-guide 首次安装默认不勾选，已安装管理默认勾选当前 selection，空选择由交互层输出中文取消/提示，不透出 Inquirer 英文 required 文案。
- rd-guide Skill 选择页回车后直接应用选择：首次安装直接执行 `plugin add <id> --version ^<latest> --content-skill ...`，缺少平台证据时由交互层补入既有默认平台；已安装选择变更直接执行 `plugin update <id> --content-skill ...`。该路径不展示平台选择、dry-run 预览或二次确认。
- rd-guide 已安装管理中的 checkbox 表示最终启用状态：取消部分 Skill 会保存剩余启用项，取消的 Skill 仍作为可重新启用的可选项显示；取消全部 Skill 时，由于 `contentSelection.skills` 不允许为空，交互层执行 `plugin remove <id>` 停用整个 rd-guide Plugin。
- rd-guide 的来源级入口不展示底层 Marketplace Plugin 包版本；已安装且有显式 selection 时显示“来源名 · 已启用 N 个技能”，无 selection 或未安装时只显示来源名，避免把包版本误读成单个 Skill 版本。
- 其它普通 Marketplace Plugin 的 Skill 选择仍保留原 Plugin 生命周期模型：安装确认前 dry-run 和真实命令都携带相同 `--content-skill` 参数；已安装管理菜单选择变化后执行 dry-run、确认和真实 update。
- 内置 `flower/skill-garden` 仍走 `context.openSkillManager()`，不复用普通 Marketplace selection 流。

## Compatibility And Risks

- `.flower/plugins.json` 没有 `contentSelection` 时继续表示全量安装当前 manifest 声明的 Skill；这属于项目选择语义，不是旧 manifest 兼容。
- 旧 manifest 字符串 Skill 条目和旧 Marketplace 路径不做兼容。
- 对 selection 字段的 canonical JSON 排序不能改变现有数组语义；新增数组在写入前排序，避免重复 dry-run 抖动。
- selection 缩小时会触发旧受管路径删除，必须复用已有 ownership/hash 检查，不能绕过 `TransactionWriter`。
- UI inspection 不能在发现页批量下载 Marketplace 包，避免启动慢和无谓网络请求。
- rd-guide 只有一个 active Skill 的场景需要单测固定，防止未来有人用目录扫描把其它 Skill 或测试脚本展示出来。
