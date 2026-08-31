# Brief — 保障旧 RD Guide 项目的离线升级兼容

## Goal

- 让仍使用旧 RD Guide 形式、外部 GitLab 不可达或遗留孤立 lock/state 的项目安全完成 Flower/Trellis 核心升级，同时保持显式远程安装/更新的严格失败和零写入语义。

## Scope

- 为 GitLab lock 固化安全的 Marketplace `indexPath`，并用受限、确定性的 RD Guide 映射兼容缺少该字段的历史 lock。
- 从当前 `.flower/plugins.json` 声明出发计算 lock 可达性，只离线冻结仍活跃的外部 Plugin。
- 让无关孤立节点不再触发远程来源准备，并通过现有 Resolver/Application Service 事务收敛 roots、lock、state 和受管内容。
- 将已经不存在的孤立受管路径视为幂等清理，同时保留对现存内容摘要漂移、ownership 冲突和状态损坏的安全阻断。
- 补齐历史/当前索引路径、核心离线升级、孤立状态、显式远程失败和 TUI 入口的自动化测试及相关 Trellis 规范。

## Non-Goals

- 不解决公司 GitLab 的公网连通、DNS、认证或镜像基础设施问题。
- 不支持在没有缓存或镜像的情况下离线安装、升级或恢复远程 Plugin 内容。
- 不在聚合 Plugin 尚未证明技能等价时自动迁移全部 `rd-guide/xhgj-*` 声明。
- 不放宽本地摘要、ownership、依赖图和 schema 安全校验，也不恢复旧 Marketplace 发布结构。

## Key Decisions

- 新 GitLab lock 必须保存 `indexPath`；旧 lock 只通过限定到已确认 RD Guide 来源和 Plugin ID 族的映射兼容，不做多路径网络探测。
- 新 Marketplace 继续唯一使用 `.flower-plugin/marketplace.json`；旧 `.flower-marketplace/marketplace.json` 只作为历史 lock 的读取位置。
- lock 可达性以当前直接声明为入口，不信任可能陈旧的 `lock.roots`；活跃外部节点冻结，孤立节点进入同一生命周期事务清理。
- 受管目标已不存在时允许幂等收敛；目标仍存在且摘要漂移时继续在写入前阻断并保留现场。
- 核心升级不得访问冻结外部来源；用户显式安装、更新或恢复 RD Guide 时仍必须访问 GitLab 或可用缓存，并在失败时保持项目零写入。
- 旧独立 RD Guide Plugin 本轮只保证离线冻结可用，聚合迁移延后到技能等价映射具备之后。

## Key Context

- 404 根因位于 `src/plugin/sources/gitlab-provider.js`：`prepareLocked()` 用当前 `marketplacePath` 读取只锁定了 `indexCommit` 的历史来源。
- lock/source 契约位于 `src/plugin/contracts.js`、`src/plugin/schemas/project-files.js`；当前 GitLab source 尚无 `indexPath`。
- 远程来源登记和候选准备位于 `src/commands/plugin.js`、`src/commands/plugin-remote.js`，当前会遍历全部历史远程 lock。
- 核心升级冻结入口位于 `src/commands/update.js`；生命周期冻结校验、orphan removal 和事务写入位于 `src/plugin/application-service.js`。
- Resolver 已在 `src/plugin/resolver/dependency-resolver.js` 返回 `orphans`，应复用现有事务而非新增独立清理流程。
- 现有测试已覆盖活跃外部 Plugin 离线冻结、本地目录漂移阻断和显式外部 update 必须准备远程包，可在这些基线上扩展。

## Risks / Deferred

- 历史路径映射范围过宽会误判其它 GitLab Plugin，必须限定来源项目和历史 ID 族。
- 可达性计算遇到 lock 依赖缺失时必须保留明确错误，不能把结构损坏误当成可清理 orphan。
- 旧独立 Plugin 到聚合 Plugin 的自动迁移明确延后，直到技能内容等价和迁移映射可验证。

## Acceptance

- 旧 RD Guide lock 在缓存缺失时使用历史索引路径读取固定 commit；新 lock 保存安全 `indexPath`，非法路径被拒绝。
- GitLab 完全不可达且无凭据时，含活跃旧独立 RD Guide 声明的项目完成核心升级，外部声明、lock、state 和受管内容逐字节不变。
- 仅遗留孤立 root/lock/state 且目标已不存在时，核心升级不访问 GitLab，并在同一事务中清理孤立元数据。
- 孤立受管内容存在摘要漂移时，升级在写入前以本地内容冲突失败，文件和三类项目状态保持不变。
- 新增或更新其它 Plugin 时，无关孤立 RD Guide 节点不触发 Provider；显式 RD Guide 更新在 GitLab 不可达时仍稳定失败且零写入。
- 自动化测试和相关 Plugin GitLab、Runtime、Contracts、Config/State 规范覆盖并固化上述行为。

## Next Step

- 确认 Brief 后运行 `task.py start`，进入实现路由并先落地 GitLab lock `indexPath` 与声明驱动的 lock 可达性基础能力。
