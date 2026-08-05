# 实现 Trellis 项目级关闭与恢复

## Goal

为已经安装 Trellis/Flower 的项目提供项目级总开关，使用户可以一次关闭全部 AI 平台中的 Trellis 集成，并在需要时完整恢复。关闭后，新启动的 AI 会话不应加载 Trellis 指令、Skills、Agents、Commands、Workflows 或 Hooks；历史任务、规范、日志和 Plugin 所有权证据必须保留。

## Background

- 当前 `no-trellis` 只跳过单轮 `<workflow-state>` 注入，`TRELLIS_DISABLE_HOOKS=1` 只关闭 Hook；两者都不会移除 `AGENTS.md` 管理块或项目 Skills，因此不属于真正关闭。
- Trellis 通过 `.trellis/.template-hashes.json` 记录原生模板路径，通过 `.flower/state.json` 记录 Flower/Skill-Garden 投影路径和所有权。
- 当前项目的配置平台由 Trellis `getConfiguredPlatforms()` 从模板哈希推导；Flower Plugin lifecycle 已有统一 preflight、事务写入和回滚机制。
- 上游 `trellis update` 不读取 Flower 项目状态，无法识别新增的 disabled 标记。

## Requirements

### R1. Project-Level CLI

- 提供 `flower-trellis trellis disable`、`flower-trellis trellis enable` 和 `flower-trellis trellis status`，并继续支持 `ft` / `ftl` 别名。
- 开关作用于整个项目和全部已配置平台，不提供面向用户的平台级关闭参数。
- mutating 命令支持只读预演；参数错误、冲突和执行失败沿用现有 CLI 退出码约定。

### R2. True Disable

- `disable` 必须在一次事务中移除或中和所有 AI 可发现的 Trellis 集成入口，包括：
  - `AGENTS.md` 中 `<!-- TRELLIS:START -->` 到 `<!-- TRELLIS:END -->` 的管理块；
  - Trellis/Flower 安装的 Skills、Agents、Commands、Prompts、Workflows、Hooks、Extensions 和平台配置入口；
  - Flower SessionStart 更新提示入口。
- 关闭后的新 AI 会话不得收到 Trellis SessionStart、workflow-state 或 sub-agent context，也不得在项目 Skill/Agent/Command 列表中发现 Trellis 条目。
- `.trellis/tasks/`、`.trellis/spec/`、`.trellis/workspace/`、当前任务指针、Plugin declarations/lock/state 和其它历史数据不得删除。
- 当前已经启动的 AI 会话不承诺卸载已加载上下文；命令必须明确提示用户重启 AI 会话。

### R3. Ownership And Conflict Safety

- 目标集合必须来自 Trellis 模板哈希、当前配置平台模板集合和 Flower Plugin state，不能用目录名称猜测所有权。
- 独占且 hash-clean 的受管文件可以自动 detach；共享文件必须只移除 Trellis 管理片段并保留无关用户内容。
- 任何无法安全拆分的用户修改目标必须在写盘前报告冲突，默认零写入。
- 显式强制路径必须先保存完整恢复材料，且不得静默丢弃用户内容。
- 软链、特殊文件、非法相对路径或项目外逃逸必须 fail closed。

### R4. Durable Recovery

- 关闭事务必须在 `.flower/` 的本机私有区域保存 schema 化 manifest、原始字节、文件 mode、原路径、owner、关闭前后 hash 和共享配置片段。
- `enable` 必须先校验全部恢复目标，再原子恢复关闭前现场；不能出现部分平台恢复。
- 恢复独占文件时保留关闭前用户字节；恢复共享文件时结构化合并 Trellis 片段，保留关闭期间新增的无关配置。
- 精确恢复后运行当前版本的 Trellis update 和 Flower Plugin replay，使旧快照升级到当前安装版本。
- 任一步失败时回滚为完整 disabled 状态，保留诊断和修复证据；只有全链成功后才能标记 enabled。
- 恢复完成后提示重启 AI 会话；原有 active task 和运行数据继续可用。

### R5. Disabled-State Persistence

- `flower-trellis update`、`self-update` 的项目更新链和 Flower Plugin add/update/replay 在项目 disabled 时不得把 Trellis 入口留在可发现位置。
- 用户直接执行不经过 Flower 的上游 `trellis update` 视为显式绕过；它可能重建 Trellis 入口，`status` 必须报告 `drifted`，但本功能不通过移动整个 `.trellis/` 来拦截该命令。
- disabled 状态必须能检测入口漂移并由 `status` 报告，不能把“状态文件写着 disabled”误报为真正关闭。
- 关闭期间的版本升级不得丢失恢复能力；恢复应先回到关闭前现场，再通过当前 update/plugin lifecycle 规范化。

### R6. Idempotency And Observability

- 重复 disable、enable 和 status 必须幂等。
- `status` 至少区分 enabled、disabled、drifted、conflict/repair-required，并展示恢复材料位置和需要重启的信息。
- disable/enable dry-run 必须返回与真实执行相同的目标、冲突和预期变化，但零写入。

## Acceptance Criteria

- [ ] AC1: 在同时配置 Claude 和 Codex 的标准项目上执行一次 disable 后，所有平台 Trellis 入口均不可发现，`.trellis` 用户数据和 `.flower` 声明/锁/state 保持完整。
- [ ] AC2: `AGENTS.md` 的 Trellis 管理块被移除，管理块外的项目规则逐字节保留。
- [ ] AC3: 带无关用户配置的共享 JSON 设置文件关闭后仍保留这些配置，恢复后 Trellis 配置与用户配置同时存在。
- [ ] AC4: 修改过且无法安全拆分的受管文件使 disable 在 preflight 阶段失败，项目零写入并输出稳定冲突诊断。
- [ ] AC5: enable 在无冲突场景完整恢复全部平台，随后通过当前 Trellis/Flower 版本规范化；原 active task 不丢失。
- [ ] AC6: enable 任意中途故障会回滚到完整 disabled 状态，不产生部分恢复。
- [ ] AC7: Flower update、self-update 项目更新和 Plugin lifecycle 在 disabled 项目上运行后仍保持不可发现状态。
- [ ] AC8: status 能识别手工重建某个入口后的 drifted 状态，而不是只读取标志文件。
- [ ] AC9: dry-run、重复 disable、重复 enable、软链/路径逃逸、损坏 manifest 和恢复冲突均有自动化覆盖。
- [ ] AC10: 完整测试、语法检查、快照一致性、compiled targets 和隔离项目 dogfood 全部通过。

## Out Of Scope

- 不尝试从已经运行的 AI 会话中删除已加载的系统上下文；真正关闭从重启后的新会话开始。
- 不删除 Trellis 用户数据，不等同于 `trellis uninstall`。
- 不提供单个平台开关或不同平台混合 enabled/disabled 状态。
- 不停止已经运行的 auto-loop、channel worker 或其它外部进程。
- 不保证直接运行上游 `trellis update` 后仍维持关闭；该行为由 `status` 作为漂移报告。
