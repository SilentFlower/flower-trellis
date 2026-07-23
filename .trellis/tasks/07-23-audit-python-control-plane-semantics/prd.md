# 审计 Trellis Python 控制面语义边界

## Goal

修复 auto-loop 对 PRD `Open Questions` 的机械误判，并系统审计 Trellis 当前流程中会改变任务状态、执行路由、上下文注入、质量门禁或自动循环推进结果的 Python 决策点，减少脚本输出与用户真实意图不一致的情况。

## Confirmed Facts

- `auto_loop.py` 当前按 Markdown 标题和普通列表项机械提取 `Open Questions`，不理解自然语言语义。
- `- 无。当前实现口径已确认。` 会被误判为阻塞；精确的 `TBD` 反而会被忽略，当前实现同时存在假阳性和假阴性。
- 已确认采用 Markdown checkbox 作为新文档的显式状态：`- [ ]` 表示未解决，`- [x]` 表示已解决。
- 已解决的问题在 PRD 收敛阶段应移入 `Decisions` 或删除；没有开放问题时不保留占位列表项。
- 普通无状态列表项需要兼容历史 PRD，不能简单按问号或少量自然语言关键词决定是否放行。
- 审计范围不限于 auto-loop，应覆盖当前 Trellis 流程中由 Python 脚本作出的机械解析、状态推断、静默兜底和格式耦合决策。
- 首轮审计除 Open Questions 外还提出了跨任务 route 授权、task start/finish 假成功、JSONL 跨仓路径、runtime JSON 损坏状态合并等候选；逐项评审后的最终分类见 `research/python-control-plane-audit.md`。
- 用户要求对 F2-F12 候选逐项讨论，不把首轮静态审计直接视为最终缺陷结论；每项必须结合现有保护、真实触发概率和业务影响判断是否过滤。
- F2 已确认纳入：保留 auto-loop 全局/唯一 running run fallback，但 route 授权生效前必须验证当前任务属于该 run 的未完成队列；任务不匹配时返回 miss，不写 runtime route decision。
- F3 已确认纳入且限制为 `task.py start` 启动链路的局部修复：状态写入失败必须返回非零；active-task pointer 设置失败时补偿恢复原状态；失败路径不得执行 `after_start` hook；不扩展为通用 task store 事务框架。
- F4 已确认纳入：清理 session active-task pointer 失败时必须返回非零，不得输出成功或执行 `after_finish` hook；`clear_current_task()` 必须传播真实清理结果。无当前任务和多 session 无法安全选择时继续保持现有保守行为。
- F5 的仓库外路径限制不纳入：存在从 `flower-trellis` 创建任务和规划、按次修改任意 sibling repository（例如 `/root/project/ai-fund`）的合法跨仓流程。JSONL 是上下文清单而非文件系统授权边界，必须保持当前跨仓读取和实施能力，不新增目标仓声明步骤。
- F6 已确认按收窄范围纳入：修复 task create、set-*、父子任务双文件关系和 archive 关键状态写入的假成功；重复 slug 不得覆盖现有任务；active pointer 自动设置继续 best-effort 但必须可诊断；不扩展为完整 task store/archive 事务框架。
- F7 已确认按 runtime 控制面范围纳入：`.trellis/.runtime/**` 写入使用同目录临时文件和原子替换；读取区分 missing、corrupt 与 I/O error；损坏的 auto run/session/route 状态不得静默视为缺失或跨任务 fallback。普通 task/config JSON 不在本项范围。
- F8 已确认本轮不改：brief freshness 继续遵循现有 mtime 契约；内容 hash 属于尚无实际故障证据的增强设计，记录为已知限制，待出现真实误判或独立需求时再处理。
- F9 已确认按诊断增强纳入：无 active task 的 progress 扫描继续只自动使用健康候选，但额外返回 `invalidCandidates` 和 `scanWarnings`；不改变 progress schema、退出码或任务数据。
- F10 已确认放弃：现有 `task.py create` 和默认 `current` stdout 已承担稳定脚本链路，尚无真实格式漂移故障；本轮不新增 `--json` 接口，仅由相关回归测试保护现有 `current --source` 契约。
- F11 已确认放弃：workflow heading 是受管理模板的明确格式契约，且 `get_context.py` 已在章节缺失时退出码 2 并输出明确错误，不存在首轮所述的静默空上下文问题。
- F12 已确认不考虑：当前 config 模板使用的 YAML 子集可以正常解析，本轮不扩展为完整 YAML parser，也不增加配置读取 warning 系统。
- 用户要求本次升级和改造完全遵循 Skill-Garden / Flower Patch Engine 架构：不得手改 `enhancements/0.6` 快照或当前 dogfood 作为真实源；上游已有 Trellis 文件的变化必须由 Patch operation 表达，Skill-Garden 自有 runner/skill 资产必须从 vendor 权威源维护，并统一经过 sync、Patch preflight/apply 和幂等校验。

## Requirements

- R1：`Open Questions` 新契约必须明确区分未解决、已解决和无开放问题三种状态。
- R2：`- [ ]` 条目必须阻塞 auto-loop；`- [x]` 条目不应阻塞，但规划收敛阶段仍应清理已解决条目。
- R3：章节不存在或没有有效条目时直接放行，不要求写 `- [x] 无问题` 等占位内容。
- R4：历史普通列表项必须进入兼容路径；无法可靠判断时不得静默放行真正的未决问题。
- R5：修复 `TBD` 被错误放行的反向漏洞。
- R6：系统审计会影响工作流行为的 Python 决策点，至少覆盖任务状态、SessionStart/workflow-state、brief/start gate、route、auto-loop、task intent、spec discovery 和 progress 状态。
- R7：每个发现必须区分确定缺陷、可接受的保守降级和仅需增强诊断的信息缺口，不把所有 `except` 或 fallback 一概视为 bug。
- R8：对确认修复的风险补充行为测试，覆盖正常、边界、格式漂移、损坏状态和兼容场景。
- R9：修改从权威源开始，并同步发布快照与当前 dogfood 文件，避免只修本仓运行副本。
- R10：auto-loop route fallback 必须保持 task scope，不能把其它任务 run 的临时授权用于当前任务。
- R11：`task.py start` 只有在任务状态和 active-task pointer 均按当前运行模式成功落盘后才能报告成功；任一步失败必须返回非零，并补偿本次已经完成的前序状态变更。
- R12：`task.py finish` 只有在目标 session pointer 确实清除后才能报告成功并执行 `after_finish`；底层清理 API 不得把删除失败伪装成成功。
- R13：JSONL context 与 auto-loop gate 必须保持跨仓上下文兼容，不得用仓库根目录 containment 限制替代真实权限模型；若统一校验逻辑，只校验路径存在性、声明的 file/directory 类型和可诊断错误，不新增外部仓库 allowlist。
- R14：task store 命令只有在其声明的核心本地写入成功后才能输出成功；父子任务双向关系写入必须在第二次写入失败时补偿第一次写入，且正常路径不得改变 auto-loop 协议或任务 schema。
- R15：runtime 控制面 JSON 必须采用抗截断写入；当前 run 或当前 session 状态损坏时必须提供结构化诊断并保留原文件，只有可唯一恢复的 pointer 损坏允许自动重建指针。
- R16：progress 候选扫描不得把确定损坏的恢复记录伪装成“完全不存在”；必须在保持健康候选和现有退出码兼容的前提下返回附加诊断。
- R17：上游已有 Trellis 文件的修改必须从 `vendor/skill-garden/.trellis/0.6/overrides/patches/` 进入 Patch Engine；不得新增旁路注入器或直接维护最终 dogfood 差异。
- R18：`auto_loop.py`、`task_progress.py`、`task_intent.py`、`route_state.py` 等 Skill-Garden 自有资产必须从 vendor 权威副本修改，经 `npm run sync` 生成发布快照，再由 Flower 增强流水线铺设到 dogfood；不得把资产复制机制伪装成对不存在目标的 Patch create。
- R19：新增或调整的 Patch 必须具备 bundle 归属、精确 selector/baseline、managed marker、冲突断言、JS/Python consumer preflight 覆盖和二次应用零变更证明。

## Acceptance Criteria

- [x] AC1：`Open Questions` checkbox 契约有代码、规范和测试共同约束。
- [x] AC2：`- [ ] 待确认事项` 会阻塞，`- [x] 已解决事项`、空章节和无章节不会阻塞。
- [x] AC3：`TBD`、`待确认`等真实未决内容不会被兼容逻辑静默放行。
- [x] AC4：历史普通列表项的处理策略可审计，AI 语义判断若参与流程，结果必须结构化回写且无法确定时保守阻塞。
- [x] AC5：形成 Python 控制面风险清单，逐项包含触发条件、实际影响、现有测试、建议处理和是否纳入本任务。
- [x] AC6：纳入范围的确定缺陷完成修复及回归测试；未纳入项明确记录后续边界。
- [x] AC7：源文件、`enhancements/0.6` 快照和当前 dogfood 副本保持一致。
- [x] AC8：相关 Python 测试、同步校验和 `git diff --check` 通过。
- [x] AC9：所有上游文件差异均能在 Patch provenance 中追溯到 operation；Skill-Garden 自有资产均能追溯到 vendor 源和 `enhancements/MANIFEST.json`。
- [x] AC10：`npm run sync` 后 vendor 与 `enhancements/0.6` 对应文件逐字节一致；当前 dogfood 完整应用两次后第二次 Patch 修改数为 0，目标文件 hash 不再变化。
- [x] AC11：跨仓 JSONL 上下文继续支持类似 `../ai-fund/...` 或绝对外部路径，不新增仓库 allowlist。

## Out of Scope

- 不把所有自然语言内容都交给模型判断；结构化、确定性的状态仍由 Python runner 负责。
- 不因为静默 fallback 的存在就默认改变行为；只有能证明会造成错误状态、错误路由、错误放行或难以诊断的偏差才纳入修复。
- 不修改 brief freshness 的 mtime 契约，不新增 task CLI `--json`，不改 workflow heading parser，不扩展完整 YAML 支持。
- 不实施完整 task store/archive/git 跨文件事务，也不把 Skill-Garden 自有资产改造成非法的普通文件 Patch create。
- 本规划阶段不启动任务、不修改运行逻辑。

## Notes

- 2026-07-23：`trellis mem search "auto-loop Open Questions Python runner blocked"` 在当前项目历史中未找到匹配；本轮以用户提供的 rollout、auto runtime、代码、测试和 git 历史为权威证据。
- 2026-07-23：最终纳入 F1/F2/F3/F4/F6/F7/F9；F5 保持跨仓兼容且不新增边界限制；F8/F10/F11/F12 不改。
