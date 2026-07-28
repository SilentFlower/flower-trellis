# 内置 skill-garden 与旧 CLI 迁移

## 目标

将现有 `enhancements/`、`applyEnhancements()` 和 `.trellis/.flower-manifest.json` 成功链迁移为 `flower/skill-garden` 内置 system Plugin，并让 `init/update/uninstall/self-check/update-check` 使用统一 Plugin Runtime，同时保持既有安装结果、平台资产、Patch marker 和 CLI 兼容。

本任务是父任务 P5，依赖 P2 Runtime/事务和 P4 capability/Patch 集成。

## 已确认事实

- `init` 和 `update` 当前在 Trellis 成功后直接调用 `applyEnhancements()`。
- `resolveEnhancementSnapshot()` 强制目标存在 `.trellis/`，只适合内置 Trellis 场景。
- `uninstall` 当前按安装包当前快照中的 skill 名称猜测清理路径，不能证明实际所有权。
- `enhancements/<variant>` 是已发布离线快照，`vendor/skill-garden` 不进入 npm 包；首期不搬迁快照内容。
- 现有 Patch Engine 对内置 `skill-garden`/`flower` 保留 local marker 兼容语义。
- 完整 `flower-trellis init` 默认安装 `skill-garden`；独立 `plugin add` 不隐式安装。

## 需求

### R1. 内置 `flower/skill-garden`

- 新增内置 Plugin manifest，canonical ID 固定为 `flower/skill-garden`，由 builtin provider 的不可伪造信任根授予 `system`。
- payload adapter 继续读取 `enhancements/<variant>`、现有 skill-garden/flower catalog、脚本和 Flower assets，不在本期搬迁大量快照。
- variant 选择继续依据目标 `.trellis/.version` 和 `--variant`，兼容 `old|0.5|0.6`。
- 内置 Plugin digest 必须稳定绑定 Flower 包版本、variant、快照 manifest 和 catalog 内容，不依赖绝对路径或同步时间。
- 保持现有 local operation ID、marker、selector、备份和 compiled target 字节兼容。

### R2. Init 默认声明

- `flower-trellis init` 在 Trellis 初始化成功后声明并安装 `flower/skill-garden`。
- 新项目的 `.flower/plugins.json` 将其记录为直接默认 Plugin；lock/state 由统一 Runtime 生成。
- `plugin add` 仍只安装目标及显式依赖，不因 Runtime 存在而自动声明 `skill-garden`。
- `--no-enhance` 保留为兼容入口：当前命令不声明或应用默认 `flower/skill-garden`，不能提升或改变外部 Plugin 依赖。
- `--enhance-only` 使用同一 Runtime 只声明/重放 `flower/skill-garden`，不调用 Trellis init/update。

### R3. Update 重放

- 普通 `flower-trellis update` 在 Trellis 更新后重放 `plugin-lock.json` 中已锁定的全部 Plugin，不重新解析外部版本。
- `flower/skill-garden` 可根据新的 Trellis 版本重新选择内置 variant，但外部 Plugin 版本只能由 `plugin update` 改变。
- update 的 Trellis config 保留、备份清理和 dry-run 行为保持兼容。
- dry-run 展示 Trellis 预览和 Plugin 重放计划，不应用 Plugin mutation。
- `--no-enhance` 当前命令跳过默认 skill-garden mutation；显式外部 Plugin 仍按 lock 和自身依赖处理。

### R4. `applyEnhancements()` 兼容 facade

- 保留现有导出和返回/日志兼容，内部委托 Plugin application service 处理 `flower/skill-garden`。
- facade 不再直接复制资产、清理 stale path 或写旧成功 manifest。
- 现有单元测试可逐步改为断言 Runtime 结果，但对外调用点在迁移期不需要同时重写。
- 全部成功状态只写 `.flower/`；不得同时保留旧 manifest 写链和新 state 写链。

### R5. 旧 manifest 迁移

- 只读解析 `.trellis/.flower-manifest.json` 的 variant、version、skills、paths、patch provenance 和 update-check 策略。
- 在内存映射为 `flower/skill-garden` 的直接声明、lock 节点和 state ownership，再与实际目标 hash 校验。
- 只有完整 preflight 和事务成功后才持久化 `.flower/`；失败保留旧 manifest 和目标原状。
- 迁移成功后保留旧 manifest 作为历史证据，不继续写入；state 记录 migration source/schema。
- 重复运行迁移必须幂等，不重复声明、重复 ownership 或改变 lock。
- 旧 manifest 缺失、损坏或与目标不一致时返回可诊断结果，不能按当前快照猜测所有权。

### R6. Update-check 与 Self-check

- update-check 用户策略迁移到 `.flower/settings.json`，本机运行缓存迁移到 `.flower/update-check.tmp`，均复用 P1 稳定写入与局部 ignore。
- 兼容读取旧 `.trellis/.flower-manifest.json` 和 `.flower-update-check.tmp`；新位置成功写入后不再更新旧位置。
- `self-check` 优先读取新 Plugin lock/state，报告 `flower/skill-garden`、外部 Plugin 和迁移状态；旧项目仍可只读降级。
- 普通启动检查不得因 `rd-guide` 预注册而联网。

### R7. Uninstall 与所有权

- `flower-trellis uninstall` 在 Trellis 删除前读取 `.flower/state.json` 的 `flower/skill-garden` 所有权并生成 dry-run 计划。
- Trellis uninstall 成功后只删除仍匹配 state hash 的 skill-garden/Trellis-owned 目标；用户修改项报告冲突并保留。
- 不按当前 npm 快照名称猜测，也不删除其它 Plugin 拥有或共享的路径。
- 外部 Plugin 仍存在时保留 `.flower/`、lock 和 state；只在没有任何 Plugin/状态且目录可安全判空时清理空 Runtime 边界。
- dry-run 零写入并展示 Trellis 与 Plugin 清理计划。

## 验收标准

- [ ] 新 init 默认声明并安装 `flower/skill-garden`；`--no-enhance` 不声明/应用；独立 `plugin add` 不隐式安装。
- [ ] builtin payload adapter 对 old/0.5/0.6 产出与当前 enhancement 链相同的最终文件和 Patch provenance。
- [ ] `applyEnhancements()` facade 不再写旧 manifest，现有调用点与关键日志/返回契约兼容。
- [ ] 普通 update 重放锁定外部 Plugin，只有 skill-garden variant 随 Trellis 兼容线调整；外部版本不升级。
- [ ] 旧 manifest 正常、缺失、损坏、目标漂移和重复迁移均有测试；失败零写入且保留旧证据。
- [ ] update-check 策略/缓存迁移和旧读取兼容通过，启动检查不触发 GitLab。
- [ ] uninstall 只按 state ownership + hash 删除，保留共享、外部和用户修改路径。
- [ ] 新旧项目在 init/update/self-check/uninstall 上有对比 fixture，重复执行第二次零变化。
- [ ] sync、snapshot、Patch conflicts、compiled targets、context budget 和完整 `npm test` 通过。

## 非目标

- 不搬迁或重写 `enhancements/` 快照生成流程。
- 不实现 GitLab、作者工具或外部 Marketplace CI。
- 不移除 `--no-enhance`、`--enhance-only` 或旧 manifest 只读兼容。
- 不自动卸载用户显式安装的外部 Plugin。
