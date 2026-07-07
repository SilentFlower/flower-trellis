# 启动时自更新检查设计

## Architecture

本功能由四层组成：

1. 版本探测层：复用并扩展 `src/lib/update-check.js`，统一生成结构化更新建议。
2. manifest 状态层：扩展 `.trellis/.flower-manifest.json`，保存安装清单、用户策略和检查缓存。
3. CLI 命令层：新增 `self-check`、`self-update`、`update-check` 三类命令。
4. 平台 hook 层：在 Codex / Claude Code SessionStart 中追加轻量检查 hook，把 `self-check --json` 结果注入给 AI。

启动 hook 只做只读检查和上下文注入，不直接执行 npm 安装或项目更新。真正更新必须通过 CLI 命令执行，便于 AI 工具记录、用户审计和失败排查。

版本检查分两条路径：

- 本地一致性检查：读取当前安装的 flower-trellis / 捆绑 Trellis 版本，对比项目 `.trellis/.flower-manifest.json` 的 `flowerVersion` 和项目 `.trellis/.version`。这条路径不受 `intervalHours` 限制，每次启动都可以快速判断。
- 远程可用版本检查：访问 npm registry 读取 flower-trellis dist-tags。只有这条路径受 `intervalHours` 节流和离线静默规则限制。

## Manifest Contract

`.trellis/.flower-manifest.json` 继续作为 flower-trellis 项目内唯一状态文件。现有字段保持兼容：

```json
{
  "flowerVersion": "0.4.1",
  "variant": "0.6",
  "version": "0.6.5",
  "skills": [],
  "paths": []
}
```

新增 `updateCheck`：

```json
{
  "updateCheck": {
    "enabled": true,
    "policy": "ask",
    "intervalHours": 24,
    "lastCheckedAt": "2026-07-07T00:00:00.000Z",
    "lastRemote": {
      "latest": "0.4.2",
      "beta": null
    },
    "lastStatus": "update_available",
    "lastErrorCode": null
  }
}
```

字段语义：

- `enabled`: 是否启用启动检查。`false` 等价于不联网、不注入更新提示。
- `policy`: `off` / `notify` / `ask` / `auto`。
- `intervalHours`: 联网探测最小间隔，默认 24。
- `lastCheckedAt`: 最近一次成功或失败检查时间，用于节流。
- `lastRemote`: 最近一次成功读取到的 npm dist-tags。
- `lastStatus`: 最近一次检查状态，如 `update_available`、`project_out_of_sync`、`up_to_date`、`offline`。
- `lastErrorCode`: 最近一次失败的简短错误码，如 `timeout`、`fetch_failed`、`invalid_response`；不记录完整堆栈或代理 / 路径等敏感细节。

写入规则：

- `writeManifest()` 或后续包装函数必须保留已有 `updateCheck` 用户策略字段。
- 全装重写 manifest 时可以更新 `flowerVersion` / `variant` / `version` / `skills` / `paths`，但不能丢失 `updateCheck.enabled` / `policy` / `intervalHours`。
- 缓存字段 `lastCheckedAt` / `lastRemote` 可由 `self-check` 更新。
- `enabled` 是总开关，`policy` 是启用后的行为偏好。`update-check disable` 只设置 `enabled=false`，不得修改现有 `policy`；`update-check enable` 只设置 `enabled=true`，继续沿用原 `policy`，缺失时按 `ask` 处理。

## CLI Commands

### `flower-trellis self-check --json --target <dir>`

只读探测命令，供 hook / AI 自动化调用。必须始终输出 JSON。

状态枚举：

- `update_available`: 发现可用更新。
- `project_out_of_sync`: 远程检查不一定有新版本，但当前安装版本与目标项目已铺版本不一致，项目需要重叠加。
- `up_to_date`: 当前安装无需更新。
- `disabled`: manifest 策略关闭或环境变量关闭。
- `skipped`: npx、节流命中、目标不是 Trellis 项目等可预期跳过。
- `offline`: 联网失败、超时、registry 返回不可用数据。

输出要包含：

- 当前 flower-trellis 版本。
- 项目 manifest 里的 flower 版本和 Trellis 版本。
- 当前捆绑 Trellis 版本。
- 远程 dist-tags 或缓存值。
- 推荐命令。
- 当前 policy。
- safety 结果，如 dirty 工作区、活跃任务、命令可用性。
- 面向 AI 的动作指令。

### `flower-trellis self-update --target <dir> --yes`

执行受控更新：

1. 根据 `self-check` 推荐通道执行 `npm i -g flower-trellis@latest` 或 `npm i -g flower-trellis@beta`。
2. 全局 flower 更新后，对目标项目执行 `flower-trellis update --target <dir> --no-update-check --force`。
3. 任一步失败都输出明确修复命令；目标项目未重叠加时不得报告完成。

当 `self-check` 返回 `project_out_of_sync` 且没有远程 flower 更新时，项目阶段仍必须执行完整 `flower-trellis update --target <dir> ... --no-update-check --force`，用于刷新：

- Trellis 本体到当前 flower 捆绑版本。
- `.trellis/workflow.md` 的 workflow override / workflow-state sentinel。
- `.agents/skills`、`.claude/skills`、`.claude/commands/trellis` 中的强化 skill。
- `.trellis/scripts` 中的强化脚本与 flower 自有 `flower_update_hook.py`。
- Codex / Claude Code 的 SessionStart hook 后处理。
- `.trellis/.flower-manifest.json` 的 `flowerVersion`、variant、Trellis version、paths 和 updateCheck 缓存。

项目更新阶段必须走现有 `flower-trellis update` 编排，不能直接覆盖单个文件。默认冲突策略使用 Trellis 原生 `--force`，对应用户常用的 “Apply Overwrite to all” / 覆盖全部选择。

为支持其它冲突策略，`self-update` 仍需要允许给项目 update 阶段传递额外参数。默认命令等价于：

```bash
flower-trellis self-update --target . --yes
```

内部项目 update 默认追加 `--force`。`--` 之后的参数只传给内部 `flower-trellis update --target <dir> --no-update-check ...`；如果透传参数里已经包含 `-f` / `--force` / `-s` / `--skip-all` / `-n` / `--create-new` 这类上游冲突策略，`self-update` 不再自动追加默认 `--force`，以用户显式选择为准。当前上游 Trellis `update --help` 已提供 `-f, --force`，语义是覆盖所有 changed files 且不询问，对应交互里的 “Apply Overwrite to all”。flower 不自行发明新的覆盖语义。

`--dry-run` 模式：

- 打印将执行的 npm 安装命令。
- 打印将执行的目标项目 update 命令，默认包含 `--force`。
- 打印目标路径、当前版本、远程版本和安全检查结果。
- 不执行 npm 安装，不执行项目 update，不写 manifest。

### `flower-trellis update-check ...`

管理 `.flower-manifest.json` 中的策略：

```bash
flower-trellis update-check get --target .
flower-trellis update-check set --policy auto --interval-hours 12 --target .
flower-trellis update-check disable --target .
flower-trellis update-check enable --target .
```

`policy` 支持：

- `off`: 不检查、不联网。
- `notify`: 只提示。
- `ask`: 默认，AI 先问用户。
- `auto`: 满足安全条件时 AI 可直接执行。

`disable` / `enable` 语义：

- `disable`: 设置 `updateCheck.enabled=false`，不修改 `updateCheck.policy`。
- `enable`: 设置 `updateCheck.enabled=true`，继续沿用原 `policy`；原 policy 缺失时默认 `ask`。

## Hook Integration

新增项目脚本：

```text
.trellis/scripts/flower_update_hook.py
```

源文件位置：

```text
src/assets/flower_update_hook.py
```

该脚本属于 flower-trellis 自身能力，由 flower-trellis 安装 / 更新流程直接复制到目标项目；不放进 `enhancements/0.6/scripts/`，避免和 skill-garden 快照同步边界混淆。

职责：

- 读取 hook stdin 的 `cwd`。
- 调用 `flower-trellis self-check --json --target <cwd>`。
- 解析 JSON；只有 `status=update_available` 或 `status=project_out_of_sync` 时注入 `<flower-update>` 块。
- `disabled` / `up_to_date` / `skipped` / `offline` 默认不注入用户可见上下文，避免启动噪音。
- 脚本失败时不阻断 SessionStart；必要时可在调试模式输出简短错误。

Codex 集成：

- 泛化或扩展 `src/lib/codex-tweaks.js`，在 `.codex/hooks.json` 的 `SessionStart` 中追加 flower update hook。
- 保留现有 Trellis SessionStart hook，不覆盖上游 UserPromptSubmit。

Claude Code 集成：

- 新增平台后处理，修改 `.claude/settings.json` 的 `hooks.SessionStart`。
- 只对 `startup` matcher 挂载更新检查；`clear` / `compact` 不运行 update hook，避免同一会话内重复提示。

## Safety Rules

`policy=auto` 时，只有全部满足才允许 AI 直接执行：

- 目标项目是 Trellis 项目。
- git 工作区 clean。
- 当前没有 active/in_progress Trellis 任务。
- `flower-trellis` 命令可用。
- `self-check` 返回 `update_available` 或 `project_out_of_sync`，且有推荐命令。
- 未设置 `FLOWER_NO_UPDATE_CHECK`。

任一条件不满足，hook 注入应降级为 `ask`，并说明降级原因。

## Compatibility

- 旧 manifest 没有 `updateCheck` 时使用默认值：`enabled=true`、`policy=ask`、`intervalHours=24`。
- manifest 损坏时，`self-check` 返回 `skipped` 或明确错误 JSON，不应破坏启动。
- 现有 `init` / `update` 的交互版 `checkForUpdate()` 行为保持兼容。
- 现有 Trellis `session_context.py` 的独立更新提示需要避免和 flower 更新提示形成双入口；最终以 flower 更新块为准。

## Open Design Questions

无。
