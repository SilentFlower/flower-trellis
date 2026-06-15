# optimize trellis-route implement plan

## Implementation Checklist

- [x] 启动任务：`python3 ./.trellis/scripts/task.py start optimize-trellis-route`。
- [x] 进入实现前读取 `trellis-before-dev` 和相关 spec。
- [x] 修改 `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/SKILL.md`：
  - [x] 将偏好配置从仅 implement 的 4h 单值扩展为 implement/check 都支持的 gitignored 个人配置。
  - [x] 明确正常路由命中配置时可直接输出决定。
  - [x] 明确“临时改/重新选择/清除默认”等意图必须绕过配置并重新展示选项。
  - [x] 将 check 普通选项收敛为 `check-all inline/subagent` 及保存默认选项。
  - [x] 保留轻量 `trellis-check` 隐藏逃生口。
- [x] 将同样内容同步到 `vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-route/SKILL.md`。
- [x] 修改 `vendor/skill-garden/.trellis/0.6/overrides/workflow.md` 的 Routing Gate。
- [x] 手工受控复制同步当前 `.agents` / `.claude` 副本。
- [x] 运行 `npm run sync`，同步 `enhancements` / manifest。
- [x] 如有必要，手工同步 `.trellis/workflow.md` 的 Routing Gate 文案。
- [x] 检查副本一致性。
- [x] 更新 PRD 验收项为已完成或记录差异。

## Validation

- `diff -u vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/SKILL.md vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-route/SKILL.md`
- `diff -u vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/SKILL.md .agents/skills/trellis-route/SKILL.md`
- `diff -u vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/SKILL.md enhancements/0.6/.agents/skills/trellis-route/SKILL.md`
- `diff -u vendor/skill-garden/.trellis/0.6/overrides/workflow.md enhancements/0.6/overrides/workflow.md`
- `npm run sync`
- `node --check src/cli.js && for f in src/lib/*.js src/commands/*.js scripts/*.mjs; do node --check "$f"; done`
- `git diff --check`
- `git -C vendor/skill-garden diff --check`
- `node scripts/check-snapshot.mjs`（提交 `enhancements/` 快照前会按预期失败）

## Review Gates

- 实现前：用户确认 PRD / design / implement。
- 检查后：按 Trellis Post-Check Stop Gate 停止汇报，不自动 finish-work。
- 提交前：必须通过 `trellis-push` 展示完整执行计划，不能裸 `git commit` / `git push`。
