# Brief — Update skill entry workflows

## Goal

- 补齐三个技能入口问题：用户主动 Flower 升级不被自动提示节流挡住，SLS/Forest 排障避免同 trace 多请求误判，`trellis-worktree` 菜单显示明确中文说明。

## Scope

- 新增默认可用的 `trellis-flower-update` 强化包 skill，引导 AI 在用户明确要求升级时运行人工 self-check、展示摘要并执行受控 `self-update`。
- `trellis-flower-update` 自身提供清晰触发说明，并在技能菜单中显示中文用途短句。
- `trellis-flower-update` 明确排除“我想发版了”、release、打 tag、npm publish、修改 package 版本号等发布语义。
- 为 `self-check` 暴露人工入口参数，并让 `self-update --yes` 使用该语义绕过 prompt suppression。
- 保持 SessionStart hook 自动路径继续尊重 `snooze` / `skip` / `cooldown`。
- 更新 `aliyun-sls-query` Codex / Claude common skill，加入 Java Forest/HTTP trace 请求-响应-异常配对守则。
- 更新 `aliyun-sls-query` Codex / Claude common skill，加入 SLS project/logstore 选择守则：先按系统线索锚定 `xhgj-zysys` 这类 project，不能靠 `xhxhgjmall` 这类名称相似猜主入口。
- 为 `trellis-worktree` 增加菜单中文短说明，避免显示“查看技能说明”。
- 为 `trellis-flower-update` 同步增加菜单中文短说明，避免新增后出现同类占位。
- 通过同步链路刷新 `enhancements/0.6/` 与 `enhancements/common/` 快照。

## Non-Goals

- 不执行 npm 发版、tag、publish 或 push。
- 不把发版请求路由到 `trellis-flower-update`。
- 不改变自动更新提示的默认策略、冷却时长、snooze/skip 语义。
- 不把 `aliyun-sls-query` 扩展成 SRM 专用排障 skill。
- 不重写 `trellis-worktree` 的 worktree 准备逻辑。

## Key Decisions

- Flower 升级入口做成默认强化包 skill，而不是可选 common skill，确保已安装 Flower/Skill-Garden 的项目中 AI 能直接响应用户主动升级请求。
- CLI 增加人工入口语义，不让 skill 通过解析 `suppressedAction` 或重置提示缓存绕过节流。
- `self-update` 作为显式写入命令也使用人工入口语义，但仍要求 `--yes` 才能写入。
- `trellis-worktree` 保留英文 frontmatter 触发描述，仅在 Flower skill catalog 展示层加中文 override。
- `trellis-flower-update` 新增时同时处理 frontmatter 触发说明和菜单中文短说明。
- `trellis-flower-update` 的 frontmatter 要把“升级已安装强化包”和“项目发版”切开，避免发版语义误触发。

## Key Context

- 更新契约：`.trellis/spec/flower-trellis/cli/config-and-state.md`。
- Skill-Garden/common skill 同步和托管边界：`.trellis/spec/flower-trellis/cli/enhancements-model.md`。
- Flower 手动升级相关文件：`src/commands/self-check.js`、`src/commands/self-update.js`、`src/lib/self-check.js`、`src/assets/flower_update_hook.py`。
- Skill authoring source：`vendor/skill-garden/.trellis/0.6/` 与 `vendor/skill-garden/.common/`。
- 快照输出：`enhancements/0.6/` 与 `enhancements/common/`。
- 菜单说明逻辑：`src/lib/skill-catalog.js`。
- SRM 复盘证据：`research/srm-forest-trace-pairing.md`。

## Risks / Deferred

- `implement.jsonl` / `check.jsonl` 引用了两个较大的 spec，task validate 提示注入可能截断；实现阶段需要按章节定向读取相关段落。
- `npm run sync` 可能刷新 manifest 元数据或快照内容，需要在实现后单独核对 diff，避免把无关快照变化混进任务结论。

## Acceptance

- 用户主动升级时，`trellis-flower-update` 能展示版本差异和推荐命令，并在写入前遵守确认/安全门槛。
- 被 snooze 的自动检查仍返回 `skipped`；人工 self-check 返回可执行状态。
- `self-update --yes --project-only` 在项目落后但提示已 snooze 时仍尝试项目重叠加。
- SessionStart hook 自动路径不绕过提示节流。
- `aliyun-sls-query` 两份 common source 和同步快照都包含 Forest trace 配对守则。
- `aliyun-sls-query` 两份 common source 和同步快照都包含 project/logstore 选择守则。
- `flower-trellis skill` / skill catalog 中 `trellis-worktree` 显示中文用途短句。
- `flower-trellis skill` / skill catalog 中 `trellis-flower-update` 也显示中文用途短句。
- 用户说“我想发版了”时，不应触发 `trellis-flower-update` 的升级流程。
- 测试覆盖 self-check 人工绕过、self-update 绕过提示抑制、hook 自动路径保持抑制、skill catalog 中文说明。

## Next Step

- 确认 brief 后运行 `task.py start`，再进入实现路由。
