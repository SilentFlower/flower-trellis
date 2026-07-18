# Brief — 优化 Trellis Push 依赖型多仓单次确认

## Goal

- 让包含本地生成命令的普通多仓计划只确认一次，并把当前任务产物纳入同一次授权下的独立任务记录/progress 提交。

## Scope

- 首次计划用一行展示生成命令、工作目录和后续仓预计 exact files。
- 前置仓成功后执行已展示命令，并复用现有提交前预检。
- 命令成功且没有新增预计列表外的 dirty path 时继续；否则重新规划并确认。
- 当前任务 dirty/untracked 产物与预计更新的 `task.json` 组成任务记录 exact set，计划总数和文件摘要必须包含它们。
- 业务提交不混入任务产物；业务 push 后独立提交并推送当前任务记录，其他任务和无关 dirty/staged 保持原状。
- 修改 0.6 双平台 `trellis-push`，同步快照、dogfood 与项目规范。

## Non-Goals

- 不新增独立中间步骤章节、验证协议、文件状态、脚本或 runtime state。
- 不重复描述现有 branch、upstream、ahead、conflict、staged 等 Git 守卫。
- 不扩展 commit-only、auto-loop、finish-work 或 release；不改变 progress schema。
- 不把任务产物混入业务 commit，也不提交其他任务目录。

## Key Context

- 普通多仓本来就是一次计划、一次确认；这里只允许计划中夹带一个确定性的本地生成命令。
- `skill-garden -> npm run sync -> flower-trellis` 是首个场景，但规则保持通用。
- 内容、hash 和统计变化不重问；计划外路径或现有计划边界变化才重问。
- 当前任务 exact set 必须通过 `--untracked-files=all` 展开到文件级，不能把 `?? <task-dir>/` 折叠目录当成提交范围。
- finish-work 负责 release audit、归档移动和 journal，不是当前任务规划产物首次入库的默认时机。

## Acceptance

- 用户只看到一条简短生成说明，不出现额外验证清单。
- 生成后 dirty paths 未超出预计 exact files 时自动继续。
- 新路径或现有 Git 计划边界变化时重新确认。
- 当前任务产物不再同时显示为 retained，任务记录 commit 的 exact set、计划总数和最终提交保持一致。
- 全新未跟踪任务目录也能得到文件级 exact set。
- 其他任务和无关 dirty/staged 文件不会进入任务记录提交。
- 普通多仓和其它 Trellis 流程无回归。

## Next Step

- 按当前 `inline implement` 路由更新 0.6 push/workflow 源，重新同步并执行 Check-All。
