# Brief — Marketplace Plugin 支持按 content.skills 子集选择安装

## Goal

- 让普通 Marketplace Plugin 可以按 manifest `content.skills` 声明的 Skill 子集安装，并在 TUI 中提供类似内置 Skill Garden 的选择体验；rd-guide 当前只向用户暴露 `xhgj-gitlab-collaboration`。

## Scope

- 新增 `contentSelection.skills` 数据模型，贯通 `.flower/plugins.json`、`plugin-lock.json`、`state.json`、公共 DTO 和 schema。
- 增加 CLI selection 参数，支持 `plugin add` 和单个 `plugin update <id>` 选择 Skill 子集，并让 dry-run、update、replay、verify 回读或校验该选择。
- 修改 Resolver、lock builder、Application Service 和 content projector，使普通 Plugin 的 `content.skills` 只投影被选择的 Skill，未声明 selection 时保持全量安装兼容。
- 扩展 Plugin TUI：rd-guide 普通 Marketplace Plugin 在发现页和已安装页进入 Skill 选择/管理视图，列表只来自 manifest `content.skills`。
- 补充 schema、CLI parser、生命周期、投影、TUI 交互和 rd-guide 单 Skill 场景的定向测试。

## Non-Goals

- 不调整 rd-guide 仓库目录结构。
- 不把 `contract.yaml` 作为 TUI 可选 Skill 的唯一来源。
- 不新增外部 Plugin 的主动执行 capability，也不安装 manifest 外的脚本、测试或验证目录。
- 不重做 Marketplace source/auth/search 认证流程。

## Key Decisions

- 使用 `contentSelection.skills` 表示项目选择，而不是复用 manifest 的 `content.skills`；manifest 表示包发布了哪些内容路径，selection 表示当前项目启用哪些 Skill 名称。
- selection 值使用 manifest `content.skills` 条目的 basename；只要 Skill 目录名不变，rd-guide 调整包内父目录后选择仍可延续。
- `contentSelection` 缺失表示旧行为：安装全部 manifest `content.skills`；存在时必须非空、唯一、稳定排序。
- selection 写入 `.flower/plugins.json` 作为项目声明意图，写入 `plugin-lock.json` 作为 resolved graph 回读，写入 `state.json` 作为本机实际投影记录。
- TUI 不硬编码 rd-guide 的隐藏名单；rd-guide 当前只显示 GitLab collaboration，由 rd-guide 包 manifest 只声明该 Skill 来控制。
- 内置 `flower/skill-garden` 继续走原有 `skill-manager` action，不进入普通 Marketplace selection 流程。

## Key Context

- 需求来源：`https://gitlab.xhgjdev.com/xhgj003027/flower-trellis/-/work_items/2`。
- 关键规范：`.trellis/spec/flower-trellis/cli/flower-plugin-contracts.md`、`.trellis/spec/flower-trellis/cli/flower-plugin-runtime.md`、`.trellis/spec/flower-trellis/cli/flower-plugin-gitlab.md`、`.trellis/spec/flower-trellis/cli/module-guidelines.md`。
- 关键实现入口：`src/commands/plugin.js`、`src/commands/plugin-interactive.js`、`src/commands/plugin-remote.js`、`src/plugin/application-service.js`、`src/plugin/resolver/dependency-resolver.js`、`src/plugin/install/content-projector.js`、`src/plugin/schemas/project-files.js`。
- 现状：普通 Plugin 当前全量投影 manifest `content.skills`；TUI 只有内置 `flower/skill-garden` 会打开 Skill 管理器；Marketplace search 不返回 manifest Skill 清单。

## Risks / Deferred

- `plugin-lock.json` 增加 selection 字段会扩展可提交锁文件 schema，实现时如发现与现有发布兼容性冲突，必须回到 planning 更新设计。
- TUI inspection 必须在用户进入具体 Plugin/版本后按需读取 manifest，不能在发现页批量下载 Marketplace 包。
- selection 缩小时会删除旧受管 Skill 路径，必须复用现有 ownership/hash/TransactionWriter 边界。

## Acceptance

- `plugin add <id> --content-skill <name>` 或等价重复/逗号写法可安装指定 Skill 子集，dry-run 零写入且 JSON 输出能回读选择。
- `plugin update <id>` 无 selection 参数时保留既有选择，带 selection 参数时按新子集投影并清理取消选择的 hash-clean 旧路径。
- `plugin replay` 使用 `.flower/plugins.json` 选择意图重放，不自动安装远端新增但未选择 Skill。
- `plugin verify` 能发现声明、lock、state selection 不一致，以及 selected Skill 已不在当前 manifest `content.skills` 中的情况。
- TUI 发现页安装 rd-guide Plugin 时只显示 `xhgj-gitlab-collaboration`，确认后 dry-run 与真实命令携带相同 selection。
- TUI 已安装页可重新管理 rd-guide Skill 选择，并复用现有预览、确认、失败停留和问题页机制。
- manifest 外存在其它 Skill、`scripts/`、`tests/` 或 `verification/` 时，TUI 不显示，投影不安装。
- `flower/skill-garden` 行为不回退。
- 定向测试、相关远程测试、全量 `npm test`、`npm pack --dry-run --json`、`git diff --check` 按计划通过。

## Next Step

- 用户确认 brief 后，运行 `python3 ./.trellis/scripts/task.py start .trellis/tasks/08-28-marketplace-plugin-skill-subset-selection` 进入实现阶段。
