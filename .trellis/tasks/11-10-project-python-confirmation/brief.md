# Brief — 将自动确认迁移为项目内 Python

## Goal

- 项目初始化或更新后，通过随项目部署的 Python 独立运行自动确认。

## Scope

- 迁移完整确认运行时及 Codex、Claude 原生接入。
- 删除旧 `flower-trellis confirm` 命令与 Node 确认实现。
- 同步 Hook、工作流说明、安装更新、项目关闭、卸载和测试。

## Non-Goals

- 操作系统支持范围扩展、确认规则调整、其他 Flower 命令迁移。

## Technical Overview

- 统一入口为 `.trellis/scripts/flower_confirmation.py`。复用现有 Python 策略和前台身份校验，迁移状态机、原生客户端与本机传输；完整展示后计时，领取及 started 校验后进入原流程。

## Context & Decisions

- 按你的决定采用完整替换，清理旧入口及调用。
- 确认运行时使用 Python 标准库和项目脚本。安装器沿用现有 Flower 体系。
- 保留默认时长、配置、消息来源核验、单次执行和记账。升级使旧等待失效。

## Risks

- Codex 传输和并发状态迁移需行为回归与真实原生验证。
- 自动路径沿用 Linux/WSL 能力条件，脚本保持 Python 3.8+ 基线。

## Acceptance

- 隔离 Node、npm、Flower 后，项目 Python 命令与 Hook 完成两端确认链路。
- 重复领取、人工输入、窗口退出、材料变化、信号和卸载竞争覆盖通过。
- 安装更新幂等，用户配置及 Hook 保留，源码、快照、投影一致。
- 本地完整回归、两端原生验证及交付提交对应的跨平台 CI 通过。

## Next Step

- 确认后启动任务，先建立迁移行为测试与 Python 状态核心。
