# 自动 GC 提交默认放行

## Goal

普通 `trellis-push` 遇到 SessionStart 自动产生的任务物理归档提交时，默认允许该提交随已确认的推送发布，免去针对该 GC 提交的额外许可。

## Background

- `trellis-push` 当前把无法归属本次任务的历史 ahead commit 作为停止条件（`.agents/skills/trellis-push/SKILL.md:97`、`:223`）。
- `task_lifecycle.py` 的 GC 只创建本地提交，不推送；固定消息为 `chore(task): gc closed tasks`（`.trellis/scripts/task_lifecycle.py:1898`）。
- 已发生的 `0c02fb7` 只将两份 closed 任务完整移动到对应月份的 `archive/`，共 15 个内容相同的重命名。

## Requirements

- R1：普通推送和任务记录发布恢复应识别可验证的自动 GC 历史提交，并将其视为已获默认许可的 ahead commit；正常业务提交计划仍遵循原有确认流程。
- R2：识别必须逐个提交核验单父、固定消息、任务目录到关闭月份归档目录的完整文件映射、内容不变，以及归档 `task.json` 的 completed/closed 状态；同一提交可移动多份任务，也可删除与已有归档完全相同的顶层副本。
- R3：计划和结果应清楚列出随推送携带的已验证 GC 提交；不能把它计作本次业务 planned files 或任务记录提交。
- R4：只有消息相同但带有其它文件变更、未关闭任务、路径不匹配、内容变化或证据缺失的提交，继续按未知 ahead 阻断；普通 retained dirty、分支/upstream 和 Git 集成态规则保持现有语义。
- R5：规则应从 Skill-Garden 托管源同步到发布快照与本项目已部署的 Codex/Claude skill，并与相关规范一致。

## Acceptance Criteria

- [ ] `0c02fb7` 这样的纯归档 GC 提交可通过审计，并在普通推送计划中作为默认允许的历史提交展示，不再单独要求许可。
- [ ] 单次移动多任务和内容相同的归档去重均能按相同证据规则判断。
- [ ] 伪造相同消息但修改业务文件、改写任务内容、归档到错误月份或任务未关闭时，不会获得默认许可。
- [ ] 任务记录 push-only 恢复遇到已验证 GC ahead 时可继续；其它未知 ahead 仍阻断。
- [ ] Skill-Garden 源、`enhancements/0.6/` 快照、项目运行 skill 与规范一致，并通过相应同步及检查。

## Non-Goals

- 不改变 GC 的创建、移动、恢复或提交算法，也不让 Push 主动触发物理 GC。
- 不为其它自动提交建立通用白名单，不跳过业务提交计划的一次确认。
- GC 同时携带任务内容改写时暂不默认放行；即使该改写来自 runner，也需另行核验其来源。
