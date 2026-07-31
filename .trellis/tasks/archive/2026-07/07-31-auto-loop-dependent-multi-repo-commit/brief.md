# Brief — Auto-Loop 依赖型多仓提交支持

## Goal

- 以最小改动让 Auto-Loop 自动完成有依赖顺序的多仓本地提交和中间确定性生成，例如 `Skill Garden commit -> npm run sync -> Flower commit`，并在安全条件下自行恢复和重试。

## Scope

- 不新建提交步骤状态机，复用 `trellis-push` 已有的多仓发现、顺序提交、本地生成、生成后重新预检和部分成功不回滚能力。
- 更新 `trellis-auto-loop` Skill，使内部 `commit_only` 不再仅因多个仓库、submodule pin 或证据充分的生成命令返回 `multi-repo-commit-boundary`。
- 更新 `trellis-push` Skill，使 auto-loop 内部 commit-only 复用普通多仓执行路径，但不再次确认、不 push、不执行 finish/archive。
- 动态执行链支持任意数量的仓库和生成步骤，不硬编码 Skill Garden、Flower 或 `npm run sync`。
- 允许根据任务 artifacts、项目 SOP/spec、受版本控制脚本、明确输入输出关系和可验证 Git/submodule 关系进行受约束自动推断。
- 生成命令必须是本地、确定性、可重复、受版本控制且无外部副作用的既有入口。
- retained dirty 可以存在；执行前后必须保持摘要不变，且不能与 generated/planned paths 冲突。
- 失败恢复时从真实 Git 状态重新规划：验证并跳过已经完成的 commit，安全重跑确定性生成，后续文件 clean 时跳过空 commit。
- runner 只为现有 `record` 增加可重复 `--repo-commit <repository>::<hash>`，保存 `commits[]`，继续保留兼容主字段 `commit`。
- `commit-repairable` 使用与现有 fix/recheck 一致的三轮修复预算：前三次失败重新发出同一个 `commit_only`，第 4 次失败 blocked。
- 更新 status、resume、decision summary 和 task progress 的多 commit 展示，并补齐 Python、JS 和临时双仓 fixture 测试。
- 修改 Skill Garden canonical 后同步 `enhancements/0.6` 和当前 dogfood runner/Skills。

## Non-Goals

- 不增加 `commit-plan`、`commit-step`、新的 record result、通用 workflow DSL 或 runner Git/命令执行器。
- 不执行 push、merge、release、deploy、finish-work、archive、网络写入、凭证操作或生产数据修改。
- 不自动 reset、rebase、revert、amend，也不撤销已经成功的本地 commit。
- 不允许没有可审计证据的依赖猜测、任意 shell 字符串、管道、重定向或命令替换。
- 不保证证据不足的任意第三方仓库都能自动发现生成关系；这类情况仍安全 blocked。

## Key Context

- 当前 runner 已支持 outstanding `commit_only` 跨 resume、跨仓 exact files/retained files、主 commit 和结果摘要。
- 当前 `trellis-push` 已支持普通多仓生成链、计划外 dirty 阻断和部分成功不回滚；真正缺口主要是 auto-loop 内部 commit-only 的单仓措辞。
- SLS 原 run `auto-20260730175312` 已在不修改 runner 的情况下成功完成 `321bcc1 -> npm run sync -> b8c611f -> record + next`，证明无需新建步骤状态机。
- runner 的最小新增状态只有可选 `commits[]` 与 `attempts.commit_repair`；不提升 schema version，旧单仓调用保持兼容。
- 安全自修复只适用于确定性生成未收敛或可重新规划的本地预检。计划外 dirty、retained 漂移、未知 staged、无法由当前计划或已记录提交解释的分支/HEAD 漂移、归属歧义和外部副作用风险立即 blocked。
- `snapshot_commit` 保持原语义，不用于承载第二仓 commit。
- 当前工作区还保留遥测/SLS 的 post-auto-loop `task.json`，以及本任务规划文件；实现和提交必须精确保留这些无关 dirty。
- canonical 所有权在 `vendor/skill-garden/.trellis/0.6/scripts/auto_loop.py`、`.agents/skills/trellis-auto-loop/SKILL.md` 和 `.agents/skills/trellis-push/SKILL.md`；生成副本和 dogfood 副本必须通过同步链保持一致。

## Acceptance

- [ ] Auto-Loop 可无人干预完成 SLS 形态的多仓链，不再因 `multi-repo-commit-boundary` blocked。
- [ ] 同一机制支持任意数量的仓库和本地生成步骤，不依赖具体仓库或命令名称。
- [ ] 证据充分时可受约束自动推断执行链；证据不足或存在外部副作用时 blocked。
- [ ] retained dirty 不冲突且摘要不变时允许继续；计划外 dirty、retained 漂移、未知 staged 或分支漂移会阻断后续副作用。
- [ ] 前置 commit 成功后不会被撤销或重复创建；恢复时验证并跳过已完成步骤。
- [ ] repairable commit-only 最多执行三轮自动修复，第 4 次失败 blocked，预算和 commits 可跨 resume 保留。
- [ ] runtime、status 和 task progress 记录全部仓库 commit，同时保留兼容主 `commit`。
- [ ] 单仓 commit-only、旧 runtime 和现有 `record --commit` 调用保持兼容。
- [ ] 不新增 `commit-plan` / `commit-step`，不执行 push、发布、部署、归档或其它外部写操作。
- [ ] Python runner、JS 静态契约、临时双仓 fixture、完整 `npm test` 和分发一致性检查全部通过。

## Next Step

- runner、两个 Skill 协议、测试及 canonical/snapshot/dogfood 同步已经完成；首次 full Check-All 已通过，随后按用户反馈澄清 progress owner、证据冲突和已完成 commit 的 HEAD 漂移语义。
- follow-up edit 已完成定向验证；full Check-All 发现的仓库不可读未结构化失败、兼容主 `commit` 可与 `commits[]` 不一致两个 runner 校验问题均已修复并补充回归测试。
- 修复后的 full Check-All、完整测试、分发一致性和 dogfood 幂等检查全部通过。
- 下一步进入 `trellis-update-spec`，最小更新 Auto-Loop commit-only 的稳定契约。
- Spec 更新为 `no-op|written` 后进入 `trellis-push`，按多仓顺序生成精确本地提交计划；不自动 push 或归档。
