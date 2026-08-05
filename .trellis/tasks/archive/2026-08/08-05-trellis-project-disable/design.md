# Technical Design

## Architecture Overview

新增 Flower 自有的 Trellis Integration Control Plane。它不修改上游 Trellis 模板或 Skill-Garden 作者源，而是在目标项目中依据现有所有权证据生成 detach/restore 计划，并用独立事务管理平台入口。

```text
ft trellis disable|enable|status
        |
        v
src/commands/trellis.js
        |
        +--> target discovery
        |      - getConfiguredPlatforms()
        |      - collectPlatformTemplates()
        |      - .trellis/.template-hashes.json
        |      - .flower/state.json
        |
        +--> mutation planning
        |      - exclusive file detach
        |      - AGENTS managed block extraction
        |      - shared JSON structural extraction
        |
        +--> control transaction
               - preflight/hash drift checks
               - backup + manifest
               - apply / rollback
               - disabled-state verification
```

## State And Storage

在 `.flower/` 下增加本机私有控制状态：

```text
.flower/trellis-control.json
.flower/trellis-detached/<transaction-id>/
  manifest.json
  files/<encoded-path>
```

`.flower/.gitignore` 增加 `trellis-control.json` 和 `trellis-detached/`。状态不进入 Plugin declarations/lock/state，避免 Plugin lifecycle 覆盖控制面。

控制状态 schema 至少包含：

```js
{
  schemaVersion: 1,
  status: "disabled" | "repair-required",
  transactionId: string,
  disabledAt: string,
  configuredPlatforms: string[],
  trellisVersion: string,
  flowerVersion: string,
  manifestPath: string,
  expectedDisabled: Array<{
    path: string,
    kind: "exclusive-file" | "managed-block" | "json-fragment",
    afterHash: string | null
  }>
}
```

`ProjectStore` 负责 `.flower` 路径边界、软链检查和 control state 原子读写；独立 validator 拒绝损坏 schema，普通命令不得覆盖损坏证据。

## Target Discovery

目标集合按以下事实源取并集：

1. `getConfiguredPlatforms(projectRoot)` 返回的全部 Trellis 配置平台；
2. 每个平台 `collectPlatformTemplates(platform)` 的模板路径；
3. `.trellis/.template-hashes.json` 中上述平台 root 下实际被 Trellis 记录的路径；
4. `.flower/state.json` 中 `flower/skill-garden` 及其它明确属于 Trellis 集成的投影路径；
5. 根级 `AGENTS.md` Trellis 管理块。

不扫描并猜测整个平台目录。`.trellis/**` 默认不进入 detach 目标，Flower SessionStart hook 等位于 `.trellis/scripts/` 的实现文件可以保留，因为平台注册入口关闭后不会被 AI 调用；这样 tasks/spec/workspace 和 Git 状态保持稳定。

共享 `.agents/skills/` 中仅处理 Trellis 所有权路径，不触碰 common/第三方 Skills。

## Mutation Classes

### Exclusive File

适用于独立 Skill、Agent、Command、Workflow、Prompt、Hook 脚本、Extension 文件以及 hash-clean 的纯 Trellis 配置文件。

- preflight 校验普通文件、项目内路径和 owner hash；
- 保存原始字节和 mode；
- 删除目标文件；
- 只清理本轮变空且完全位于受管目标链上的目录。

目标存在用户修改且没有安全拆分器时，默认返回 conflict。显式 `--force` 仍先保存原始字节，再整体 detach，恢复时原样返回。

### Managed Markdown Block

首版处理 `AGENTS.md` 的 `TRELLIS:START` / `TRELLIS:END` 块：

- 必须恰好存在一对有效标记，否则 preflight conflict；
- manifest 保存块正文、前后锚点和关闭前后 hash；
- disable 只删除管理块并规范化相邻空行；
- enable 在目标不存在 Trellis 块时重新插入，保留关闭期间其它正文变化；已有不同 Trellis 块则冲突。

### Shared JSON Fragment

平台 settings/hooks JSON 可能包含用户配置。使用结构化 JSON 而不是整文件文本替换：

- 依据当前平台模板 JSON 和明确的 Trellis 受管路径生成待移除 object key、array entry 和 hook command 操作，禁止只按 `trellis` 名称猜测所有权；
- 只删除模板拥有或明确引用 Trellis hook/extension/agent 路径的节点；
- manifest 保存关闭前原始 JSON 与关闭态 canonical JSON；status/enable 在内存中按 matcher/id/name/path/command 等稳定身份推导结构化差量和数组相对顺序；
- 同身份数组节点仍保留用户子节点时，模板减法必须保留 matcher/id/name 等身份字段，避免用户 hook 组变成无条件组或恢复出重复组；
- 删除后再次扫描，若仍残留 Trellis 可执行引用则 preflight conflict；
- enable 将保存节点合并到关闭期间的当前 JSON，相同节点幂等，冲突节点阻断全量恢复。

无法结构化处理的 TOML/Markdown 配置只在 hash-clean 时按 exclusive file 处理；用户修改时 fail closed，不进行启发式文本删除。

## Disable Transaction

1. 校验项目根、`.trellis`、control state 和现有 repair evidence。
2. 解析 configured platforms 与目标集合。
3. 对全部目标生成 mutation、before/after hash、备份载荷和冲突列表。
4. dry-run 到此返回，零写入。
5. 建立 `.flower/trellis-detached/<id>/` staging、backup 和 manifest。
6. 依稳定路径顺序应用 mutation，并持续记录 completed operations。
7. 校验所有 Trellis 入口均已 absent/neutralized。
8. 最后原子写 `trellis-control.json(status=disabled)`。
9. 失败时逆序恢复；恢复不完整则保留目录并写 `repair-required`。

重复 disable 在状态和磁盘均 disabled 时返回 unchanged；状态为 disabled 但入口重新出现时返回 drifted/conflict。显式 force 重收敛必须把旧 manifest 的全部原始材料迁移到新事务，只 detach 重新出现或新增的入口，并在新 control state 成功落盘后才清理旧事务。

## Enable Transaction

1. 读取并校验 control state、manifest 和所有备份 hash。
2. 对全部目标预演恢复：exclusive path 必须缺失或字节相同；共享文件必须可无冲突合并。
3. dry-run 返回恢复计划，零写入。
4. 先快照当前 disabled 现场，再应用全部恢复 mutation。
5. 恢复后调用当前 Flower 内部 update/replay 边界进行版本规范化；该调用带内部 `restoring` 上下文，避免 disabled guard 再次 detach。
6. 若 update/replay 失败，使用本轮快照回滚到完整 disabled 现场。
7. 全部成功后删除 control state；detached evidence 只在清理成功时删除，清理失败作为 warning 保留。

原 active task、`.trellis` runtime 和 Plugin declarations/lock/state 不因 detach 丢失。

## Status And Drift Detection

`status` 是只读命令：

- `enabled`：无 control state，且存在 Trellis 配置/入口；
- `disabled`：control state 有效，manifest/备份完整，所有 expected disabled 目标满足 after hash；
- `drifted`：状态为 disabled，但至少一个 Trellis 入口重新出现或共享文件片段不再满足关闭结果；
- `repair-required`：control state、manifest、备份或上次回滚损坏；
- `not-initialized`：项目没有 `.trellis` 和控制状态。

直接执行上游 `trellis update` 后通常进入 `drifted`。该行为是显式绕过，不自动修改或移动 `.trellis`。

## Flower Lifecycle Integration

- `flower-trellis update` 和由 `self-update` 触发的项目 update 在进入主流程前读取 control state。
- disabled 项目执行 update 时，内部事务临时物化入口以复用现有 Trellis update/platform detection，完成 Trellis + Plugin 更新后立即重新生成新的 detach evidence 并再次关闭；最终成功条件包含 disabled verification。
- 更新任一步失败时，现有 update compensation 与 control transaction 共同恢复到调用前 disabled 现场。
- `plugin add/update/remove/replay` 完成写入后若 control state 为 disabled，必须执行 Trellis integration reconciliation；外部非 Trellis Plugin 内容保留，仅重新 detach Trellis-owned 路径。
- disabled 包装的外层补偿快照必须从 Plugin preflight 接收精确 content/Patch target；对普通 Update 排除的 `.trellis/spec` 只强制捕获明确目标或首个缺失祖先，不能扩大为整个用户数据目录。外层恢复不完整时持久化 `repair-required`。
- 直接调用上游 `trellis update` 不在 Flower 控制边界内，由 `status` 报告 drift。

## CLI Contract

```bash
flower-trellis trellis disable [--dry-run] [--force] [--target <dir>]
flower-trellis trellis enable  [--dry-run] [--force] [--target <dir>]
flower-trellis trellis status  [--target <dir>]
```

不接受 `--platform`。退出码沿用现有风格：usage `2`、conflict/validation `3`、其它失败 `1`。

## Compatibility And Rollback

- 仅使用 Node 18 内置模块和现有 Trellis exports，不增加依赖。
- 路径统一使用 POSIX manifest key，Windows 文件调用转换为本地路径。
- CRLF/LF hash 语义复用 Trellis `computeHash()`；备份保存原始字节。
- 旧项目缺少 Flower state 时仍可仅依据 template hashes 关闭原生 Trellis 入口。
- 任意 repair-required 状态禁止 disable/enable 覆盖证据，即使显式 `--force` 也必须先按诊断修复；`--force` 只处理恢复证据完整时的目标内容冲突和 drifted 重收敛。

## Main Risks

- 多平台共享同一 `.agents/skills` 目标，需要稳定去重和多 owner 证据。
- 共享 JSON 的数组顺序与关闭期间用户修改可能导致恢复冲突，必须使用结构化 operation 而不是整文件覆盖。
- disabled update 会跨 control transaction、Trellis update compensation 和 Plugin transaction，必须保证最终状态只有完整 disabled 或完整 enabled。
- 正在运行的 AI 会话已经缓存入口；CLI 只能保证重启后的新会话。
