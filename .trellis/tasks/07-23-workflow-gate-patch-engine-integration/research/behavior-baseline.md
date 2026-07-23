# Workflow Gate 行为与上下文基线

## Context Budget

| 对象 | 迁移前 | 迁移后 | 变化 |
| --- | ---: | ---: | ---: |
| Hub source | 12,386 B / 163 行 | 2,307 B / 30 行 | -10,079 B / -133 行 |
| 最终 workflow | 52,844 B / 832 行 | 43,872 B / 702 行 | -8,972 B / -130 行 |
| workflow control | 19,497 B / 265 行 | 10,525 B / 135 行 | -8,972 B / -130 行 |
| Phase summary | 20,470 B / 300 行 | 11,498 B / 170 行 | -8,972 B / -130 行 |
| SessionStart | 19,878 B / 299 行 | 10,906 B / 169 行 | -8,972 B / -130 行 |
| control-context-total | 111,647 B | 84,731 B | -26,916 B |

迁移后 `node scripts/check-ai-context-budget.mjs --strict` 全部为 `ok`。

## Compatibility Scenarios

| 场景 | 输入 / 状态 | 权威 owner | 预期确认次数 | 预期结果 |
| --- | --- | --- | ---: | --- |
| 普通讨论或只读检查 | 无活动任务，明确 `discuss` / `inspect` | Request Triage | 0 | 静默进入讨论或检查，不创建任务 |
| 有界低风险直改 | 无活动任务，范围已知且可逆 | Request Triage + `no_task` state | 0 | 一次非阻塞状态提示后直改，不记录 task/progress |
| 明确复杂实现 | 无活动任务，复杂实现意图清晰 | Request Triage + `trellis-brainstorm` | 0 次机械建任务确认 | `task_intent.py create` 创建 planning task，只进入规划 |
| 规划激活 | planning artifacts 已收敛 | Phase 1.4 + `trellis-task-brief` | 1 | 展示完整 brief；下一条确认后 `task.py start` |
| brief 缺失或过期 | planning task | `task.py start` | 0 | 非零退出，状态、session pointer、hook 均不变 |
| active task 收到无关实现 | `in_progress` | active workflow state | 0 | 在 route/edit 前停止；新任务、更新 artifacts 或明确不跟踪三选一 |
| route 已有合法偏好 | `in_progress` + target 匹配 | `trellis-route` + `route_state.py` | 0 | 复用当前 task/target 决策 |
| route 无合法证据 | `in_progress` | `trellis-route` | 1 | 展示编号选项并等待，不自行默认模式 |
| 普通 Check-All | 非 auto-loop | Phase 2.2 + `trellis-check-all` | 0 | 输出 audit-only 报告后停止，不生成提交计划 |
| validated auto-loop Check-All | outstanding action 匹配 | `trellis-check-all` + `trellis-auto-loop` | 0 | 先 `record` 再 `next`，不触发交互停止 |
| Flower ask 更新 | `<flower-update>` blocking context | SessionStart update hook | 1 | 展示摘要和命令，确认前不执行 |
| Flower 更新完成 | `<flower-update-result>` | `self-update` payload + `trellis-push` | 1 个 push 计划确认 | 进入 `trellis-push`，不手写 Git 计划 |
| 普通代码提交 | Phase 3.4 | `trellis-push` | 1 | exact commit + push；计划外 dirty 保留 |
| auto-loop commit-only | run 已显式预授权且安全 | `trellis-auto-loop` + push internal | 0 次二次确认 | exact local commit，不 push、不写远端 progress |
| finish-work bookkeeping | 用户显式请求且 Phase 3.4 已完成 | `trellis-finish-work` | 0 | 只处理 archive/journal bookkeeping，不重提业务代码 |
| progress schema 非法 | `task_progress.py write` | `task_progress.py` | 0 | 结构化错误，`task.json` 不变 |
| progress 原子替换失败 | 合法 schema，`os.replace` 失败 | `task_progress.py` | 0 | 返回 `write-failed`，旧 `task.json` 与目录内容不变 |

## Dogfood

- 第一次 `update --enhance-only`：Patch 修改 6，新增 Project Knowledge owner，替换 Hub 与请求路由正文。
- 第二次相同命令：Patch 修改 0，证明 managed marker 原位升级与内容写入幂等。
