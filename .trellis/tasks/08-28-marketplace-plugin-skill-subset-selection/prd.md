# Marketplace Plugin 支持按 content.skills 子集选择安装

## Goal

普通 Marketplace Plugin 支持按 manifest `content.skills` 声明的 Skill 子集选择安装，并在 TUI 中提供类似内置 Skill Garden 的选择体验；rd-guide 来源当前只向用户暴露 `xhgj-gitlab-collaboration`。

## Background

- GitLab 需求来源：`https://gitlab.xhgjdev.com/xhgj003027/flower-trellis/-/work_items/2`。
- rd-guide 侧计划把 `skills/` 作为 bundle 包根，通过包根 `plugin.json` 的 `content.skills` 控制当前可发布 Skill；测试脚本、验证脚本和未发布 Skill 不应被普通用户看到。
- `flower/skill-garden` 已有 TUI 技能管理体验，但普通 GitLab/GitHub Marketplace Plugin 目前只能安装整个 Plugin 包，不能选择 manifest 中的某几个 Skill。

## Requirements

- 普通 Marketplace Plugin 的 add/update/replay/verify 生命周期必须支持并保留 Skill 子集选择；未声明选择时保持现有行为：安装 manifest `content.skills` 的全部 Skill。
- 用户可通过 CLI 为单个 Plugin 声明显式选择 Skill 子集，选择项使用 Skill 目录名，即 manifest `content.skills` 条目的 basename。
- `.flower/plugins.json` 必须保存项目声明的选择意图，`.flower/plugin-lock.json` 和 `.flower/state.json` 必须能回读本次 resolved/apply 使用的 Skill 子集。
- 内容投影只安装被选择的 Skill；更新时不得因为远端 manifest 新增 `content.skills` 条目而自动安装未选择 Skill。
- TUI 在 rd-guide Marketplace Plugin 的发现页和已安装页提供“RD Guide 技能管理”式交互：列表展示 manifest `content.skills` 中声明的 Skill，空格选择，回车预览应用。
- TUI 展示清单只能来自已选 Plugin 包 manifest 的 `content.skills`；不能扫描仓库目录，也不能把 `scripts/`、`tests/`、`verification/` 或未写入 manifest 的 Skill 当成可选项。
- rd-guide 当前 manifest 只声明 `xhgj-gitlab-collaboration` 时，TUI 只能展示这一项；以后 rd-guide 新版本新增 active Skill 后，只有 manifest 声明后才可显示。
- 现有 `flower/skill-garden` 内置技能管理、local Plugin 全量安装和已有 Marketplace Plugin 生命周期不得回退。

## Non-Goals

- 不调整 rd-guide 仓库目录结构；该工作由 rd-guide 任务独立处理。
- 不把 `contract.yaml` 作为 TUI 可选 Skill 的唯一来源；它只作为 Skill 自身治理/验证材料。
- 不新增外部 Plugin 的主动执行 capability，也不把 manifest 外的脚本或测试投影到可执行位置。
- 不重做 Plugin Marketplace source/auth/search 的认证流程。

## Acceptance Criteria

- [x] `plugin add <id> --content-skill <name>` 或等价重复/逗号写法可安装指定 Skill 子集，dry-run 零写入且 JSON 输出能回读选择。
- [x] `plugin update <id>` 在无新选择参数时保留既有选择；带新选择参数时按新子集投影，清理已取消选择且 hash-clean 的旧受管路径。
- [x] `plugin replay` 使用 `.flower/plugins.json` 的选择意图重放，不自动安装远端新增但未选择的 Skill。
- [x] `plugin verify` 能发现声明、lock、state 的 Skill 选择不一致，以及选择项已不在当前 manifest `content.skills` 中的情况。
- [x] TUI 发现页安装 rd-guide Plugin 时先进入 Skill 选择页，当前只显示 `xhgj-gitlab-collaboration`，确认后 dry-run 与真实命令都携带相同选择。
- [x] TUI 已安装页可重新管理 rd-guide Skill 选择，并复用现有预览、确认、失败停留和问题页机制。
- [x] manifest 目录下存在其它 Skill、`scripts/`、`tests/` 或 `verification/` 但未写入 `content.skills` 时，TUI 不显示，投影也不安装。
- [x] `flower/skill-garden` 的发现页入口仍打开原有内置 Skill 管理器，不经过普通 Marketplace selection 流程。
- [x] 覆盖 schema、CLI parser、Application Service、content projector、TUI 交互和 rd-guide 单 Skill 场景的定向测试通过。

## Notes

- 本任务属于复杂跨层改动，必须配套 `design.md` 与 `implement.md` 后才能开始实现。
