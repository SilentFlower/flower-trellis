# Implement Plan

## Checklist

1. 确认真实源文件位置。
   - 先改 `vendor/skill-garden/.trellis/0.6` 源。
   - 再运行 `npm run sync`。
   - 最后同步当前 dogfood 副本。
2. 修复 auto-loop route 默认。
   - 更新 `trellis-auto-loop/SKILL.md` 默认启动命令，不再传 `--route-implement subagent --route-check check-all-subagent`。
   - 在 skill 启动 runner 前调用/遵循 `trellis-route` 准备度判断：已有 runtime 决策或 prefs 才直接启动；缺失时先走 route 询问/fallback。
   - 调整 `auto_loop.py start` / state schema 或文案，避免默认 route 授权。
   - 如仍保留显式 route 参数，改名或文档说明为 explicit temporary route policy，不能显示成真实 route result。
3. 修复 route_state stale auto-loop pointer。
   - session `current_auto_run` / global `current.json` 指向非 running run 时忽略。
   - fallback 扫描唯一 running run。
   - 多个 running / 无 running 时返回明确 miss。
4. 修复 auto-loop current pointer 生命周期。
   - run completed / stopped 后清理或失效 `current.json`。
   - 保持显式 `--run-id` 可查看历史 run。
   - `status` 无 running run 时输出不误导。
5. 修复完成态输出。
   - `_summary()` / `_resume_capsule()` 输出区分 auto-loop item 完成与 task archive 完成。
   - 多任务队列不在中间停 finish-work。
   - 最终 done 非阻塞提示未归档任务。
   - 单个任务因 Git 提交预检失败被 blocked/skipped 时，继续后续 pending 任务。
6. 增加关键决策日志。
   - 在 run 或 queue item 中追加精简 `decision_log`。
   - route 决策记录真实 target/mode/source/task。
   - commit-only 记录计划文件、保留文件、commit message、work commit / snapshot commit。
   - done/blocked/skipped 记录未归档任务、失败原因、是否继续后续队列和下一步建议。
   - 不记录完整模型思维链。
7. 让 commit-only 走 trellis-push 边界。
   - 不新增 `push_commit_only.py`；文件归属由 AI 根据任务 artifacts 与 diff 判断。
   - `trellis-push` 执行 auto-loop 预授权校验、Git 状态预检、提交计划、精确暂存/提交、commit hash 输出/回写。
   - 预检发现可能混入非本任务改动或无法安全隔离时暂停并说明原因。
   - 更新 `trellis-push` / `trellis-auto-loop` 文档指向 AI 计划 + push 边界。
8. 更新 spec。
   - `.trellis/spec/flower-trellis/cli/enhancements-model.md` 记录 Auto Loop Runner 修复后契约。
9. 同步与 dogfood。
   - `npm run sync`
   - 对比 `vendor/skill-garden/.trellis/0.6` 与 `enhancements/0.6`
   - 同步 `.trellis/scripts` 和 `.agents/skills` 当前项目副本。
10. 验证。

## Validation Commands

```bash
python3 -m py_compile vendor/skill-garden/.trellis/0.6/scripts/auto_loop.py
python3 -m py_compile enhancements/0.6/scripts/auto_loop.py
python3 -m py_compile .trellis/scripts/auto_loop.py
python3 -m py_compile vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/scripts/route_state.py
python3 -m py_compile .agents/skills/trellis-route/scripts/route_state.py
npm run sync
git diff --check
```

Behavior checks:

```bash
# 默认 start 不应写 subagent route_authorization
python3 ./.trellis/scripts/auto_loop.py start --tasks <planning-or-test-task> --profile commit-only --run-id <tmp-run>

# stale current.json 不应阻止 route_state fallback 到唯一 running run
python3 .agents/skills/trellis-route/scripts/route_state.py resolve --target implement --verbose

# completed/stopped 后 current.json 清理或失效
python3 ./.trellis/scripts/auto_loop.py next --run-id <tmp-run>

# 多任务队列第一个 commit_only 后继续第二个任务
python3 ./.trellis/scripts/auto_loop.py record --run-id <tmp-run> --action commit_only --result ok --commit deadbeef
python3 ./.trellis/scripts/auto_loop.py next --run-id <tmp-run>

# 当前任务 commit_only 预检失败时，应记录当前 item 并继续后续任务
python3 ./.trellis/scripts/auto_loop.py record --run-id <tmp-run> --action commit_only --result blocked --failure-type unsafe-git-state --summary "commit-only preflight failed"
python3 ./.trellis/scripts/auto_loop.py next --run-id <tmp-run>

# runtime 应包含关键决策摘要，但不包含完整模型思维链
python3 ./.trellis/scripts/auto_loop.py status --run-id <tmp-run>
```

同步检查:

```bash
cmp -s vendor/skill-garden/.trellis/0.6/scripts/auto_loop.py enhancements/0.6/scripts/auto_loop.py
cmp -s enhancements/0.6/scripts/auto_loop.py .trellis/scripts/auto_loop.py
cmp -s vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/scripts/route_state.py .agents/skills/trellis-route/scripts/route_state.py
```

## Risky Files

- `vendor/skill-garden/.trellis/0.6/scripts/auto_loop.py`
- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-auto-loop/SKILL.md`
- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/scripts/route_state.py`
- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-push/SKILL.md`
- `enhancements/0.6/**`
- `.trellis/scripts/auto_loop.py`
- `.agents/skills/trellis-auto-loop/SKILL.md`
- `.agents/skills/trellis-route/scripts/route_state.py`
- `.agents/skills/trellis-push/SKILL.md`

## Notes

- 不要把 finish-work 放进 auto-loop 默认执行链。
- 不要让 auto-loop route 授权替代 `trellis-route` 用户选择。
- 不要只改当前 dogfood 副本；源和快照必须同步。
