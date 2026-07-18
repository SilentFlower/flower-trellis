# 优化 Trellis Task 意图识别与强化变换能力

## Goal

让 Trellis 根据用户真实意图自动决定讨论、只读检查、直接修改、创建任务并规划或执行显式工作流动作，不再机械询问是否创建 task；同时把 skill-garden 0.6 从只能追加高优先级文本，升级为可对 Trellis 原始内容执行安全、幂等的 `insert / replace / remove` 变换，使旧 task 引导被真正替换而不是与新规则并存。

## Background

- `.trellis/workflow.md:275`、`:280-284`、`:304-321`、`:504-508` 和 `:847` 在 Phase 摘要、Request Triage、`no_task`、Phase 1 walkthrough 与 customization invariant 中重复要求 task-creation consent。
- `.agents/skills/trellis-start/SKILL.md:50` 与 `.agents/skills/trellis-brainstorm/SKILL.md:28` 会在手动启动或进入 brainstorm 时再次引入同一机械询问规则。
- `src/lib/workflow-inject.js:112-120`、`:163-180` 只把 state guard 放到原 body 前面；原规则仍然保留。
- `src/lib/skill-override-inject.js:41-55`、`:67-87` 只在 frontmatter/H1 后追加 override，不会修改原正文。
- `src/lib/apply-enhancements.js:98-129` 在 workflow/skill/hook 注入前写成功 manifest；required 变换若随后失败，会留下错误的成功状态。
- `hook-override-inject.js` 已验证“首次备份、目标不存在则跳过、内容一致不写”的安全模式可以复用。
- 历史任务 `07-08-brainstorm-planning-gate` 的门禁继续有效：创建 planning workspace 不等于允许实施，默认 `prd.md` 也不等于规划完成。

## Requirements

### R1. 意图分类

每轮请求至少区分以下意图：

- `discuss`：讨论、解释、评估或方案比较，不写文件、不创建任务。
- `inspect`：读取代码、查状态、打开本地工具或执行无副作用命令，不创建任务。
- `direct_edit`：范围明确、非破坏性的本地修改，可直接处理。
- `task_plan`：新功能、复杂修改、需求边界不清或跨层工作，创建/恢复任务并进入 Trellis planning。
- `workflow_action`：用户明确调用 `trellis-push`、finish-work、check、auto-loop 等动作，直接进入对应能力。

分类必须综合用户动词、请求范围、风险、副作用、当前活动任务和当前请求内最新显式切换，不能只按“优化”“修复”等单个关键词判断。

### R2. 自动路由、切换与反馈

- 高置信意图直接执行对应的可逆下一步，不再机械询问“是否创建 Trellis 任务”。
- **D1**：用户明确说“修一下”“实现这个”“开始做”“做吧”等实施语句，且系统高置信判断为复杂工作时，视为允许创建 task 并进入 brainstorm；该授权不覆盖 `task.py start` 或实施。
- 只有低置信且不同解释会产生明显不同副作用，或涉及破坏性操作、生产、数据库、凭证、外部系统和权限边界时，才询问一个真正影响决策的问题。
- 当前用户消息中的显式指令优先级最高；`走任务`、`不要任务`、`先讨论`、`直接做`、`先别做` 等最新指令覆盖此前推断。compact summary、旧 session 意图和普通偏好不能覆盖当前消息。
- **D3**：用户明确说“不要任务”“直接改”时，允许非破坏性的本地代码工作跳过 task tracking；高风险安全门禁仍然保留。
- 手工创建或历史 planning task 不属于自动 discard 范围；切换只让当前请求走 untracked 路由，原 task 与 session 状态保持不变。
- **D4**：显式切换只作用于当前请求，直到请求完成或再次切换；新的无关请求恢复自动识别，长期偏好另走显式配置。
- **D5**：`discuss`、`inspect` 静默路由；只有自动创建/恢复 task、进入不记录进度的直接修改、显式切换或风险询问时显示一行非阻塞说明。
- **D8**：已经产生 untracked dirty changes 后再切回 `走任务` 时，保留现有修改并登记为规划前基线，然后立即回到 brainstorm、brief、start 和 route 门禁；不得自动回滚或把旧 diff 视为已通过规划/检查。

### R3. 自动创建与安全丢弃

- 自动路由创建 task 时必须留下可验证的来源元数据，以区分本轮临时 task 与用户显式创建、历史或人工维护的 task。
- **D6**：本轮自动创建的临时 planning task 在用户切换为“不要任务”后默认删除，不保留 dormant 草稿，也不归档为 completed。
- **D7**：无二次确认删除必须同时满足：来源是当前请求自动路由、状态仍为 `planning`、没有子任务、没有关联 commit/PR、没有进入实施阶段。
- 任一安全条件不满足时拒绝自动删除，输出结构化阻断原因并等待更高风险的明确清理指令。
- 安全删除必须精确清理该 task 目录、指向它的 session runtime 和父任务引用；不得修改其它 task、其它 session 或业务 dirty changes。
- 当前 `task.py` 没有 delete/discard 命令；首版通过随 0.6 强化包分发的窄 helper 提供自动创建标记、dirty baseline 和安全 discard，不改变 `task.py create/start` 的既有状态转换。

### R4. 声明式强化变换层

- skill-garden 0.6 支持声明式 `insert / replace / remove`，目标限定为已存在的 Trellis workflow、skill、command 和 hook 文件。
- 每个操作必须声明稳定 ID、显式目标路径、操作类型、精确锚点或匹配内容、预期匹配次数、required/optional 和内容来源；禁止无锚点宽泛正则。
- **D2**：required `replace/remove` 的锚点或预期次数不成立时，preflight 失败并终止本次强化应用；不得写目标文件、静默猜测、退化为追加或写入成功 manifest。
- optional 操作失败可以跳过，但必须进入结构化结果和用户可见输出。
- 变换结果使用稳定 managed marker 区分“已经应用”与“上游锚点漂移”，支持升级内容替换、`remove` tombstone 和重复运行幂等。
- marker 必须支持目标语言合法的 `html/hash/slash` 注释风格；hook 必须显式声明 style，且早期错误写入的 HTML marker 可原位迁移。
- 每个被修改文件保留首次注入前备份；内容一致不写，换行稳定，非目标区域的用户修改必须保留。
- 平台入口不存在时跳过该显式目标，不创建未启用的 `.agents`、`.claude` skill、command 或 hook 文件。
- 变换 preflight 必须先于强化包的复制、过期清理和 manifest 写入；成功 manifest 移到所有 required 强化步骤完成后写入。

### R5. 用变换层彻底替换 task 引导

- 替换 `.trellis/workflow.md` 的 Phase 摘要、Request Triage、`workflow-state:no_task` 原 body、Phase 1.0/1.1 walkthrough 和 customization invariant 中的机械 task-creation consent。
- 更新 `trellis-start` 的 no-active-task 分支，改为意图分类、自动路由和自然语言切换。
- 更新 `trellis-brainstorm` 前置条件，使显式 task 授权和由明确复杂实施意图推导的 planning 授权都合法。
- 更新 Codex/Claude SessionStart 的 no-task 提示，使会话入口直接要求意图识别，不再重新注入机械 task consent。
- 自动路由创建和从 planning 切到“不要任务”必须分别实际调用 `task_intent.py create/discard`；不能只写文案而不改变 task/runtime 状态。
- skill-garden hub/state 只保留必要的高优先级边界；旧 no_task sentinel 和原始机械正文不得重复存在。
- Brainstorm Gate、Task Brief、`task.py start` review、Routing Gate、Check、Push、finish-work 及高风险操作确认不得削弱。
- 反向残留扫描只清除“创建 planning task 的机械确认”，不能用宽泛关键词误删其它必要确认。

### R6. 源、快照与兼容

- 真实源位于 `vendor/skill-garden/.trellis/0.6/`；运行 `npm run sync` 生成 `enhancements/0.6`，再同步当前 dogfood `.trellis`、`.agents`、`.claude`。
- flower-trellis 实现变换执行器、preflight、备份、错误报告和编排；skill-garden 提供变换声明、替换文本与 intent helper。
- skill-garden 独立 `install.sh` 必须通过标准库 Python consumer 消费同一份声明，并同步 intent helper；不得保留只支持追加的第二套协议。
- 首版只改 0.6，不修改 0.5、old 或官方 `@mindfoldhq/trellis` npm 包源码。
- 现有 additive workflow/skill override 保留兼容路径；迁移后必须清理旧块，重复应用不得产生双份内容。
- 变换引擎与意图路由作为一个发布单元实现：路由依赖变换能力，vendor/snapshot/dogfood 必须一起验收，不拆成可独立发布的父子任务。

### R7. 自动化验证与规范

- **D9**：新增零第三方依赖的测试基础设施：JavaScript 使用 Node 内置 `node:test`，Python helper 使用内置 `unittest`，并提供统一 `npm test` 入口。
- JavaScript 测试至少覆盖 insert/replace/remove、managed marker 幂等、marker style 迁移、required 漂移、optional skip、严格 schema 类型、首次备份、非目标文本保留和 manifest 不提前成功。
- Python 测试至少覆盖自动创建元数据、dirty baseline、全部 discard 安全条件、父引用/session 清理、拒删时零副作用和路径穿越防护。
- 独立安装器测试至少覆盖三种 operation、hook marker 语法、required 零写入、`--scope all` 复制前失败、真实 clone/install、helper 同步和二次安装幂等。
- 更新 CLI quality/spec 文档，记录测试目录、命令和强化变换协议；保留现有语法校验、snapshot diff 和 dogfood 验证。

### R8. 两份独立 spec 与 AI 上下文预算

- 完成实现后新增或收敛两份独立规范：
  - `trellis-injection-transforms.md`：定义 skill-garden 对 Trellis 的 `insert / replace / remove` 声明、preflight、marker、备份、兼容和同步协议。
  - `ai-context-budget.md`：定义完整 workflow、skill-garden hub、workflow-state、Phase summary / SessionStart control-plane 注入的分层与总量预算。
- 当前基线必须记录在预算规范中：完整 workflow `56,635` bytes、0.6 hub `10,757` bytes、五个 state 合计 `8,546` bytes、`get_context.py --mode phase` `17,935` bytes、当前 SessionStart 样本 `17,841` bytes。
- 预算以 UTF-8 bytes 与行数作为确定性指标，不以模型相关且不稳定的 token 估算作为硬门禁。
- 新增可重复执行的 context-budget checker，至少测量完整 workflow、hub、单 state、state 总和、Phase summary 和可复现的 SessionStart control-plane 输出。
- 规范必须明确“prompt 只留门禁和边界、skill 留流程语义、helper 留确定性状态操作”，禁止同一长规则在 hub、state、workflow 正文和 skill 中重复注入。
- **D10**：预算默认作为评审告警，不作为 `npm test` 的大小硬门禁；超过 target 或 review ceiling 时输出分级 warning 和实际差异，但默认退出成功。
- checker 的测量失败、fixture 损坏、目标缺失或输出无法解析属于结构性错误，仍必须非零退出；另提供显式 `--strict` 供发布审计按需把 review ceiling 转为失败。
- 调整 target/review ceiling 必须附带原因、基线差异和 spec 更新，不能为消除 warning 直接放宽常量。

## Acceptance Criteria

- [x] AC1：纯讨论、只读检查和本地工具动作不再询问是否创建 task。
- [x] AC2：高置信复杂实施请求直接创建 task 并进入 brainstorm，但不会越过 brief/start/route 门禁实施。
- [x] AC3：用户可用自然语言在 discuss、direct edit、task planning 间切换，最新当前请求指令生效且不泄漏到无关请求。
- [x] AC4：低置信或高风险场景仍只询问一个影响副作用的问题。
- [x] AC5：本轮自动创建且满足全部安全条件的 planning task 可被删除，task 目录、父引用和 session 指针不残留。
- [x] AC6：不满足任一安全条件时 discard 拒绝且零副作用；其它 task、session 和业务 dirty changes 保持不变。
- [x] AC7：从 direct edit 切回 task planning 时保留并登记已有 dirty baseline，后续继续走完整规划门禁。
- [x] AC8：通用变换层支持 `insert / replace / remove` 和 workflow/skill/command/hook 目标，严格校验显式锚点、预期次数与 marker style。
- [x] AC9：重复应用无额外 diff；required 锚点漂移时目标文件不变、成功 manifest 不更新并报告错误。
- [x] AC10：首次备份保留，非目标区域用户修改不被覆盖，缺失平台入口不被创建。
- [x] AC11：workflow、SessionStart、`trellis-start`、`trellis-brainstorm` 和已启用平台副本不再残留机械 task-creation consent，同时保留所有实施与风险门禁，并实际接通 create/discard helper。
- [x] AC12：`npm test`、ESM/Python 语法校验、`npm run sync`、snapshot/dogfood 一致性检查全部通过。
- [x] AC13：0.5、old 和官方 Trellis 源无语义漂移。
- [x] AC14：两份独立 spec 已写入 CLI spec index，分别覆盖声明式注入协议和 AI context budget。
- [x] AC15：context-budget checker 可在测试中执行，输出各层 actual/target/review ceiling；默认大小超限只告警，结构性错误失败，显式 `--strict` 可用于发布审计。

## Out of Scope

- 修改 `task.py create/start` 的既有状态转换或新增 `cancelled` 状态。
- 自动执行生产、部署、数据库、凭证或外部系统操作。
- 使用无锚点宽泛正则修改任意用户文件，或整份覆盖 Trellis workflow、skill、command、hook。
- 为临时意图切换增加跨请求持久偏好；长期偏好另行设计。
- 首版为 0.5/old 引入同等变换能力。
