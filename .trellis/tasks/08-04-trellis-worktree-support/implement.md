# 兼容 Trellis worktree 开发入口 - Implement

## Checklist

1. 整理当前半成品 root fallback：
   - 保留 `untracked_flow.py` 的 Git worktree fallback。
   - 把 hook root fallback 纳入 `patch.json` operation，而不是孤立 content 文件。
   - 确认 selector/content 命名符合 Patch Engine 规范。
2. 新增 `worktree_setup.py`：
   - 实现 `status` / `prepare` / `--target` / `--json`。
   - 实现 Git common dir 和 `git worktree list --porcelain` 主根解析。
   - 实现 symlink projection、manifest、幂等和冲突拒绝。
3. 新增 `trellis-worktree` skill：
   - 写入 `.agents/skills/trellis-worktree/SKILL.md`。
   - 同步 `.claude/skills/trellis-worktree/SKILL.md`。
   - 说明触发条件、诊断命令、安全边界、准备完成后回到普通 Trellis 流程。
4. 注册分发：
   - 确认 sync 脚本会自动带上新增 skill 和 script。
   - 如 Bundle / manifest 需要显式引用，补充 `overrides/bundles` 或相关 catalog。
5. 测试：
   - 新增或扩展 Python unittest。
   - 运行相关测试和语法检查。
6. 同步快照：
   - 运行 `npm run sync`。
   - 检查 `enhancements/0.6` 与 vendor 源一致。
7. Patch target / diff 检查：
   - 运行 `npm run patch:targets:check` 或必要时先刷新 compiled targets。
   - 运行 `git diff --check`。

## Validation Commands

```bash
python3 -m unittest discover -s test/python -p 'test_untracked_flow.py'
python3 -m unittest discover -s test/python -p 'test_workflow_state_hook.py'
python3 -m unittest discover -s test/python -p 'test_worktree_setup.py'
python3 -m py_compile vendor/skill-garden/.trellis/0.6/scripts/untracked_flow.py
python3 -m py_compile vendor/skill-garden/.trellis/0.6/scripts/worktree_setup.py
npm run sync
npm run patch:targets:check
git diff --check
```

## Risk Points

- 不能让 helper 覆盖 linked worktree 中已有用户平台目录。
- 不能把 hook fallback 当成主能力；没有平台目录时 hook 不会运行。
- 不能只改 `enhancements/0.6`，必须以 `vendor/skill-garden/.trellis/0.6` 为 authoring source。
- 不能扩大 untracked state schema 或强行绑定 worktree，否则会影响现有 direct-edit 流程。
