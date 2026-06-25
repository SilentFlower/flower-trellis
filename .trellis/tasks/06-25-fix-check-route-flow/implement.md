# Implement — 修正 check 后路由规则

## 步骤

1. 读取当前 0.6 route/workflow 源文件与快照，确认实际差异。
2. 修改 `vendor/skill-garden/.trellis/0.6` 中 workflow hub、`in_progress` / `in_progress-inline` 状态块和 `trellis-route` skill。
3. 同步当前项目 `.trellis/workflow.md` 与 `.agents` / `.claude` skill 副本。
4. 运行项目同步脚本生成 `enhancements/0.6` 快照和 manifest。
5. 搜索 0.6 主路径，确认不存在与目标相反的残留文案。
6. 运行语法与 diff 检查。

## 验证命令

```bash
node --check src/cli.js
for f in src/lib/*.js src/commands/*.js scripts/*.mjs; do node --check "$f"; done
git diff --check
git -C vendor/skill-garden diff --check
```

```bash
diff -u vendor/skill-garden/.trellis/0.6/overrides/workflow.md enhancements/0.6/overrides/workflow.md
diff -u vendor/skill-garden/.trellis/0.6/overrides/workflow-states/in_progress.md enhancements/0.6/overrides/workflow-states/in_progress.md
diff -u vendor/skill-garden/.trellis/0.6/overrides/workflow-states/in_progress-inline.md enhancements/0.6/overrides/workflow-states/in_progress-inline.md
diff -u vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/SKILL.md enhancements/0.6/.agents/skills/trellis-route/SKILL.md
diff -u vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-route/SKILL.md enhancements/0.6/.claude/skills/trellis-route/SKILL.md
```

## 回滚点

该任务主要修改文档和快照。若验证发现语义不对，回退本任务涉及的 workflow/skill/快照文件即可。
