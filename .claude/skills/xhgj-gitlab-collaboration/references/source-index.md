# 来源索引

本文件只登记 locator。执行前读取命中的当前正文；不要用本索引替代正文，不要从历史快照推断现行规则。

## 当前有效面

| 场景 | canonical locator | 最小读取范围 |
| --- | --- | --- |
| GitLab 协作模型、身份、权限、分支、commit、MR、故障分流 | `docs/playbooks/gitlab-collaboration-onboarding.md` | §2、§3、§4、§5、§9 |
| GitLab Issue 最小清单、角色、载体分工、关系、变更、提醒与 Agent 写入边界 | `docs/playbooks/gitlab-issue-collaboration.md` | §1、§2、§3、§4、§5、§8 |
| Note 类型、Discussion Reply、checkpoint 与上下文装配 | `docs/standards/note-contract.md` | §1、§2、§3、§4 |
| 工作站安装、认证边界和就绪检查 | `docs/playbooks/gitlab-workstation-setup.md` | §3、§4、§5、§6 |
| 并行工作面与一目录一分支 | `docs/playbooks/multi-session-workflow.md` | 命中当前任务的工作面和交接章节 |
| 工时链路、授权、防重复和估算 | `docs/standards/work-hour-recording.md` | §2、§3、§5 |
| 收口触发与 `worktime_check` | `docs/architecture/session-closure-behavior-baseline.md` | §2、§3、§4 |
| Checkpoint 字段 | `docs/templates/checkpoint-template.md` | 条件式工时核查、交接与收口 |
| Skill 范围、工作站矩阵和状态 | `rd-guide #6` | description 当前面与最新实施锚点 |
| 工时执行接口边界 | `rd-guide #6 note 18234` | 执行契约来源；写入实测证据见 `rd-guide #6 note 20382` |

## 过渡期与历史证据

| locator | 使用边界 |
| --- | --- |
| `ticket-ops docs/16` 与 `docs/06` 迁移冻结版本 | 仅作 `ticket-ops-gitlab-issue-collaboration` 的历史审计与回滚准备；不得用于新的通用执行或决策，不得进入默认执行路径 |
| `sources/README.md` | 只读取审计分类、冲突清单和消费指引 |
| `sources/git-guide-historical.md` | 只作为安装、工作区、撤销、标签、`.gitignore`、remote、分支、stash 的 coverage seed |
| `sources/gitlab-usage-spec-historical.md` | 只作为受保护分支、错分支 commit、MR 字段和 commit message 的场景证据 |

历史分支模型、开发者自行合并、旧 TAG 集合和 destructive 救援命令不得直接执行。历史证据与当前正文冲突时，以当前 canonical 为准；canonical 不可达时停止。
