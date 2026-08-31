# 实施计划

## 1. 固化 GitLab lock 索引路径

1. 扩展 GitLab source contract 与项目文件 schema，增加安全的可选 `indexPath`。
2. 让 GitLab 候选和 lock builder 保留当前 Marketplace 固定路径。
3. 在 `prepareLocked()` 中实现 lock-first 路径读取和受限 RD Guide 历史映射。
4. 增加 schema、候选来源和 provider 回归测试，证明新 lock 可重放、旧 lock 可兼容、非法路径被拒绝。

## 2. 统一声明驱动的 lock 可达性

1. 从现有 `reachableLockIds()` 提炼共享函数，改为以当前直接声明为入口遍历 lock 依赖。
2. 明确区分 reachable、orphan 和锁图缺失节点，供 update、remote prepare 与 verify 复用。
3. 保持稳定排序和现有错误码，避免不同命令对同一项目给出不同分类。

## 3. 修正远程来源准备范围

1. 从 `plugin.js` 把当前 `pluginsFile` 或已计算的可达 ID 传入远程注册与候选准备。
2. `registerRemotePluginSources()` 和 `prepareRemoteLock()` 只处理本轮所需的可达历史节点。
3. 保持新增/更新目标及跨来源依赖闭包的现有准备逻辑，确保显式远程操作不会被错误冻结。
4. 增加“无关 orphan 不调用 Provider”和“显式目标仍调用 Provider”的 CLI 测试。

## 4. 让核心升级安全处理旧状态

1. `replayPlugins()` 只冻结当前声明可达的外部 GitLab/GitHub 节点。
2. 让孤立节点进入现有 Resolver/Application Service 移除投影，而不是冻结校验。
3. 调整旧 state 删除 preflight：目标不存在时幂等通过；目标存在且摘要漂移时仍阻断。
4. 验证 roots、lock、state 和内容清理在同一事务中提交，失败时全部保持原样。

## 5. 完整回归与规范同步

1. 扩展 Skill-Garden update 测试，覆盖旧独立 RD Guide 活跃冻结、孤立缺失路径、孤立漂移路径和 fetch 强制失败。
2. 扩展 GitLab provider、project schema、remote CLI、application service 和 TUI 相关测试。
3. 运行定向 Node 测试、完整 lint/type-check/test，以及仓库现有打包/安装校验。
4. 根据最终实现更新 Plugin GitLab、Runtime、Contracts、Config/State 规范。

## 主要验收场景

| 场景 | 预期 |
| --- | --- |
| 旧 `rd-guide/xhgj-*` 活跃声明，GitLab 不可达 | 核心升级成功，旧 lock/state/内容不变 |
| 旧 lock 缓存缺失，GitLab 可达 | 使用历史 `.flower-marketplace/marketplace.json` 重放 |
| 当前聚合 lock 缓存缺失 | 使用 `.flower-plugin/marketplace.json` 重放 |
| 只剩孤立 root/lock/state，目标路径已删除 | 不访问 GitLab，事务清理孤立元数据 |
| 孤立独占路径被用户修改 | 写入前失败，保留文件和三类项目状态 |
| 安装新 RD Guide 时存在无关 orphan | orphan 不触发远程准备，目标正常安装 |
| 显式更新 RD Guide 且 GitLab 不可达 | 稳定失败，项目零写入 |

## 完成条件

- PRD 中全部验收项有自动化证据。
- 新旧 lock 均通过 schema 和 provider 测试。
- 核心升级离线测试能够证明未调用外部 Provider/凭据流程。
- 本地安全冲突测试能够证明失败发生在事务写入前。
- 相关 Trellis spec 与最终行为一致。
