# 优化 Trellis 提交与推送流程实施计划

## Implementation Steps

1. 固化场景与契约
   - 使用已确认的每仓库 8 文件/12 行阈值。
   - 收敛 PRD，确认普通 check-all、普通 push、显式 commit-only、auto-loop commit-only 四类行为。

2. 回归确认 auto-loop 边界
   - 不修改 runner profile/action schema。
   - 验证 `run_check_all -> run_spec_update -> commit_only` 顺序保持不变。
   - 验证 auto-loop commit-only 仍进入 `trellis-push` 统一边界，且不产生远端 push。

3. 调整 `trellis-auto-loop` skill
   - 保留启动命令、唯一 profile 和 action 映射。
   - 明确普通 `trellis-push` 默认 push 不影响 auto-loop 固定 commit-only。
   - 强化 auto-loop commit 不得绕过 `trellis-push` 的说明。

4. 调整 `trellis-push` skill
   - 强化“唯一入口”规则，禁止其他 skill/agent 自制提交确认流程。
   - 保留并强化现有 auto-loop commit-only 预授权判定。
   - 将计划数据与展示方式分离：内部精确列表，外部按阈值紧凑展示。
   - 明确 commit message 的生成、用户覆盖、普通确认和 auto-loop 自动采用规则。

5. 调整 workflow 与相关 skill 门禁
   - 保留现有 post-check stop gate 与 Phase 3.3 时机，不增加检查通过后的自动 spec update。
   - 明确 post-check 报告只输出检查维度、验证结果、剩余风险、结论和下一步，并等待用户继续。
   - 强化 Phase 3.4 转交规则：既有 Phase 3.3 完成后必须进入 `trellis-push`，不得生成旁路提交计划。
   - 在 hub 与 in-progress state guard 中明确整段覆盖下层 Phase 3.4 `Proposed commits` / local-only / no-push walkthrough。
   - 让计划显示最近一次 Spec review 单行结论；有 spec 变更时把文件纳入精确提交范围，无活动任务时显示跳过。
   - 更新 Code Commit Confirmation Gate，允许大型列表紧凑展示但不降低精确暂存要求。
   - 检查 finish-work 对 `push_mode` 的判断和提示是否仍正确。

6. 同步强化包与 dogfood 副本
   - 同步 vendor `.agents` / `.claude` 源副本。
   - 运行 `npm run sync` 更新 `enhancements/0.6` 和 manifest。
   - 同步当前 `.agents` / `.claude` 与 `.trellis/workflow.md` 注入结果。

7. 更新项目 spec
   - 在 `enhancements-model.md` 记录普通默认 push、auto-loop 固定 commit-only 和门禁契约。
   - 若发现通用质量规则变化，补充对应 CLI spec。

8. 执行验证
   - 静态检查、auto-loop commit-only 回归、skill 副本一致性和 workflow 文案扫描。
   - 走一遍普通模式计划和 auto-loop commit-only 计划/回写模拟，不执行真实远端 push，除非用户在实施阶段明确授权测试远端。

## Validation Commands

```bash
npm run sync
git diff --check
```

补充行为验证：

- `auto_loop.py start` 仍只接受并默认使用 `profile=commit-only`。
- auto-loop `next` 仍按 `run_spec_update -> commit_only` 推进。
- `commit_only` outstanding action 仍能 record/resume，且不会触发远端 push。
- 普通 `trellis-push` 计划默认为 push，大文件范围采用紧凑展示。
- 每仓库 8 个文件以内完整展示，超过 8 个按目录归组且文件区不超过 12 行；风险文件始终完整展示。
- 无活动任务场景默认排除所有无法证明来源的 dirty 文件，用户明确纳入后才允许进入 planned files。
- `rg` 确认 post-check stop/Phase 3.3 时机保持不变，且不存在 check/check-all 自行要求 `ok` 后直接 commit 的旁路文案。
- `rg` 确认 hub/state guard 明确将下层 Phase 3.4 `Proposed commits` / `Never push` walkthrough 标记为 inactive。
- 场景验证确认 post-check 报告不含 commit message、planned files 或提交确认提示。
- `cmp -s` 或 `diff -u` 确认 vendor、enhancements、`.agents`、`.claude` 对应副本一致。

## Review Gates

- 复核 diff 不得出现 auto-loop profile/action schema 变化。
- Workflow 与 skill 文案修改后检查是否存在互相矛盾的 post-check 与 auto-loop 规则。
- `npm run sync` 后检查 manifest 和快照只包含预期变化。
- 最终实现必须经过 `trellis-check-all`，再由 `trellis-push` 完成提交/推送。

## Rollback Points

- `trellis-push` 紧凑展示规则可独立回退到完整列表展示，不影响精确暂存逻辑。
- Workflow gate 修改必须与 vendor override 和当前 `.trellis/workflow.md` 一起回退，避免注入漂移。
