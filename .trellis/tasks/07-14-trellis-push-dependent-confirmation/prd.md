# 优化 Trellis Push 依赖型多仓单次确认

## Goal

让普通 `trellis-push` 在多仓计划中包含确定性的本地生成命令时仍只确认一次；生成后出现计划外文件才重新确认。

## Background

- 普通静态多仓已经一次展示完整计划、一次确认。
- `skill-garden -> npm run sync -> flower-trellis` 的后续仓内容依赖前置仓新 commit，但命令和预计文件范围在首次计划时已经确定。
- 现有 Step 4 已负责重新检查 planned files 和 Git 安全边界，不需要另建依赖执行协议。

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

### R4. 兼容与同步

- 不新增独立 `Step 4.1`、validation 集合、状态类型、脚本、配置或持久化事务。
- 用户显式 `commit-only`、auto-loop、task progress、finish-work 和 release 行为不变。
- 修改 skill-garden 0.6 `.agents` / `.claude` 源，并同步 `enhancements/0.6` 和当前 dogfood。
- 不修改 0.5、old、workflow hub 或 Trellis npm 包内置文件。

## Acceptance Criteria

- [ ] AC1：计划只增加一行生成说明，不展示额外验证清单。
- [ ] AC2：生成后 dirty paths 未超出预计 exact files 时不二次确认。
- [ ] AC3：出现计划外文件或现有计划边界变化时重新确认。
- [ ] AC4：实现不新增独立步骤、状态、脚本或重复 Git 守卫。
- [ ] AC5：0.6 源、快照和 dogfood 一致，0.5/old 无漂移。

## Out of Scope

- 数据库、部署、外部系统、凭证或生产写入命令。
- 多仓原子事务或自动回滚。
- 对 dirty 文件建立内容指纹或持久化确认计划。
