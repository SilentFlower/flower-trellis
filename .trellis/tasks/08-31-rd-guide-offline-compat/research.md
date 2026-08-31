# 调研结论

## 已确认根因

- 当前内置 RD Guide 来源在 `src/builtin-marketplaces/rd-guide.json` 中声明 `marketplacePath=.flower-plugin/marketplace.json`。
- 历史索引 commit `012054fd22a7a5fd90799e740ab210e1dc586baf` 只包含 `.flower-marketplace/marketplace.json`，因此使用当前路径读取该 commit 会得到 404。
- `src/plugin/contracts.js` 与 `src/plugin/schemas/project-files.js` 的 GitLab source lock 只保存 `indexCommit`，没有保存历史索引路径。
- `src/plugin/sources/gitlab-provider.js` 的 `prepareLocked()` 在缓存缺失时使用当前来源的 `marketplacePath` 读取旧 `indexCommit`，直接造成路径漂移。
- `src/commands/plugin-remote.js` 的 `prepareRemoteLock()` 遍历全部 lock 节点；`add/update` 因而可能先准备与本次操作无关的孤立 RD Guide 节点。
- `src/commands/update.js` 当前把全部外部 lock 节点加入 `preserveIds`；`src/plugin/application-service.js` 又要求每个冻结 ID 必须出现在新解析图中，所以半清理项目的孤立节点可能阻塞核心升级。

## 可复用能力

- `src/plugin/resolver/dependency-resolver.js` 已返回不在新解析图中的 `orphans`。
- `src/plugin/application-service.js` 已按旧 state 与新投影生成 removal mutations，并在摘要漂移时阻止删除。
- `src/plugin/application-service.js` 已有 lock 可达性遍历，但入口使用 `lock.roots`；本任务应把共享语义改为从当前直接声明出发。
- `test/js/plugin-skill-garden.test.js` 已证明活跃外部 Plugin 可以在来源未配置时冻结 lock/state/受管目录，并证明本地目录漂移会在写入前阻断。
- `test/js/plugin-remote-cli.test.js` 已证明显式外部 Plugin update 必须准备远程固定包。

## 规范边界

- GitLab Marketplace 的新标准入口保持 `.flower-plugin/marketplace.json`；不得通过通用路径探测或重新生成旧 `.flower-marketplace/marketplace.json` 来兼容历史项目。
- 历史兼容只能依赖 lock provenance 和受限映射，不能把远程 404 当作格式发现机制。
- `preserveIds` 是核心升级内部冻结能力，不改变显式 Plugin update 的远程语义。
- 普通核心升级应冻结外部 Plugin 的既有声明、lock、state 和受管内容，不应要求来源配置、凭据或缓存。
- 三类项目状态必须保持事务一致；本地摘要漂移、ownership 冲突和 schema 损坏仍是安全阻断条件。

## 设计结论

1. GitLab lock source 新增安全的固定 `indexPath`，新 lock 必写，旧 lock 通过 RD Guide 受限映射读取。
2. 共享可达性从 `.flower/plugins.json` 声明出发沿 lock 依赖遍历，不信任陈旧 `lock.roots`。
3. 核心升级只冻结可达外部节点；孤立节点进入现有 Resolver/Lifecycle 的同事务收敛。
4. 旧 state 目标已不存在属于幂等删除，不应被误判为用户修改；目标存在且摘要漂移仍阻断。
5. 显式远程操作只忽略无关 orphan，目标自身仍必须访问 GitLab或可用缓存。
6. 旧独立 `rd-guide/xhgj-*` 保持离线冻结，不在本任务中强制迁移到聚合 Plugin。
