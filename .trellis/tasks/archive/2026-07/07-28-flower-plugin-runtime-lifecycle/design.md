# Flower Plugin Runtime、依赖解析与生命周期 CLI 技术设计

## 1. 模块边界

```text
plugin command parser
        |
application-service
   |       |       |
source   resolver  project-store(P1)
registry    |
        resolved graph
              |
 platform detector + content projector
              |
         install planner
              |
      transaction writer
```

application service 是唯一用例入口。CLI 不直接读写 store，Provider 不写项目文件，Resolver 不访问目标文件系统，Planner 不执行 mutation。

## 2. 建议文件布局

```text
src/plugin/
├── application-service.js
├── resolver/
│   ├── dependency-resolver.js
│   └── lock-builder.js
├── sources/
│   ├── source-registry.js
│   ├── builtin-provider.js
│   └── local-provider.js
└── install/
    ├── platform-detector.js
    ├── content-projector.js
    ├── install-planner.js
    └── transaction-writer.js
src/commands/plugin.js
```

`src/cli.js` 只增加 `plugin` 分支；Plugin 多级参数解析放在 `src/commands/plugin.js` 或其专用 parser，不扩大现有 `parseCliArgs()` 的职责。

## 3. Resolver

- Provider 先返回按 canonical ID 分组的 `PluginCandidate[]`。
- Resolver 对直接约束和递归依赖执行稳定回溯求解，候选版本按 SemVer 降序、commit 和 source ID 作为稳定次序。
- 已锁定候选在仍满足全部约束且未显式 update 时排在第一位。
- 每次选择记录约束来源，失败时生成可诊断冲突集合。
- 求解完成后执行循环检测并生成稳定拓扑；依赖先于依赖者。
- Lock Builder 只消费 resolved graph，不重新访问 Provider。

首期规模以项目级 Plugin 数量为主，不引入通用 SAT 框架；实现必须将候选排序和回溯边界隔离，后续可替换求解器而不改变 DTO。

## 4. 平台投影

从 `ENHANCEMENT_SKILL_TARGETS` 提取通用 descriptor registry，保留现有增强链所需字段并增加明确 platform ID。检测输出分为逻辑平台与物理 root，物理 root 用于去重。

投影规则：

1. `--platform` 存在时验证全部平台 ID。
2. 否则检测已存在的原生 root。
3. 无结果时返回 `PLATFORM_SELECTION_REQUIRED`。
4. canonical 内容生成每个唯一物理 root 的 mutation。
5. platform override 在单文件层覆盖 canonical 输入，不改变包摘要。

## 5. InstallPlan 与冲突

Planner 输入为 resolved graph、下载/内置包路径、平台选择和当前 state，输出 P1 `InstallPlan`：

- `mutations[]` 稳定按目标路径排序，但执行依赖使用显式 operation order。
- 每个 mutation 包含 owner、source、target、beforeHash、afterHash、kind 和 staged content reference。
- 同 target 不同 owner/内容、文件目录前缀冲突、逃逸路径和未管理现有文件均为 error。
- 相同 target、相同内容且物理 root 共享时合并为一项，并保留全部逻辑平台 provenance。

P4 后续通过 `patchMutations` 扩展同一计划，不建立第二套 writer。

## 6. Transaction Writer

事务目录只保存当前项目本机恢复信息。流程：

1. 创建 transaction ID 和 manifest。
2. 再次读取所有目标并核对 before hash。
3. 将 changed 目标原字节备份到事务目录，新内容写入 staging。
4. 按稳定顺序替换目标；记录已完成 operation。
5. 写可提交的 `plugins.json`、`plugin-lock.json`。
6. 最后写 `state.json`。
7. 成功后清理事务目录；失败则逆序恢复。

删除同样先备份；目录只在确认为当前 Plugin 创建且变空时清理。恢复失败保留事务证据并返回 blocker。

## 7. CLI 输出

- 交互输出展示来源、版本、依赖变化、目标路径和操作摘要。
- `--json` 固定包含 `ok`、`command`、`changes`、`diagnostics` 和必要结果，不输出彩色文本。
- 错误使用 P1 稳定错误码；进程退出码区分成功、用法错误、验证/冲突和执行失败。
- `verify` 只读，不触发 Provider 更新或版本重新解析。

## 8. 兼容与回滚

- P2 新命令在 P5 接管 init/update 前与现有增强链并存。
- 出现问题可移除 `plugin` CLI 分支和新 application service，不影响现有命令。
- P2 不写旧 manifest，P5 接入前不存在双写成功来源。
