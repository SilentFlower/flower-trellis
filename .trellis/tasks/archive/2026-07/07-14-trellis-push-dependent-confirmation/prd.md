# 优化 Trellis Push 依赖型多仓单次确认

## Goal

让普通 `trellis-push` 在多仓计划中包含确定性的本地生成命令时仍只确认一次，并把当前任务产物纳入同一次授权下的任务记录提交；只有出现计划外文件或其它计划边界变化时才重新确认。

## Background

- 普通静态多仓已经一次展示完整计划、一次确认。
- `skill-garden -> npm run sync -> flower-trellis` 的后续仓内容依赖前置仓新 commit，但命令和预计文件范围在首次计划时已经确定。
- 现有 Step 4 已负责重新检查 planned files 和 Git 安全边界，不需要另建依赖执行协议。
- 当前普通 push 会把活动任务的 `brief.md`、`prd.md`、`design.md`、`implement.md` 和 jsonl 等产物列为 retained dirty，却又计划执行独立 progress commit/push；这会让远端只出现 `task.json` 进度而缺少对应任务上下文。
- finish-work 的职责是 release audit、归档移动和 journal，不应成为当前任务规划产物首次入库的默认时机。

## Requirements

### R1. 简短展示生成命令

- 普通 `PUSH` 可以在仓库顺序中包含一个本地生成命令。
- 首次计划用一行展示命令、工作目录和后续仓预计 exact files。
- 尚未生成的内容和增删行显示“生成后计算”。

### R2. 复用现有预检

- 前置仓成功后执行已展示的命令，并重新运行现有 Step 4 预检。
- 命令成功且后续仓全部 dirty paths 都在已确认的预计 exact files 内时直接继续，不再次确认。
- 预计文件的内容、hash、统计变化或最终保持 clean 不构成计划扩大。

### R3. 重新确认边界

- 命令失败、出现预计列表外的新 dirty path，或现有 Step 4 判断其它计划边界变化时，停止并重新展示计划。
- 只有后续仓没有 retained dirty 时才使用该规则，避免判断生成命令是否改动计划外内容。

### R4. 当前任务记录纳入

- 普通模式存在活动任务时，当前任务目录中已存在且可归属的 dirty/untracked 任务产物必须从 retained 移入独立任务记录计划；预计由 helper 更新的 `task.json` 也属于该 exact set。
- 业务仓仍只提交业务 planned files；全部业务动作结束后，先写入 progress，再用独立 `chore(task): update <task-name> progress` 提交精确纳入当前任务产物和 `task.json`，随后 push。
- 首次计划必须展示任务记录 commit、文件数和 exact files 或同一 exact set 的分组摘要；总 commit/file 数必须包含任务记录提交，不能把这些文件同时显示为“保留未提交”。
- 其他任务目录、无法归属当前任务的文件和计划外 staged 文件仍保持 retained，不得顺带提交。
- finish-work 继续负责 release audit、archive 和 journal；它可以提交归档移动及当场生成的 `release.md`，但不能作为普通 push 排除当前任务规划产物的理由。

### R5. 兼容与同步

- 不新增独立 `Step 4.1`、validation 集合、状态类型、脚本、配置或持久化事务。
- 用户显式 `commit-only`、auto-loop、finish-work 和 release 行为不变；任务进度提交只扩展 exact files，不改变 progress schema。
- 修改 skill-garden 0.6 `.agents` / `.claude` 源，并同步 `enhancements/0.6` 和当前 dogfood。
- 同步更新 workflow hub 的任务记录/进度提交所有权摘要；不修改 0.5、old 或 Trellis npm 包内置文件。

## Acceptance Criteria

- [ ] AC1：生成命令部分只增加一行说明，不展示额外验证清单。
- [ ] AC2：生成后 dirty paths 未超出预计 exact files 时不二次确认。
- [ ] AC3：出现计划外文件或现有计划边界变化时重新确认。
- [ ] AC4：实现不新增独立步骤、状态、脚本或重复 Git 守卫。
- [ ] AC5：普通 push 的计划总数和 exact scope 包含当前任务产物与 `task.json`，这些文件不再同时出现在 retained dirty。
- [ ] AC6：任务记录提交只包含当前任务 exact files；其他任务和无关 dirty/staged 文件保持原状。
- [ ] AC7：0.6 源、快照和 dogfood 一致，0.5/old 无漂移。

## Out of Scope

- 数据库、部署、外部系统、凭证或生产写入命令。
- 多仓原子事务或自动回滚。
- 对 dirty 文件建立内容指纹或持久化确认计划。
