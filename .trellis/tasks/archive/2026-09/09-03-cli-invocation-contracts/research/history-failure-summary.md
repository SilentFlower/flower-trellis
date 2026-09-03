# 历史调用失败摘要

## 覆盖范围

- 本机 Codex JSONL：2532 份。
- 本机 Claude JSONL：159 份。
- 识别到 Flower/Trellis 直接调用约 10047 次，其中 551 次返回非零。
- 本机未提供可用的 OpenCode 历史适配器，因此不包含 OpenCode 会话。

统计包含重复重试、正常安全护栏和预期空状态，不代表独立缺陷数量。

## 主要集中项

| 命令/签名 | 非零次数 | 会话分布 | 结论 |
|---|---:|---:|---|
| `untracked_flow.py` | 69 | 41 | 其中 63 次为 `active-task-present`，覆盖 38 个会话，是最广泛的状态探测错配 |
| `decision_log.py` | 39 | 30 | 多数为短任务名无法解析带日期目录 |
| `task_progress.py` | 18 | 13 | 多数为 `invalid-progress-schema`，尤其遗漏 `updatedAt` |
| `task.py current` 空状态 | 约 114 | 多会话 | 正常无任务被退出码 1 标为失败，属于表观失败 |
| `maven_verify.py` | 90 | 8 | 高频但集中，主要是正确护栏或真实构建失败，不是本任务重点 |
| `flower-trellis worktree` | 11 | 4 | 5 次与缺失 `--help` 有关，当前工作区已有修复 |
| `flower-trellis update` | 11 | 6 | 多为历史 `-y` 透传、升级重放或下游失败；当前仍缺命令级无副作用帮助 |
| `spec_router.py` | 8 / 732 | 7 | 调用者猜测 `--query`、`--paths` 等直觉参数，整体失败率低 |
| `get_context.py` | 6 / 3153 | 5 | 整体稳定 |

## 分类原则

- 保留：Maven workspace/plan/evidence 护栏、Plugin 鉴权与完整性校验、任务状态迁移校验。
- 优化：正常查询状态的非零退出码、同类 helper 不一致的任务解析、机械时间字段由调用者手写、帮助请求进入副作用流程。
- 已有基线：`worktree --help` 的根级和 `create` 引导已经在当前工作区实现，后续任务应集成而非重做。
