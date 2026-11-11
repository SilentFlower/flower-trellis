# Brief — 支持原生 Windows 后台超时确认

## Goal

- 让原生 Windows 上普通启动的 Codex 和 Claude 跑通后台超时确认。

## Scope

- 接入两端的 Windows Hook、原生唤醒和窗口退出检测。
- 在这台 Windows 主机分别验收两端；保留 Linux/WSL 回归。

## Non-Goals

- beta 发布暂缓。容量改造保留自己的交付记录；本任务沿用现有默认倒计时和确认权限。

## Technical Overview

- Claude 先验证真实 Hook、Windows 命令参数和后台任务通知。Codex 验证普通窗口的控制服务，再接入已在隔离环境握手成功的本地代理与窗口身份校验。

## Context & Decisions

- 以当前已验证的本地容量改造作为联调基线，分开记录 Windows 新增差异。

## Risks

- 隔离握手尚未覆盖普通 Codex 窗口的归属和队列。两端在能力或来源无法核验时保持人工确认。

## Acceptance

- 两端在真实 Windows 窗口通过完整展示、倒计时、原生唤醒及单次领取和 started。
- 新输入、退出、恢复、双开、伪造通知与重复领取的取消或拒绝行为通过验证；Windows Python 3.8/3.12 和 Linux/WSL 回归通过。

## Next Step

- 先记录容量工作区基线，在隔离 Windows 项目实测 Claude 的 Hook 与通知。
