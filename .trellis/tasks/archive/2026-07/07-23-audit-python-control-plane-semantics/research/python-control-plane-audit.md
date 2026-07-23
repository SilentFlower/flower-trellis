# Python 控制面语义边界首轮审计

## 审计范围

本轮优先检查会直接影响以下结果的 Python 决策点：

- planning / in_progress / completed 等任务状态
- session active-task pointer 与 workflow-state 注入
- implement / check route 选择
- auto-loop 队列推进、恢复和 blocked 判定
- brief/start gate 与 JSONL context gate
- task intent 自动创建/丢弃
- task progress 恢复
- spec discovery 与 workflow Markdown 提取

## 已确认缺陷

### F1. Open Questions 同时存在假阳性和假阴性

- 位置：`vendor/skill-garden/.trellis/0.6/scripts/auto_loop.py::_open_questions`
- 当前行为：普通列表项除精确 `TBD` / `N/A` 外全部阻塞。
- 影响：`无。当前实现口径已确认。` 被误阻塞；真实未决的 `TBD` 被静默放行。
- 证据：用户提供的 `auto-20260722113620.json` 和 rollout；本仓输入矩阵复现。
- 建议：新文档采用 `- [ ]` / `- [x]` 显式状态；无章节/空章节放行；历史裸列表进入结构化 AI review，`ambiguous` 保守阻塞并记录 PRD hash。

### F2. auto-loop route 授权可能跨 session / task 串用

- 位置：`.agents/skills/trellis-route/scripts/route_state.py::_auto_route_mode`
- 当前行为：当前 session 未绑定 `current_auto_run` 时，可读取全局 `current.json` 或项目中唯一 running run；函数没有接收或校验当前 task。
- 最小复现：session B 当前任务为 task-b，项目唯一 running auto run 的队列只有 task-a，route helper 仍返回 task-a 的 `subagent` 授权，`reason=null`。
- 影响：另一个会话的 auto-loop 临时 route 可能被写为当前任务的 route decision。
- 建议：auto route 必须同时匹配 session 绑定和当前 task；全局/唯一 run fallback 只能用于诊断或必须验证队列当前项等于 current task。

### F3. `task.py start` 在状态写入失败时仍返回成功

- 位置：`.trellis/scripts/task.py::cmd_start`
- 当前行为：先写 active-task pointer，再尝试把 task status 从 planning 改为 in_progress；`write_json()` 返回 false 时不报错，继续输出上下文提示、运行 hook 并返回 0。degraded mode 同样会返回 0。
- 最小复现：mock `write_json=False` 后命令退出码为 0，task status 仍为 planning，但 active pointer 已报告设置成功。
- 影响：CLI、auto-loop 和 AI 都会把未真正启动的任务当成启动成功，状态与 pointer 分裂。
- 建议：把 pointer/status 更新做成可补偿事务；任一步失败返回非零，并恢复已完成的前序写入。

### F4. `task.py finish` 在 session 文件删除失败时仍报告清理成功

- 位置：`.trellis/scripts/common/active_task.py::clear_active_task`、`.trellis/scripts/task.py::cmd_finish`
- 当前行为：`_remove_file()` 的 false 返回值被忽略；`cmd_finish` 仍打印 `Cleared current task` 并返回 0。
- 最小复现：mock unlink 失败后，函数返回旧 task，session 文件仍存在。
- 影响：stale pointer 会在下一轮继续注入，用户却已经收到成功提示。
- 建议：clear 返回结构化成功状态；删除失败必须返回非零，不能运行 `after_finish` hook。

### F5. JSONL context 允许仓库外路径通过校验

- 位置：`.trellis/scripts/common/task_context.py::cmd_add_context` / `_validate_jsonl`，以及 auto-loop `_has_real_jsonl_entries`
- 当前行为：使用 `repo_root / file_path` 检查存在性，没有做 resolve 后的根目录包含校验；`../outside.md` 可作为合法 curated entry。
- 最小复现：根目录外文件存在时，`_validate_jsonl()` 返回 0 并显示一条有效 entry。
- 影响：sub-agent context gate 可被仓库外文件满足，也可能读取与任务无关或敏感的本地文件。
- 用户补充的合法场景：任务和规划保存在 `flower-trellis`，实施目标可能是每次不同的 sibling repository（如 `/root/project/ai-fund`）。JSONL 只是上下文清单，不承担文件系统授权。
- 评审结论：过滤“仓库外路径即漏洞”的首轮判断，不增加 containment 或目标仓 allowlist。保留外部相对/绝对路径能力；后续若统一 `task.py validate` 与 auto-loop gate，只校验存在性、file/directory 类型并增强错误诊断。

### F6. task 创建和父子关系更新存在多处“写失败但继续成功”

- 位置：`.trellis/scripts/common/task_store.py`
- 当前行为：初始 `task.json`、parent/child 双向链接、archive 状态和 set-* 操作多处忽略 `write_json()` 返回值；自动激活还捕获所有异常后静默 `pass`。
- 影响：可能生成缺 task.json 的半成品任务、单向 parent/child 链接，或返回 Created 但 planning pointer 未建立。
- 额外偏差：`task_intent.py` 的 `autoDiscardEligible` 只看 context key 是否存在，没有验证 task create 是否真的激活成功。
- 建议：创建/链接/归档按事务边界校验写入并补偿；best-effort 激活失败应明确输出 degraded reason，intent helper 不得报告可自动丢弃。

### F7. runtime JSON 非原子写入，损坏状态又被当成“缺失”

- 位置：`auto_loop.py`、`route_state.py`、`active_task.py` 和 `common/io.py` 的 JSON I/O。
- 当前行为：直接 `write_text()` 覆盖；进程中断可能留下截断 JSON。读取层通常把 missing、invalid JSON 和 I/O error 合并为 `{}` / `None`。
- 影响：损坏 auto run 会显示“不存在”并可能允许新 run；损坏 session runtime 会退回 prefs/auto 并可能覆盖原文件，丢失其它状态。
- 建议：临时文件 + fsync/replace 的原子写入；读取结果区分 missing / corrupt / io-error；控制面状态损坏默认失败关闭并给出恢复路径。

## 已确认的设计弱点

### F8. brief freshness 只比较 mtime，不验证内容版本

- 位置：`.trellis/scripts/task.py::_validate_planning_brief`
- 当前行为：只要 brief mtime 不早于 prd/design/implement 就放行。
- 影响：复制/还原旧时间戳、手动 touch brief、文件系统时间异常都可能让内容过期的 brief 被视为 fresh。
- 当前规范明确采用 mtime，因此这是设计弱点而不是实现偏离。
- 建议：brief 生成时记录权威 artifacts 的内容 hash；start gate 校验 hash，mtime 只作为兼容提示。

### F9. progress 候选扫描会静默丢弃损坏进度

- 位置：`.trellis/scripts/task_progress.py::_progress_candidates`
- 当前行为：无 active task 时，invalid task.json / invalid progress schema 直接 continue；最终可能显示 `no-current-task`。
- 影响：本应提示修复的恢复记录从候选中消失，AI 误以为不存在进度。
- 建议：候选输出同时返回 valid candidates 和 invalid candidates diagnostics。

### F10. 多处 helper 反解析面向人的 stdout

- 位置：`task_intent.py::_find_created_task`、`route_state.py::_current_task`、`auto_loop.py::_current_task_ref/_current_session_key`。
- 当前行为：依赖英文前缀 `Current task:`、`Source:` 或 `.trellis/tasks/` 行。
- 影响：上游输出本地化、ANSI、格式调整或警告混入时，真实成功可被识别成 no-current-task / create-output-invalid。
- 建议：为 task.py 增加稳定 `--json` 输出，所有 helper 只消费结构化接口。

### F11. workflow Markdown 提取依赖精确标题格式

- 位置：`.trellis/scripts/common/workflow_phase.py`
- 当前行为：Phase Index、Phase 1 和 `#### X.X` 标题格式漂移时返回空字符串，不带结构化错误。
- 影响：SessionStart 或 phase context 可能缺少关键流程正文，但调用方不一定知道是解析失败。
- 建议：保持标题契约，同时在找不到 step/index 时返回显式错误；发布测试覆盖真实 workflow 全部 step。

### F12. 简化 YAML parser 对不支持语法会静默默认

- 位置：`.trellis/scripts/common/config.py`、`common/trellis_config.py`
- 当前行为：仅支持项目约定的 YAML 子集；未知/复杂语法可能被跳过或解析为字符串，读取错误通常返回空配置。
- 影响：dispatch mode、package、hook 或 session 配置可能回落默认，表现为“配置写了但没生效”。
- 建议：明确验证支持的 schema；遇到非空配置但无法可靠解析时输出 warning/error，而不是静默默认。

## 当前判断为合理的保守行为

- 多 session 同时存在时，active-task fallback 拒绝任选一个任务：这是防止跨窗口污染的必要边界。
- lifecycle 外部 hook 失败只告警、不回滚 task 本地状态：当前规范明确为 best-effort；可增强摘要，但不应默认改成强事务。
- spec-router 的匹配是知识发现建议而不是状态权威；允许 no-match，但应保留现有测试和可解释 reason。
- auto-loop 遇到未知 step 或真正未决产品问题时 fail closed：方向正确，问题在于输入状态契约不清晰。

## 测试缺口

- `test_auto_loop.py` 没有 planning start gate / Open Questions 测试。
- `test_route_state.py` 当前只有 legacy mode 归一相关测试，未覆盖 spec 要求的 runtime/prefs/auto-loop 优先级、task 隔离和多 session 场景。
- 没有 task_progress 行为测试。
- task start 测试未覆盖 status write failure 和 pointer/status 补偿。
- workflow-state 测试未覆盖 session unlink failure。
- task context 缺少跨仓相对/绝对路径兼容和 auto-loop gate 一致性测试。

## 逐项评审状态

- F1：方向已确认。采用 checkbox 显式状态，并为历史裸列表设计兼容路径。
- F2：确认纳入，按中等优先级修复。保留全局/唯一 running run fallback，但增加当前 task 与 run 未完成队列的匹配；不匹配返回 miss。
- F3：确认纳入，按小范围修复。仅调整 `task.py start`：状态写入失败返回非零；pointer 设置失败时补偿恢复 planning；失败路径不运行 `after_start`。不扩展为通用事务框架。
- F4：确认纳入。session pointer 删除失败必须显式失败，`task.py finish` 不得输出成功或运行 `after_finish`；`clear_current_task()` 传播真实结果。保留无当前任务和多 session 歧义时的现有保守行为。
- F5：过滤原始安全判断，不限制仓库外路径。跨仓上下文是明确需求；本任务只增加兼容回归测试，不修改路径边界行为。
- F6：确认按收窄范围纳入。修复 create 初始元数据、重复 slug、create --parent/add/remove-subtask 双文件关系、set-* 和 archive 核心状态的假成功；active pointer 自动设置维持 best-effort 并修正诊断/`autoDiscardEligible`。不实施完整 archive/git 原子事务。
- F7：确认按 runtime 控制面范围纳入。增加抗截断原子写与 missing/corrupt/io-error 分类；auto-loop 当前状态损坏时阻塞新 run，唯一健康 running run 可修复损坏 pointer；session/route 损坏不跨任务 fallback。普通 task/config JSON 不纳入。
- F8：过滤，不修改。mtime freshness 是当前明确契约，尚无实际误判证据；hash 版本留作独立增强。
- F9：确认按诊断增强纳入。候选扫描新增 `invalidCandidates` / `scanWarnings`，不自动选择损坏任务、不阻塞健康候选、不改变 schema 或退出码。
- F10：过滤，不修改。当前机器链路已有受控 stdout，未发现真实格式漂移故障；不新增 `--json`，由 F2/F7 相关测试保护 `current --source` 契约。
- F11：过滤，不修改。`get_context.py` 已对缺失 Phase Index/step 显式退出并报错，精确 heading 是托管 workflow 的合理契约。
- F12：过滤，不修改。当前模板只使用受支持的 YAML 子集且解析正常；完整 YAML 支持留作独立能力，不在本任务增加 parser 或 warning 系统。

## 最终实施分类

### 本任务推荐纳入

- F1 Open Questions 新契约与兼容 AI review。
- F2 auto-loop route 的 session/task 隔离。
- F3/F4 task start/finish 假成功。
- F6 task store 核心假成功与父子双写补偿。
- F7 控制面 runtime 原子写与损坏诊断的最小公共能力。
- F9 progress 候选扫描附加诊断。
- 对上述项目补足回归测试，并更新相关规范。

### 本任务不改行为

- F5 保持任意跨仓上下文能力，不增加 containment/allowlist；只补兼容测试。
- F8 brief 内容 hash 会改变派生产物契约，适合独立设计后实施。
- F10 不新增 task CLI `--json`。
- F11 保持受管理 workflow heading 精确契约。
- F12 不扩展完整 YAML parser 或 warning 系统。
- 完整 task store/archive/git 原子事务不纳入。
