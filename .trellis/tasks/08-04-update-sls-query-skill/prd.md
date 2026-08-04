# Update Skill Entry Workflows

## Goal

补齐三个 AI 技能入口问题，让用户在对话中可以可靠触发 Flower 项目升级、SLS/Forest 排障时避免 trace 误判，并让 `trellis-worktree` 在技能菜单中展示明确中文用途说明。

## Background

- 用户发现：如果 SessionStart 自动更新提示里选择稍后或关闭提示，后续在对话中主动要求升级 Flower/Trellis 时，AI 缺少一个明确入口来绕过提示节流并执行受控升级。
- 现有 `self-check` 在 `snooze` / `skip` / `cooldown` 时会返回 `status=skipped`，真实动作被保留在 `suppressedAction` 中；启动 hook 不会注入 `<flower-update>`，这是正确的“不主动打扰”行为，但不应阻止用户显式要求升级。
- SRM 事故复盘显示：`aliyun-sls-query` 的 SLS 查询能力有效，但缺少 Java Forest/HTTP 多外部请求 trace 配对守则，导致一开始把“同一 trace 链路里出现 404”误读为“指定接口本身 404”。
- 用户截图显示 `trellis-worktree` 在 `flower-trellis skill` 菜单中的说明是“查看技能说明”。代码证据表明该 skill frontmatter 有英文 description，但 `summarizeSkillDescription()` 对英文说明统一降级为该占位文案，且 `SKILL_DESCRIPTION_OVERRIDES` 没有 `trellis-worktree` 中文短描述。

## Requirements

- 新增默认可用的 Flower 手动升级 skill，建议命名为 `trellis-flower-update`，用于用户在对话中明确说“更新/升级 flower-trellis / Trellis 强化包 / 追平项目版本”时触发；它不得覆盖“我想发版了”、release、打 tag、npm publish、修改 package 版本号等项目发版语义。
- `trellis-flower-update` 自身必须有清晰说明：SKILL frontmatter description 覆盖自然语言触发场景，`flower-trellis skill` 菜单中也要展示中文用途短句，不能显示“查看技能说明”或“暂无用途简介”。
- `self-check` 提供显式人工入口参数，例如 `--manual` 或 `--ignore-prompt-suppression`，该参数只绕过提示抑制，不改变自动启动 hook 的节流语义。
- `self-update --yes` 的检查阶段应使用人工入口语义，避免用户已显式执行写入命令时仍被旧的 `snooze` / `skip` / `cooldown` 状态影响。
- 启动 hook 保持只读和不打扰：自动 SessionStart 仍不得注入被提示抑制的 `<flower-update>`。
- 更新 `aliyun-sls-query` skill，在日志库查询经验或排错速查中加入 Java Forest/HTTP trace 配对守则：不能用“某条 trace 链路里出现 404”反推“目标接口本身 404”；必须按 trace 回查完整链路，把 `[Forest] Request`、`Response: Status = ...`、`调用接口异常` 按时间配对。
- `aliyun-sls-query` 还要加入 SLS project/logstore 选择守则：不能仅凭 project 名称像生产或业务词相似就先查；必须以用户给出的系统线索、服务名、应用名或已知前缀锚定 project，再用 logstore/service/trace 证据确认，例如 SRM/supplier/API 应优先核对 `xhgj-zysys` 而不是把 `xhxhgjmall` 当主入口。
- SLS 经验补充应同时覆盖 Codex 与 Claude common skill authoring source，并通过同步链路刷新随包快照。
- `trellis-worktree` 在技能菜单中应展示中文短说明，不再显示“查看技能说明”。优先通过 `SKILL_DESCRIPTION_OVERRIDES` 添加明确短描述，避免改变英文 frontmatter 的触发语义。
- `trellis-flower-update` 也应纳入 `SKILL_DESCRIPTION_OVERRIDES` 或等价菜单说明机制，保证新增后可读性与 `trellis-worktree` 一致。
- 合并任务不发布 npm、不打 release tag、不执行生产或远程写入操作。

## Acceptance Criteria

- [ ] 用户主动要求升级时，`trellis-flower-update` 会先读取 `self-check --json` 的人工检查结果，展示版本差异和推荐命令；需要写入时仍遵守确认/安全门槛。
- [ ] `trellis-flower-update` 的 SKILL frontmatter 和技能菜单都提供明确用途说明，不出现占位说明，且明确排除发版 / publish / tag 流程。
- [ ] `self-check --json --target .` 在被 snooze 的场景仍返回 `skipped`，而人工入口参数返回 `project_out_of_sync` 或 `update_available` 的可执行状态。
- [ ] `self-update --target . --yes --project-only` 在项目版本落后但提示已 snooze 时仍会尝试项目重叠加，而不是输出“无需执行”。
- [ ] `flower_update_hook.py` 自动调用路径不会因人工入口改动而绕过提示节流。
- [ ] `aliyun-sls-query` 的 Codex / Claude 两份源 skill 都包含 Forest trace 配对守则，且同步后的 `enhancements/common` 快照一致。
- [ ] `aliyun-sls-query` 的 Codex / Claude 两份源 skill 都包含 project/logstore 选择守则，明确 `xhgj-zysys` 这类系统线索优先于 `xhxhgjmall` 这类名称相似猜测。
- [ ] `flower-trellis skill` / skill catalog 中 `trellis-worktree` 的说明为中文用途短句，不再是“查看技能说明”。
- [ ] 相关测试覆盖 self-check 人工绕过、self-update 绕过提示抑制、hook 自动路径保持抑制、skill catalog 的 `trellis-worktree` 中文说明。

## Out Of Scope

- 不执行 Flower npm 发版、tag、publish 或 push。
- 不把用户的“我想发版了”路由到 `trellis-flower-update`；发版应走项目发布 SOP 或 `trellis-release` / release 规范。
- 不改变自动更新提示的默认策略、冷却时长、snooze/skip 语义。
- 不把 `aliyun-sls-query` 扩展成 SRM 专用排障 skill；新增内容只沉淀通用 Forest/HTTP trace 分析纪律。
- 不重写 `trellis-worktree` 的工作流逻辑，只修菜单说明可读性。
