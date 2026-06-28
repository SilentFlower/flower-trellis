# Trellis 0.6.2 -> 0.6.5 升级研究

## 版本基线

- `package.json`: `@mindfoldhq/trellis` 固定为 `0.6.2`。
- `package-lock.json`: `node_modules/@mindfoldhq/trellis` 为 `0.6.2`，`@mindfoldhq/trellis-core` 为 `0.6.2`。
- `.trellis/.version`: `0.6.2`。
- `npm view @mindfoldhq/trellis@0.6.5 dependencies` 显示 core 依赖固定为 `@mindfoldhq/trellis-core: 0.6.5`，其它依赖版本范围与 0.6.2 基本一致。

## 证据命令

```bash
npm view @mindfoldhq/trellis@0.6.2 version dependencies dist.tarball
npm view @mindfoldhq/trellis@0.6.5 version dependencies dist.tarball
npm pack @mindfoldhq/trellis@0.6.2
npm pack @mindfoldhq/trellis@0.6.5
npm pack @mindfoldhq/trellis-core@0.6.2
npm pack @mindfoldhq/trellis-core@0.6.5
npx --yes @mindfoldhq/trellis@0.6.5 update --dry-run
npx --yes @mindfoldhq/trellis@0.6.5 init --help
```

## 0.6.5 dry-run 结果

`npx --yes @mindfoldhq/trellis@0.6.5 update --dry-run` 显示会从 `0.6.2` 升级到 `0.6.5`。

会自动更新的关键文件：

- `.trellis/scripts/common/active_task.py`
- `.trellis/scripts/common/cli_adapter.py`
- `.trellis/scripts/common/task_store.py`
- `.trellis/scripts/common/workflow_phase.py`
- `.trellis/scripts/common/safe_commit.py`
- `.trellis/scripts/add_session.py`
- `.claude/hooks/inject-workflow-state.py`
- `.claude/hooks/session-start.py`
- `.codex/hooks/inject-workflow-state.py`
- `.agents/skills/trellis-brainstorm/SKILL.md`
- `.agents/skills/trellis-break-loop/SKILL.md`
- `.agents/skills/trellis-meta/**`
- `.agents/skills/trellis-session-insight/**`
- 对应 `.claude/skills/**` 副本。

需要人工决策的文件：

- `.trellis/config.yaml`
- `.trellis/workflow.md`
- `.claude/commands/trellis/finish-work.md`
- `.agents/skills/trellis-finish-work/SKILL.md`
- `.codex/hooks.json`

这些都是本仓高风险定制点。

## 与 flower-trellis 相关的上游变化

### 平台矩阵

0.6.5 的 `trellis init --help` 新增：

- `--devin`
- `--zcode`
- `--trae`
- `--with-statusline`

并保留：

- `--windsurf`: deprecated alias for `--devin`

当前 flower-trellis：

- `src/constants.js` 的 `PLATFORM_FLAGS` 尚无 `--devin`、`--zcode`、`--trae`、`--with-statusline`。
- `src/lib/pick-platforms.js` 菜单仍显示 `Windsurf`，未显示 `Devin`、`ZCode`、`Trae`。

影响：

- 用户显式传 `--devin` / `--zcode` / `--trae` 时，flower 当前会把它们透传给 Trellis，但 `hasPlatform` 判断不会识别它们，可能额外弹平台菜单或在非交互下追加默认 `--codex --claude`。
- `--with-statusline` 是 feature flag，不应纳入 `PLATFORM_FLAGS`；它可以原样透传。
- `--windsurf` 仍可用，但菜单应改为 Devin，必要时保留 Windsurf 说明。

建议：

- 升级实现时更新 `PLATFORM_FLAGS`：新增 `--devin`、`--zcode`、`--trae`，保留 `--windsurf` 兼容。
- 更新平台菜单：`Windsurf` 改为 `Devin`，新增 `ZCode`、`Trae`。
- README 平台说明同步更新。

### Workflow 模板

0.6.5 上游 `.trellis/workflow.md` 相比 0.6.2 的关键变化：

- 平台矩阵增加 `ZCode`、`Reasonix`、`Trae`。
- `Windsurf` 在 inline/agent-less 分组中变为 `Devin`。
- Phase 1.3 / 1.4 增强 JSONL 门禁：sub-agent-dispatch 平台在 `task.py start` 前要求 `implement.jsonl` 和 `check.jsonl` 都有真实 spec/research entry，seed row 不算 ready。
- Phase 2.1 把 `Gemini / Qoder / Copilot / ZCode / Reasonix / Trae` 归到 pull-based sub-agent block，而不是 hook auto-handles block。
- Phase 2.2 check sub-agent 矩阵补齐新平台。

冲突：

- 本仓 `.trellis/workflow.md` 已注入 skill-garden hub 和多个 workflow-state guard，dry-run 标记为 modified by you。
- 不能直接覆盖，否则会丢 task brief handoff、route gate、post-check stop gate、trellis-push gate、push snapshot recovery 等本地规则。

建议：

- 实际升级时不要接受整文件覆盖。
- 手工把 0.6.5 的平台矩阵、JSONL ready 门禁和 pull-based dispatch 分类合并到 skill-garden 源头 `vendor/skill-garden/.trellis/0.6/overrides/**` 或当前 `.trellis/workflow.md` 的非覆盖段。
- 合并后运行 `npm run sync` 同步 `enhancements/0.6`，必要时刷新当前 dogfood `.trellis/workflow.md`。

### 配置与 Codex hooks

dry-run 标记 `.trellis/config.yaml` 和 `.codex/hooks.json` 为 modified by you。

当前本仓必须保留：

- `.trellis/config.yaml` 的 `packages` / `default_package`。
- `codex.dispatch_mode: sub-agent`。
- channel worker guard。
- `.codex/hooks.json` 上游 `UserPromptSubmit` + flower 补的 `SessionStart`。

已有保护逻辑：

- `src/commands/update.js` 已在 `trellis update` 前后调用 config preserver。
- `src/lib/codex-tweaks.js` 采用 merge 策略，只补 SessionStart，不覆盖上游 UserPromptSubmit。

建议：

- 实际升级时用 `flower-trellis update` 路径验证保护逻辑，不要裸跑强制覆盖。
- 若手工运行上游 `trellis update`，不能选择覆盖 `.trellis/config.yaml` 或 `.codex/hooks.json` 后不检查。

### finish-work 覆盖

dry-run 标记：

- `.claude/commands/trellis/finish-work.md`
- `.agents/skills/trellis-finish-work/SKILL.md`

这些文件承载 skill-garden 0.6 finish-work release operations override。

建议：

- 不接受上游覆盖。
- 升级后确认 `vendor/skill-garden/.trellis/0.6/overrides/skills/trellis-finish-work.md` 仍能正确注入当前上游 finish-work 文案。
- 如果上游 finish-work 模板有新结构，需要调整 skill-garden override 的注入位置和当前 `.agents` / `.claude` 副本。

### Python runtime 脚本

0.6.5 自动更新的 Python 脚本包含有价值修复：

- `safe_commit.py` / `add_session.py` 修复 `.trellis` auto-commit staging scope，避免并行窗口的其它 task dir 被 session auto-commit 扫进去。
- `active_task.py` 增加 Trae session key。
- `task_store.py` 增加 `.trae` 作为 sub-agent platform，注释里将 Windsurf 更名为 Devin。
- hooks 修复 stdin 为空时阻塞的问题，并增加 Kiro plain stdout 分支。

建议：

- 这些自动更新应接受，之后检查是否和本地中文注释要求冲突。本项目 AGENTS 要求注释中文，但这些是 Trellis 上游模板文件，历史上已保留英文；若本地新增注释，应遵守中文。

### trellis-session-insight / mem

0.6.5 `trellis-core` 的 mem 变化：

- 新增 Pi session adapter。
- Claude cwd sanitization 修复 Windows 场景。
- `--task` quick reference 被替换为 `--cwd`，phase slicing 对 implement 的定义改为 outside brainstorm windows。

影响：

- 本仓当前 `trellis-session-insight` 文案仍是 0.6.2 版本，dry-run 会自动更新。
- 对 flower-trellis 业务代码无直接冲突，但文档/skill 行为会改变。

### Kiro / Pi / Channel

0.6.4 / 0.6.5 修复：

- Kiro main-session workflow injection。
- Pi startup context 和 `tools` frontmatter。
- Windows channel spawn `.cmd` shim。
- shared Python hooks stdin empty blocking。

影响：

- 对当前 Codex/Claude dogfood 路径影响较小。
- 如果用户依赖 Kiro/Pi/Windows channel，这些是应接受的上游修复。

## 明显冲突清单

1. **平台 flag 识别冲突**
   - 当前 flower 不识别 `--devin` / `--zcode` / `--trae` 为平台 flag。
   - 风险：用户显式传这些平台时，flower 仍可能追加默认 `--codex --claude` 或弹菜单。

2. **平台菜单过期**
   - 当前菜单仍是 `Windsurf`，缺少 `Devin` / `ZCode` / `Trae`。
   - 风险：交互 init 无法自然选择 0.6.5 新平台。

3. **workflow 整文件覆盖风险**
   - 0.6.5 上游 workflow 有真实变化，但本仓 workflow 有 skill-garden hub。
   - 风险：接受覆盖会丢本地强化；跳过则缺少新平台矩阵和 JSONL gate。

4. **finish-work 覆盖风险**
   - 上游想更新 finish-work，但本仓有 release audit override。
   - 风险：接受覆盖会丢上线事项推断/核对规则；跳过则可能错过上游文案变化。

5. **config.yaml 覆盖风险**
   - 上游 update 管理整文件，本仓有 monorepo package 配置和 Codex dispatch 配置。
   - 风险：覆盖会丢 `packages`、`default_package`、`codex.dispatch_mode`。

6. **Codex hooks 合并风险**
   - 上游 hook 模板有变化，本仓必须保留 SessionStart。
   - 风险：整文件覆盖会丢 SessionStart；只跳过则可能错过上游 UserPromptSubmit 修复。

7. **skill-garden 源 / 快照 / dogfood 副本同步风险**
   - 如果只改当前 `.trellis/workflow.md` 或 `.agents`，后续 `npm run sync` / `flower-trellis update` 会带回旧语义。
   - 风险：发布包和当前项目行为漂移。

## 建议升级计划

1. 修改 `package.json` 为 `@mindfoldhq/trellis@0.6.5` 并更新 lockfile。
2. 更新 flower 平台列表：
   - `src/constants.js`
   - `src/lib/pick-platforms.js`
   - README 平台说明。
3. 跑 `flower-trellis update --target . --no-update-check` 或等价流程，避免裸上游 update 绕开 config/hook 保护。
4. 对自动更新的 Trellis Python runtime、hooks、bundled skills 接受上游 0.6.5。
5. 手工合并 `.trellis/workflow.md`：
   - 保留 skill-garden hub 和 state guards。
   - 合入 0.6.5 平台矩阵、JSONL 门禁、pull-based dispatch 分类。
6. 检查 finish-work：
   - 保留 skill-garden release operations override。
   - 如上游模板结构变动，调整 override 注入源。
7. 检查 `.trellis/config.yaml`：
   - 保留 `packages`、`default_package`、`codex.dispatch_mode: sub-agent`。
8. 检查 `.codex/hooks.json`：
   - 保留上游 UserPromptSubmit。
   - 保留 flower SessionStart。
9. 同步 skill-garden 0.6 源到快照：
   - 先改 `vendor/skill-garden/.trellis/0.6/`。
   - 运行 `npm run sync`。
   - 同步当前 `.agents` / `.claude` dogfood 副本。
10. 验证：
    - `node --check src/cli.js && for f in src/lib/*.js src/commands/*.js; do node --check "$f"; done`
    - `npm run sync`
    - `node scripts/check-snapshot.mjs`
    - `node bin/flower-trellis.js -v`
    - `node bin/flower-trellis.js update --dry-run --no-update-check`
    - 关键 diff 人工检查。
