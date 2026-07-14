# Trellis Push 依赖型多仓单次确认技术设计

## 设计决定

不增加新的中间步骤流程，只允许现有普通多仓计划夹带一个已确认的本地生成命令。

```text
repo A commit/push -> displayed local command -> existing Step 4 preflight -> repo B commit/push
```

## 计划展示

沿用现有计划模板，只增加一行：

```markdown
顺序：skill-garden -> `npm run sync` -> flower-trellis -> task progress
生成：在 `flower-trellis` 运行 `npm run sync`；预计只影响 <exact files>
```

后续仓最终内容或增删行尚未生成时写“生成后计算”。不单独展示 validation 列表。

## 执行规则

1. 按现有规则提交并推送前置仓。
2. 在计划声明的工作目录运行已展示的本地命令。
3. 重新执行现有 Step 4 预检。
4. 命令成功、后续仓全部 dirty paths 都属于首次确认的预计 exact files，且现有计划边界未变化时直接继续。
5. 命令失败、出现预计列表外 dirty path 或现有预检失败时停止并重新规划。

预计文件的内容、hash、统计变化不触发再次确认；最终 clean 的预计文件不强行提交。

## 适用边界

- 仅普通 `PUSH` 使用。
- 后续仓首次计划必须没有 retained dirty。
- 命令必须本地、可重复且无外部副作用。
- commit-only、auto-loop、progress、finish-work 和 release 不变。

## 删除的复杂度

- 不新增独立 `Step 4.1`。
- 不重复列举 branch、upstream、ahead、conflict、staged 等现有守卫。
- 不要求生成后 validation 集合。
- 不新增 planned/pending/allowed 状态、内容指纹或持久化 transaction。

## 修改边界

- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-push/SKILL.md`
- `vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-push/SKILL.md`
- 对应 `enhancements/0.6` 与 dogfood 副本
- `.trellis/spec/flower-trellis/cli/enhancements-model.md`

## Rollback

恢复两份 vendor 0.6 源文件并重新运行 `npm run sync`，再从快照恢复 dogfood。没有数据或 runtime 迁移。
