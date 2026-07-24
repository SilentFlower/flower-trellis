# Brief — 升级 Auto-Loop 无人值守执行

## Goal

把 auto-loop 升级为真正的批量无人值守流程：用户发出启动指令即完成本次 run 授权，runner 先完成全队列 prepare，再自动执行到本地 commit-only 终态；执行期间不再因逐任务 `confirm_brief`、route 选择或普通 Check-All 停止边界等待用户。

## Scope

- 将 runner 升级为 schema 2，引入 `preparing`、`awaiting_input`、`running`、`completed_with_blocked`、`globally_blocked` 等状态，同时兼容读取 schema 1 runtime。
- 在执行首个任务前检查整个显式队列，集中处理任务状态、planning artifacts、Open Questions、readiness、brief freshness、route/check 策略、任务依赖和 Git baseline。
- 用户的 auto-loop 启动指令作为本 run 唯一授权；prepare 生成绑定任务顺序、artifact hash、route、check depth 和 profile 的 manifest revision，不再二次确认 manifest。
- `Open Questions` 继续由人工界定和回答。任一任务存在未解决问题时，整个 run 保持 `awaiting_input`；全部收敛后才进入无人值守执行。
- 除 Open Questions 和高风险黑名单外，允许 AI 基于需求、代码、spec 与仓库证据自动修复 planning 问题，单任务最多 3 轮，并记录修改、依据和 hash。
- 支持 run 内显式任务依赖、稳定拓扑排序和 `blocked-dependency` 传播；任务排列顺序本身不构成依赖。
- 新增结构化 AI 决策日志：runtime 保存实时摘要，任务目录保存 append-only `decisions.jsonl`；决策导致 planning 变化时生成新的 manifest revision。
- 在后续 finish/archive 前增加一次 Decision Audit。存在未审查决策时必须先接受全部或按 decision ID 要求返工；`task.py archive` 提供不可绕过的确定性 guard。
- 允许保留无关 unstaged/untracked 改动并标记为 `protected-retained`；auto-loop 不得修改、暂存或提交这些文件。staged、冲突和未完成 Git 集成仍是全局阻断。
- 更新 canonical vendor runner、skills、Patch、脚本分发别名、生成产物和 dogfood 副本，并补齐 Python、Node、Patch、安装与真实链路测试。
- 控制 Auto-Loop SKILL 体积：按直接铺设的 canonical variant 最终入口测量，以当前 `15,600 bytes / 220 lines` 为基线，`16 KiB` 为 target、`18 KiB` 为 review ceiling。

## Non-Goals

- 不自动 push、merge、release、deploy、finish-work 或 archive。
- 不在 auto-loop 完成时把 Trellis 任务状态改为 `completed`；本地提交完成后任务继续保持 `in_progress`，归档时才转换状态。
- 不允许 AI 回答、删除、改写或勾选人工保留的 Open Questions。
- 不允许 AI 自主执行不可逆真实数据修改、降低安全或隐私保护、公开 API/数据格式破坏性变更、费用或生产/外部系统操作，以及明显改变任务目标但缺少仓库证据的决策。
- 不把 run 内依赖扩展为通用 task parent/child 依赖模型，也不从任务顺序、父子关系或代码引用猜测依赖。
- 不在队列结束后自动进行第二遍 blocked 恢复扫描；预算耗尽即标记 blocked 并继续，后续恢复仍由用户显式调用 `retry-blocked`。

## Key Context

- canonical 修改源位于 `vendor/skill-garden/.trellis/0.6`；随后通过 `npm run sync` 生成 `enhancements/0.6`，再用 enhance-only 更新当前 dogfood 副本，禁止逐份手改生成物。
- `auto_loop.py` 继续拥有 prepare、manifest、调度、重试和队列终态；新 `decision_log.py` 负责 decision append/status/review/digest；finish-work 负责交互式审查，`task.py archive` 负责确定性兜底。
- schema 2 的 planning 任务在 hash 与 manifest 一致时直接 `start_task`，不返回逐任务 `confirm_brief`；schema 1 outstanding action 仍按旧协议恢复。
- AI 决策只允许 `low|medium` 风险，记录可审计结论、候选、选择、依据、证据、影响范围和验证结果，不记录思维链。新增决策会使旧 review digest 失效。
- 成功 queue item 的 `completed` 仅表示本地精确提交完成，不改变 `task.json.status`。决策日志随任务的精确提交持久化，并在以后归档时自然移动。
- running 阶段继续复用现有 implement -> Check-All -> 最多 3 轮 fix/recheck -> spec update -> exact commit-only 链路。任务级失败只影响自身及显式依赖项，独立任务继续。
- commit-only 必须使用 exact files，排除 runtime、route prefs、protected paths 和其它任务目录；禁止 `git add .`、`git add -A` 或依据 dirty 时间差猜测归属。
- SKILL 只保留语义边界和 action 调度；manifest schema、确定性校验、Git 解析与错误矩阵下沉到 runner/helper。新增内容通过替换旧规则控制体积，不靠提高预算上限消除告警。
- 项目自有源码新增维护性注释使用中文；公开 API 按项目约定补充完整 Docstring/Javadoc 风格说明。

## Acceptance

- [ ] 多个 planning 任务启动后先完成全队列 prepare，running 阶段不再逐项出现 `confirm_brief` 或 Open Questions 提问。
- [ ] 启动指令是唯一 run 级授权，manifest 明确绑定原始/执行顺序、依赖、profile、route、check depth 和每项 planning/handoff hash。
- [ ] 任一未解决 Open Questions 都阻止整个队列进入 running，并由主会话逐项引导人工处理；AI 不代答。
- [ ] 其它 planning blocker 可自动修复最多 3 轮，修复与自主决策均可审计；越过高风险边界时任务稳定 blocked。
- [ ] AI 决策同时写入 runtime 摘要和任务 `decisions.jsonl`；合法 artifact 更新产生新 manifest revision，无决策事件的漂移被阻断。
- [ ] finish/archive 对未审查决策展示摘要并要求一次 review；无决策任务不增加确认，未接受或损坏日志时 archive 零副作用失败。
- [ ] 显式依赖支持稳定拓扑重排，拒绝循环、缺失和自依赖；前置任务失败只阻塞依赖项，独立任务继续。
- [ ] staged、冲突、未完成 Git 集成在启动前全局阻断；无关 dirty 可作为 `protected-retained` 保留且不会被修改或提交。
- [ ] 可恢复失败在当前任务内即时重试，planning repair 与实现 fix/recheck 各最多 3 轮；队列结束后不自动二次恢复。
- [ ] 全成功进入 `completed`，部分失败进入 `completed_with_blocked`，真正全局问题进入 `globally_blocked`；结果包含逐项终态和恢复方式。
- [ ] auto-loop 只执行本地 commit-only，不归档、不推送、不发布；完成后 Trellis 任务仍为 `in_progress`。
- [ ] schema 1 runtime、route/check depth、Check-All `record + next`、`retry-blocked` 和 existing commit-only 行为保持兼容。
- [ ] canonical Auto-Loop SKILL 独立纳入上下文预算，目标不超过 `16 KiB`；strict 检查不得突破 `18 KiB` review ceiling，且不改变既有 `control-context-total` 公式。
- [ ] runner、decision log、archive guard、finish-work Patch、selective install、同步生成物和 dogfood 场景测试覆盖完整，并通过 `git diff --check`。

## Next Step

用户确认本 brief 与 `prd.md`、`design.md`、`implement.md` 后，执行：

```bash
python3 ./.trellis/scripts/task.py start 07-24-auto-loop-unattended-run
```

任务状态切换为 `in_progress` 后，再按 Trellis Phase 2 路由进入实现；本轮不提前修改产品代码或 runner。
