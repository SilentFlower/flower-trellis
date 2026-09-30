# 实施计划：自动 GC 提交默认放行

1. 读取 `trellis-before-dev` 指向的规范、Push 源与模板、GC 的实际提交形态和 Plugin 托管边界；固定需更新的精确文件集合。
2. 在 Skill-Garden 作者源的 Codex/Claude `trellis-push` 中加入只读 GC 提交校验脚本、ahead 归属、发布前复核、Step 5 与 completed-task recovery 规则；同步更新计划/结果输出模板。
3. 运行 `npm run sync` 刷新 `enhancements/0.6/`，再通过 Flower Plugin 生命周期更新本项目部署结果；逐项核对两个平台、快照与所有权状态。
4. 用真实 GC 提交和隔离 Git 仓库的正反例验证识别边界；运行相关快照、编译目标、输出模板及项目测试。
5. 进入 Check-All；通过后按 workflow 更新 `enhancements-model.md`，再由 `trellis-push` 规划精确提交与推送。

## 风险与恢复

- 托管 skill 不能只改部署副本；若同步或 Plugin 事务失败，保留现场并按其状态恢复，不手动覆盖用户文件。
- 识别规则缺证据即回到原有未知 ahead 停止路径；不改写、丢弃或重排既有 Git 历史。
