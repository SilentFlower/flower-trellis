# Trellis Push 依赖型多仓单次确认实施计划

## 实施步骤

1. 精简 0.6 `.agents` `trellis-push` 源文件。
   - 删除独立 `Step 4.1`、validation 列表和重复 Git 守卫。
   - 计划模板只保留一行生成说明。
   - Step 4 只增加一段“命令成功且无计划外 dirty path 就继续”的规则。

2. 同步 0.6 `.claude` 源文件。

3. 运行 `npm run sync`，同步 `enhancements/0.6` 和当前 dogfood。

4. 将 `enhancements-model.md` 收缩为相同的通用规则。

5. 运行定向验证和 Check-All。

## Validation Commands

```bash
diff -u \
  vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-push/SKILL.md \
  vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-push/SKILL.md

diff -u \
  vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-push/SKILL.md \
  enhancements/0.6/.agents/skills/trellis-push/SKILL.md
diff -u enhancements/0.6/.agents/skills/trellis-push/SKILL.md .agents/skills/trellis-push/SKILL.md

rg -n "生成|预计 exact files|计划外.*dirty|不再次确认|重新.*计划" \
  vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-push/SKILL.md

if rg -n "Step 4.1|validations|planned-now|pending-derived|allowed_paths|required_paths|内容指纹" \
  vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-push/SKILL.md; then
  exit 1
fi

git diff --name-only -- enhancements/0.5 enhancements/old
git diff --check
git -C vendor/skill-garden diff --check
python3 .trellis/scripts/task.py validate .trellis/tasks/07-14-trellis-push-dependent-confirmation
```

## 场景验证

1. 静态多仓：现有行为不变。
2. 正常生成：dirty paths 是预计 exact files 子集，直接继续。
3. 计划外文件：停止并重新规划。
4. 后续仓有 retained dirty：不使用该规则。
5. commit-only / auto-loop：不获得生成命令授权。

## Review Gates

- skill 中没有独立中间步骤章节或验证协议。
- 生成逻辑复用现有 Step 4 预检。
- 不新增文件状态、脚本、runtime state 或指纹机制。
- 普通多仓、progress、commit-only、auto-loop 和 finish-work 无回归。

## Rollback Points

- sync 前：恢复 vendor 两份源文件。
- sync 后：恢复 vendor 源并重新运行 `npm run sync`。
- dogfood 同步后：以生成快照为唯一恢复来源。
