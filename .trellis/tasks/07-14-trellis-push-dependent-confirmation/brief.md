# Brief — 优化 Trellis Push 依赖型多仓单次确认

## Goal

- 让包含本地生成命令的普通多仓计划只确认一次，不为此新增独立流程或状态模型。

## Scope

- 首次计划用一行展示生成命令、工作目录和后续仓预计 exact files。
- 前置仓成功后执行已展示命令，并复用现有提交前预检。
- 命令成功且没有新增预计列表外的 dirty path 时继续；否则重新规划并确认。
- 修改 0.6 双平台 `trellis-push`，同步快照、dogfood 与项目规范。

## Non-Goals

- 不新增独立中间步骤章节、验证协议、文件状态、脚本或 runtime state。
- 不重复描述现有 branch、upstream、ahead、conflict、staged 等 Git 守卫。
- 不扩展 commit-only、auto-loop、progress、finish-work 或 release。

## Key Context

- 普通多仓本来就是一次计划、一次确认；这里只允许计划中夹带一个确定性的本地生成命令。
- `skill-garden -> npm run sync -> flower-trellis` 是首个场景，但规则保持通用。
- 内容、hash 和统计变化不重问；计划外路径或现有计划边界变化才重问。

## Acceptance

- 用户只看到一条简短生成说明，不出现额外验证清单。
- 生成后 dirty paths 未超出预计 exact files 时自动继续。
- 新路径或现有 Git 计划边界变化时重新确认。
- 普通多仓和其它 Trellis 流程无回归。

## Next Step

- 按当前 `inline implement` 路由精简 0.6 源，重新同步并执行 Check-All。
