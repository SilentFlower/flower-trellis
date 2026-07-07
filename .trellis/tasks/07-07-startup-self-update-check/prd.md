# 启动时自更新检查

## Goal

在 Codex / Claude Code 启动 flower-trellis 项目会话时，自动判断当前项目使用的 flower-trellis / Trellis 版本是否落后于远程可用版本，并把可执行、可审计的更新建议注入给 AI；在用户允许的策略下，AI 可以自主执行受控更新命令。

核心价值是让用户不用手动记住“先升级 flower-trellis，再 `flower-trellis update` 重新叠加强化包”，同时避免启动 hook 因联网、npm 安装或权限问题阻塞 Codex / Claude Code 启动。

## Confirmed Facts

- flower-trellis 当前版本来自包根 `package.json`，由 `src/lib/versions.js#flowerVersion()` 读取；捆绑 Trellis 版本由 `src/lib/versions.js#trellisVersion()` 读取。
- 目标项目内已有 `.trellis/.flower-manifest.json`，记录上次全装铺设时的 `flowerVersion`、目标项目 Trellis `version`、variant、skills 和 paths；这是判断“项目上次由哪个 flower 版本叠加”的可靠来源。
- flower-trellis 已有 `src/lib/update-check.js`，能从 `https://registry.npmjs.org/flower-trellis` 读取 npm dist-tags，带 2.5s 超时，失败静默，不阻断主流程。
- 现有 `checkForUpdate(ctx, commandLabel)` 只挂在 `init` / `update` 前，用于交互提示或非交互打印升级命令；尚未接入 Codex / Claude Code 的 SessionStart hook。
- `.trellis/scripts/common/session_context.py` 里已有 Trellis 升级提示雏形：读取项目 `.trellis/.version`，调用 `trellis --version` 解析可用更新，并写 `.trellis/.runtime/update-check-*.marker` 避免同一会话重复提示。
- 当前 Codex SessionStart 入口是 `.codex/hooks/session-start.py`，由 `.codex/hooks.json` 注册；当前 Claude Code SessionStart 入口是 `.claude/hooks/session-start.py`，由 `.claude/settings.json` 注册。
- `src/lib/codex-tweaks.js` 已在 flower-trellis 叠加阶段对 Codex 做后处理：合并 `.codex/hooks.json` 的 SessionStart hook，并强制 `.trellis/config.yaml` 的 `codex.dispatch_mode: sub-agent`。
- 当前没有对应 Claude Code 的统一后处理模块；如需自动为 Claude Code 增加启动检查 hook，需要新增平台后处理或泛化现有 Codex 后处理。
- `src/lib/global-trellis-sync.js` 已能把全局 `trellis` 同步到当前 flower-trellis 捆绑的 `@mindfoldhq/trellis` 版本；因此更新闭环应优先走 flower-trellis，而不是让 hook 单独升级 Trellis。
- release / publishing 规范要求验证 npm 发布结果以 `npm view` / registry 为准，版本联网探测必须尽力而为、带超时、失败静默。

## Requirements

- R1: 启动检查必须支持 Codex 和 Claude Code 两个平台。
- R2: 启动检查必须复用现有 flower-trellis 版本探测规则：npm dist-tags、latest / beta 通道判断、超时、失败静默、npx / `FLOWER_NO_UPDATE_CHECK` 短路。
- R3: 启动 hook 不得直接执行 `npm install -g` 或 `flower-trellis update`；启动阶段只允许做快速检查、缓存读取、结构化上下文注入。
- R4: 必须提供 AI 可执行的确定性命令，用于完成自更新和项目重叠加；命令需要支持非交互模式和 `--target <dir>`。
- R5: 自主更新策略必须可配置，至少能表达“关闭检查 / 只提示 / 询问后执行 / 满足条件时自动执行”。
- R5a: 默认策略必须是 `ask`：启动时发现可更新只注入建议，AI 必须先询问用户，不能默认静默执行更新。
- R6: 自动执行更新前必须有安全门槛，避免在 dirty 工作区、活跃任务执行中、不可读版本状态或缺少 flower-trellis 命令时静默改动项目。
- R6a: 自更新不能产生“只升级全局 flower-trellis、目标项目未重叠加”的半更新状态；一次成功的自更新必须包含目标项目执行 `flower-trellis update --target <dir>`。
- R6b: 当目标项目 git 工作区 dirty 时，即使配置 `policy: auto`，也必须降级为 `ask`，由 AI 告知风险并等待用户确认后再执行更新。
- R7: 启动检查必须有节流机制，避免每次启动都联网；远程检查节流缓存统一写入 `.trellis/.flower-manifest.json` 的 `updateCheck`，如需同一会话去重 marker 才可落在项目本地 `.trellis/.runtime/`。
- R8: 对已有项目，`flower-trellis update` 应能把该能力安装 / 更新到 Codex 和 Claude Code 的 SessionStart 链路，并保持幂等。
- R9: 对新项目，`flower-trellis init` 选择 Codex / Claude Code 后应自动具备该能力。
- R10: 所有用户可见文案、PRD / 设计 / 注释必须使用中文。
- R11: 启动更新提示必须统一以 flower-trellis 为主入口；不单独建议把 Trellis 升级到远程最新版本，Trellis 版本随 `flower-trellis update` 同步到当前 flower-trellis 捆绑版本。
- R12: 启动更新检查的用户策略和运行缓存统一写入 `.trellis/.flower-manifest.json`；manifest 写入必须 merge 保留用户策略字段，不能在全装重写时覆盖用户选择。
- R13: 必须提供 CLI 命令管理 `.trellis/.flower-manifest.json` 里的更新检查策略，不能只依赖用户手动编辑 JSON。
- R14: `updateCheck.policy` 必须明确支持且文档化以下枚举值：
  - `off`: 不做启动更新检查，也不联网。
  - `notify`: 启动时只注入“有更新”提示和手动命令，AI 不主动询问。
  - `ask`: 默认值；启动时发现更新后，AI 必须先询问用户是否执行更新。
  - `auto`: 满足安全条件时，AI 可以自主执行受控更新命令；dirty 工作区或其他安全条件不满足时自动降级为 `ask`。
- R14a: `updateCheck.enabled` 是总开关，`updateCheck.policy` 是启用后的行为偏好；`update-check disable` 只设置 `enabled=false`，不得修改现有 `policy`；`enable` 只设置 `enabled=true`，继续沿用原 `policy`，缺失时默认 `ask`。
- R15: `flower-trellis self-check --json` 必须始终输出稳定 JSON；无更新或检查失败时也通过 `status` 表达状态，而不是静默无输出。
- R16: hook 注入给 AI 的动作指令必须按 policy 固定：
  - `notify`: 只告知发现新版本和手动命令，要求 AI 不主动询问、不主动执行。
  - `ask`: 告知发现新版本和推荐命令，要求 AI 先询问用户是否更新。
  - `auto`: 安全条件满足时允许 AI 直接执行 `flower-trellis self-update --target <dir> --yes`；安全条件不满足时降级为 `ask` 并说明原因。
- R17: `flower-trellis self-update` 必须支持 `--dry-run`，用于预览将执行的全局 npm 安装命令、项目 update 命令、目标路径和安全检查结果，不做任何写入。
- R18: Claude Code 只在 `SessionStart` 的 `startup` matcher 运行 update hook；`clear` / `compact` 不运行 update hook，避免同一会话内重复打扰。
- R19: manifest 的 `updateCheck` 缓存需要记录最近一次检查状态和简短错误码；失败时只写 `lastStatus` / `lastErrorCode`，不写完整错误堆栈或敏感网络细节。
- R20: `flower_update_hook.py` 的源文件属于 flower-trellis 自身能力，放在 `src/assets/flower_update_hook.py`，由 flower-trellis 直接复制到目标 `.trellis/scripts/`；不得放进 `enhancements/0.6/scripts/` 以免和 skill-garden 快照同步边界混淆。
- R21: 本地项目版本不一致必须优先于远程检查节流。只要 `.trellis/.flower-manifest.json` 中的 `flowerVersion` 与当前安装的 `flowerVersion()` 不一致，或项目 `.trellis/.version` 与当前 flower-trellis 捆绑 Trellis 版本不一致，就必须注入“项目需要重叠加/同步”的提示，不得因为 `intervalHours` 未到而跳过。
- R22: `intervalHours` 只限制访问 npm registry 的远程版本探测，不限制本地 manifest / 项目版本一致性检查。
- R23: 项目内容更新必须沿用现有 `flower-trellis update` 链路：同步全局 Trellis 到当前 flower 捆绑版本，运行 `trellis update`，再执行 `applyEnhancements()` 重叠加强化包；不能只改 manifest 或只覆盖单个 hook 文件来冒充完成。
- R24: 自更新命令的项目 update 阶段默认使用上游 `--force`，即等价于交互里的 “Apply Overwrite to all” / 覆盖全部；仍允许用户通过 `--` 透传其它上游冲突策略覆盖默认值，例如 `--skip-all` 或 `--create-new`。

## Technical Notes

- 新增只读命令：`flower-trellis self-check --json --target <dir>`，输出当前安装版本、项目 manifest 版本、npm dist-tags、推荐动作和 AI 指令。
- `self-check --json` 状态至少包括：`update_available`、`project_out_of_sync`、`up_to_date`、`disabled`、`skipped`、`offline`。启动 hook 根据 status 决定是否注入用户可见上下文。
- `self-check --json` 需要区分远程可更新和本地项目不同步。即使 npm 远程检查被 interval 节流，本地不同步仍返回可注入状态，例如 `project_out_of_sync`。
- 新增执行命令：`flower-trellis self-update --target <dir> --yes`，按推荐通道升级全局 flower-trellis，并对目标项目默认执行 `flower-trellis update --target <dir> --no-update-check --force`；目标项目重叠加无法执行时，整体视为未完成，需要给出明确修复指令；`--dry-run` 只预览不写入。
- 当只是本地项目版本与当前安装版本不一致、但远程没有新版或远程检查被节流时，推荐命令应是 `flower-trellis update --target <dir> --no-update-check --force` 或 `flower-trellis self-update --target <dir> --yes --project-only` 这类仅重叠加项目的路径；`self-update` 的 project-only 路径同样默认 `--force`。
- 新增策略管理命令，例如 `flower-trellis update-check get|set|disable|enable --target <dir>`：
  - `get`: 显示当前 manifest 中的 `updateCheck` 策略和最近检查缓存。
  - `set --policy <off|notify|ask|auto> [--interval-hours <n>]`: 修改策略。
  - `disable`: 设置 `enabled=false`，不修改 `policy`。
  - `enable`: 设置 `enabled=true`，继续沿用原 `policy`；原 policy 缺失时默认 `ask`。
- 策略管理命令使用顶层命名空间 `flower-trellis update-check ...`；`self-check` 保持只读自动化探测职责，`self-update` 保持执行升级职责。
- 新增项目内轻量 hook 脚本，例如 `.trellis/scripts/flower_update_hook.py`，由 Codex / Claude Code SessionStart 调用；该脚本只调用 `flower-trellis self-check --json` 并把结果转成注入上下文。
- hook 脚本源文件放在 `src/assets/flower_update_hook.py`，作为 flower 自有资产复制到目标 `.trellis/scripts/flower_update_hook.py`。
- 新增平台后处理模块，负责为 `.codex/hooks.json` 和 `.claude/settings.json` 合并启动检查 hook；Codex 现有 `codex-tweaks` 可保留或被泛化。
- 默认策略为 `ask`：启动时提示 AI 有更新，AI 先询问用户；只有用户显式配置 `auto` 时才允许 AI 自主运行更新命令。
- 现有 `.trellis/scripts/common/session_context.py` 的 Trellis 更新提示需要避免与 flower 更新提示形成双入口；最终启动上下文只展示统一 flower 更新块。
- `.trellis/.flower-manifest.json` 需要扩展结构，例如新增 `updateCheck` 段：

  ```json
  {
    "flowerVersion": "0.4.1",
    "variant": "0.6",
    "version": "0.6.5",
    "skills": [],
    "paths": [],
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

  其中 `enabled` / `policy` / `intervalHours` 是用户策略，`lastCheckedAt` / `lastRemote` / `lastStatus` / `lastErrorCode` 是运行缓存。

## Out of Scope

- 不让启动 hook 直接执行全局 npm 安装。
- 不实现 GUI / 桌面通知。
- 不单独升级 `@mindfoldhq/trellis` 到远程最新版本；Trellis 版本跟随当前 flower-trellis 捆绑依赖。
- 不把该能力做成长期后台进程或定时任务。
- 不修改 npm 发布流程和 CI Trusted Publishing 机制。

## Acceptance Criteria

- [ ] Codex SessionStart 会注入 flower-trellis 更新状态；无更新、离线或关闭检查时不打扰用户。
- [ ] Claude Code SessionStart 会注入同等更新状态；无更新、离线或关闭检查时不打扰用户。
- [ ] `flower-trellis self-check --json --target <dir>` 在有更新、无更新、离线、npx、关闭检查、manifest 缺失等场景下始终输出稳定 JSON。
- [ ] 当项目 manifest 的 `flowerVersion` 落后于当前安装版本，或项目 `.trellis/.version` 与当前捆绑 Trellis 版本不一致时，即使远程检查 interval 未到，SessionStart 也会注入项目需要更新 / 重叠加的提示。
- [ ] `flower-trellis self-update --target <dir> --yes` 能完成全局 flower-trellis 更新和目标项目 `flower-trellis update` 重叠加；失败时给出明确手动命令，不吞掉错误。
- [ ] 项目内容更新会执行完整 `flower-trellis update` 链路，包括 Trellis update 和 `applyEnhancements()` 重叠加；默认按上游 `--force` 覆盖全部，且用户显式透传其它上游冲突策略时以用户选择为准。
- [ ] `flower-trellis self-update --target <dir> --dry-run` 只预览将执行的命令、目标路径、版本和安全检查结果，不做任何写入。
- [ ] `flower-trellis update-check get|set|disable|enable --target <dir>` 能管理 `.trellis/.flower-manifest.json` 的 `updateCheck` 策略；`disable` 不修改 `policy`，`enable` 沿用原 `policy`。
- [ ] `flower-trellis init` / `flower-trellis update` 对已有 Codex / Claude Code 项目重复运行后，hook 配置不重复、不覆盖非 flower 管理的已有 hook。
- [ ] 启动检查联网失败或超时不影响 Codex / Claude Code 正常启动。
- [ ] 自动执行策略默认不静默改项目；只有显式配置允许时，AI 才能自主执行更新命令。
- [ ] `policy=auto` 遇到 dirty 工作区或其他安全条件不满足时降级为 `ask`。
- [ ] `src/assets/flower_update_hook.py` 会复制到目标 `.trellis/scripts/flower_update_hook.py`；该脚本不从 `enhancements/0.6/scripts/` 同步。
- [ ] README 和相关 help 文案说明启动检查、配置策略、跳过方式和手动修复命令。
- [ ] 通过语法检查：`node --check src/cli.js && for f in src/lib/*.js src/commands/*.js; do node --check "$f"; done`。
- [ ] 通过针对临时目标的 dogfood 验证：`flower-trellis init --target ./test-target -y`、`flower-trellis update --target ./test-target --dry-run`，并检查 Codex / Claude Code hook 合并结果。

## Open Questions

无。
