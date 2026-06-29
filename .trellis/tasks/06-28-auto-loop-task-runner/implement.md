# Auto loop task runner 实施计划

## Ordered Checklist

1. 前置检查
   - 读取 `prd.md`、`design.md`、本文件和相关 spec。
   - 确认当前任务 status 为 `planning`，且 `implement.jsonl` / `check.jsonl` 已 curated。

2. 设计 runner 状态机
   - 新增 `.trellis/scripts/auto_loop.py` 入口。
   - 如逻辑增长，新增 `.trellis/scripts/common/auto_loop.py` 承载状态读写、队列推进和 JSON 输出。
   - 实现 `start`、`resume`、`next`、`record`、`status`、`stop` 命令骨架。
   - 状态写入 `.trellis/.runtime/auto-loop/<run-id>.json`，使用 `schema_version`。
   - 新增 `trellis-auto-loop` skill 作为 agent 入口，描述触发、恢复、action 映射、record 回写和 commit-only 预授权边界。

3. 实现 start gate 与队列推进
   - 支持显式多个任务参数并按顺序写入队列。
   - 检查 `planning` 任务的 PRD/design/implement/jsonl gate。
   - 满足 gate 时允许执行 `task.py start`；不满足时记录 blocked 并继续后续任务。

4. 实现 route 临时授权兼容
   - 扩展 `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/scripts/route_state.py` 的合法 source、auto runtime 读取和 resolve 优先级。
   - 同步同 skill 的 `.claude` 副本。
   - 运行 `npm run sync` 同步 `enhancements/0.6`。
   - 必要时同步当前 dogfood `.agents/skills/trellis-route/scripts/route_state.py`。

5. 实现 record / blocked / resume capsule
   - `record` 记录执行结果、失败类型、失败摘要、尝试次数、修改文件和下一步。
   - `next` 写入待回写 action；`record` 必须显式传入匹配 action，缺失或不匹配时拒绝推进。
   - 每个任务默认最多 3 轮 fix/recheck。
   - blocked 后跳过当前任务并继续队列。
   - 每次状态变化刷新 `resume_capsule`。

6. 实现 commit-only 边界
   - 设计任务相关文件归属规则。
   - 只提交当前任务可归属文件。
   - 无法归属 dirty 文件时不提交，并记录备注或 blocked 摘要。
   - 保持 push、发布、归档为 out of scope。

7. 更新 workflow / skill-garden 指令
   - 在 0.6 覆盖中补充 auto runner 的恢复规则和 route 临时授权语义。
   - 确保高频 workflow/state 只保留边界，机械状态解析留给 Python 脚本。
   - 在 `trellis-push` 中补充 auto-loop commit-only 预授权例外：只允许当前 run、当前任务、commit-only、本地提交、文件可归属时跳过二次确认。

8. 验证
   - `python3 -m py_compile .trellis/scripts/auto_loop.py`
   - `python3 -m py_compile .agents/skills/trellis-route/scripts/route_state.py`
   - `npm run sync`
   - `node scripts/check-snapshot.mjs`
   - `node --check src/cli.js`
   - `for f in src/lib/*.js src/commands/*.js; do node --check "$f"; done`
   - `flower-trellis update --enhance-only --target <tmp> --variant 0.6 --skills trellis-auto-loop --no-update-check` 后确认 skill 与 `.trellis/scripts/auto_loop.py` 同时安装。
   - `git diff --check`
   - `python3 ./.trellis/scripts/task.py validate 06-28-auto-loop-task-runner`
   - 临时 run 验证当前任务可从 `run_implement` 自动推进到 `commit_only` / `done`。
   - 临时 run 验证 `record` 缺失或不匹配 action 会返回 error。
   - 临时 planning 任务验证 inline route 下 seed-only JSONL 不阻塞 start gate，个人 subagent 默认仍会阻塞。

## Risky Files

- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/scripts/route_state.py`
- `vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-route/scripts/route_state.py`
- `enhancements/0.6/**`
- `.agents/skills/trellis-route/scripts/route_state.py`
- `.agents/skills/trellis-auto-loop/SKILL.md`
- `.agents/skills/trellis-push/SKILL.md`
- `.trellis/scripts/**`
- `.trellis/workflow.md` 或 skill-garden workflow overrides

## Rollback Points

- runner 新脚本独立，可通过删除 `.trellis/scripts/auto_loop.py` 和对应 common 模块回滚。
- route helper 扩展必须保持现有 runtime -> prefs 行为；如 auto 授权异常，可回滚 auto source 分支。
- `npm run sync` 后如快照漂移异常，用 `git diff vendor/skill-garden enhancements/0.6` 定位源/快照差异。

## Notes

- 不要把 `.trellis/.runtime/auto-loop/`、`.trellis/.runtime/sessions/` 或 `.trellis/.route-prefs.tmp` 加入提交。
- 不要直接运行裸 `git commit` / `git push`；commit-only 必须走 Trellis 约定流程。
