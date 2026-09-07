# Brief — 完善 Flower 团队克隆后的安装与版本记录

## Goal

- 让团队克隆带上准确的 Flower 版本，并在缺少 CLI 时通过对话确认完成安装。

## Scope

- 升级时幂等修正已有根 `.gitignore` 及局部规则，开放 `.flower/plugins.json`、`plugin-lock.json` 和 `.gitignore`，保留其他规则及换行风格。
- 迁移必要策略和缓存后删除旧 `.trellis/.flower-manifest.json`，失败回滚；修正旧记录相关提示。
- Codex/Claude 启动 hook 检测 CLI 缺失，手动升级 skill 补充同一检测入口。

## Non-Goals

- 不移动 `.flower`、不共享本地状态或个人设置、不发版；保留当前项目已有变更。

## Key Decisions

- 成员确认后安装项目锁定版本，验证后继续原请求；全局安装会同步本机 Trellis 命令，不隐式升级项目内容。
- 根 `.gitignore` 不存在就不新建；显式 `--no-enhance` 不清理未经迁移的旧记录。
- 保留旧项目迁移入口，成功后不留旧 manifest；现代有效配置优先。

## Key Context

- 文件变更复用插件投影和事务，根/局部忽略规则、迁移配置及旧文件都纳入回滚。
- 修改 Flower 源 hook 和两份 canonical 手动升级 skill，同步分发快照。

## Risks / Deferred

- 自动引导依赖升级文件已提交、Python 可用及宿主启用 hooks；其他平台通过手动升级入口触发。
- 项目锁无效、CLI 异常或安装失败时报告原因，不猜版本、不自动提权、不循环安装。

## Acceptance

- 真实 Git 验证共享文件可见、本地数据被忽略、重复升级无重复规则。
- 验证迁移保留配置、旧文件删除、失败恢复和 dry-run 零写入。
- 验证克隆后无 state/CLI 仍能输出正确安装引导，未确认不安装，拒绝后不反复追问。
- 相关回归和仓库质量门禁通过；重任务经 WSL 保护入口串行执行。

## Next Step

- 最终摘要确认后启动任务，进入实现路由，先完成忽略规则和事务处理。
