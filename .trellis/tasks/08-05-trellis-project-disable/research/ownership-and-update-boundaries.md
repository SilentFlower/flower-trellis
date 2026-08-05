# Trellis 关闭功能所有权与更新边界研究

## Confirmed Evidence

- `getConfiguredPlatforms(projectRoot)` 从 `.trellis/.template-hashes.json` 与各平台模板集合推导当前配置平台，不依赖平台目录是否存在。
- `.trellis/.template-hashes.json` 记录 Trellis 原生生成文件，`.flower/state.json` 记录 Flower/Skill-Garden 投影路径、hash 和 exclusive/shared ownership。
- `AGENTS.md` 使用稳定的 `TRELLIS:START` / `TRELLIS:END` 标记，可安全移除管理块并保留项目自有正文。
- Flower `PluginApplicationService` 和 `TransactionWriter` 已提供 preflight、target drift 校验、原子写入、逆序恢复和 repair evidence。
- `flower-trellis update` 已有项目外补偿快照，并在 Trellis update 后重放 Plugin Runtime。
- 上游 `trellis update` 只依据 Trellis 本身的模板状态运行，不读取 `.flower/` 的 disabled 状态。

## Design Consequences

- 用户入口应是单一项目级开关；平台列表只存在于内部 manifest 和恢复计划。
- detach 目标应取 Trellis template hashes、configured platform templates 与 Flower state paths 的并集，并排除 `.trellis` 用户数据面。
- 独占文件和共享容器需要不同 mutation：独占文件移动/删除，共享 Markdown/JSON 只移除 Trellis 片段。
- 恢复不能只重新生成模板，也不能只拷贝旧备份；应先精确恢复关闭前现场，再运行当前版本 update/plugin replay。
- 为保证 Flower 更新链在 disabled 状态下不泄漏入口，更新完成后必须按同一 detach 计划重新收敛，且最终状态校验不可只看标志文件。

## Technical Constraint

若要求直接调用上游 `trellis update` 也无法重建入口，Flower 必须让项目对上游看起来不再是 Trellis 项目，实际意味着移走或重命名整个 `.trellis/`。该做法会把通常受 Git 管理的 workflow、scripts、spec 和 tasks 显示为大批删除，与“偶尔不用 Trellis 进行普通开发”的目标冲突。

## Resolved Product Decision

用户确认采用推荐边界：Flower 自有 `update/self-update/plugin` 写链必须保持 disabled；直接执行上游 `trellis update` 视为显式绕过，允许重建入口，随后由 `ft trellis status` 报告 `drifted`。实现不移动整个 `.trellis/`。
