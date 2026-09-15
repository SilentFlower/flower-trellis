# Auto-Loop 恢复阶段自动自纠设计

## 1. 目标与边界

针对 schema 2 running run，在路径登记及恢复读取文档基线时提供有界的 action 内恢复；保留原业务 action、决策依据、文件基线和已完成提交。runner 负责可确定校验与次数，agent 负责读证据并做可逆纠正，原 `record` 仍独占阶段推进。

本任务是一项完整交付：路径入口防错、pending 恢复、纠正闭环、协议同步与回归必须同时成立，不拆成能够单独宣称修好的子任务。已有检查和提交修复通道不重构；不新增业务 action、全局状态或通用执行引擎。

## 2. 文件参数与登记预检

新增可重复 `decide --task-file <name>`，只接受当前任务四文档 `prd.md`、`design.md`、`implement.md`、`brief.md`；按已解析 `--task` 生成 canonical `.::<任务目录>/<name>`，实际目标须为任务内普通文件。可与既有 `--file` 混用，规范化后去重。

`--file` 保持 `<repository>::<path>` 或主仓相对路径语义，继续支持代码文件及尚待创建的代码路径。检查登记仓库、路径边界、父目录软链、绝对路径/越界、protected 冲突；不得因为所有非文档文件都必须已存在而破坏合法新文件决策。

裸四文档名指向仓库根、但当前 task 存在同名 artifact 时，返回明确路径诊断，建议 `--task-file` 或完整键；不静默改解释规则。根目录也有同名文件或来源证据冲突时不猜测目标。运行期有原 action 时，可确定的误填进入下述恢复诊断；真正越界与 protected 问题直接拒绝。

无效登记不得写入 `decisions.jsonl`、pending decision 或 manifest。允许记录专用的错误诊断/纠正尝试元数据，run/item 仍 running；准备阶段没有 running action 时沿用 prepare 的错误处理，不借本次功能绕过规划门禁。

## 3. 固定原 action 与文档基线

首次发出 schema 2 action 时保存可重放的 action 载荷和四文档 baseline。已有 outstanding 时，next 返回同一 action：不重设 issued_at、不重取 Check baseline、不改变 depth/route/step、不重置任何预算。

执行 `next` 前做无副作用的逐文件对照：

| 情况 | 返回与行为 |
| --- | --- |
| 无漂移 | 返回原 action；新阶段才记新的 action。 |
| 当前 pending 决策与 task/run/baseline 一致，变化全部落在正确登记的 artifact 内 | 返回原 action，提示继续完成并按原 action record；不提前重绑 manifest、不消费 pending。 |
| 原 Check baseline 后只有 implement/brief 发生待申报 DOC 变化，尚未 record | 保留原 Check 和基线，要求按原 DOC 资格审查与精确声明回写；next 不接受内容或重绑。prd/design 等超出 DOC 范围且无决策的变化仍阻塞。 |
| 存在可证明的旧 basename 登记错误，或可通过撤回本 action 已证明误改恢复 | 返回带恢复指令的 retryable，保持 running 与原 action。 |
| Check 已进入既有 retryable | 继续展示原 Check 重录指令和原计数，不新开恢复预算、不重新采样基线。 |
| 无可信 baseline/pending、未知外部或跨 action 漂移、受保护内容变化、越权 | 沿原终态阻塞和依赖传播。 |

仅路径集合相等不能证明内容已授权：agent 必须检查差异是否符合原决策和任务目标；涉及人工 Open Questions、需求扩张或高风险选择时主动 blocked。runner 不从自然语言证据推断产品授权。

`status`/`resume` 展示当前恢复摘要，但不尝试修正文件、不消耗次数。新变化若使证据失效须重新诊断，不能沿用先前“可继续”的结果。

非 Check 的 record 如果遇到同一类可证明的 pending 路径错误，复用该恢复诊断，纠正后必须重新提交原真实结果；不得在纠正成功时自动消费曾失败的 record。Check record 继续由原 DOC/重录通道处理；commit_only 的 Git/部分成功检查仍由原 owner 负责，不从文档纠正扩大提交权限。

## 4. 纠正闭环

新增一个窄控制命令 `reconcile`；它不作为 `STEP_ACTIONS` 的业务 action，也不调用业务实现、Git 或 record。建议接口如下，最终帮助沿用现有 argparse 风格：

```text
auto_loop.py reconcile --run-id <run> --task <task>
  --recovery-id <诊断绑定标识> --attempt-id <本次尝试标识>
  --result ok|failed|blocked --summary <纠正结论>
  [--evidence <证据>] [--file-map <旧唯一键>=<新唯一键> ...]
```

### 4.1 诊断上下文

item 增加可选恢复上下文，包含：source（decide/next/record）、原 action 身份、原决策 ID、原文件基线/错误登记集合、观察到的漂移摘要、确定候选映射、实际尝试计数和最多三条尝试回执。`recovery-id` 绑定 run/task/action/原基线，重复查询复用同一上下文；变化只刷新诊断，不创建新预算。已有 pending 的原摘要必须与合法冻结版本及原决策记录对应，不能把漂移之后补登记的当前摘要当成原始授权。

只有可归因的文档登记问题可进入该通道。初始发现记 0 次。被拒绝的新 decide 保留诊断所需的路径事实，不保存无效决策或整个命令载荷。

### 4.2 Agent 的动作

agent 收到诊断后，在同轮读取原决策、当前任务、原基线与真实 diff，采用以下一种处理并提交 reconcile：

1. 初始 decide 被拒绝：确认 runner 给出的任务文档目标，提交精确映射；校验通过后重新调用原 decide，并在成功登记之后编辑。
2. 旧 pending 决策已误填 basename：仅在当前 task 四文档可唯一匹配、根目录无歧义、原决策内容和实际改动相符时提交精确映射。runner 核验后追加纠正审计，并将 pending 的文件键更新为正确键；保留修改前基线，不能用纠正时当前文件作为新基线。
3. 已证明由本 action 误改、需要撤回：agent 先保全新增记录并只撤回自身误改，runner 校验文件已恢复到原基线。runner 本身不恢复文件、不覆盖用户或其他会话修改。
4. 无法证明归属、涉及外部/安全边界：明确提交 blocked。

`--result ok` 仅表达 agent 已完成一次纠正；runner 必须重读文件并独立验证所有不变量，不能仅因 ok 就放行。失败且仍可安全纠正时返回 retryable，agent 继续下一轮。成功返回原 action 或重试原 decide 的准确指令，不要求用户回复“继续”。

### 4.3 路径纠正与审计

映射只接受已诊断的原错误键到当前 task 同名四文档的精确一对一映射。不得接受新增任意文件、跨任务/跨仓映射、根文件真实存在造成的歧义、`..`、软链或 protected 路径；不修改原决策的 choice、requirements、risk 等语义。

旧 pending 的修正优先复用 `load_events`、`append_decision`：追加普通 decision，保留原语义，evidence 记录原 decision ID、recovery/attempt 标识、前后文件键及证据摘要；更新 pending 引用到纠正后的 decision，保留最初 artifact baseline。原日志不删改，新记录按现有 digest 使旧 review 失效。

文档 aggregate hash 和 manifest revision 仍等原 action 的真实 record 才更新。reconcile 不能伪造实现成功、降低 Check depth、跳过 recheck，不能改 completed task 或已有 commits。

### 4.4 次数与幂等

- 三轮以显式提交的实际纠正为准，首次诊断不计数；`next/status/resume` 不计数。
- 第 1、2 次纠正失败返回 retryable；第 3 次允许成功，若第 3 次仍失败则终态 artifact-drift，并记录预算耗尽详情。
- 重放同一 attempt-id 且请求一致返回同一回执、不重复计数/追加决策；同 ID 不同载荷返回冲突。收到回执丢失后可以安全重试。
- 新漂移或重复诊断不能洗掉同一 action 的已用预算；新 action 或用户显式恢复终态时才按所属规则重置。
- 审计与 runtime 双文件写入失败时按 attempt 标识识别已落盘的纠正记录，恢复后不重复追加或切换基线；保留最后成功证据，写入失败不得报告纠正完成。
- 既有 Check `artifact_reconcile`、fix/recheck 和 commit_repair 各维持原语义。一个错误只归一个通道；Check 首次 record 已返回 retryable 后，不再通过 reconcile 获得第二套三轮预算。next 首先发现的恢复问题则由本通道持有，解决后才允许原 record。

## 5. 兼容与安全门禁

- schema 2 增加可选字段，run/item 的持久状态不新增 retryable，保证 route_state 继续识别 running。schema 1 保持旧行为，不强制迁移。
- 旧 schema 2 若有可信 pending baseline 可恢复；只有 aggregate hash、无可信逐文件证据的漂移继续阻塞。缺 action 完整载荷但有旧 last_action 时可依据现有 step 重建展示，不重置原时间及已有 baseline。
- 已终态的历史 run 不自动复活，用户仍通过 retry-blocked 明确恢复；不自动对真实历史状态执行迁移/补写。
- protected 检查须先于接受路径映射/内容变化；查询型检查不得调用会消费 protected 漂移的现有 helper。未进入纠正资格的内容漂移保持原失败边界。
- 可恢复阶段不标记依赖任务失败；最终 blocked 后才使用现有传播，独立任务继续。已有本地 commits 不回滚。
- 既有 `--file` 的代码文件用途保持；新增文档便捷参数不是通用路径自动猜测功能。

## 6. 影响文件与分发

- 作者源：`vendor/skill-garden/.trellis/0.6/scripts/auto_loop.py`；复用同目录 `decision_log.py` 已有 API，确需辅助能力时扩展它而不复制日志协议。
- 协议源：0.6 `.agents/skills/trellis-auto-loop/SKILL.md` 与 `.claude/skills/trellis-auto-loop/SKILL.md`；恢复说明须把 next/decide 的纠正与 Check 原重录明确分开，指令包含“同轮继续”与准确命令。
- 经消费者研究确定的 workflow/Check/Update-Spec owner 只补恢复出口引用，不复制整张状态矩阵；不增加新的交互确认门。
- Flower 测试：`test/python/test_auto_loop.py`、`test/python/test_route_state.py`、`test/js/workflow-gate-ownership.test.js`、`test/js/update-spec-auto-decision.test.js`、`test/js/check-all-smart-depth.test.js`，必要时补现有 decision-log 测试。
- 必查消费者：Auto-Loop Skill；Check `depth-routing.md`、`reporting-and-disposition.md`、`document-drift-auto-remediation.md`；Update-Spec `autonomous-evaluation/content.md`。route 与 Continue 不另建恢复机制，仅验证 running/权威入口兼容。
- 生成：先 canonical，必要时 compiled targets，再 `npm run sync`，通过受管安装入口更新 dogfood；现有 runtime 不入提交。
- 规范：`.trellis/spec/flower-trellis/cli/enhancements-model.md` 的 Auto Loop 契约局部更新，只修正与本功能有关的事实。

## 7. 验证与回退

用临时 Git 项目复现旧错路径 pending 和正确 pending 两条压缩恢复序列；通过真实 CLI 子进程模拟 agent 按诊断修正并执行 reconcile，不能仅单测内部 if 分支。模拟路径安全、篡改、重复恢复、三次纠正、回执丢失、部分审计写入及 Check baseline 幂等。

同时跑现有 Check/commit/dependency/schema 回归和所有恢复消费者契约。对临时安装目标验证 canonical/snapshot/dogfood 一致及第二次应用零修改，不拿实际历史 run 试错。

回退以恢复 canonical 与生成投影到已知版本为单位；已有决策审计保留，不能倒退或手写运行状态。运行中含新恢复上下文时不热降级旧 runner，先保留现场并使用匹配版本续跑或由用户显式停止。
