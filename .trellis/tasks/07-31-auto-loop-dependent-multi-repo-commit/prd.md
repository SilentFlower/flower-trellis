# Auto-Loop 依赖型多仓提交支持

## Goal

以最小改动让 `trellis-auto-loop --profile commit-only` 自动完成有依赖顺序的多仓本地提交和中间生成步骤，例如 `Skill Garden commit -> npm run sync -> Flower commit`，并在安全可恢复时自行重新规划和重试。

## Background

- `trellis-push` 已经具备多仓顺序提交、本地确定性生成、生成后重新预检、计划外 dirty 阻断和部分成功不回滚能力。
- 当前 Auto-Loop runner 已能保持同一个 `commit_only` outstanding action 跨 `resume`，并能记录跨仓 exact files、retained files、主 commit 和结果摘要。
- SLS 任务曾因 `multi-repo-commit-boundary` 被 blocked，但没有修改 runner 的情况下，原 run 已成功完成 `321bcc1 Skill Garden commit -> npm run sync -> b8c611f Flower commit`，随后通过 `record + next` 正常结束。
- 这证明主要缺口不是新的提交状态机，而是 `trellis-auto-loop` 与 `trellis-push` 的内部 commit-only 协议仍按单仓单 commit 描述；runner 还缺少多个 commit 的结构化记录和有限重试预算。
- 用户允许 Auto-Loop 根据受版本控制的仓库脚本和明确的 Git、输入输出关系进行受约束自动推断，但不允许任意命令或外部副作用。

## Requirements

- Auto-Loop 收到 `commit_only` 后，必须允许 `trellis-push` 使用现有多仓执行路径，不得仅因计划包含多个仓库、submodule pin 或本地生成命令而 blocked。
- 执行链不得硬编码 Skill Garden、Flower、两仓三阶段或 `npm run sync`；应能动态组织任意数量的本地 `commit` 和 `generate` 操作。
- 动态执行链由 `trellis-push` 根据以下证据生成，优先级从高到低：当前任务 `design.md` / `implement.md`、项目 SOP/spec、受版本控制的 `package.json` / Makefile / 仓库脚本及其明确输入输出关系、可验证的 submodule 父子关系。
- 允许受约束推断，但证据必须能说明命令入口、工作目录、依赖顺序和预期影响路径；只有命令名相似、文件时间戳或 AI 猜测不足以执行。
- 生成命令必须是本地、确定性、可重复、受版本控制且无外部副作用的既有入口；禁止 push、发布、部署、归档、网络写入、凭证操作和生产数据修改。
- 多仓生成流程可以存在 retained dirty；只要 retained exact paths 在步骤前后摘要不变、与 planned/generated paths 不冲突，就不得因此 blocked。
- 每个 commit 或 generate 操作前后都必须重新检查分支、未完成 Git 集成、staged、全部 dirty paths 和 retained 摘要。出现计划外路径、retained 漂移或归属歧义时，在后续副作用前停止。
- 已完成的前置 commit 必须保留，不自动 reset、rebase、revert、amend 或改写历史。恢复时应从真实 Git 状态重新规划，验证 hash、message 和文件集合后跳过已完成 commit。
- 确定性生成命令失败、生成结果尚未收敛或后续提交前的可恢复预检失败时，Auto-Loop 应在同一个 `commit_only` action 内最多执行三轮自动修复；生成后最终无变化的提交步骤可以自动跳过。
- 不新增 `commit-plan`、`commit-step` 等公开命令，不增加通用 workflow DSL，也不让 runner 执行 Git 或生成命令。
- 现有 `record` 仅增加可选的多仓 commit 记录参数；runtime 保存 `commits[]` 和 `attempts.commit_repair`，现有 `commit` 继续作为主仓/最后提交的兼容字段。
- repairable commit-only 失败必须保留已记录 commits，并重新发出同一个 action；第 4 次失败或出现安全边界问题时进入 blocked，摘要包含已完成 commits、失败位置和精确恢复入口。
- 单仓 commit-only、旧 runtime 和现有 `record --commit` 调用保持兼容，不要求迁移或 schema version 提升。
- `status`、`resume`、decision summary 和 task progress 应能展示多个仓库短 hash；默认输出保持紧凑，verbose 才展示完整列表。
- canonical 修改继续以 `vendor/skill-garden/.trellis/0.6` 为源，再同步 `enhancements/0.6` 和当前 dogfood 副本。

## Out Of Scope

- 自动 push、merge、release、deploy、finish-work 或 archive。
- 新建通用提交计划 DSL、步骤执行器或 shell 命令运行器。
- 自动回滚已经创建的本地 commit 或重写 Git 历史。
- 在没有可审计证据时猜测仓库依赖、生成命令或输出范围。
- 执行任意 shell 字符串、管道、重定向、命令替换或有外部副作用的命令。
- 保证任意第三方仓库都能自动发现生成关系；证据不足时仍应安全 blocked。

## Acceptance Criteria

- [ ] Auto-Loop 可无人干预完成 `skill-garden commit -> npm run sync -> flower-trellis commit`，不再返回 `multi-repo-commit-boundary`。
- [ ] 同一机制支持任意数量的仓库和本地确定性生成步骤，不依赖具体仓库或命令名称。
- [ ] 任务文档、项目规范或受版本控制脚本存在明确证据时可自动推断执行链；证据不足或存在外部副作用时 blocked。
- [ ] retained dirty 与生成路径不冲突且摘要不变时允许继续；计划外 dirty、retained 漂移、未知 staged 或分支漂移会阻断后续副作用。
- [ ] 前置 commit 成功后生成或后续预检失败时不撤销 commit；安全重试会识别并跳过已完成 commit。
- [ ] repairable commit-only 最多执行三轮自动修复，第 4 次失败进入 blocked；预算和已完成 commits 可跨 `resume` 保留。
- [ ] 最终 runtime、status 和 task progress 记录全部仓库 commit；兼容 `commit` 指向主仓/最后提交。
- [ ] 单仓 commit-only、旧 schema runtime 和现有 CLI 调用保持兼容。
- [ ] 不新增 `commit-plan` / `commit-step` 命令，不执行 push、发布、部署、归档或其它外部写操作。
- [ ] Python runner 测试覆盖多 commit 成功、部分成功重试、预算耗尽、blocked 恢复和旧协议兼容；JS 静态契约覆盖 Auto-Loop/Push 双平台一致性。
- [ ] canonical、`.claude`、`enhancements/0.6` 和当前 dogfood 副本同步，完整 `npm test` 与分发检查通过。

## Notes

- 本任务仍涉及 Auto-Loop 状态、Git 安全边界和 Skill 分发，但实现边界已从“新建通用步骤状态机”收缩为“复用现有多仓执行语义，加少量结果记录和重试状态”。
