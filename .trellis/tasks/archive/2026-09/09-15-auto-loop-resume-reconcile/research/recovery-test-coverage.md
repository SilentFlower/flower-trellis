# Research: Auto-loop 恢复自纠测试与消费者覆盖

- Query: 新增 next/resume 文档漂移三轮自动纠正，需要哪些 CLI 回归场景；哪些现有测试或恢复消费者会与新契约冲突。
- Scope: internal；只读测试、Skill/恢复 owner 和 route 消费者，不重复主会话 runner 实现分析。
- Date: 2026-09-15

## Findings

### 研究边界与输入

本研究依据主会话提供的方案方向评估测试：保留原 outstanding action 与文件 baseline；增加 action 内恢复诊断和显式 reconcile 校验入口，不新增业务 action，不伪造成功 record；查询不计数，三次实际提交纠正仍失败后才 blocked。`reconcile` 的参数名、attempt 标识和返回字段尚待最终设计，以下建议不将其臆定为已存在接口。

现有 CLI 测试已提供隔离临时目录和子进程执行基础。无需启动开发者的真实 auto run，也不需要为了这个修改引入新的测试框架。

### 已定位文件

| 文件 | 用途和定位 |
| --- | --- |
| `test/python/test_auto_loop.py:16` | 测试复制 canonical runner，而不是仅测当前安装副本；`SOURCE_RUNNER` 指向 vendor 源。 |
| `test/python/test_auto_loop.py:25` | `setUp` 创建临时 Trellis 目录、session 环境和两个任务。 |
| `test/python/test_auto_loop.py:63` | `runner()` 用 subprocess 调 CLI、断言退出码并解析 JSON，适合复现跨进程恢复。 |
| `test/python/test_auto_loop.py:105` | `advance_to_check()` 可复用的 Check 前置。 |
| `test/python/test_auto_loop.py:526` | `start_task` 文档无 decision 漂移立即阻塞的现有测试。 |
| `test/python/test_auto_loop.py:546` | Check DOC 声明重绑 manifest、白名单/集合不匹配、retryable、预算和显式 blocked 的测试组。 |
| `test/python/test_auto_loop.py:771` | 失败只传播给依赖项，独立任务继续。 |
| `test/python/test_auto_loop.py:851` | protected 文件内容漂移立即阻塞，需继续保留。 |
| `test/python/test_auto_loop.py:948` | 正确 decision 路径通过下一次 record 重绑；目前没有夹入恢复查询的场景。 |
| `test/python/test_auto_loop.py:1232` | 旧 Check artifact_reconcile 预算显式恢复重置。 |
| `test/python/test_auto_loop.py:1250` | manifest 历史外置审计，后续含旧 runtime 迁移测试。 |
| `test/python/test_auto_loop.py:1611` | 现有 resume 断言主要验证已完成多仓 commit 摘要保留，未覆盖未完成 action 的文档漂移。 |
| `test/python/test_auto_loop.py:1731` | commit repair 独立三轮预算和已完成提交保留。 |
| `test/js/workflow-gate-ownership.test.js:294` | 明确要求只有 Check 自纠、其它 action 漂移阻塞的静态断言。 |
| `test/js/update-spec-auto-decision.test.js:84` | 验证 Check Auto-Loop Return Gate，另在 133 行附近验证 Update-Spec 三态映射。 |
| `test/js/check-all-smart-depth.test.js:214` | Check retryable 不调用 next、DOC 范围和三轮常量契约。 |
| `test/python/test_route_state.py:66` | auto route 只授权未完成队列中的同一任务；可加恢复状态兼容用例。 |

下文的 `canonical/` 均表示 `vendor/skill-garden/.trellis/0.6/`。源改动还需要经同步落入 `enhancements/0.6/`；`.agents` 与 `.claude` 应保持一致，不可只改当前项目已安装副本。

### 建议新增的有意义 CLI 场景

| 编号 | 准备与操作 | 必须验证的行为 |
| --- | --- | --- |
| R1 正确登记跨恢复 | 发出 `run_implement`；正确 `decide --file <task>/implement.md --file <task>/design.md`；修改文件；分别执行新进程 `status`、`resume`、`next`；之后完成实施并 record。 | 恢复不进入终态；业务 action、issued_at、原文件 baseline、route 不变；修改仍绑定原 decision；没有虚假实施成功事件；最终 record 消费一次 decision、产生一次合法重绑。查询阶段是否预绑定 manifest 由最终设计确定，但不得重复追加审计。 |
| R2 Check baseline 稳定 | 发出 Check 后保存完整 outstanding；修改 implement；重复 `next`，其中一次跨 resume；随后以原 Check action 补精确 DOC 声明 record。 | next 不把“修改后的文件”重采样成新 baseline，不重置 issued_at；补声明仍能匹配真实变化；Check 深度、DOC 白名单不改变。须测行为结果，不能只断言 action 名称相同。 |
| R3 无漂移恢复幂等 | 在同一 action 下多次 `next/status/resume`，覆盖 compact 和 verbose。 | 不新增业务 action，不增加任何纠正预算，不消费 pending decision，不产生重复 action 审计；默认输出无完整 manifest 历史。 |
| R4 原事故兼容 | 用旧 runtime fixture 表示已有 decision 的 `implement.md` / `design.md` 裸 basename，实际改的是当前任务文件；恢复诊断后提交纠正。 | 只允许精确映射当前任务四文档；保留原 decision 内容和证据；修正映射可审计；恢复继续原实施，不要求新 run 或虚假 `record ok`。未来 decide 若提前拒绝裸路径，不能因此删掉这个旧 runtime 兼容用例。 |
| R5 basename 负例 | 根目录和当前任务都有同名文件、其它任务同名文档、非四文档 basename、带 `../` 路径、符号链接逃逸、错误仓库 identity。 | 不做模糊搜索/跨任务匹配；有歧义或越界即拒绝；不改其他文件，不吞掉真实 repo-root 意图。若历史裸 basename 的精确规则无法排除根目录真实文件，必须保留为设计边界，不在测试里假设安全。 |
| R6 查询不耗预算 | 首次诊断漂移后连续至少四次 `next/status/resume`，穿插同一进程外恢复。 | 仍是同一可纠正状态，预算未增加；不存在“查四次状态就 blocked”。诊断应包含可执行恢复入口和原 action，而非只给错误原因。 |
| R7 三次实际纠正 | 提交三次不同的、确实未通过的纠正尝试，间隔插入任意查询。 | 计数只在显式实际纠正校验时增加；1/2 次失败允许继续，第 3 次失败按最终方案 terminal blocked；用 CLI 观察而非直接改计数到边界。与既有 Check 的“第 4 次 record 才 blocked”明确分开。 |
| R8 重复 attempt 幂等 | 同一个 attempt 标识/相同冻结请求因响应丢失被提交两次；再重启 CLI 重放；另提交新 attempt。 | 重复请求不重复消耗预算、不重复写 decision/manifest/audit；新 attempt 才增加；同标识不同载荷拒绝，不用成功缓存覆盖新变化。具体 attempt 字段待设计确认。 |
| R9 修复后继续与清理 | 第一或第二次纠正成功，继续实施，最后真实 record；下一个 action 再出现独立漂移。 | 恢复记录不完成业务 action；旧恢复状态不泄漏到下一 action；成功清理/重置按 action 作用域发生，新漂移预算不继承无关 action。 |
| R10 Check 自纠不双计数 | Check record 首次返回现有 retryable；执行 resume/next 获取恢复诊断，再提交一次合法 DOC 或一次失败纠正。 | 原 Check outstanding/baseline 保留；同一次失败不能同时增加旧 `artifact_reconcile` 与新恢复预算；不能通过 next/reconcile 往返刷新预算或绕过 DOC 白名单；修复成功后保留原有效检查结果，不重跑无意义检查。 |
| R11 即时安全阻塞 | protected-retained 被改；错误任务/仓库/action；无可验证来源的外部修改；修改人工 Open Questions 或风险边界。 | 不进入宽松自动授权，不更改 protected baseline，不把所有 dirty 当 owned；立即按边界阻塞或结构化拒绝，不消耗普通自纠预算掩盖安全问题。 |
| R12 队列传播时点 | A 漂移待纠正，B 显式依赖 A，C 独立；先成功纠正一遍，再单独复现预算耗尽。 | retryable 阶段不把 A/B 标成 blocked，不结束 run 或清 pointer；实际 terminal 后才传播 A→B；C 继续的既有语义保持。不能只测单任务 done。 |
| R13 提交/终态兼容 | commit-only 已有部分成功 commits 时遇到文档恢复；另测 schema 1 outstanding 与缺恢复字段的 schema 2。 | commit repair 预算和已有 commits 不丢失、不重复提交；新恢复不改 schema 1 动作协议；旧 schema 2 可恢复或给稳定诊断，不 traceback；显式 retry-blocked 只重置适用恢复计数。 |
| R14 输出与生命周期 | 检查 retryable 下默认/verbose 输出、status 摘要、task.json 和 current pointer，再检查真实终态。 | retryable 不返回业务 `action=done`，不写 `task.json.status=completed`，不清 current pointer，不生成本任务 pending_archive，不触发 finish-work/push；终态仍提供真正完成任务的归档待办。 |
| R15 注册早失败 | 新 decide 路径参数不存在、跨仓错配或白名单冲突；随后用正确参数重试。 | 错误在写入 decision/runtime 前返回；失败无半条 decision 或残留 pending；正确重试可继续。若任务路径便利参数留后续，不为未实现参数写测试。 |

R1/R2/R4/R6/R7/R8/R10/R11/R12 是此次故障的核心回归集。R13 应沿用现有 fixture 只加新恢复交互的最小断言，不重复测试完整 Git 实现。

### 现有断言冲突与保留原则

1. `test/js/workflow-gate-ownership.test.js:295` 强制匹配“其它 action 仍按 artifact-drift 阻塞”。这是明确需要替换的旧协议断言；替换为原 action 恢复入口、查询不计数、三次实际纠正失败以及越界阻塞的 owner 契约，不能只删除断言。
2. `test/python/test_auto_loop.py:526` 覆盖的是 `start_task` 时未经授权修改已展示 brief。它不等同于有 pending decision 的实施恢复。若 `start_task` 不在新安全恢复范围，应保留原断言；若纳入，需分成可证据纠正和无来源变更两个场景，不能全改 retryable。
3. `test/python/test_auto_loop.py:653` 明确让三次 Check record 返回 retryable，第 4 次 blocked，计数最终为 4；`1232` 明确恢复该旧计数。新方案三次“实际纠正”耗尽与旧三次“允许自纠”不是同一口径。需在设计中明确是否保持旧 Check 路径或迁移到统一计数，否则容易出现新老边界混用及 off-by-one。
4. `test/js/update-spec-auto-decision.test.js:89` 和 `test/js/check-all-smart-depth.test.js:218` 要求 Check record retryable 后不得 next。若保留“主动纠正优先、偶发恢复 next 仅幂等返回诊断”的语义，这些 owner 行为规则可以保留，但需精确限定为 record 返回后的调度规则；不能推广成 runner 收到 next 就终态阻塞。
5. `test/js/update-spec-auto-decision.test.js:133` 之后验证 Update-Spec 的 `no-op|written -> record ok`、`needs-review -> blocked`。这些业务结果映射应保留。扩展点是 record/next 的协议返回如何承接，而非改变业务三态。
6. `test/js/update-spec-auto-decision.test.js:149` 附近以及 `test/js/check-all-smart-depth.test.js:227` 后覆盖源与发布快照一致；修改 canonical 后必须同步，不能用已安装副本绕过。
7. `.trellis/spec/flower-trellis/cli/enhancements-model.md:2409`、`2412`、`2444`、`2507` 仍写“其它 action / next 漂移立即 blocked”和 Check-only 预算。这些是此次合同变更的必要 spec 同步点。文档另有历史生命周期表述不一致，见 Caveats，不应在本测试研究里顺带重构。

### 恢复消费者与误判终态风险

| 消费者 | 已有行为 | 对新协议的影响 |
| --- | --- | --- |
| `canonical/.agents/skills/trellis-auto-loop/SKILL.md:16`、`125`、`132`、`164`、`181` | 只说明 outstanding Check 的 retryable；恢复示例是 resume 后直接 next；其余 action 漂移直接 blocked。 | 首要更新 owner。新增恢复返回必须明确“先按诊断提交纠正，再继续同一 action”，不得仅列新 CLI 名称。命令成功退出或查询有 JSON 均不等于业务完成。 |
| `canonical/.agents/skills/trellis-check-all/references/depth-routing.md:42` | 通过 runner status/next 验证 run running、task 匹配、outstanding 是 Check/Recheck；失败转 interactive。 | 若持久化 run/item 状态改成 retryable，会被误判非 auto，触发不必要的交互暂停。建议保持原 running 状态，以命令结果/恢复字段表达 retryable；新增测试验证 pending 恢复仍能验证合法 auto 上下文。 |
| `canonical/.agents/skills/trellis-route/scripts/route_state.py:202`、`222`、`261` | 只接收 run.status=running 和 item.status=pending/running。 | 同上。现有 `test_route_state.py:66` / `102` 可补“恢复元数据不影响合法 route，真正 completed 不授权”的用例。无需修改 route 算法，只要新状态契约保持兼容。 |
| `canonical/overrides/patches/skills/trellis-update-spec/autonomous-evaluation/content.md:58` | no-op/written 后无条件 record ok 并立即 next。 | 如果 spec record 也能返回新 retryable，该句需要引用 Auto-Loop owner 的 retryable 处理，避免跳到业务下一阶段。英文 patch 保持英文。 |
| `canonical/.agents/skills/trellis-check-all/references/reporting-and-disposition.md:218` 和 `document-drift-auto-remediation.md:77` | 已明确 retryable 不终止、不跑 next，补声明或显式 blocked。 | 没有把 retryable 当 done 的直接证据；需同步恢复入口，以免新协议与“只补 DOC 重录”冲突。 |
| `canonical/overrides/patches/skills/trellis-continue/task-progress-recovery/content.md:18` | progress 不覆盖 auto-loop runtime，不从 progress 恢复 Git 编排。 | 新 retryable 不应写旧 terminal blocked progress，否则恢复提示会错误要求用户 retry-blocked。保持 runtime 为权威，普通 Continue 不新增一套恢复状态机。 |
| `canonical/.agents/skills/trellis-push/references/completed-task-recovery.md:13` | 只认健康终态或 recent run 的精确 pending_archive 与可验证本地提交。 | 新恢复不得进入 completed 或产生当前任务 pending_archive；已有其他任务完成的 pending_archive 可以保留，不能把整个列表存在误判当前项完成。 |
| `canonical/overrides/patches/workflow/hub/content.md:19`、`30` | Hub 只记录 Return Gate owner 与 record/next 顺序。 | 保持 Hub 轻量，详细 reconcile/预算规则放 auto-loop owner，不向高频 workflow 状态注入整套新错误矩阵。 |

在限定搜索范围（canonical Python/JS、Skill/owner，以及当前安装的 Codex/Claude hook 和 Trellis helper）内，没有发现独立消费者把 JSON `status=retryable` 直接判成 `done`。当前实际消费主要是模型按 Skill 调度；已识别的机器风险是 route 的状态白名单，而不是一个现成的 `retryable -> done` 分支。`next` 默认/verbose 输出的压缩投影由 runner 自己拥有，交给主会话确认，应通过 R14 测试它确实保留恢复字段。

### 验证命令建议

以下仅为实施后建议命令，本研究未运行测试或真实 auto run。

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s test/python -p 'test_auto_loop.py'
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s test/python -p 'test_route_state.py'
node --test test/js/workflow-gate-ownership.test.js test/js/update-spec-auto-decision.test.js test/js/check-all-smart-depth.test.js
```

同步后的分发检查按项目标准执行：

```bash
npm run patch:targets:check
node scripts/check-patch-conflicts.mjs
node scripts/check-ai-context-budget.mjs --strict
npm test
```

若修改 Patch 源，应先由主会话按 SOP 刷新 canonical compiled targets，再同步发布快照和 dogfood，最后检查。研究代理不执行这些写入命令。

### Related Specs

- `.trellis/workflow.md:169`：Auto-Loop Return Gate 的 owner。
- `.trellis/workflow.md:465`：Phase 1.2 研究持久化和角色边界。
- `.trellis/spec/flower-trellis/cli/index.md`：源目录、质量检查入口。
- `.trellis/spec/flower-trellis/cli/quality-guidelines.md:46`：零依赖测试和查询/写入错误矩阵。
- `.trellis/spec/flower-trellis/cli/enhancements-model.md:26`：先改 canonical 再同步快照。
- `.trellis/spec/flower-trellis/cli/enhancements-model.md:2343`：完整 Auto Loop Runner 契约与 required tests。

### External References

无。本任务是本仓 Python CLI 状态/协议回归研究，事实来自仓库当前文件和主会话明确提供的方案输入，不依赖外部框架或版本资料。

## Caveats / Not Found

- 本研究没有执行新协议；`reconcile` 字段、attempt identity 和允许 action 集合未定，场景表表达验收行为而非已实现 API。
- 主会话负责 runner 内部诊断、状态投影和 decision 归因算法；本研究没有独立重复确认其实现原因。
- 尚未证明历史裸 basename 能安全映射所有四文档场景；根目录确有同名文件时尤其需要最终设计作出保守选择。
- 现有 spec 的 `enhancements-model.md:2421`、`2500`、`2513` 对生命周期有历史冲突：旧说明称 runner 不改任务 completed，而当前 auto-loop Skill 与测试已按本地 completed 承接。此事实与恢复协议核心无关，避免借机扩大实现范围；本任务只修订明确受新恢复契约影响的段落。
- 行号基于 2026-09-15 研究时文件，实施修改后会移动；使用函数/测试名和章节名复定位。
