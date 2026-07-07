# 启动时自更新检查实施计划

## Checklist

1. 扩展 manifest 工具
   - 更新 `src/lib/manifest.js`，提供读取 / 写入 `updateCheck` 的 helper。
   - 确保 `writeManifest()` 或新包装函数保留 `updateCheck.enabled` / `policy` / `intervalHours`。
   - 添加默认策略：`enabled=true`、`policy=ask`、`intervalHours=24`。
   - `update-check disable` 只写 `enabled=false`，不改 `policy`；`enable` 只写 `enabled=true`，沿用原 `policy`，缺失时默认 `ask`。

2. 抽象结构化版本检查
   - 在 `src/lib/update-check.js` 中保留现有 `checkForUpdate()` 行为。
   - 新增纯函数 / async helper，生成 `self-check --json` 所需结构化结果。
   - 复用现有 dist-tags、版本比较、latest/beta 推荐逻辑。
   - 每次先做本地一致性检查：对比当前 `flowerVersion()` 与 manifest 的 `flowerVersion`，以及当前捆绑 `trellisVersion()` 与目标 `.trellis/.version`。
   - 只有 npm registry 远程探测受 `intervalHours` 节流；本地不一致必须返回 `project_out_of_sync`，不得被上次检查时间跳过。

3. 新增 CLI 命令
   - `src/commands/self-check.js`
   - `src/commands/self-update.js`
   - `src/commands/update-check.js`
   - 更新 `src/cli.js` 分发与 help 文案。

4. 新增启动 hook 脚本资产
   - 新增 `src/assets/flower_update_hook.py`。
   - 扩展脚本复制逻辑，确保全装时铺到 `.trellis/scripts/flower_update_hook.py`。
   - 脚本调用 `flower-trellis self-check --json --target <cwd>`；仅在 `update_available` 或 `project_out_of_sync` 时注入 `<flower-update>` 块。

5. 平台 hook 后处理
   - 泛化现有 `src/lib/codex-tweaks.js` 或新增平台后处理模块。
   - Codex：向 `.codex/hooks.json` 的 `SessionStart` 追加 update hook，保留现有 Trellis SessionStart。
   - Claude Code：向 `.claude/settings.json` 的 `hooks.SessionStart` startup matcher 追加 update hook，不修改 clear / compact。
   - 保持幂等，重复 `init` / `update` 不重复追加。

6. 自更新执行
   - `self-update --dry-run` 打印将执行命令和安全检查，不写入。
   - `self-update --yes` 执行 npm 全局升级，再执行目标项目 `flower-trellis update --target <dir> --no-update-check --force`。
   - `self-update --yes` 里的 `--yes` 只表示确认 flower 自更新命令，不传给上游 `trellis update`；上游 `trellis update` 当前没有 `-y`。
   - 默认将用户常用的 “Apply Overwrite to all” 映射为上游已有 `--force`，不新增 `--override-to-all` 这类 flower 私有覆盖语义。
   - 支持 `--` 参数边界，把其后的参数原样透传给项目 update 阶段；若透传参数已包含 `-f` / `--force` / `-s` / `--skip-all` / `-n` / `--create-new`，不再自动追加默认 `--force`。
   - 当 `self-check` 只返回 `project_out_of_sync` 时，支持 project-only 路径：跳过 npm 全局安装，只执行同一条完整 `flower-trellis update --target <dir> --no-update-check --force` 链路。
   - 失败时给出明确手动命令。

7. 文档
   - 更新 README：启动检查、policy 枚举、`update-check` 命令、`self-check` / `self-update`。
   - 更新 CLI help。

## Validation

1. 静态检查

```bash
node --check src/cli.js
for f in src/lib/*.js src/commands/*.js; do node --check "$f"; done
python3 -m py_compile <flower_update_hook.py源文件>
git diff --check
```

2. CLI 行为检查

```bash
flower-trellis self-check --json --target .
flower-trellis update-check get --target .
flower-trellis update-check set --policy auto --interval-hours 12 --target .
flower-trellis self-update --target . --dry-run
flower-trellis self-update --target . --dry-run -- --skip-all
```

3. dogfood 临时目标

```bash
flower-trellis init --target ./test-target -y
flower-trellis update --target ./test-target --dry-run
```

检查项：

- `test-target/.trellis/.flower-manifest.json` 包含并保留 `updateCheck`。
- `test-target/.codex/hooks.json` 包含 Trellis SessionStart 和 flower update hook，重复运行不重复。
- `test-target/.claude/settings.json` 仅 startup matcher 包含 flower update hook。
- 离线或模拟 registry 失败时启动 hook 不阻断。

## Risk And Rollback

- 风险：manifest 既存安装清单又存策略 / 缓存，写入时容易覆盖用户策略。
  - 回滚：保留旧 manifest 字段；如果 updateCheck 写坏，可手动删除 `updateCheck` 恢复默认 ask。
- 风险：hook 注入命令重复或覆盖上游 hook。
  - 回滚：从 `.codex/hooks.json` / `.claude/settings.json` 删除 flower update hook 片段，保留 Trellis 原 hook。
- 风险：`self-update` 期间全局包升级成功但项目 update 失败。
  - 回滚：命令必须报告未完成，并提示用户手动执行 `flower-trellis update --target <dir> --no-update-check --force`。

## Open Items

无。
