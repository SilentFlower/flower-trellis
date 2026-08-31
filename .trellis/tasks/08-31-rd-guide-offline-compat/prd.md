# 保障旧 RD Guide 项目的离线升级兼容

## Goal

确保历史 RD Guide 项目即使仍使用旧 Marketplace 形式、外部 GitLab 当前不可达，或遗留了不可达的 lock/state 节点，也能安全完成 Flower/Trellis 核心升级；需要访问远程内容的显式 RD Guide 安装与更新仍保持严格失败和零写入。

## Background

- 历史 RD Guide 索引 commit `012054fd22a7a5fd90799e740ab210e1dc586baf` 只包含 `.flower-marketplace/marketplace.json`，当前内置来源则固定读取 `.flower-plugin/marketplace.json`。
- 当前 GitLab lock 只保存 `indexCommit`，`prepareLocked()` 会使用当前来源配置的 `marketplacePath` 读取历史 commit，因此旧 lock 在缓存缺失时会请求不存在的路径并得到 404。
- 普通 `flower-trellis update` 已通过 `preserveIds` 冻结外部 Plugin，但当前会冻结 lock 中的全部外部节点。若项目只删除了声明、仍留下旧 root/lock/state，孤立节点可能在解析前或冻结校验阶段阻塞升级。
- `plugin add/update` 当前会先准备全部历史远程 lock，导致与本次目标无关的孤立旧节点也触发 GitLab 请求。

## Requirements

### R1. 历史索引路径可重放

- 新生成的 GitLab lock 来源快照必须保存固定的 Marketplace 索引路径，与 `indexCommit` 一起构成可重放来源身份。
- `prepareLocked()` 必须优先使用 lock 内保存的索引路径，不得使用后来变化的用户来源配置覆盖历史路径。
- 对缺少索引路径的既有 lock，必须使用受控、确定性的 RD Guide 兼容映射补全历史路径；不得通过依次请求多个候选路径来探测格式。
- 新 Marketplace、作者模板和 CI 继续只使用 `.flower-plugin/marketplace.json`，不得重新生成旧 `.flower-marketplace/marketplace.json`。
- 索引路径必须继续服从项目内安全 POSIX 相对路径约束，拒绝绝对路径和目录逃逸。

### R2. 核心升级离线冻结活跃外部 Plugin

- 普通 Flower/Trellis 核心升级必须从 `.flower/plugins.json` 的直接声明出发，沿既有 lock 依赖计算活跃节点，只冻结仍可达的 GitLab/GitHub Plugin。
- 冻结活跃外部 Plugin 时不得初始化其凭据、访问其来源或要求本地存在远程缓存；既有声明、lock、state 和受管内容必须原样保留。
- 仍采用旧独立 `rd-guide/xhgj-*` 声明的项目必须能够离线升级，不强制迁移到当前聚合 Plugin。
- 外部 GitLab 的 DNS、网络、认证或服务状态不得成为核心升级的失败原因。

### R3. 孤立 lock/state 本地收敛

- 远程来源注册和候选准备必须忽略从当前直接声明不可达的历史 lock 节点，避免孤立节点触发无关网络请求。
- 生命周期成功执行时，解析器返回的孤立节点必须在同一事务中从 roots、lock 和 state 收敛；不得先写项目状态再访问远程。
- 孤立 state 指向的受管路径已不存在时，视为可安全收敛：删除 ownership 元数据，不因摘要与 `null` 不同而报“用户修改”。
- 孤立 state 指向的独占路径仍存在且摘要匹配时，沿用现有卸载语义删除；摘要漂移时必须在写入前失败并保留用户内容和项目状态。
- shared ownership、目标冲突、状态 schema 无效或依赖图缺失仍按现有安全规则处理，不得为了离线升级静默吞掉本地一致性问题。

### R4. 显式远程操作保持严格

- 用户显式执行 RD Guide 安装、更新或缺失内容恢复时，仍必须访问 GitLab 或已配置的可用镜像/缓存；本任务不承诺离线获取不存在的包。
- 显式远程操作只准备当前活跃 lock 节点和本次目标的依赖闭包，不得被无关孤立节点阻塞。
- 远程认证、网络或索引读取失败时，命令必须返回稳定错误码，并保证 `.flower/plugins.json`、lock、state 和受管内容零写入。

### R5. 兼容诊断与规范

- `plugin verify` 继续报告 root 缺失/多余、lock orphan、state extra 和 ownership 漂移；自动安全收敛后相应诊断必须消失。
- 更新 GitLab 来源、Plugin Runtime、lock/state 契约规范，明确历史路径、离线冻结、孤立节点和安全阻断边界。

## Acceptance Criteria

- [ ] 旧 RD Guide lock 在包缓存缺失时使用历史索引路径读取固定 commit，不再因当前 Marketplace 路径变化返回 404。
- [ ] 新生成的 GitLab lock 保存安全的固定索引路径，非法路径会被 schema 拒绝。
- [ ] 外部 GitLab 完全不可达且无凭据时，含旧独立 RD Guide 声明的项目可以完成核心升级，外部 lock/state/受管内容逐字节不变。
- [ ] 仅遗留孤立 RD Guide root/lock/state 且受管路径已不存在时，核心升级不访问 GitLab，并在事务中清理孤立元数据。
- [ ] 孤立节点存在摘要漂移的本地受管内容时，核心升级在写入前失败并保留现场，错误明确指向本地内容冲突而非远程不可达。
- [ ] 新增或更新其它 Plugin 时只准备活跃历史节点和目标依赖闭包，无关孤立 RD Guide 节点不会触发远程请求。
- [ ] 显式 RD Guide 更新在 GitLab 不可达时仍失败，且三类项目状态和受管内容保持零写入。
- [ ] 回归测试覆盖历史/当前索引路径、离线活跃节点、孤立缺失路径、孤立漂移路径、显式远程失败和 TUI 安装入口。

## Non-Goals

- 不解决公司 GitLab 的公网连通、DNS、认证或镜像基础设施问题。
- 不支持在没有缓存或镜像的情况下离线安装、升级或恢复远程 Plugin 内容。
- 不在 RD Guide 聚合 Plugin 尚未覆盖旧技能时自动迁移全部 `rd-guide/xhgj-*` 声明。
- 不放宽受管内容摘要、ownership、依赖图和 schema 的本地安全校验。
- 不恢复或继续发布旧 Marketplace 文件结构。

## Open Questions

无。旧形式采用“保持活跃节点冻结可用、孤立节点安全收敛、聚合迁移延后”的兼容策略。
