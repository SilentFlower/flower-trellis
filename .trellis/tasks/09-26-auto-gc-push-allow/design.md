# 设计：自动 GC 提交默认放行

## Ownership

- 策略由 `trellis-push` 的 Step 2、Step 5 和 completed-task recovery reference 持有；物理 GC 继续由 `task_lifecycle.py` 持有。
- `trellis-push/scripts/verify_gc_commit.py` 是两个平台 skill 内同内容的只读判定入口；它只依赖 Git 和 Python 标准库，返回明确的 `verified/rejected` JSON。Push skill 仍负责 ahead 归属、计划与确认。
- 作者源是 `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-push/` 与 `.claude/skills/trellis-push/`；`npm run sync` 生成 `enhancements/0.6/`，Flower Plugin 生命周期更新本项目部署结果。
- `enhancements-model.md` 记录长期契约；workflow hub 只保留 Push owner 映射。

## Recognition Contract

对 `@{u}..HEAD` 中每个历史提交独立分类，不能只看最新提交，也不能仅凭消息推断：

1. 提交必须恰有一个父提交，完整主题精确等于 `chore(task): gc closed tasks`。
2. 以 Git 树的原始文件路径和 blob ID 检查变更。仅接受 `.trellis/tasks/<name>/...` 顶层文件删除，以及 `.trellis/tasks/archive/YYYY-MM/<name>/...` 对应文件新增；归档去重时新增可省略，但相同目标文件必须已在提交后的树中。
3. 每个被删除的源文件，在提交后的归档目录中必须有同名、同 blob 的目标；每个新增的目标也必须对应一个源文件。同批可包含多个任务，不允许额外文件。每个任务必须包含 `task.json`，提交后的顶层任务目录必须不存在。
4. 使用 JSON 解析归档 `task.json`，要求 `status=completed`、`closeout.status=closed` 且 `closedAt` 为有效时间；路径中的 `YYYY-MM` 必须等于关闭时间的 UTC 月份。任一校验失败即视为未知 ahead。

使用 NUL 分隔的 Git 文件输出或等价的结构化解析，避免中文、空格和制表符路径被 quote 破坏。纯内容移动与去重以 blob ID 证明，不依赖 Git rename 相似度的启发式结果。任务内容发生任何改写时保持失败关闭，这涵盖少见的 runner bookkeeping 与 GC 合并提交；本轮只解决已观察到的纯归档提交。

## Push Behavior

- 已验证 GC 作为 ahead 历史提交随正常 `git push` 发布，不纳入本轮业务 `planned`，不追加第二次确认，也不单独执行 push。
- 最小计划增加可选的已验证 GC 提交摘要；结果显示实际推送的提交并保持业务 commit 与任务记录 commit 的区分。
- Step 5 发布前和 completed-task push-only 恢复复用同一识别条件。执行前重新验证 ahead 范围与提交树；若出现新的未知提交则停止并重新规划。
- 其它 Git 安全预检、retained dirty 与 exact pathspec 行为不改变。

## Validation

- 在已发生的 `0c02fb7` 上逐条核验单父、路径、blob、关闭状态和归档月份。
- 构造相同消息但多带业务文件、任务内容变化、错误月份及未关闭状态的本地临时提交，确认均被判为未知 ahead；覆盖多任务与去重。
- 检查作者源两平台一致，运行快照同步、compiled targets 与输出模板检查，并核对部署产物及 Plugin state。
- `test_trellis_push_gc.py` 通过真实 lifecycle GC 和伪造提交调用校验器 CLI；纳入现有 Python 3.8/3.12 的 Ubuntu/Windows 矩阵。
