# 技术设计

## 1. 现状与根因

当前路径存在三个相互叠加的问题：

1. `GitLabSourceDescriptor` 只锁定 `indexCommit`，没有锁定读取该 commit 时使用的 Marketplace 路径。
2. `GitLabSourceProvider.prepareLocked()` 使用当前 `source.marketplacePath` 读取历史 commit，来源配置改名后无法重放旧 lock。
3. 远程准备和核心升级以“lock 中存在”为依据处理全部外部节点，没有先从当前声明计算可达性；半清理项目中的旧 root/lock/state 因而触发无关远程请求或冻结校验失败。

现有 Resolver 已返回 `orphans`，Application Service 也会为不再需要的独占路径生成删除计划。实现应复用这条生命周期事务，不新增另一套独立清理器。

## 2. 关键决策

### D1. lock 固化历史索引路径

在 GitLab `ResolvedPlugin.source` 中新增可选 `indexPath`：

- 新候选写 lock 时始终带上当前已验证的 `marketplacePath`。
- `prepareLocked()` 使用 `plugin.source.indexPath`；仅旧 lock 缺失该字段时进入兼容解析。
- `indexPath` 复用安全相对路径 schema，不增加自由 URL 或绝对路径能力。

旧 lock 兼容采用确定性映射，不做网络探测：

| 来源与 Plugin | 缺失 `indexPath` 时使用 |
| --- | --- |
| `rd-guide` 固定项目下的历史 `rd-guide/xhgj-*` | `.flower-marketplace/marketplace.json` |
| `rd-guide/rd-guide` 聚合 Plugin | `.flower-plugin/marketplace.json` |
| 其它 GitLab Plugin | 当前已配置并验证的 `marketplacePath` |

该映射只用于读取既有 lock，不改变新 Marketplace 和作者工具的唯一标准路径。

### D2. 以当前声明计算 lock 可达性

抽取共享的 lock 可达性函数，输入当前 `plugins.json` 声明和既有 lock：

1. 以直接声明 ID 为入口，不信任可能陈旧的 `lock.roots`。
2. 沿 lock 中的 `dependencies` 稳定遍历。
3. 输出 `reachableIds`、`orphanIds`，并保留缺失节点诊断所需信息。

该结果由三个入口复用：

- 核心升级只把可达的外部节点加入 `preserveIds`。
- 远程来源注册和 `prepareRemoteLock()` 只处理可达且未冻结的远程节点。
- verify 仍独立比较声明与 roots，同时用同一可达性语义报告 orphan。

### D3. 活跃旧 Plugin 冻结，孤立旧 Plugin 事务收敛

- 活跃外部节点继续由 Resolver 的 preserved candidate 重放，不注册 Provider、不读取缓存、不初始化凭据。
- 孤立外部节点不进入 `preserveIds`。Resolver 将其返回为 orphan，后续 lock/state 投影自然移除它们。
- Application Service 删除旧 state 路径时，把“目标已不存在”视为幂等清理：不生成文件删除动作，只移除 state ownership。
- 目标仍存在且摘要匹配时执行现有删除；摘要漂移时继续在 preflight 阻断，保证用户修改不被覆盖。
- 所有 roots、lock、state 和内容变更仍由同一个 `TransactionWriter` 提交或回滚。

### D4. 显式远程操作不降级为离线成功

核心升级的离线冻结仅通过内部 `preserveIds` 生效。用户显式安装或更新 RD Guide 时：

- 仍准备目标及其依赖闭包；缓存缺失时访问固定远程来源。
- 只过滤无关 orphan，不跳过目标自身的远程准备。
- 任何认证、网络、404 或清单校验错误都在 Application Service 写入前返回。

### D5. 不自动迁移旧独立 Plugin 到聚合 Plugin

当前聚合包未证明覆盖全部历史技能，强制替换会产生内容丢失风险。本任务仅保证旧声明离线冻结可用；后续只有在技能等价映射和内容校验具备后，才能单独设计迁移。

## 3. 数据流

```text
plugins.json + plugin-lock.json
        |
        v
按当前声明计算 reachable / orphan
        |
        +--> 核心升级：reachable external -> preserveIds -> 本地冻结重放
        |                                      |
        |                                      v
        |                               不访问 GitLab/凭据/缓存
        |
        +--> 显式远程命令：只准备 reachable lock + 当前目标闭包
        |
        +--> orphan：进入既有 Resolver/Lifecycle 删除投影
                                               |
                                               v
                              缺失路径幂等收敛；漂移路径安全阻断
```

## 4. 影响范围

- `src/plugin/contracts.js`、`src/plugin/schemas/project-files.js`：GitLab lock 来源字段与安全 schema。
- `src/plugin/sources/gitlab-provider.js`：候选来源快照、历史路径选择和锁定索引读取。
- `src/plugin/resolver/` 或相邻共享模块：声明驱动的 lock 可达性计算。
- `src/commands/plugin.js`、`src/commands/plugin-remote.js`：把当前声明和可达 ID 传入远程注册/准备。
- `src/commands/update.js`：仅冻结可达外部节点。
- `src/plugin/application-service.js`：缺失旧目标的幂等 removal 和一致性诊断复用。
- `test/js/plugin-*.test.js`：schema、GitLab provider、远程 CLI、Skill-Garden update、生命周期和交互回归。
- `.trellis/spec/flower-trellis/cli/`：同步最终可执行契约。

## 5. 兼容与失败语义

- lock schemaVersion 保持不变，`indexPath` 为向后兼容可选字段；新写入数据必须包含该字段。
- 旧 lock 不因字段缺失直接失败，只有兼容映射后的固定路径确实不存在时返回来源错误。
- 核心升级允许外部来源完全不可用，但不允许本地内容漂移、ownership 冲突或结构损坏被静默覆盖。
- dry-run 与实际执行必须生成同样的可达性、孤立清理和冲突判断，实际执行前不得产生远程之外的项目写入。

## 6. 验证策略

- 单元测试：GitLab `indexPath` schema、候选写入、旧/新 RD Guide 路径选择、非法路径拒绝。
- Resolver/Service 测试：声明驱动可达性、孤立返回、缺失路径幂等收敛、摘要漂移零写入。
- CLI 测试：add/update 只准备可达历史节点；显式远程目标失败仍调用 Provider 并零写入。
- 核心升级测试：无来源配置、无凭据、fetch 强制失败时，活跃旧 RD Guide 被逐字节冻结；孤立元数据本地收敛。
- 交互测试：RD Guide 技能管理入口在旧状态存在时不因无关 orphan 提前 404。

## 7. 风险控制

- 历史映射必须限定到已确认的 RD Guide 来源和 Plugin ID 族，避免把任意 GitLab 仓库误判为旧格式。
- 可达性入口必须来自当前声明；若 lock 依赖缺失，保持明确诊断而不是把缺失依赖当 orphan 删除。
- 缺失路径幂等处理只放宽“已经不存在”的删除场景，不放宽存在文件/目录的摘要校验。
