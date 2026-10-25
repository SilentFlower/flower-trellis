# 技术设计

## Boundary

本任务交付一条简化后的默认交互完成链：路由、检查、规范评估、提交计划之间沿用现有阶段与协议，只收缩默认选择、重复指令和低频材料的读取范围。各入口共同验收，不拆出新的工作流或状态体系。

Brief 的文件、模板、展示和首次批准规则，以及升级门禁，均按现状保护。

## Ownership

- 作者源：`vendor/skill-garden/.trellis/0.6/`。workflow 与上游 Update-Spec 通过现有 `overrides/patches/` 修改；增强 skill 从 `.agents/skills/`、`.claude/skills/` 源修改。
- 发布和执行结果：子仓 `compiled-targets/`、根仓 `enhancements/0.6/`、当前项目 `.trellis/` 与平台入口均机械生成或通过 Plugin 生命周期更新，不手改摘要、lock 或 state。
- 项目规范只更新与本任务契约相关的章节；0.5、old、CI 发布配置和插件分发运行时不在本轮重构范围。

## Changes

### 自动收尾的一致性

修改 `overrides/patches/workflow/state-untracked/content.md` 中仍要求等待后续继续或直接 Git 的条文。状态只表达当前阶段的一跳动作，继续与停止由 Check-All 的 Post-Check owner 决定。

默认通过链保持 Check-All → Update-Spec → Push 计划；明确停止、未处置问题、阻断型部分验证与 `needs-review` 保持原处置。通过不授权普通代码修复、代用户接受风险或实际 Git 写入。

### 内置 inline 缺省

沿用当前明确指令、匹配任务的既有选择、个人偏好和有效 runner 候选的现有优先级；最后的正常空状态改为内置当前会话模式：实现为 `inline`，检查为 `check-all-inline`。

缺省解析与 `route_state.py` 的普通解析、只读预检、untracked 偏好查询路径保持一致，明确标识内置缺省来源，不伪造人工选择，不写个人偏好。沿用现有数据和文件，不新建配置、状态文件或审批记录。主动重选仍可显示菜单；清除默认后回到内置 inline。

仅正常缺少选择允许使用缺省。损坏 session/run、非法任务范围、解析失败与用户明确指定但无法执行的子 agent 继续保留诊断和原安全边界，不借缺省绕过授权。auto-loop 预检和实际执行消费相同解析结果，避免没有偏好时预检误要求 subagent 上下文。

### Check-All 默认材料与报告

保留现有 requested/effective depth、行为性 hard-full、未知影响 fallback-full 和 light→full 单向升级。主入口只放短路由和必须常驻的能力边界；详细检查清单继续由对应 profile 所有。

分类完整规则只维护一份，入口保留足够判断 CHK/FBK/DOC 的短定义。DOC 自修规则在发现候选后、任何写入之前加载；源码注释、Maven、修复续行、auto-loop 等细则按真实分支读取。共享验证证据继续复用。

把现有报告材料中的普通通过、findings 处置与 runner 细则划清加载条件。普通 light 通过展示范围、结论、实际验证、必要风险和下一步；画像仍可供内部路由和审计使用，不强制展示全部字段和空维度。发现问题时保留现有分类、独立编号、分区、严重度与完整证据；保持终端可读的标题承载条目格式。

### Update-Spec 与 Push

Update-Spec 的入口保留 `no-op | written | needs-review`、证据顺序、最小写入边界和自检。先判定是否有新契约及已有规范是否覆盖，允许直接 `no-op`；删除重复说明并压缩上游通用示例和模板，保持必要的六栏规范合同。实现使用增量 Patch，不复制上游整份 skill。

现有增强 skill 的目录投影会清理非源文件，不能通过只新增 reference 的同名 skill 目录覆盖上游 Update-Spec。为此本轮优先就地精简该入口，不引入分发适配或额外写规范 skill。

Push 默认入口保留证据、仓库/文件归属、Git 预检、一次精确计划确认、执行和真实结果。多仓生成、已有 merge、GC 审计、auto-loop 与失败恢复在命中后加载到现有引用目录；各分支能力和停止条件原样保留。已读且未变化的输出模板可复用，模板变化或上下文不可恢复时重读。

## Evidence And Size

基线详见 `research/flow-audit.md`。以最终投影后的入口和实际默认必读集合计量，不以源码文件数或拆分数量评价 KISS。

- 对比普通 light、缺省 inline、规范 `no-op`、普通单仓 Push 的加载集合与字节数；默认路径均应减少控制文本。
- 对比全部关联说明材料，避免只拆文件却新增重复正文；不调高现有预算来掩盖增长。
- 先列受保护能力及正反断言，再修改规则。旧测试按 owner 与语义迁移，不能通过删除能力断言获得通过。

## Compatibility And Risk

- 最大风险是少读细则导致错误放行，或不同平台缺少新引用。保留常驻边界，验证所有被引用文件、平台投影、精细安装与最终产物。
- 路由只改变真正无选择时的缺省行为；已有 subagent 选择与 runner 授权不得被覆盖。损坏状态和正常空状态分别回归。
- 上游、源、快照和本地结果必须一致；Plugin 更新重复执行应幂等。保持既有 API、runner action、完成状态与 Git 操作安全合同。
- 失败时保留真实现场；不自动撤销用户改动、成功提交或推送。需要恢复时按实际受影响作者源与生成链恢复，不在生成文件中单独补丁。
