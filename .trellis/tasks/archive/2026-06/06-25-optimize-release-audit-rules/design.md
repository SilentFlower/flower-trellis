# 优化 trellis-release 与 finish-work 上线核对规则 - Design

## Scope

本任务修改 skill-garden 0.6 强化包中的 AI 指令文本，不修改 Trellis CLI 原生命令实现。

需要保持三类文件语义一致：

- 源文件：`vendor/skill-garden/.trellis/0.6/`
- 发布快照：`enhancements/0.6/`
- 当前项目已安装副本：`.agents/` 与 `.claude/`

## Technical Approach

### trellis-release

将当前“汇总任务 `release.md`”的流程改成“先核对、再汇总”：

1. 任务集合和 release 名称仍由用户输入、本地任务列表和归档任务列表决定。
2. 对每个任务读取任务规划、实施、检查和已有 release 文件。
3. 通过本地 git 证据核对实现影响面：
   - 任务内明确提到的相关文件。
   - `git log --oneline --name-only`、`git show --name-only` 或可定位的近期 work commit。
   - 当前 dirty path 只作为风险提示，不能当作已上线内容。
4. 将已有 `release.md` 与核对结果对比，记录覆盖、缺失、冲突和证据不足。
5. 生成批次上线单时保留任务来源引用，并新增核对摘要 / 风险标记。

### release 文件命名

默认输出文件使用：

```text
.trellis/releases/YYYY-MM-DD-<release-slug>.md
```

规则：

- 用户显式给出名称时清理为安全文件名后使用。
- 用户未给出时，从版本名、批次名、wave 或任务集合推导 `<release-slug>`。
- 推导不到时使用 `release`。
- 目标文件已存在时追加 `-2`、`-3` 等后缀，不覆盖已有文件。

### finish-work 注入块

强化 release operations inference：

- 明确上下文压缩 / 会话恢复后必须重新读取任务文件与 git 证据。
- 明确不能依赖记忆判断上线事项。
- 对已存在 `<task>/release.md` 做漂移检查。
- 不确定但存在上线风险时写入 `Needs human review`，避免误判为无事项。

## Compatibility

- 不改变 `trellis-release` 的触发方式。
- 不执行上线操作。
- 不自动为批次内所有缺失 `release.md` 的任务补写单任务文件。
- `npm run sync` 会重建 `enhancements/` 快照，因此先改源文件。

## Risks

- 如果只改当前 `.agents` / `.claude` 副本，后续同步会丢失改动。
- 如果只强调“汇总”，AI 仍可能在上下文压缩后相信旧 `release.md`，没有重新核对代码证据。
- 如果文件名规则不处理冲突，可能覆盖历史上线单。
