# Implementation Plan

## Step 1: Check-All 智能深度与统一入口

- [ ] 在 vendor 0.6 agents/claude Check-All 中扩展 Step 0：validated context、requested/effective depth、hard-full、light eligibility、fallback full 和 profile 输出。
- [ ] 让 light/full 共用 audit-only 问题模型；light 通过正式满足门禁，强风险单向升级 full。
- [ ] 明确 full 修复重检不可降级，保留 `CHK-*` 编号。
- [ ] 将 Auto-Loop Return Gate 放到 Interactive Post-Check Stop Gate 之前。

验证：

```bash
cmp vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-check-all/SKILL.md \
    vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-check-all/SKILL.md
rg -n "requested_depth|effective_depth|hard-full|Auto-Loop Return|Interactive Post-Check" \
  vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-check-all/SKILL.md
```

## Step 2: Route 与 Auto-Loop Skill 收口

- [ ] 从 agents/claude `trellis-route` 删除顶层轻量 `trellis-check` 逃生口和 `check-inline/check-subagent` dispatch 文案。
- [ ] 保留 check-all inline/subagent 路由与既有 route_state.py schema。
- [ ] 更新 agents/claude `trellis-auto-loop`：start/retry 参数、action record 字段、检查后立即 next、subagent 返回后的主会话职责。

验证：

```bash
cmp vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/SKILL.md \
    vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-route/SKILL.md
cmp vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-auto-loop/SKILL.md \
    vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-auto-loop/SKILL.md
! rg -n "隐藏逃生口|inline check`|subagent check`" \
  vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/SKILL.md
```

## Step 3: Runner 状态与续跑协议

- [ ] 为 `auto_loop.py start/retry-blocked` 增加 `--check-depth auto|light|full`。
- [ ] 新 run 默认 auto；旧 state 缺字段按 full；状态摘要和 resume capsule 可审计显示 requested depth。
- [ ] `run_check_all/run_recheck` action 输出 requested/minimum depth。
- [ ] `record` 接收 effective depth/reason，写 item.last_check；旧调用缺字段按 full 兼容。
- [ ] 通过、失败、blocked 继续使用现有 spec_update/fix/recheck/预算/commit-only 状态机。

验证：

```bash
python3 -m py_compile vendor/skill-garden/.trellis/0.6/scripts/auto_loop.py
python3 vendor/skill-garden/.trellis/0.6/scripts/auto_loop.py start --help
python3 vendor/skill-garden/.trellis/0.6/scripts/auto_loop.py record --help
```

## Step 4: Workflow 停止门禁去冲突

- [ ] 在 vendor workflow hub 中先表达 validated auto-loop `record+next`，再限定 interactive stop。
- [ ] 两个 in-progress state 用一句短门禁覆盖 auto-loop 例外，不复制 runner 命令。
- [ ] 保留 push、commit-only、finish-work 显式门禁不变。

验证：

```bash
rg -n "Auto-Loop|Interactive Post-Check|record.*next" \
  vendor/skill-garden/.trellis/0.6/overrides/workflow.md \
  vendor/skill-garden/.trellis/0.6/overrides/workflow-states/in_progress*.md
```

## Step 5: 自动化测试

- [ ] 新增 Python runner 回归测试，覆盖 depth state、legacy fallback、action/record、pass/fail/recheck 和多任务无确认续跑。
- [ ] 新增或扩展 Node 静态契约测试，覆盖 Check-All/route/hub/state 双平台和分发一致性。
- [ ] 确认测试不依赖 raw session runtime，不修改真实任务或 git 状态。

验证：

```bash
node --test test/js/*.test.js
python3 -m unittest discover -s test/python -p 'test_*.py'
```

## Step 6: Snapshot 与 Dogfood 同步

- [ ] 运行 `npm run sync` 生成 enhancements 快照。
- [ ] 同步当前项目 `.agents` / `.claude` Check-All、route、auto-loop 副本。
- [ ] 对当前 dogfood 项目运行本地 `--enhance-only --no-update-check`，验证 `.trellis/workflow.md` 和 state 注入。
- [ ] 重复运行，确认文件树幂等。

验证：

```bash
npm run sync
diff -ru vendor/skill-garden/.trellis/0.6/.agents enhancements/0.6/.agents
diff -ru vendor/skill-garden/.trellis/0.6/.claude enhancements/0.6/.claude
cmp vendor/skill-garden/.trellis/0.6/scripts/auto_loop.py enhancements/0.6/scripts/auto_loop.py
node bin/flower-trellis.js update --target . --enhance-only --no-update-check
```

## Step 7: 全量验证与发布前检查

- [ ] 运行项目全部测试、JS/Python/Bash 语法和 diff check。
- [ ] 运行默认与 strict AI context budget，审阅 hub/state 增量，不通过抬高阈值隐藏重复。
- [ ] 验证 0.5/old 未漂移，vendor source/agents/claude/enhancements/dogfood 一致。
- [ ] 验证 check-snapshot：vendor 未提交阶段允许因 dirty source 阻断；最终 push 流程在 vendor commit 后重新 sync 并通过。

验证：

```bash
npm test
node scripts/check-ai-context-budget.mjs --strict
node --check src/cli.js
for f in src/lib/*.js src/commands/*.js scripts/*.mjs test/js/*.test.js; do node --check "$f"; done
python3 -m unittest discover -s test/python -p 'test_*.py'
git diff --check
git -C vendor/skill-garden diff --check
node scripts/check-snapshot.mjs
```

## Risk And Rollback Points

- Check-All prompt 误判：fallback full；不得自动询问或 light 放行 hard risk。
- auto-loop action/record 漂移：runner 拒绝 mismatch，禁止手改 runtime。
- 旧 running state：缺 `check_depth` 必须 full fallback。
- 高频 prompt 变大：优先替换旧句和把细节留在 skill，不提高预算阈值。
- 分发漂移：真实修改只落 vendor，最终通过 sync 生成父仓快照。
