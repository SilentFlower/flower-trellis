# Implementation Plan

## 1. Freeze Current Contracts

- [x] 为 Codex、Claude 和一个非目标共享平台记录当前完整 breadcrumb、SessionStart 分段与 `no-trellis` 行为。
- [x] 增加失败用例骨架，覆盖状态未变化静默、第 5 轮心跳、状态变化完整刷新和 SessionStart 强制刷新。
- [x] 记录当前真实输出字符预算，确保实现后按最终文件复测。

## 2. Add Conditional Injection Runtime

- [x] 在 Skill-Garden `inject-workflow-state/shared-runtime` authoring source 中增加会话 key 解析、独立 tracker 路径、严格记录校验和原子写入。
- [x] 把完整上下文渲染整理为可被普通事件和 SessionStart 内部模式共同调用的函数，保持现有平台事件 envelope。
- [x] 对 Codex 与 Claude 实现 fingerprint 比较、未变化计数、默认 5 轮心跳和 `heartbeat_turns: 0`。
- [x] 从选中 workflow-state 正文提取第一条可见动作，生成携带 subject、summary 和完整规则指向的心跳。
- [x] 保持其他共享 Python 平台逐轮完整输出，保持 `no-trellis` 不读取或更新计数。
- [x] 为 tracker 缺失、损坏、无 session identity 和写入失败实现完整注入降级。

## 3. Integrate SessionStart

- [x] 扩展 `src/assets/flower_session_start.py`，只在 `state` 分段调用对应 Codex/Claude workflow-state Hook 的内部刷新模式。
- [x] 将内部调用返回的完整 workflow-state 追加到 state 分段，并重置 tracker 计数。
- [x] 保留 `rules`/`stages` 并行独立、`resume`/全局禁用零输出、Astra 条件提示和现有诊断合并语义。
- [x] 内部刷新失败时保留原生状态，追加可见诊断，并允许下一次用户输入完整恢复。

## 4. Configuration And Contracts

- [x] 在受管配置说明中加入 `prompt_injection.heartbeat_turns`，默认 5、`0` 关闭、非法值回退默认。
- [x] 在 Phase 3.3 更新 workflow runtime contract，明确完整状态、心跳动作首行约定、Codex/Claude 条件注入和其他平台兼容边界。
- [x] 更新 AI context budget 场景，纳入 SessionStart 附带完整状态与心跳的最终输出测量。
- [x] 更新 Patch conflict/owner 断言，保持共享 Hook 的 marker、字节一致性和 managed source 所有权。

## 5. Test Matrix

- [x] 扩展 `test/python/test_workflow_state_hook.py`：首次完整、1–4 轮静默、第 5 轮心跳、第 6 轮重新计数、状态/正文/dispatch mode 变化、interval 变化与关闭。
- [x] 覆盖 Codex、Claude 跨 session 隔离、tracker 损坏重建、无 context key、原子写失败和 `no-trellis` 不计数。
- [x] 断言 untracked summary、task ID/status、inline 状态和 missing-task 心跳动作正确。
- [x] 断言至少一个非目标共享平台连续两轮仍输出完整状态。
- [x] 扩展 `test/python/test_flower_session_start.py`：startup/clear/compact 完整刷新并归零、resume 零输出、三段并行、Astra 与刷新内容共存、失败诊断不丢原生 state。
- [x] 扩展 JS/Patch 测试，验证 authoring source、snapshot、compiled targets、Flower asset 与 dogfood 投影。

## 6. Sync Managed Outputs

- [x] 运行 `npm run sync`，从 `vendor/skill-garden/.trellis/0.6` 刷新 `enhancements/0.6`。
- [x] 运行 `npm run patch:targets` 刷新当前精确 Trellis 版本的 compiled targets。
- [x] 通过 Flower Plugin lifecycle 对当前项目执行 enhance-only dogfood 更新，不手改部署副本。
- [x] 再次执行相同 dogfood 更新，确认第二次零修改。

## 7. Validation

- [x] 运行受影响 Python 测试与 `python3 -m py_compile`。
- [x] 运行 Patch/platform/SessionStart 相关 JS 测试。
- [x] 运行 `node scripts/check-patch-conflicts.mjs`。
- [x] 运行 `npm run patch:targets:check`。
- [x] 运行 `node scripts/check-ai-context-budget.mjs --strict`。
- [x] 运行完整 `npm test` 与 `git diff --check`。
- [x] 核对 vendor source、`enhancements/0.6`、compiled targets、当前 Codex/Claude dogfood 和 `.flower/state.json` provenance 一致。

## Risk And Rollback Points

- SessionStart state 增长接近分段预算时，先压缩重复包装文案，不能静默截断完整规则。
- tracker 必须与 active task session JSON 分离，避免并发读改写丢失任务状态。
- 心跳动作必须来自 workflow-state 正文，禁止引入第二套硬编码路由表。
- 其他共享平台的输出是兼容门禁；出现行为变化时回滚条件分支，不扩大本轮平台范围。
- Patch selector、baseline、同步或 dogfood preflight 失败时停止，保留事务前状态。
