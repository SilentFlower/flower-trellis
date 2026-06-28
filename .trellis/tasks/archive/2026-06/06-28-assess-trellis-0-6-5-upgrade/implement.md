# Trellis 0.6.5 升级实施计划

## 前置状态

- 父仓分支：`beta`。
- `vendor/skill-garden` 分支：`beta`。
- 当前任务状态：`in_progress`。
- 已通过 `trellis-task-brief` 生成 brief，并通过 `task.py start` 进入执行阶段。

## 实施清单

### 1. 依赖升级

- [x] 修改 `package.json`：`@mindfoldhq/trellis` 从 `0.6.2` 升级到 `0.6.5`。
- [x] 更新 lockfile，确保 `package-lock.json` 中：
  - [x] `node_modules/@mindfoldhq/trellis.version == 0.6.5`
  - [x] `node_modules/@mindfoldhq/trellis-core.version == 0.6.5`
- [x] 运行 `node bin/flower-trellis.js -v`，确认 bundled trellis 显示 `0.6.5`。

### 2. 对齐 flower 平台列表

- [x] 修改 `src/constants.js`：
  - [x] 新增 `--devin`。
  - [x] 新增 `--zcode`。
  - [x] 新增 `--trae`。
  - [x] 保留 `--windsurf` 兼容 deprecated alias。
  - [x] 不把 `--with-statusline` 放入 `PLATFORM_FLAGS`。
- [x] 修改 `src/lib/pick-platforms.js`：
  - [x] `Windsurf` 改为 `Devin`。
  - [x] 新增 `ZCode`。
  - [x] 新增 `Trae`。
  - [x] 维持默认勾选 Claude Code + Codex。
- [x] 更新 README 平台相关文案。
- [x] 如平台规则变化值得沉淀，更新 `.trellis/spec/flower-trellis/cli/config-and-state.md`。

### 3. 执行 Trellis 0.6.5 update

- [x] 运行 dry-run 记录当前预期：

```bash
npx --yes @mindfoldhq/trellis@0.6.5 update --dry-run
```

- [x] 运行实际 update。优先使用 flower 路径以保留 config / hook 保护：

```bash
node bin/flower-trellis.js update --skip-all --no-update-check
```

- [x] 对交互冲突文件执行手工合并，不使用 blanket overwrite：
  - [x] `.trellis/config.yaml`
  - [x] `.trellis/workflow.md`
  - [x] `.codex/hooks.json`
  - [x] `.agents/skills/trellis-finish-work/SKILL.md`
  - [x] `.claude/commands/trellis/finish-work.md`

### 4. 合并 workflow 与 skill-garden 0.6 源

- [x] 对照 0.6.5 上游 workflow，把以下变化合并进 skill-garden 0.6 源：
  - [x] 平台矩阵增加 `ZCode`、`Reasonix`、`Trae`。
  - [x] `Windsurf` 改为 `Devin`，保留兼容说明时不破坏旧 alias。
  - [x] Phase 1.3 / 1.4 加强 JSONL 真实条目门禁。
  - [x] Phase 2.1 pull-based sub-agent 分类包含 `Gemini`、`Qoder`、`Copilot`、`ZCode`、`Reasonix`、`Trae`。
  - [x] Phase 2.2 check 矩阵补齐新平台。
- [x] 保留 skill-garden 现有规则：
  - [x] Task Brief Handoff。
  - [x] Routing Gate。
  - [x] Post-Check Stop Gate。
  - [x] Code Commit Confirmation Gate。
  - [x] Push Progress Recovery / Snapshot。
- [x] 修改源头优先级：
  - [x] `vendor/skill-garden/.trellis/0.6/overrides/workflow.md`
  - [x] `vendor/skill-garden/.trellis/0.6/overrides/workflow-states/*.md`
- [x] 运行 `npm run sync`，同步 `enhancements/0.6`。
- [x] 同步当前 dogfood `.trellis/workflow.md`、`.agents`、`.claude` 副本。

### 5. 检查 finish-work override

- [x] 检查上游 0.6.5 finish-work 模板结构是否影响 skill-garden override 注入。
- [x] 如需调整，先改：
  - [x] `vendor/skill-garden/.trellis/0.6/overrides/skills/trellis-finish-work.md`
- [x] 再运行 `npm run sync`。
- [x] 确认当前 `.agents/skills/trellis-finish-work/SKILL.md` 与 `.claude/commands/trellis/finish-work.md` 仍包含 release operations override。

### 5.5 修复 trellis-route 跨任务 runtime 决策隔离

- [x] 修改 `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/scripts/route_state.py`：
  - [x] 默认输出包含当前 `task`，便于压缩恢复和排查。
  - [x] `_write_runtime_decision()` 写入当前任务任一 target 前，清理同一 session 中 `task != current_task` 的 `route_decisions`。
- [x] 同步 `.claude` 源副本、`enhancements/0.6` 快照、当前 dogfood `.agents` / `.claude` 副本。
- [x] 保持 `.trellis/workflow.md` 与 workflow override 的轻量 target-matched route guard；task 校验和跨任务清理由 helper 负责，不扩散到高频 workflow/state 文案。
- [x] 使用临时 `TRELLIS_CONTEXT_ID` 验证：
  - [x] 任务 A runtime 中存在 `route_decisions.check` 时，切到任务 B 并写入 implement 会清理任务 A 的 check 决策。
  - [x] 同一任务已有 check 决策时，写入 implement 会保留 check 决策。

### 6. 检查配置与 hooks

- [x] `.trellis/config.yaml`：
  - [x] 保留 `packages.flower-trellis` 或当前实际 package 配置。
  - [x] 保留 `packages.skill-garden` 子模块配置。
  - [x] 保留 `default_package`。
  - [x] 保留 `codex.dispatch_mode: sub-agent`。
  - [x] 保留上游 `channel.worker_guard`。
- [x] `.codex/hooks.json`：
  - [x] 保留上游 `UserPromptSubmit`。
  - [x] 保留 flower `SessionStart`。
  - [x] 不恢复旧 `[features.multi_agent_v2]` 依赖。

### 7. 验证

- [x] ESM 语法检查：

```bash
node --check src/cli.js && for f in src/lib/*.js src/commands/*.js; do node --check "$f"; done
```

- [x] 快照同步：

```bash
npm run sync
node scripts/check-snapshot.mjs
```

说明：`npm run sync` 已完成；`node scripts/check-snapshot.mjs` 当前在未提交状态下会因为 `enhancements/` 存在未提交改动而失败，这是发布前门禁预期行为。Phase 3.4 通过 `trellis-push` 提交后需重跑。

- [x] 版本检查：

```bash
node bin/flower-trellis.js -v
```

- [x] Trellis update 预览：

```bash
node bin/flower-trellis.js update --dry-run --no-update-check
```

- [x] diff 质量：

```bash
git diff --check
git -C vendor/skill-garden diff --check
```

- [x] 关键副本一致性：

```bash
diff -u vendor/skill-garden/.trellis/0.6/overrides/workflow.md enhancements/0.6/overrides/workflow.md
diff -u vendor/skill-garden/.trellis/0.6/overrides/workflow-states/in_progress.md enhancements/0.6/overrides/workflow-states/in_progress.md
diff -u vendor/skill-garden/.trellis/0.6/overrides/workflow-states/in_progress-inline.md enhancements/0.6/overrides/workflow-states/in_progress-inline.md
```

- [x] `trellis-route` helper 静态与行为验证：

```bash
python3 -m py_compile vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/scripts/route_state.py vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-route/scripts/route_state.py enhancements/0.6/.agents/skills/trellis-route/scripts/route_state.py enhancements/0.6/.claude/skills/trellis-route/scripts/route_state.py .agents/skills/trellis-route/scripts/route_state.py .claude/skills/trellis-route/scripts/route_state.py
```

行为验证已通过：`cross-task-cleanup: ok`、`same-task-preserved: ok`。

### 8. 任务收尾前检查

- [x] 更新 `prd.md` 验收状态。
- [x] 如升级中形成新的长期规则，使用 `trellis-update-spec` 更新 spec。
  - 已更新 `.trellis/spec/flower-trellis/cli/config-and-state.md`，记录 Trellis 0.6.5 平台 flag 规则。
  - 已更新 `.trellis/spec/flower-trellis/cli/enhancements-model.md`，记录 `trellis-route` runtime 决策清理契约。
- [x] 运行 `trellis-check-all` 或等价全面检查。
- [x] 检查通过后停在 Phase 3.4，按 `trellis-push` 生成提交计划；不要裸 `git add` / `git commit`。

## 风险点

- `.trellis/workflow.md` 被上游整文件覆盖会丢 skill-garden hub。
- `.trellis/config.yaml` 被覆盖会丢 monorepo package 配置和 Codex dispatch 配置。
- `.codex/hooks.json` 被覆盖会丢 SessionStart。
- 只改 `enhancements/0.6` 不改 `vendor/skill-garden` 会被下一次 `npm run sync` 覆盖。
- 父仓与子模块分支必须都在 `beta`，否则提交会落到错误分支。

## 回滚点

- 依赖升级前。
- Trellis update 后、skill-garden 合并前。
- `npm run sync` 后。
- 当前 dogfood 副本同步后。

每个回滚点都通过 git diff 确认范围，不使用破坏性 checkout/reset。
