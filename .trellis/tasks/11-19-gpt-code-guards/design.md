# GPT 工程判断提示设计

## Ownership And Change Points

- 唯一正文作者源为 `src/assets/flower_session_start.py::MODEL_WORKFLOW_HINT_BODY`；在当前英文正文中补充简短的工程选择规则。
- Astra、Sol、Sol 6.1 和通用 GPT 均从同一正文生成；保留现有模型替换、外层标签、开关及注入条件。
- Flower builtin 内容投影负责更新 `.trellis/scripts/flower_session_start.py`，同时维护 `.flower/plugin-lock.json` 和忽略的 Plugin state。
- 本轮源变更位于 Flower；Skill-Garden 作者源和 canonical compiled targets 按实际依赖判断，避免无意义生成。

## Prompt Semantics

补充内容以工程选择为主：

1. 明确禁止推测性保护/容量门槛和静默兜底。保护分支、容量阈值、超时和兜底须具备需求、具体证据、实测资源预算或依赖合同依据，范围保持最小。
2. 优先流式、分批及有界并发，按进展区分等待与停滞。
3. 在信任边界和使用点校验实际相关输入，按合同兼容附加元数据。
4. 保持真实错误及恢复方式可见，保留适用的身份、授权、完整性和单次执行保护。
5. 正常规模、长任务和恢复路径的通过性与危险输入的拒绝共同验收，既有保护作为现状证据重新审查。

规则约束实现选择，不授权绕过已有安全或工作流门禁，也不要求每个常规工程参数另行询问用户。

## Budget And Compatibility

前期短段落试算使 Sol 6.1 完整块由 1447 B 增至 1889 B；最终以实际审阅文本和 checker 测量为准。继续执行 2048 B 既有完整块预算及 SessionStart 分段/总量预算；需要压缩时优先合并重复表达，并核对原有要求完整性。

实施时按用户对实际作用的追问强化明确禁止语气，并合并原有重复提醒。当前完整块实测：Astra 1672 B、Sol 1664 B、Sol 6.1 1676 B；模型名和标签归一后仍为同一正文。

`test_models_reuse_reviewed_workflow_body` 固定了旧正文 SHA-256；本任务审阅新正文后更新该证据，并增加新增语义断言，保留跨模型归一一致性、开关、注入与失败诊断矩阵。

## Evidence And Behavioral Evaluation

工程验收复用真实 Hook 和隔离安装测试，证明内容出现的位置、次数、字符预算及兼容条件。

`research/guard-cases.md` 记录源案例、期望实现和评分维度，供同模型、同推理档位、同任务输入的前后多次对照。评分关注正常场景完成、保护依据、错误与恢复、关联入口和必要安全保护。当前任务的工程测试不标为实际模型行为实验。

## Distribution And Rollback

经 Flower Plugin 生命周期更新当前项目，重复应用核对零内容变化；README 与 `trellis-patch-engine.md` 同步正文语义和证据边界。按精确源码、测试、说明、项目投影与 lock 集合审查、提交和回滚。
