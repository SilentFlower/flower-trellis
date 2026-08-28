# Marketplace Plugin 支持按 content.skills 子集选择安装

## Goal

普通 Marketplace Plugin 支持按 manifest `content.skills` 声明的 Skill 子集选择安装，并在 TUI 中提供类似内置 Skill Garden 的直接技能管理体验；rd-guide 来源当前只向用户暴露 `xhgj-gitlab-collaboration`，用户不应被迫理解单个底层 Plugin 包 ID。

## Background

- GitLab 需求来源：`https://gitlab.xhgjdev.com/xhgj003027/flower-trellis/-/work_items/2`。
- rd-guide 侧计划在仓库根维护 `.flower-plugin/marketplace.json` 与 `.flower-plugin/plugin.json`，`marketplace.json` 只发布聚合包 `rd-guide`，`plugin.json` 的 `content.skills` 控制当前可发布 Skill；测试脚本、验证脚本和未发布 Skill 不应被普通用户看到。
- `flower/skill-garden` 已有 TUI 技能管理体验，但普通 GitLab/GitHub Marketplace Plugin 目前只能安装整个 Plugin 包，不能选择 manifest 中的某几个 Skill。
- 用户实测后确认，rd-guide 入口如果继续显示 `rd-guide/xhgj-gitlab-collaboration` 的普通 Plugin 详情页，会把“研发指南的一组 Skill”误呈现成“单独安装一个 Plugin”，体验模型不符合预期。

## Requirements

- 普通 Marketplace Plugin 的 add/update/replay/verify 生命周期必须支持并保留 Skill 子集选择；未声明选择时安装 manifest `content.skills` 的全部 Skill。
- 用户可通过 CLI 为单个 Plugin 声明显式选择 Skill 子集，选择项使用 manifest `content.skills[].name`，不是包内路径 basename。
- `.flower/plugins.json` 必须保存项目声明的选择意图，`.flower/plugin-lock.json` 和 `.flower/state.json` 必须能回读本次 resolved/apply 使用的 Skill 子集。
- 内容投影只安装被选择的 Skill；更新时不得因为远端 manifest 新增 `content.skills` 条目而自动安装未选择 Skill。
- TUI 在 rd-guide Marketplace 发现页选中条目后，直接进入“RD Guide 技能管理”式交互，不再先显示普通 `Plugin 详情` / `安装到当前项目` 菜单；列表展示 manifest `content.skills` 中声明的 Skill，空格选择，回车直接应用。
- TUI 的 rd-guide Skill 选择交互应尽量贴近内置 `flower-trellis skill`：标题、分组说明、默认勾选、中文按键提示和行内用途描述都应服务于“启用/停用技能”，而不是展示底层包结构；首次进入未安装 Skill 时默认不勾选，已安装管理时按当前 selection 勾选。
- TUI 的 `RD Guide 技能` 聚合入口不展示底层 Marketplace Plugin 包版本；进入管理列表后，具体 Skill 行展示该 Skill 自己声明的版本，不能用 rd-guide bundle / Plugin 包版本替代。
- TUI 展示清单只能来自已选 Plugin 包 manifest 的 `content.skills` entry；具体 Skill 描述和版本直接读取 entry 的 `description/version`，不能扫描仓库目录，也不能把 `scripts/`、`tests/`、`verification/` 或未写入 manifest 的 Skill 当成可选项。
- rd-guide 当前 manifest 只声明 `xhgj-gitlab-collaboration` 时，TUI 只能展示这一项；以后 rd-guide 新版本新增 active Skill 后，只有 manifest 声明后才可显示。
- GitLab Provider 和格式 Adapter 必须支持仓库根 `.flower-plugin/plugin.json` 作为 manifest 入口，并构建只含顶层 `plugin.json` 与 manifest 声明内容的运行时包；`.flower-plugin/marketplace.json` 不得进入包哈希。
- 现有 `flower/skill-garden` 内置技能管理、local Plugin 全量安装和已有 Marketplace Plugin 生命周期不得回退。

## Non-Goals

- 不把 `contract.yaml` 作为 TUI 可选 Skill 的唯一来源；它只作为 Skill 自身治理/验证材料。
- 不兼容旧的 `content.skills: ["skills/foo"]` manifest 形态，也不保留旧 `.flower-marketplace/marketplace.json` 发布路径。
- 不新增外部 Plugin 的主动执行 capability，也不把 manifest 外的脚本或测试投影到可执行位置。
- 不重做 Plugin Marketplace source/auth/search 的认证流程。

## Acceptance Criteria

- [x] `plugin add <id> --content-skill <name>` 或等价重复/逗号写法可安装指定 Skill 子集，dry-run 零写入且 JSON 输出能回读选择。
- [x] `plugin update <id>` 在无新选择参数时保留既有选择；带新选择参数时按新子集投影，清理已取消选择且 hash-clean 的旧受管路径。
- [x] `plugin replay` 使用 `.flower/plugins.json` 的选择意图重放，不自动安装远端新增但未选择的 Skill。
- [x] `plugin verify` 能发现声明、lock、state 的 Skill 选择不一致，以及选择项已不在当前 manifest `content.skills` 中的情况。
- [x] TUI 发现页安装 rd-guide Plugin 时先进入 Skill 选择页，当前只显示 `xhgj-gitlab-collaboration`，回车后直接执行真实命令并携带选择；缺少平台证据时由交互层使用既有默认平台推断，不再单独询问用户。
- [x] TUI 已安装页可重新管理 rd-guide Skill 选择，并在选择变化后直接执行真实 update；失败停留和问题页机制保持可用。
- [x] TUI 已安装 rd-guide 后取消部分 Skill 勾选，会直接执行 `plugin update <id> --content-skill ...` 保存剩余启用项；被取消项仍保留在可选清单里，呈现为未启用而不是从清单消失。
- [x] TUI 已安装 rd-guide 后取消全部 Skill 勾选，会直接执行 `plugin remove <id>` 停用整个 RD Guide 插件，而不是回到旧的“无变化/无法取消”状态。
- [x] TUI 的 `RD Guide 技能` 聚合入口不展示底层 Marketplace Plugin 包版本号；已安装且有显式 selection 时展示来源名与已启用 Skill 数量，具体 Skill 行展示 `content.skills[].version`。
- [x] manifest 目录下存在其它 Skill、`scripts/`、`tests/` 或 `verification/` 但未写入 `content.skills` 时，TUI 不显示，投影也不安装。
- [x] `.flower-plugin/marketplace.json` 和 `.flower-plugin/plugin.json` 位于仓库根时，运行时包哈希只覆盖顶层 `plugin.json` 与 manifest 声明内容，不把 Marketplace 索引或未声明文件带入包。
- [x] `flower/skill-garden` 的发现页入口仍打开原有内置 Skill 管理器，不经过普通 Marketplace selection 流程。
- [x] 覆盖 schema、CLI parser、Application Service、content projector、TUI 交互和 rd-guide 单 Skill 场景的定向测试通过。
- [x] rd-guide 发现页安装入口不再出现 `Plugin 详情` / `安装到当前项目` 中间页；选中后直接显示 RD Guide 技能管理列表，当前单 Skill 场景展示 `xhgj-gitlab-collaboration` 且默认未勾选。
- [x] rd-guide Skill 管理 prompt 使用中文帮助与取消提示，空选择不再暴露 Inquirer 英文校验文案。
- [x] TUI inspection 在不扫描目录的前提下，从 manifest `content.skills[].description` 读取用途描述用于列表展示；缺失时只展示名称。
- [x] TUI inspection 可读取并展示 manifest `content.skills[].version` 中的单个 Skill 版本；rd-guide 首次安装默认未勾选，已安装管理默认勾选当前启用项。
- [x] TUI inspection 优先只准备当前选择的 Plugin 版本，并在同一轮管理器中复用同一 Plugin/version/lock integrity 的 Skill 清单缓存，避免重复远程准备。
- [x] GitLab TUI inspection 优先只读取 Marketplace 当前/锁定索引与固定 commit 上的 manifest，不下载 archive、不读取 repository tree、不写包缓存；Provider 不支持该能力时才回退准备包。

## Notes

- 本任务属于复杂跨层改动，必须配套 `design.md` 与 `implement.md` 后才能开始实现。
