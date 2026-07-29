# 补全 Trellis Meta 的 Skill-Garden 增强架构

## Goal

让安装了 Flower/Skill-Garden 增强的 Trellis 项目中，`trellis-meta` 能准确表达增强层已经接管的架构、所有权、修改入口和运行时边界，并系统解决上游原生 meta 中已经失真的描述，避免 AI 直接编辑受管文件、遗漏 Patch Engine 或绕过现有 workflow owner；同时修复本任务暴露的 Auto-Loop 与 Check-All 文档漂移合同冲突，使合法 `DOC-*` 修复不会误入终态阻塞，action 内可恢复漂移能够由 agent 有界自纠并重录。

## Background

- 当前 `.agents/skills/trellis-meta/**` 与 `.claude/skills/trellis-meta/**` 和 `@mindfoldhq/trellis@0.6.5` bundled 模板逐字节一致，Skill-Garden Patch catalog 未修改 `trellis-meta`。
- 当前 meta 只描述上游 Trellis 的 workflow、persistence、platform、channel runtime 和 bundled skill 模型；它把其它平台 skill 视为普通项目本地内容，没有表达 `flower/skill-garden` system Plugin 的受管投影语义。
- Skill-Garden 0.6 已通过 Patch Engine、Bundle、managed marker、首次备份、provenance、兼容/冲突策略和 compiled targets 修改 workflow、skill、hook 与平台配置。
- 当前 workflow 已包含 Request Triage、Project Knowledge Discovery、Active Task Scope Guard、Routing Gate、Check-All、Auto-Loop、提交确认、bookkeeping 和 task progress recovery 等 owner；这些行为没有进入 meta 的架构模型。
- `trellis-create-command` 把 `trellis-meta` 声明为 Trellis 本地架构权威，但 meta 未覆盖 Skill-Garden 的双平台 skill 分发与同步源，形成知识闭环缺口。
- 历史记录未发现“必须保持 meta 为未修改上游副本”的既定决策。
- 已确认采用外科式 Patch：保留上游 `trellis-meta` 的目录结构与仍有效内容，只精确替换、删除或条件化冲突段落，不完整 fork 整套 meta 文档。
- 已确认沿用原 meta 的能力边界：meta 维护稳定的能力类型、架构、所有权和发现方式，不硬编码当前 Skill-Garden skill 数量或逐项能力清单；实际能力以本地 skill、Bundle catalog、workflow 和 Plugin state 为准。
- 本任务的首次 Full Check-All 中，`implement.md` 的机械勾选符合 Check-All `DOC-*` 白名单，但 `auto_loop.py record` 在消费检查结果前先比较冻结 hash，并以 `artifact-drift` 直接阻塞队列项；随后 `completed_with_blocked` 只能由用户显式 `retry-blocked` 恢复。
- 现有 `decide --file` 能为自主语义决策重绑 artifact，但它要求写 decision log，不适合无产品取舍的 Check-All 机械文档同步；Auto-Loop 缺少专门的 DOC 重绑入口，也缺少 action 内漂移的非终态重录路径。

## Requirements

### R1. 增强层识别

- `trellis-meta` 必须区分上游 Trellis 原生层与 `flower/skill-garden` 增强层。
- 必须说明增强层是显式 builtin system Plugin，通过统一计划、preflight、事务、lock、state 和 Patch catalog 应用，不是零散的本地手改。
- 必须说明只有检测到对应 managed marker、Plugin state 或本地增强资产时，才把 Skill-Garden/Flower 合同视为当前项目事实；普通 Trellis 项目仍按上游模型工作。
- 当 `flower/skill-garden` 已声明并锁定时，增强层合同优先于 meta 中冲突的上游原生操作建议；不得把两套描述并列后交给 AI 自行猜测。

### R2. 原有描述冲突治理

- 必须逐项审计现有 `trellis-meta/SKILL.md` 及 references，将内容分为“继续成立”“仅原生 Trellis 成立”“增强模式下失效”三类。
- 继续成立的上游事实应保留，例如任务/规格/工作区数据模型、channel runtime、cross-session memory 和官方 bundled skill 的基础机制。
- 仅原生 Trellis 成立的描述必须增加增强模式条件，例如 `.template-hashes.json` 冲突处理和普通 `trellis update` 行为。
- 增强模式下会误导维护者的描述必须替换或删除，不能只在文末追加相反说明。
- 最终 meta 中不得同时出现“直接编辑当前部署文件”和“必须修改 Skill-Garden 源/Patch catalog”两套无优先级的操作建议。

### R3. 所有权与修改入口

- 必须纠正“除官方 bundled skill 外均为不受管理的项目本地 skill”这一过度简化。
- 必须区分上游 bundled、Skill-Garden managed、Flower managed、shared common 和真正 project-local 内容。
- 必须明确 0.6 增强修改的真实源是 `vendor/skill-garden/.trellis/0.6/`，发布快照是 `enhancements/0.6/`，当前项目 `.agents`、`.claude`、`.trellis` 文件只是 dogfood/安装结果。
- 必须明确 0.6 对既有 Trellis 文件的修改只能进入 Patch Engine，不得直接形成新的特殊注入器或只改部署副本。

### R4. Patch 与同步模型

- 必须解释 Patch、Bundle、selector/baseline/content、target policy、required preflight、managed marker、首次备份、provenance、compatibility/conflicts 和 compiled targets 的职责边界。
- 必须说明源修改、`npm run sync`、快照一致性、compiled target 刷新和当前 dogfood 副本同步的顺序。
- meta 自身的增强也必须使用声明式 Patch，并覆盖当前存在的各平台 `trellis-meta` 目标；不得直接 fork 或覆盖整棵上游 bundled skill。

### R5. Workflow owner 模型

- meta 必须认识 Skill-Garden Workflow Owner Index，但不复制各 owner skill/helper 的完整操作流程。
- 至少应能把意图路由、项目知识发现、任务范围守卫、任务 brief、implement/check route、Check-All、Auto-Loop、Update-Spec、Push、Finish-Work 和进度恢复路由到真实 owner。
- 对可能随增强版本变化的命令、状态结构和错误矩阵，meta 应指向本地 workflow、skill、helper 或 Plugin state，不维护第二份完整合同。
- meta 不维护当前 Skill-Garden skill 数量或逐项功能表；它必须给出从本地 skill 目录、`overrides/bundles/`、`.trellis/workflow.md` 和 `.flower/state.json` 发现实际能力的方法。

### R6. 跨平台与选择安装

- `.agents`、`.claude` 以及其它已启用平台中的 `trellis-meta` 必须得到语义一致的增强内容。
- 全量安装必须应用 meta 增强；精细安装 `trellis-meta` 时也必须可独立选择该 Patch。
- `trellis-create-command` 的精细安装必须获得其依赖的 meta 增强，或取消其对未增强 meta 的权威依赖；不得留下当前矛盾。
- Bundle 选择不得无意扩大其它单 skill alias 的 Patch 范围。

### R7. 上游兼容与失败边界

- Patch 必须基于当前受测 Trellis `0.6.5` 的精确 selector/baseline；上游漂移时按现有兼容策略预检失败或告警，不得静默追加到错误位置。
- 应保留上游 meta 的通用价值，不把 Flower/Skill-Garden 私有细节改写成所有 Trellis 项目的普遍事实。
- 卸载或冻结 Skill-Garden 后，meta 不得继续声称增强 owner 必然存在。

### R8. Check-All DOC 重绑

- `run_check_all` / `run_recheck` 发出时，runner 必须保存当前任务 planning/handoff 文件的逐文件摘要，供 record 阶段核对实际变化。
- Check-All 自动修复白名单内的机械文档漂移时，record 必须能显式声明精确文件；runner 只允许当前任务中受支持的文档路径，并要求实际变化集合与声明集合完全一致。
- 合法 DOC 变化必须更新 planning/handoff hash、追加可审计 manifest revision，并保留文件与来源记录；不得伪装成 AI 产品决策或要求用户执行 `retry-blocked`。
- PRD、design 或未声明文件的变化不得借 DOC 通道放行；protected-retained 漂移仍按现有安全边界阻塞。

### R9. Action 内漂移自恢复

- `run_check_all` / `run_recheck` 的 record 阶段发现未声明 planning/handoff 漂移时，默认不得立即把队列项写成 terminal blocked；应返回结构化 `retryable` 结果并保留原 outstanding action。其它 action 继续失败关闭。
- retryable 结果必须包含原因、实际/预期摘要、当前尝试次数和上限，使 agent 能撤回自身误改、补充合法 DOC 声明或重新执行同名 record。
- 自恢复必须有确定性预算；超过预算后才转为 `artifact-drift` blocked，避免无限循环。
- agent 确认漂移来自外部、用户或无法安全归因时，必须能用同名 record 显式提交 `blocked + artifact-drift`，不通过自动重绑接受未知内容。
- `retry-blocked` 继续只服务已经进入终态的稳定 recoverable reason；权限、生产、产品语义、protected path 等真实阻塞不得自动重试。

### R10. Trellis Meta 联动复核

- 修改 Skill-Garden 管理的 workflow、skill、hook、helper、Patch、Bundle、Plugin 所有权或平台入口时，必须执行一次 `trellis-meta` 影响复核，结果只能是 `no-op` 或 `patch-required`。
- owner 内部 SOP、交互细节或错误处理变化，在 owner 身份、边界、发现路径和修改入口仍准确时应记录为 `no-op`，不得为了“同步”把完整流程复制进 meta。
- owner 迁移、能力发现路径变化、作者源/所有权变化、Plugin/Patch 生命周期变化、Bundle 选择变化或平台分发面变化必须判定为 `patch-required`。
- `patch-required` 必须修改 canonical Skill-Garden meta Patch 源，并完成 snapshot、compiled target、dogfood 和最终语义验证；不得只改已部署 meta 副本。
- 本次 Planning Brief 显式预授权仍由 `trellis-task-brief` 与 task-start brief guard 拥有，meta 现有 Planning handoff 路由保持准确，因此本次影响结论为 `no-op`。

## Acceptance Criteria

- [ ] 安装 Flower/Skill-Garden 后，`trellis-meta` 能解释增强层的 Plugin、Patch、所有权、同步源和 workflow owner 模型。
- [ ] 普通未增强 Trellis 项目中的上游 `trellis-meta` 行为不受影响。
- [ ] 对当前 meta 的全部冲突描述建立覆盖测试或最终字面量断言，确保增强模式下不再保留相反操作建议。
- [ ] 受管 skill 不再被 meta 错误归类为“永不移动、可直接自由编辑”的普通 project-local skill。
- [ ] meta 不包含需要随 Skill-Garden skill 增删同步维护的固定数量或完整能力清单。
- [ ] meta 明确指引维护者先改 `vendor/skill-garden` 源、再同步 `enhancements`，并避免只改 dogfood 副本。
- [ ] meta 改造通过 0.6 Patch catalog 表达，并在 JS/Python consumer 中保持 schema、选择、preflight、provenance 和最终字节一致。
- [ ] 全量安装、`trellis-meta` 精细安装以及 `trellis-create-command` 依赖场景均有自动化覆盖。
- [ ] `npm run sync` 后 vendor 与 `enhancements/0.6` 对应源逐字节一致。
- [ ] compiled targets、Patch conflict assertions、AI context budget、完整测试和 dogfood 幂等检查通过。
- [ ] `.agents` 与 `.claude` 当前 dogfood 副本语义一致，且没有直接修改 `node_modules`。
- [ ] Check-All 对 `implement.md` / `brief.md` 的合法 DOC 修复可通过精确声明完成 manifest 重绑，record 继续推进而不产生 `completed_with_blocked`。
- [ ] 未声明 Check artifact 漂移首次返回 `retryable` 并保留 outstanding action；纠正后可重录成功，超过预算或显式判定外部漂移时才 blocked。
- [ ] DOC 通道拒绝 PRD、design、其它任务文件、未声明变化和 protected-retained 路径，且测试覆盖零静默接受。
- [ ] Auto-Loop 与 Check-All skill 明确区分 action 内自恢复和终态 `retry-blocked`，不再要求用户为内部机械冲突手动续跑。
- [ ] code-spec 定义 `trellis-meta` 联动复核的 `no-op | patch-required` 双态合同，并覆盖 owner 内部 SOP 与架构/分发变化的边界。
- [ ] Planning Brief 显式预授权被验证为 meta `no-op`：meta 继续指向 `trellis-task-brief` owner，且不复制预授权交互细节。

## Out Of Scope

- 不把每个 Skill-Garden skill 的完整 SOP、命令帮助或错误矩阵复制进 `trellis-meta`。
- 不修改上游 `@mindfoldhq/trellis` npm 包源码或发布官方 Trellis 新版本。
- 不重新设计 Patch Engine、Plugin Runtime 或现有 workflow owner 的业务行为。
- 不处理 0.5/old 变体的 meta 增强，除非实现研究发现现有安装链会产生兼容性回归。
- 不让所有 blocked reason 自动恢复，也不削弱 Open Questions、权限、生产、外部系统、protected path 或业务语义门禁。
- 不把机械 DOC 修复写入 `decisions.jsonl`，也不允许 DOC 通道修改 PRD 或 design 的语义合同。
- 不要求每次 owner 内部文案或 SOP 变化都修改 `trellis-meta`；必须复核，但只有稳定架构合同失真时才更新 meta Patch。
