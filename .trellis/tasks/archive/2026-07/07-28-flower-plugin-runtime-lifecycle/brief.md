# Brief — Flower Plugin Runtime、依赖解析与生命周期 CLI

## Goal

- 基于 P1 契约实现可在普通项目独立运行的 Plugin Runtime、依赖求解、多平台内容投影、事务写入和生命周期 CLI。

## Scope

- 实现 builtin/local Source Provider 与可扩展 Registry。
- 实现直接/传递依赖、共享依赖、锁定保持、更新、循环/冲突和 orphan 计算。
- 实现平台检测、共享物理 root 去重、canonical 内容投影和普通内容 InstallPlan。
- 实现带 before-hash 复核、备份、恢复和 state 最后写的事务 writer。
- 接管 `plugin list/add/update/remove/verify`，支持 dry-run、JSON 和无 Trellis 最小 Runtime。

## Non-Goals

- 不实现 GitLab/OAuth、远端 source/search、Patch capability、skill-garden 迁移或第三方 hook。

## Key Context

- 依赖 P1 的 schema、DTO、错误码、stable JSON、tree hash 和 Project Store。
- `plugin` 必须在 `src/cli.js` 的未知命令透传前接管；多级参数使用独立 parser。
- 普通 Plugin 无平台时不能沿用 Claude fallback，也不能隐式创建 `.trellis/` 或安装 `skill-garden`。
- transaction writer 禁止调用 `copyPath()`；全部冲突和 before-hash 漂移在写盘前失败。
- P4 后续把 Patch mutation 合并进同一 InstallPlan，不建立第二套 writer。

## Acceptance

- resolver 覆盖传递/共享依赖、锁定保持、update、缺失、循环和约束冲突，输出稳定 lock。
- 无 Trellis项目可安装普通 Plugin；无平台选择时零写入失败。
- 多 Plugin 路径、前缀、ownership 和用户文件冲突在 preflight 阶段阻断。
- transaction 中途失败可恢复，成功 state 最后写；重复应用零变化。
- 生命周期命令、dry-run、JSON、remove orphan 和 verify 有自动化测试，现有 CLI 回归通过。

## Next Step

- P1 验收完成后启动本任务，依次实现 Provider/Resolver、平台投影、Planner/Writer 和 CLI。
