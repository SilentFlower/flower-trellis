# 为 No-Task 增加稳定完成流程实施计划

## 1. Preparation

1. 读取 `prd.md`、`design.md`、两份 research 和 curated JSONL。
2. 检查 Flower 主仓、`vendor/skill-garden` 子仓及配置 Git packages 的 HEAD/dirty 状态，保留用户现有改动。
3. 读取 workflow、route、pre-check、task intent、hook、agent 和 Patch owner 的实际定义，按目标文件语言与缩进修改。

## 2. Shared Git Evidence

1. 从 `auto_loop.py` / `task_intent.py` 中提取或建立共享的 Git 仓库发现、porcelain 解析和 fingerprint helper。
2. 仓库集合覆盖根仓、已初始化递归 submodule 和 `get_git_packages()` 返回的 `git: true` packages。
3. 为 HEAD、dirty/untracked 内容指纹、已有 staged 基线保留、conflict/integration 阻断和路径稳定顺序补单元测试。
4. 回接 auto-loop 与 task intent，确保现有 baseline 和错误 reason code 不回归。

## 3. Untracked State Helper

1. 新增 `vendor/skill-garden/.trellis/0.6/scripts/untracked_flow.py`，实现 `begin`、`prepare-edit`、`record-validation`、`advance`、`record-check`、`record-spec`、`status`、`session-start-hint` 和 `clear`。
2. 使用 session context key 和原子 JSON 替换，保留 runtime 未知字段。
3. 实现单活跃 work item、同事项幂等 begin、无关事项冲突、阶段前置条件、workspace fingerprint 绑定和证据失效。
4. 新增 `test/python/test_untracked_flow.py`，覆盖正常、边界、损坏、跨 session、多仓和恢复场景。

## 4. Route Preference

1. 在 route_state 真实源增加 `read-pref`、`write-pref`、`clear-pref`，复用现有 mode 归一化与合法值集合。
2. 把 `.route-prefs.tmp` 写入改为同目录原子替换；空偏好精确删除文件。
3. 保持 task `resolve/write/clear` 和 runtime -> prefs -> auto-loop 顺序不变。
4. 扩展 route state 测试，覆盖无 current task、偏好缺失/损坏、仅本次不落盘和保存默认。

## 5. Pre-Check Subject

1. 把 `pre_check_state.py` schema 升级为 task/untracked subject，并只读兼容 version 1 task hold。
2. 更新 set/read/clear/session-start-hint，校验当前 context 与 subject，避免跨事项误继承。
3. 扩展 Python、Codex 和 Claude SessionStart 测试，确保旧 task 行为和 auto-loop 无回归。

## 6. Task Adoption

1. 在 `task_intent.py` 增加 `adopt` 子命令和参数解析，复用现有 task create、安全路径、parent/session 补偿。
2. 校验当前 untracked state 与 workspace fingerprint，创建 planning task 并写 `meta.intentRouting` 接管信息。
3. 仅在 task meta 和 session current task 都成功后清理 untracked；任一步失败恢复新 task、parent/session 并保留原状态。
4. 扩展 task intent 测试，覆盖成功、现有 diff 不变、不同阶段、各失败点和 stale fingerprint。

## 7. Workflow, Skills, Hooks And Agents

1. 新增 `[workflow-state:untracked]` Patch，更新 runtime contract、Request Triage、Phase 2/3 和 owner map。
2. 更新 `inject-workflow-state`：合法 untracked 命中时优先于 no_task；损坏或缺失时安全回退。
3. 更新 Codex/Claude SessionStart，注入一条紧凑 untracked 恢复提示。
4. 更新 trellis-start、trellis-route、trellis-check-all、trellis-update-spec、trellis-push 和相关 command/agent 文本，支持 task 或 untracked context。
5. untracked dispatch 使用 `Untracked work:` 首行并携带完整上下文；保留 task sub-agent 的 `Active task:` 契约。
6. 增加 JS/Python owner 和 walkthrough 测试，断言单活跃 guard、完成链、hold、偏好与接管语义没有被 Hub 重复。

## 8. Bundle And Asset Distribution

1. 把 `untracked_flow.py` 加入 `src/lib/copy-scripts.js` 与 builtin content adapter alias 映射。
2. 更新 intent-routing 及相关 route/check/update-spec/push Bundle，保证 full install 和 selective install 都铺设必需 helper/Patch。
3. 扩展 apply-enhancements、skill filter、Bundle alias 和 manifest ownership 测试。
4. 运行 `npm run sync`，审查 `enhancements/0.6` 只包含源同步结果。

## 9. Compiled Targets And Dogfood

1. 运行 `npm run patch:targets` 刷新 Skill-Garden Claude/Codex canonical compiled targets。
2. 运行 `npm run patch:targets:check`，确认 vendor 源、快照和 compiled targets 无漂移。
3. 通过 Flower Plugin Runtime 在临时 0.6 项目验证 fresh install、upgrade、selective Bundle、Codex/Claude hooks。
4. 对当前 Flower 项目执行 dogfood 同步；第二次应用必须报告 unchanged/修改数为 0。

## 10. Full Validation

```bash
python3 -m unittest test.python.test_untracked_flow
python3 -m unittest test.python.test_route_state test.python.test_pre_check_state test.python.test_pre_check_session_start test.python.test_task_intent test.python.test_workflow_state_hook
node --test test/js/untracked-flow-gate.test.js test/js/workflow-gate-ownership.test.js test/js/pre-check-feedback-gate.test.js test/js/apply-enhancements.test.js
npm test
npm run sync
npm run patch:targets:check
git diff --check
git -C vendor/skill-garden diff --check
```

额外审查：

- task workflow 的 route、Brief、start 和归档行为不变。
- untracked 不产生 task artifacts 或 task-scoped route decision。
- 多仓原始 baseline 不会在后续修改时被覆盖。
- Check-All/Update-Spec/Push 的 owner gate 和确认要求未降低。
- runtime 损坏、workspace drift 和 adoption 失败均不覆盖用户 dirty diff。

## 11. Documentation And Spec

1. 若实现确认新的 session runtime、跨仓 fingerprint 或 native gate owner 契约，更新对应 `.trellis/spec/flower-trellis/cli/` 规范。
2. 保持 Workflow Hub 只记录 owner 与顺序，深层 schema 和错误矩阵留在 helper/Skill/spec。
3. 更新后的维护性注释和公开 Python/JS API 使用中文 Docstring/JSDoc，并包含参数和返回值。

## 12. Risk Files

- `vendor/skill-garden/.trellis/0.6/scripts/*.py`：session 原子写、Git baseline、事务补偿。
- `vendor/skill-garden/.trellis/0.6/overrides/patches/**`：workflow owner、selector/baseline 与平台一致性。
- `vendor/skill-garden/.trellis/0.6/overrides/bundles/*.json`：精细安装不得漏 helper 或扩大无关范围。
- `src/lib/copy-scripts.js` 与 builtin content adapter：legacy 与 Plugin Runtime 两条分发路径必须一致。
- `enhancements/0.6/**` 与 compiled targets：均为生成产物，禁止单独手改。

## 13. Release Boundary

- 本任务只完成代码、生成快照、compiled targets 和 dogfood 验证。
- 不自动 commit、push、打 tag、发布 npm 或修改真实业务项目。
- 提交与发布继续经过 `trellis-push` 和 Flower release SOP 的独立确认。
