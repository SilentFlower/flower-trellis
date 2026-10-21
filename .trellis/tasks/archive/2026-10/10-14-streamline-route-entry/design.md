# Design — 精简路由入口并同轮衔接执行

## Boundaries

- 保留 Trellis workflow 的授权、Phase 2.1 completion 和 Phase 2.2 检查 owner；route 只选择已获准工作的位置，不获得开工、自动修复、提交或外部操作权限。
- 沿用 `route_state.py` 的接口、原子写入、来源校验、任务隔离和 runtime → prefs → auto-loop 优先级。默认不改 helper，也不新增状态文件、公共配置或自然语言解析器。
- 明确模式指令属于当前请求中的执行选择；被引用文字、假设问题、历史对话、摘要和过期裸数字不形成选择。

## Entry And Conditional References

- `.agents/.claude/skills/trellis-route/SKILL.md` 保留目标与 subject 确认、合法来源、当前任务复用、最小 helper 调用、条件加载指针及同轮执行规则，入口控制在 8,192 字节内。
- `references/interaction.md`：无有效选择、用户要求菜单、重选或清除默认时读取；包含原模式选项、紧邻裸数字规则及选择后的写入方式。
- `references/subagent-dispatch.md`：最终模式为 subagent 时读取；包含 catalog 用法、task/untracked prompt、implement 跳过编译及只读 Check-All 边界。既有 `platform-dispatch.json` 和 `check-all-agent-body.md` 保留职责，不重复复制完整审计细则。
- `references/recovery-and-errors.md`：helper 异常、无可用 session 或需要诊断时读取；保留原失败关闭、个人配置与窗口隔离边界。
- 新 reference 采用现有 shared skill 分发方式，由作者源 `.agents` 的公共辅助文件投影到平台 skill root；两平台入口保持相同语义。
- 入口不默认读取全部 references，不要求 AI 读取 Python 脚本正文，不把低频流程搬进 workflow/state。

## Decision Flow

1. 外层 workflow 已允许对应 target 后，确认 task 或 untracked subject。
2. 当前用户指令唯一明确 target、合法 mode、临时/保存默认意图时直接应用；没有保存默认意图时只作临时选择。使用现有 `write --source trellis-route [--save-pref]` 或 untracked `write-pref`。
3. 仅要求重选、清除或指令含糊时进入交互 reference；目标不明确则只询问缺失目标，不擅自同时修改 implement/check。
4. 无覆盖指令时，已有当前任务合法决定直接复用；需要恢复时 task 调用 `resolve`，untracked 调用 `read-pref`。
5. 已确定模式只在对话中说明一句执行方式，并同轮实际进入 before-dev / Check-All 或专用 subagent 分发。取消常规 YAML、runtime 路径、工具配方及“下一轮执行”的展示要求。
6. 缺少有效选择或能力不可用时由用户决定；不得静默降级或替换专用角色。implement 完成后仍返回 Phase 2.1 completion contract，按 owner 进入检查或既有 hold。

## Recovery Evidence

- helper stdout 与 session runtime 继续提供合法 mode/source/task 证据；正常用户展示不再复制为 YAML。
- 当前任务修复和重检复用最新合法路由，压缩恢复优先 helper。损坏 runtime 或绑定 auto run 继续失败关闭，不从自然语言摘要、旧数字或其它窗口借用选择。
- task 临时选择保留当前任务/session 有效期；untracked 的仅本次只影响当前调用，不写 task runtime，保存默认只修改当前 target。

## Measurement And Compatibility

- 默认读取集合为短入口；只有明确命中条件才加载对应 reference。入口目标为 8,192 字节，原默认集合为 26,262 字节。
- 每平台真实投影的 `SKILL.md`、全部 reference Markdown 和 JSON 合计不超过 39,950 字节；不是仅比较 canonical `.claude` 目录，因为其公共 reference 原本来自共享 `.agents`。
- helper 源码不作为提示词体量累加；快照及多平台等价投影不重复计入单次读取量。
- 现有 route 风险、只读审计和 untracked 断言随职责迁移检查完整入口及实际条件加载材料，不删掉断言换取通过。新增大小和真实投影可达性回归。
- 更新模型规范中与“所有覆盖必须先菜单”“常规输出 YAML”相冲突的既有描述；不增加并行控制机制。

## Authoring And Rollback

- 权威修改点是 `vendor/skill-garden/.trellis/0.6/.agents/.claude/skills/trellis-route/`；根仓 `enhancements/0.6/` 及部署副本经 sync 和 Plugin 生命周期同步。
- 相关 root 测试包括路由体量、smart-depth、fallback-findings、untracked-flow、workflow gate、Pre-Check 和全平台分发。仅在实际依赖变动时修改现有分发代码。
- 回滚使用本任务 exact diff 的反向提交，重新 sync/投影；个人偏好和 session runtime 不作为回滚对象。

## Risks

- 按需拆分可能遗漏强制读取条件，或保持旧测试只看入口造成边界漏检；需验证 reference 投影与受保护契约。
- 静态规则和 helper 行为测试不能证明模型每次都正确衔接；真实会话效果应继续观察，不把提示词长度等同执行可靠性。
