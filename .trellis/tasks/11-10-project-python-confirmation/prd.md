# 将自动确认运行时迁移为项目内 Python

## Goal

让完成 Flower 初始化或更新的项目通过随项目部署的 Python 独立运行自动确认，消除确认阶段对 Flower CLI 和 Node 的依赖。

## Background

- 用户看到 `flower-trellis confirm result` 使用全局安装路径后，要求改为随项目部署的 Python。
- 用户进一步明确原实现无需保留；本轮采用替换迁移。
- 普通项目当前从 PATH 查找 Flower，依据为 `src/assets/flower_confirmation_hook.py:17`。
- 确认命令编排位于 `src/commands/confirm.js:42`，状态存储和等待位于 `src/lib/codex-confirmation.js:75`，正式协议编排位于 `src/lib/confirmation-runtime.js:20`。
- 现有策略和前台身份核验分别位于 `vendor/skill-garden/.trellis/0.6/scripts/confirmation_policy.py:232`、`src/assets/flower_tui_lifetime.py:112`。

## Requirements

- R1 项目自包含：确认入口及依赖随 init/update 安装，随项目共享。运行时使用 Python 标准库及项目已有脚本。运行确认阶段无需 Node、npm、Flower CLI 或额外 pip 安装。
- R2 完整替换：项目内入口覆盖 prepare、wait、claim、result、status、cancel 和原生 Hook。删除 `flower-trellis confirm`、其帮助和旧 Node 确认实现；移除旧入口调用。
- R3 协议等价：保留 Brief、Check-All、Push 的默认时长、配置开关、冻结材料和 Git 快照、完整展示后计时、单次领取、started 门禁及终态记账。
- R4 原生平台等价：保留 Codex 的精确会话、原生队列、输入 Hook、窗口出生身份与 pidfd 核验；保留 Claude 的原生后台任务绑定、transcript 来源和 runId 核验。
- R5 失效边界：人工输入、中断、窗口退出、材料或策略漂移、断连、投递结果未知、重复请求与卸载竞争继续遵守现有取消和人工路径。旧请求通过升级失效；已开始动作继续据实记账。
- R6 生命周期一致：安装、重复更新、项目关闭、卸载、确认协议说明、唤醒消息及三个 owner 同步采用 Python 路径。用户配置和用户 Hook 沿用现有保留规则。
- R7 兼容基线：脚本保持 Python 3.8+ 可加载。自动确认沿用 Linux/WSL 与既有能力条件。采用现有安装器的目标 Python 命令规则。

## Acceptance Criteria

- [x] AC1 对应 R1/R2：隔离业务项目的 PATH 缺少 Node、npm 和 Flower 时，实际执行项目 Python 命令与 Hook；受控原生宿主下完成两端确认链路。
- [x] AC2 对应 R2：真实 Flower CLI 的帮助和分发清单移除 confirm；旧 Node 确认模块及现行调用引用完成清理。
- [x] AC3 对应 R3：三类材料、默认与覆盖策略、完整展示起点、领取与 started 单次性、终态记账均通过行为回归。
- [x] AC4 对应 R4/R5：两端消息来源、人工粘贴伪通知、错会话、输入竞争、窗口退出及恢复、断连和未知投递均按原协议处理。
- [x] AC5 对应 R5/R6：安装与重复更新幂等；升级取消旧等待；关闭和卸载作废许可；后台进程遵守卸载后的目录生命周期；已 started 的记录按原协议终结。
- [x] AC6 对应 R6：保留用户 Hook 与 confirmation_timeout；作者源、compiled targets、发布快照和本地 Plugin 投影一致。
- [x] AC7 对应 R7：本地完整回归与原生验证通过；匹配交付提交的现有 Ubuntu/Windows × Python 3.8/3.12 CI 矩阵成功。平台能力条件的跳过单独记录。

## Out Of Scope

- 自动确认的操作系统支持范围扩展。
- 超时时长、默认动作和人工授权规则调整。
- Flower 安装器、Plugin 管理和其他命令的 Python 迁移。
- 执行中的旧等待向新实现的热迁移。

## Constraints

- 本任务属于确认机制自身开发，设置 `task.json.meta.confirmationTimeoutDisabled=true`，使用人工阶段确认。
- 项目当前的目录导览规划属于独立任务，保留其工作面。
