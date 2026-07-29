# Brief 显式预授权最小实施计划

## 1. Policy

- [x] 撤回 session helper、hash、task.py 和 auto-loop 重方案。
- [x] 更新 Phase 1.4：保留默认确认，增加显式预授权窄例外。
- [x] 更新 agents/claude 的 `trellis-task-brief` 作者源。
- [x] 更新 conflict assertion 和文案契约测试。

## 2. Sync

- [x] 运行 `npm run sync`。
- [x] 更新 compiled targets。
- [x] 通过 Flower 同步当前 dogfood。

## 3. Verification

- [x] 验证普通实现意图不会跳过确认。
- [x] 验证明示预授权仍要求完整展示 Brief。
- [x] 验证范围扩大、Open Questions 和高风险边界使预授权失效。
- [x] 验证未新增 `brief_review_state.py`，`task.py start` 和 auto-loop 无相关修改。
- [x] 运行定向测试、Patch/conflict 检查、完整测试和 diff 检查；全量 JS 285 项、全量 Python 146 项均通过。
