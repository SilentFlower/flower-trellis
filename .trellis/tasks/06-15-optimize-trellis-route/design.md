# optimize trellis-route design

## Technical Design

### Scope

本任务优化 `trellis-route` skill 的交互文档与 workflow override 语义，不新增 CLI 脚本或运行时代码。主目标是让 agent 在 Phase 2.1 / 2.2 / 3.1 路由时减少重复询问，同时保留用户覆盖和提交前全面检查。

### Personal Route Config

个人路由配置放在 `.trellis/.route-prefs.tmp`。该路径已被 `.trellis/.gitignore` 的 `*.tmp` 规则忽略，不会进入 git。

配置使用简单 key-value 文本，便于人工查看和 agent 读写：

```text
implement=inline
check=check-all-inline
```

允许值：

- `implement`: `inline` / `subagent`
- `check`: `check-all-inline` / `check-all-subagent`

损坏、未知 key、未知值、旧单值内容都按无配置处理；agent 可删除损坏配置后重新展示选项。

### Routing Modes

#### Normal route

如果用户只是触发正常 implement/check 路由，且 workflow 阶段已经允许进入该 target，并且配置存在：

- implement 命中 `implement=<mode>` 时直接输出对应路由决定，不再询问。
- check 命中 `check=<mode>` 时直接输出对应 `check-all` 路由决定，不再询问。
- 输出中必须提示来自个人配置，并说明可通过“临时改 / 重新选择 / 清除 route 默认”重新展示选项。

个人配置不能作为 workflow 授权：任务仍在 `planning`、没有 active task、PRD/design/implement 仍等待用户确认，或用户表达“等一下 / 我再想想”时，route 必须停止，不能读取配置后直接实现。

#### Explicit override route

如果用户表达“临时改一次”“重新选择”“这次不用默认”“清除默认”等意图，配置不能优先。此时必须重新展示选项。

#### Option display

无配置时：

- implement 展示：本次 inline、本次 subagent、保存 inline 默认、保存 subagent 默认。
- check 展示：本次 check-all inline、本次 check-all subagent、保存 check-all inline 默认、保存 check-all subagent 默认。

已有配置且用户要求临时改/重选时：

- 展示“仅本次覆盖”和“更新默认”的区别。
- 额外提供“清除默认并重新选择”或等价选项。

check 普通选项不展示轻量 `trellis-check`。轻量检查只作为隐藏逃生口：用户明确说 `light check` / `轻量检查` 时，route 可输出 `trellis-check` inline/subagent 路径。

### Workflow Override Alignment

`.trellis/workflow.md` 和 `vendor/skill-garden/.trellis/0.6/overrides/workflow.md` 中的 Routing Gate 需要同步：

- 允许 `trellis-route` 使用 gitignored 个人配置跳过重复询问。
- 明确用户显式临时覆盖时必须绕过配置并重新展示选项。
- 将 check 普通路由描述从 4 模式改为 `check-all inline/subagent` 为主，轻量 check 为显式隐藏逃生口。

### Files To Keep In Sync

源头优先修改：

- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/SKILL.md`
- `vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-route/SKILL.md`
- `vendor/skill-garden/.trellis/0.6/overrides/workflow.md`

然后手工受控复制到当前项目平台副本：

- `.agents/skills/trellis-route/SKILL.md`
- `.claude/skills/trellis-route/SKILL.md`

再运行 `npm run sync` 同步到发布快照：

- `enhancements/0.6/...`
- `enhancements/0.6/overrides/workflow.md`
- `enhancements/MANIFEST.json`

如 `npm run sync` 不更新 `.trellis/workflow.md`，需手工保持本仓 workflow override 与源头语义一致。

## Rollout / Rollback

- Rollout：文档级变更，立即影响后续 agent 路由行为。
- Rollback：回退 route skill 与 workflow override 的提交；删除本地 `.trellis/.route-prefs.tmp` 可清除个人偏好。
