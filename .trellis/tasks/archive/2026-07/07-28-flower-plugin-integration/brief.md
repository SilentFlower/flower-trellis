# Brief — Flower Plugin 跨模块集成、打包与端到端验收

## Goal

- 把 P1-P6 收敛为一致、可发布的 Flower Plugin 产品面，并将终端交互重做为清晰、美观、可恢复上下文的 Plugin 管理器。

## Scope

- TTY 裸执行 `flower-trellis plugin` 打开借鉴 Claude Code `/plugin` 信息架构的 `发现 / 已安装 / 来源 / 问题` 四页签管理器，不再使用六项平铺首页菜单。
- `发现` 合并所有已启用 Marketplace，以来源标签区分 Plugin；新 Plugin 和版本通过刷新索引自动出现。
- 未授权来源默认直接启动 Device Flow，展示授权地址和授权码，成功后恢复原搜索、详情和选中位置；PKCE 仅保留为高级认证入口。
- Plugin 详情先展示来源、描述、版本、依赖和 capability，再进入平台选择、dry-run 与最终确认；保持现有单 Plugin 原子事务。
- `已安装` 复用 verify/update/remove，`来源` 复用 source/auth，`问题` 汇总认证、依赖、完整性和目标漂移诊断。
- 作者 init/validate 保留为高级命令，不占用普通用户的四页签主界面。
- 非 TTY、显式子命令、`--json`、README、测试、npm pack 和 evidence matrix 保持现有兼容边界。

## Non-Goals

- 不兼容 Claude Plugin 格式，只借鉴其信息架构和交互模式。
- 不引入 Ink、React、Blessed 等常驻全屏 TUI 框架，不新增批量安装事务。
- 不发布、push、merge、release、部署，不修改真实 rd-guide 或 GitLab 管理配置。
- 不新增 Plugin 协议、权限档位、来源类型或平行 DTO/错误码/状态 schema，不放宽安全与原子性契约。

## Key Context

- 使用 `@inquirer/prompts` 与同一 `@inquirer/core` 体系实现轻量页签和列表交互；`src/commands/plugin-interactive.js` 仍是薄编排层。
- UI 只能消费 `ProjectStore`、`UserSourceStore` 和结构化远程 helper，并通过 `runCommand(args)` 复用现有生命周期、认证与作者命令。
- 页签、搜索词、来源过滤、选中项和游标仅保存在当前进程，不写项目状态。
- 只有进入发现页、刷新远程来源或显式登录时访问 GitLab；本地页签、非 TTY 与未使用来源保持零网络。
- 测试隔离 HOME/XDG/keyring，不读取真实凭据；取消授权、dry-run 或最终确认均必须零写入。

## Acceptance

- 四页签可用键盘切换，视觉层级清晰；详情返回、授权完成和操作完成后恢复原页签、搜索和选中位置。
- 单一未授权 `rd-guide` 进入发现页时自动进入 Device Flow，授权成功继续原流程，不要求用户选择 PKCE 或重新搜索。
- 发现、详情、已安装、来源和问题页完成核心工作流；内置来源覆盖可以恢复默认配置。
- 非 TTY 裸命令仍为 list，显式命令与 JSON 不进入交互模式，stdout 契约不漂移。
- 定向交互/PTY、GitLab mock、零网络、敏感输出、全量测试、sync、snapshot、Patch、compiled targets、strict context budget、npm pack 与 diff check 全部通过。

## Next Step

- 复用当前 inline implement 路由快速实现四页签原型和自动 Device Flow，完成定向验证后返回 Phase 2.1 Pre-Check。
