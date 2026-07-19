# Config & State

> 常量、路径定位、版本读取与安装清单(状态)的约定。

---

## Overview

flower-trellis 自身几乎无内存态:配置是一组**集中常量**,运行所需的「状态」落在
**目标项目磁盘**上(`.trellis/.version`、`.trellis/.flower-manifest.json`,以及
gitignored 的 `.trellis/.flower-update-check.tmp` 运行缓存)。
所有跨模块名单收敛到 `src/constants.js`,所有包内路径从 `src/lib/paths.js` 派生。

---

## Constants (`src/constants.js`)

集中三类名单,改动时**必须与上游同步**(注释已标注来源):

- `VARIANTS = ["old", "0.5", "0.6"]` —— 强化包支持的三个变体目录名。
- `PLATFORM_FLAGS` —— Trellis init 支持的全部平台 flag;用户未指定平台时据此判断是否补默认。
  来源为 Trellis `cli/index.ts` 的 init 注册,上游新增平台时此名单可滞后(最坏只是误补
  `--claude`,不致命)。
  - Trellis 0.6.5 起 `--devin` 是 Windsurf 更名后的主 flag,`--windsurf` 仍作为旧别名保留;
    `--zcode`、`--trae` 是平台 flag,也要纳入 `PLATFORM_FLAGS`。
  - `--with-statusline` 是 Claude Code 功能开关,不是平台选择,不要纳入 `PLATFORM_FLAGS`。
- `OWN_FLAGS` —— flower 自有、**不能透传给 trellis** 的 flag;值 `false`=布尔 flag,
  `true`=带取值 flag(剔除时要连带跳过其后一个 token)。

> 新增 flower 自有 flag 时,务必同时更新 `OWN_FLAGS` 与 `cli.js` 的 `parse()`,
> 否则会被错误透传给 trellis。

---

## Path Resolution (`src/lib/paths.js`)

- 唯一的路径锚点:`PKG_ROOT`(包根)与 `ENHANCEMENTS_ROOT`(`<PKG_ROOT>/enhancements`),
  均由 `import.meta.url` 派生。其它模块需要包内路径时**从这里 import**,不要各自
  `fileURLToPath` 重算。

---

## Version Reading (`src/lib/versions.js`)

- `flowerVersion()` 读包根 `package.json` 的 `version`。
- `trellisVersion()` 解析捆绑依赖 `@mindfoldhq/trellis/package.json`;**容错**:依赖缺失时
  返回占位串 `"(未安装)"` 而非抛错 —— `-v` 在任何环境都应能打印。
- 模式约定:版本/装饰类读取失败一律降级,不影响主输出。
- `-v` / `--version`(`printVersion`)按分组打印:
  1. 顶部先打印 `flower-trellis` 工具版本。
  2. 若项目内可读到状态,打印 `project` 分组,顺序固定为 `flower`(项目
     `.trellis/.flower-manifest.json` 的 `flowerVersion`,即「上次哪个 flower 铺的」)、
     `.trellis`(项目 `.trellis/.version`)；旧 manifest 无 `flowerVersion` 时自动省略
     `flower` 行。
  3. 最后打印 `bundled` 分组里的 `trellis` 捆绑依赖版本。
  项目状态读取失败一律吞掉并继续打印 `bundled` 分组；非 Trellis 目录只显示顶部工具版本与
  `bundled` 分组。

---

## Network Probe (尽力而为联网探测)

> flower 自身几乎零网络依赖;**唯一**的对外探测是查 npm 上 flower-trellis 自身的
> 可用版本(`src/lib/update-check.js`),入口包括 `init` / `update` 启动提示和
> `self-check` 的远程版本探测。任何联网探测都必须「尽力而为」:
> 带超时、失败静默、**绝不阻断主流程**。这是「Version Reading」降级约定在网络场景的延伸。

- **签名 / 契约**:`fetchPackageUpdateMetadata(): Promise<{tags,releaseNotesByVersion}|null>`
  —— 成功一次读取 npm registry 根文档,同时解析 `dist-tags.latest` / `dist-tags.beta`
  与各版本 package metadata 中的 `flowerReleaseNotes`;**任何失败一律 `null`**(调用方据此
  「拿不到就当没这回事」继续)。`fetchPackageDistTags()` 作为兼容导出保留,只返回
  `metadata.tags`;`fetchLatestVersion()` 仅作为旧兼容导出保留,新逻辑不要继续扩展它。
- `flowerReleaseNotes` 是 flower 内部 npm metadata 字段,每个版本只保存自己的 CHANGELOG
  段落;客户端跨版本聚合时从同一次 registry 根文档的 `versions` 字典读取并按目标通道过滤。
- release notes 摘要上限固定为最多 5 个版本、单版本 500 字符、总计 1600 字符;截断或还有
  更多版本时必须设置 `truncated` / `moreVersions`。
- **超时**:用 `AbortController` + `setTimeout(ac.abort, 5000)`,`signal` 传入内置 `fetch`;
  `finally` 里 `clearTimeout` 防句柄泄漏(否则 timer 可能拖住进程不退出)。
- **三道防线 → `null`**:① `!res.ok`(非 200);② `catch`(AbortError 超时 / `fetch failed`
  离线 / JSON 解析失败);③ 字段类型不符(`dist-tags.latest` / `dist-tags.beta` 都不是字符串)。
  `flowerReleaseNotes` 缺失或损坏只影响摘要,不得影响版本判断。
- **编排短路**:`checkForUpdate(ctx, label)` 顺序短路——关闭开关
  (`ctx.updateCheck===false` 或 `process.env.FLOWER_NO_UPDATE_CHECK` 非空)→ npx
  (`isRunningViaNpx()`,路径含 `_npx`)→ 探测失败 → 无升级推荐,任一命中即静默返回。
- **通道推荐**:稳定版当前安装只比较 `latest`;beta/prerelease 当前安装先比较 `latest`,
  若 `latest` 高于当前 beta 则推荐稳定版,否则比较 `beta`。安装命令必须锁定本次 registry
  metadata 已确认存在的精确版本并追加 `--prefer-online`,不得在执行阶段重新解析可移动 tag。
- **安装缓存竞争**:`checkForUpdate()` 与 `self-update` 共用 `installFlowerVersion()`。npm
  返回 `ETARGET` 时等待 1 秒并只重试一次;其它错误不重试。最终失败仍按原有边界降级为
  手动命令或中文错误,不得阻断 `init` / `update` 的既有容错路径。
- **不引重依赖**:不引 `update-notifier` / `semver`;版本比较轻量支持
  `major.minor.patch` 与 `major.minor.patch-beta.n`。不认识的 prerelease label 宁可不提示,
  避免跨预发布线误判。

| 失败条件 | 行为 |
|---|---|
| 离线 / DNS 失败 / 超时(>5s) | `catch` → `null` → 不打印,主流程继续 |
| 非 200(404/5xx) | `null` → 静默 |
| 响应无可用 `dist-tags.latest` / `dist-tags.beta` | `null` → 静默 |
| 关闭开关 / npx | 不发请求,直接返回 |

**Wrong**:`const v = (await fetch(url)).json(); return v.version;` —— 无超时(离线时挂起)、
无 try/catch(失败抛进 init/update 主流程)、无字段校验。
**Correct**:见 `src/lib/update-check.js#fetchPackageUpdateMetadata`(AbortController + 三道防线 + `finally` 清 timer)。

---

## Variant Selection (`src/lib/variant.js`)

- `selectVariant(target)` 读目标 `.trellis/.version` → 返回 `{ variant, version }`。
- 规则(逐字符移植 skill-garden `install.sh` 263-274):主版本 ≥1 或次版本 ≥6 → `0.6`;
  次版本 ≥5 → `0.5`;文件缺失/解析失败/更低 → `old`。次版本会先剥掉 `-beta.x` 后缀。
- 改这条规则前先确认上游 install.sh 的对应逻辑,保持一致。

---

## Install Manifest (`src/lib/manifest.js` + `.flower-manifest.json`)

flower 自己的安装清单,是「精确升级清理」的依据:

- 位置:目标项目 `.trellis/.flower-manifest.json`,随 Trellis 生命周期存在
  (`uninstall` 删 `.trellis/` 时一并消失)。
- 内容:`{ flowerVersion, variant, version, skills[], paths[], patches, updateCheck }` —— 记录**上一次全装铺过的精确路径**,
  升级(如 `0.5`/`old` → `0.6`)时据此删除「上次有、本次变体不含」的过期项,
  **只删自己铺过的路径**,绝不误删用户或 Trellis 本体的文件。
  - `flowerVersion` = 铺包时的 **flower-trellis 工具版本**(`flowerVersion()` 读包根 `package.json`);
    `version` = 目标项目的 **Trellis 版本**(`selectVariant` 从 `.trellis/.version` 拷来)。二者勿混淆 ——
    前者答「上次哪个 flower 铺的」,后者答「项目当时是哪个 trellis」,均服务后续升级判断。
  - 仅全装(无 `--skills`)时写 manifest;`--skills` 精细操作不动 manifest,故 `flowerVersion`
    只在全装时刷新。
  - `patches` 是 0.6 Patch provenance：固定包含 `schemaVersion`、`catalogHash` 和
    `applied[]`；每项记录 operation/patch/bundle/target、稳定 `status: applied` 与最终
    `resultHash`。重复全装时 provenance 必须不因本轮 changed/unchanged 而变化。
  - `updateCheck` 在 manifest 内只保存启动更新检查的用户策略:
    `enabled` / `policy` / `intervalHours`。全装重写 manifest 时必须保留已有策略,
    不能把用户选择重置回默认值。
- `readManifest` 读不到 / 损坏时返回 `null`(调用方需判空);`writeManifest` 写
  `JSON.stringify(data, null, 2) + "\n"`(两空格缩进 + 结尾换行)。
- `readUpdateCheck(target)` 必须对旧 manifest / 损坏字段返回默认策略:
  `{ enabled:true, policy:"ask", intervalHours:8, lastCheckedAt:null, lastRemote:null, lastReleaseNotes:null, lastStatus:null, lastErrorCode:null }`。
- `readUpdateCheck(target)` 返回兼容合并视图:策略来自 manifest,运行缓存来自
  `.trellis/.flower-update-check.tmp`;如果 tmp 不存在,允许从旧 manifest 的缓存字段 fallback。
- `writeUpdateCheck(target, patch)` 拆分写入:策略字段写 manifest,缓存字段写
  `.trellis/.flower-update-check.tmp`,并保留 manifest 其它安装清单字段。
- 旧 manifest 若仍包含 `lastCheckedAt` / `lastRemote` / `lastReleaseNotes` / `lastStatus` /
  `lastErrorCode`,下一次 `writeUpdateCheck()` 或 `writeManifest()` 必须清理这些字段;
  tmp 不存在时先迁移旧缓存,避免清理导致 interval / release notes 缓存立刻丢失。
- `lastRemote` 只记录 npm `dist-tags.latest` / `dist-tags.beta` 版本事实;release notes /
  changelog 摘要必须写入 tmp 内独立的 `lastReleaseNotes`,不得混入 `lastRemote`。
- 0.6 全装成功 manifest 必须在统一 Patch、资产复制和 stale 清理全部成功后写入；0.5/old
  还要等待 legacy 后处理成功。required Patch preflight 失败时不得刷新 manifest，保留旧清单
  供下次全装恢复。详见 [Trellis Patch Engine](./trellis-patch-engine.md)。

## Scenario: Startup Self-Update Check

### 1. Scope / Trigger

- Trigger: 新增或修改启动时自更新检查、`self-check` / `self-update` / `update-check`
  命令、`.trellis/.flower-manifest.json` 的 `updateCheck` 字段、或 Codex / Claude Code
  SessionStart 更新检查 hook。
- Scope: 启动 hook 只做只读检查与上下文注入;所有写入型更新必须通过 CLI 命令执行,
  便于 AI 先按 policy 决策、用户审计和失败恢复。

### 2. Signatures

```bash
flower-trellis self-check --json --target <dir> [--force-remote] [--no-update-check]
flower-trellis self-update --target <dir> --yes [--dry-run] [--project-only] [-- <trellis update flags>]
flower-trellis update-check get --target <dir>
flower-trellis update-check set --target <dir> --policy <off|notify|ask|auto> [--interval-hours <n>]
flower-trellis update-check disable --target <dir>
flower-trellis update-check enable --target <dir>
```

Hook 资产:

```text
src/assets/flower_update_hook.py
→ <target>/.trellis/scripts/flower_update_hook.py
```

### 3. Contracts

- `self-check --json` 始终输出 JSON,状态至少包括 `update_available`、
  `project_out_of_sync`、`up_to_date`、`disabled`、`skipped`、`offline`。
- `self-check --json` 在 `update_available` 和 `project_out_of_sync` 中应尽力输出
  `releaseNotes` 摘要。`update_available` 范围为 `currentFlower < version <= recommendation.version`;
  `project_out_of_sync` 范围为 `projectFlower < version <= currentFlower`。
- Codex / Claude Code SessionStart hook 输出只使用
  `hookSpecificOutput.additionalContext` 注入 `<flower-update>`;不要额外输出
  `additional_context` 等其它顶层兼容字段。Codex 会严格校验 SessionStart JSON schema,
  多余顶层字段会导致 `hook returned invalid session start JSON output`。
- 本地一致性读取先于远程判断,但不得在需要远程证据时提前短路:先读取 manifest 的
  `flowerVersion`、项目 `.trellis/.version` 与当前 `flowerVersion()` / `trellisVersion()`,
  写入 `project.outOfSync` / `project.outOfSyncReasons`;随后按缓存策略取得远程 dist-tags,
  再决定最终状态和推荐命令。
- `intervalHours` 只限制 npm registry 远程探测,不限制本地 manifest / `.trellis/.version`
  读取。缓存仍新鲜时可使用 `lastRemote` 作为远程证据;缓存过期或 `--force-remote`
  时必须先联网查 dist-tags,不得因为项目 out-of-sync 提前跳过远程探测。
- 缓存仍新鲜时可复用 `lastReleaseNotes`,但必须校验 `range.from` / `range.to` /
  `range.channel` 与本次结果一致;`range.reason` 只表示触发路径,同一版本范围在
  `update_available` 与 `project_out_of_sync` 间切换时仍可复用摘要,输出给本次
  `self-check` 的 `releaseNotes.range.reason` 应归一为当前状态。
- 缓存仍新鲜且最终返回 `project_out_of_sync` 时,如果当前
  `projectFlower < version <= currentFlower` 范围无法从 `lastReleaseNotes` 复用,
  必须绕过 `intervalHours` 主动补拉一次 npm registry metadata 生成 release notes。
  补拉成功且目标范围有摘要时,本次结果必须输出非空 `releaseNotes.versions`,并且只允许
  写回 tmp 中的 `lastReleaseNotes`;不得刷新 `lastCheckedAt` / `lastRemote` /
  `lastStatus`。补拉失败或无摘要时,本次结果应输出带当前 range 的
  `releaseNotes.unavailable=true`,但不得覆盖已有可用 `lastReleaseNotes`。
- `lastStatus=offline` 或 `lastErrorCode` 非空的缓存不得视为新鲜远端证据;远端探测失败
  只写 tmp 中的 `lastStatus=offline` / `lastErrorCode=fetch_failed`,不得刷新 `lastCheckedAt`,否则会把
  旧 `lastRemote` 在 interval 内误当作刚确认的版本证据。远端失败也不得覆盖已有可用
  `lastReleaseNotes`。
- `init` / `update` 启动阶段的 `checkForUpdate()` 若成功取得 dist-tags,必须尽力而为刷新
  已有项目的 `.trellis/.flower-update-check.tmp` 缓存(`lastCheckedAt` / `lastRemote` /
  `lastStatus` / `lastErrorCode=null`),让主动更新后的下次 SessionStart 使用最新远程证据。目标没有
  `.flower-manifest.json` 时不得凭空创建半截 manifest;写缓存失败也不得阻断主流程。
- `self-check --json` 本次写入远端缓存后,返回对象内的 `updateCheck` 必须重新读取写后视图;
  顶层 `status` 与 `updateCheck.lastStatus` 不得滞后一轮。离线写入同样适用。
- `checkForUpdate()` 必须同时尊重 `--no-update-check`、`FLOWER_NO_UPDATE_CHECK` 以及
  manifest 中的 `updateCheck.enabled=false` / `policy=off`。
- 若远端 dist-tags 表明当前 flower-trellis 有新版可用,最终状态优先为
  `update_available`,推荐完整 `self-update --target <dir> --yes`;即使项目同时
  out-of-sync,也不得推荐 `--project-only`。项目 out-of-sync 证据保留在 `project.*` 字段。
- 只有远端无新版或远端不可确认,且项目本地版本不一致时,才返回
  `project_out_of_sync`,推荐 `self-update --project-only`。
- `updateCheck.enabled` 是总开关;`policy` 是启用后的 AI 行为偏好:
  - `off`: 不检查、不联网。
  - `notify`: 只注入提示和手动命令,AI 不主动询问或执行。
  - `ask`: 默认;AI 必须先询问用户,用户明确确认前不得执行推荐命令。
  - `auto`: 安全条件满足时 AI 可执行推荐命令,否则降级为 `ask`。
- Codex 对 `additionalContext` 的执行强度弱于真正用户消息;因此 update hook 在
  `policy=ask` 且存在推荐命令时,`systemMessage` 必须写成明确阻塞确认提示,
  `<flower-update>` 开头必须包含 `priority: blocking_confirmation_required` 和
  `instruction_scope: first_assistant_reply`,便于模型在第一条回复优先处理确认。
- `<flower-update>` 存在 `release_notes` 时,AI 必须先用短句展示更新摘要和
  `recommended_command`,再询问用户确认;用户确认前不得执行推荐命令。
- `<flower-update>` 应保持精简:保留 `priority`、`instruction_scope`、`status`、
  版本差异、`release_notes*`、`recommended_command`、`safety_reasons` 和一条
  `ai_instruction`;不要同时输出重复的 `policy` / `ai_mode` / `ai_required_action`。
  `bundled_trellis` / `project_trellis` 仅在 Trellis 版本不一致时输出,`remote` 仅在
  真实远端升级或错误诊断需要时输出,`release_notes_truncated` /
  `release_notes_more_versions` 仅在为 true 时输出。
- `self-update --yes` 完成真实写入后必须输出 `<flower-update-result>` 且包含
  `post_action: run_trellis_push_confirmation`;该块只能提示 AI 进入 `trellis-push` 确认流程,
  不得由 `self-update` 自己执行 git add / commit / push。`--dry-run` 只能输出
  `write:false` 和 `post_action_preview`。
- `update-check disable` 只写 `enabled=false`,不修改既有 `policy`;`enable` 只写
  `enabled=true`,沿用既有 `policy`,缺失时按 `ask` 归一化。
- `self-update --yes` 的项目阶段必须走完整 `flower-trellis update --target <dir>
  --no-update-check ...` 链路,包含 `syncGlobalTrellis()`、上游 `trellis update`、
  `applyEnhancements()`、Codex / Claude 后处理和 manifest 刷新。
- 项目 update 阶段默认追加 `--force`,等价 Trellis 交互里的 “Apply Overwrite to all”。
  若 `--` 之后已包含 `-f` / `--force` / `-s` / `--skip-all` / `-n` / `--create-new`,
  以用户透传的冲突策略为准,不再追加默认 `--force`。
- `policy=auto` 的安全门槛至少包括:目标是 Trellis 项目、git clean、无 active /
  in_progress Trellis 任务、`flower-trellis` 命令可用、有推荐命令、未设置
  `FLOWER_NO_UPDATE_CHECK`。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| 目标无 `.trellis/` | `self-check` 返回 `skipped/not_trellis_project` |
| `FLOWER_NO_UPDATE_CHECK`、`--no-update-check`、`enabled=false` 或 `policy=off` | 返回 `disabled`,不联网 |
| npx / npm exec 临时运行 | 返回 `skipped/npx_runtime`,不建议全局更新 |
| 本地 `flowerVersion` 或 `.trellis/.version` 不一致,且缓存过期 | 先查 dist-tags;远端有新版返回 `update_available` + 完整 `self-update`,远端无新版返回 `project_out_of_sync` + `--project-only` |
| 本地 `flowerVersion` 或 `.trellis/.version` 不一致,且缓存仍新鲜无更新 | 返回 `project_out_of_sync`,推荐 `self-update --project-only`,远端来源标记为 cache |
| 本地 `flowerVersion` 不一致、缓存仍新鲜无更新,但当前范围无可复用 `lastReleaseNotes` | 为 release notes 主动补拉一次 registry metadata;有摘要则输出并只写 `lastReleaseNotes`,失败或无摘要则输出 `releaseNotes.unavailable=true`,不刷新远端缓存状态 |
| 缓存的 `lastReleaseNotes.range.reason=update_available`,本次结果为 `project_out_of_sync`,且 `from` / `to` / `channel` 相同 | 复用缓存摘要并把输出 range reason 归一为 `project_out_of_sync` |
| `lastCheckedAt` 仍在 interval 内且缓存无更新且项目不 out-of-sync | 返回 `skipped/interval_not_elapsed` |
| `lastCheckedAt` 仍在 interval 内但缓存显示有更新 | 返回 `update_available`,来源标记为 cache |
| registry 离线 / 超时 / 非 200 / 响应字段无效且项目不 out-of-sync | 返回 `offline`,只写 `lastStatus=offline` 和简短 `lastErrorCode`,不刷新 `lastCheckedAt` |
| registry 离线 / 超时 / 非 200 / 响应字段无效且项目 out-of-sync | 返回 `project_out_of_sync`,推荐 `--project-only`,同时标注远端 `errorCode` |
| npm 精确版本安装命中 `ETARGET` | `--prefer-online` 等待 1 秒后只重试一次;仍失败则输出最终错误和精确手动命令 |
| `init` / `update` 主动探测成功 | 写入 `.flower-update-check.tmp` 的 `lastRemote` / `lastCheckedAt` / `lastStatus`;无 manifest 时跳过 |
| release notes metadata 缺失或损坏 | 版本判断照常;`releaseNotes.unavailable=true` 或不展示摘要 |
| 远端探测成功且生成了可用 notes 摘要 | 写入 tmp 中的 `lastReleaseNotes`;`lastRemote` 仍只写 dist-tags |
| `self-update --dry-run` | 只打印全局安装命令、项目 update 命令、版本和安全检查,不写入 |
| `self-update` 缺少 `--yes` 且非 dry-run | 抛中文错误,由 CLI 顶层统一退出 |
| 全局 npm 安装成功但项目 update 失败 | 报告未完成,给出手动 `flower-trellis update --target ... --no-update-check --force` 命令 |

### 5. Good/Base/Bad Cases

- Good: 项目 manifest 记录 `flowerVersion=0.4.1`,当前安装 `0.4.2`,缓存仍新鲜且
  `lastRemote.latest=0.4.2`,启动 hook 注入 `project_out_of_sync` 和
  `flower-trellis self-update --target <dir> --yes --project-only`。
- Good: 项目 manifest 记录 `flowerVersion=0.4.1`,当前安装 `0.4.2`,缓存过期且
  远端 `latest=0.4.3`,启动 hook 注入 `update_available`,推荐完整
  `flower-trellis self-update --target <dir> --yes`,并保留项目 out-of-sync 证据。
- Base: 远程探测失败时 hook 静默退出;`self-check --json` 仍返回 `offline` JSON,
  不阻断 Codex / Claude Code 启动。
- Base: 用户手动运行 `flower-trellis update --target <dir>` 时,启动探测成功后会刷新
  tmp 中的 `lastRemote`,随后全装 `writeManifest()` 只保留 manifest 策略字段。
- Base: 用户配置 `policy=auto` 但 git dirty,`ai.mode` 降级为 `ask`,并给出
  `dirty_worktree` 原因。
- Bad: 启动 hook 直接执行 `npm i -g` 或 `flower-trellis update`。启动阶段只能注入上下文。
- Bad: 只覆盖 `.trellis/scripts/flower_update_hook.py` 或只改 manifest 就报告项目已更新。
  项目内容更新必须走完整 `flower-trellis update` 链路。
- Bad: 全装重写 manifest 时丢失用户设置的 `policy=auto` 或 `intervalHours=6`。
- Bad: 远程检查刷新 `lastCheckedAt` 后让 `.trellis/.flower-manifest.json` 出现仅由运行缓存导致的 git diff。

### 6. Tests Required

- 静态检查:
  - `node --check src/cli.js && for f in src/lib/*.js src/commands/*.js; do node --check "$f"; done`
  - `python3 -m py_compile src/assets/flower_update_hook.py`
  - 用假 `flower-trellis self-check --json` 驱动 `flower_update_hook.py`,断言 stdout
    是合法 JSON,且顶层字段不包含 `additional_context`。
  - `git diff --check`
- CLI 行为:
  - `self-check --json --target <dir> --no-update-check` 返回稳定 `disabled` JSON。
  - 强制远端成功或失败并写入 tmp 后,当次返回的 `updateCheck.lastStatus` /
    `lastErrorCode` 与写后缓存一致。
  - 自动安装使用远端已确认的精确版本和 `--prefer-online`;仅 `ETARGET` 重试一次,
    其它失败不重试。
  - 修改临时 manifest 的 `flowerVersion`,并在 `.flower-update-check.tmp` 把 `lastCheckedAt`
    设到未来,缓存无远端更新时
    返回 `project_out_of_sync`。
  - 修改临时 manifest 的 `flowerVersion`,并在 `.flower-update-check.tmp` 把 `lastCheckedAt`
    设到未来;缓存无远端更新且 `lastReleaseNotes=null` 时,模拟 registry metadata 含目标版本摘要,断言
    `self-check` 主动补拉并输出 `releaseNotes.versions`,且只写回 `lastReleaseNotes`。
  - 同一场景下模拟 registry metadata 拉取失败或缺目标摘要,断言仍返回
    `project_out_of_sync` 和推荐命令,同时输出 `releaseNotes.unavailable=true`,且不刷新
    `lastCheckedAt` / `lastStatus` / `lastErrorCode`。
  - 修改临时 manifest 的 `flowerVersion` 且缓存中已有同范围 `update_available`
    release notes 时,返回 `project_out_of_sync` 并继续输出 `releaseNotes`。
  - 修改临时 manifest 的 `flowerVersion` 且让缓存过期,模拟远端 `latest` 高于当前版本时,
    返回 `update_available`,推荐命令不带 `--project-only`。
  - `self-update --target <dir> --dry-run --project-only` 默认项目命令带 `--force`。
  - `self-update --target <dir> --dry-run --project-only -- --skip-all` 不再追加 `--force`。
  - `update-check set|disable|enable|get` 保留 policy / enabled 语义。
  - `flower-trellis update --target <dir> --dry-run` 在远程探测成功时刷新已有 manifest 的
    tmp 缓存 `lastRemote`;`--no-update-check` 或 `policy=off` 时不联网、不写缓存。
  - 构造旧 manifest 中含 `lastCheckedAt` / `lastRemote` / `lastReleaseNotes` 的场景,
    验证 `readUpdateCheck()` 可兼容读取,任意写入后 manifest 清理旧缓存字段且 tmp 保留缓存。
  - 构造带 `flowerReleaseNotes` 的 registry metadata,验证 stable 目标不混入 beta notes,
    beta 目标只展示 beta notes,并验证 5 个版本 / 单版本 500 字符 / 总 1600 字符截断标记。
  - `self-update --dry-run` 输出 `write:false` 和 `post_action_preview`;真实写入完成后输出
    `post_action: run_trellis_push_confirmation`,但不执行任何 git 提交动作。
- dogfood:
  - `flower-trellis init --target ./test-target -y --no-update-check`
  - `flower-trellis update --target ./test-target --dry-run --no-update-check`
  - 重复 `update --enhance-only --no-update-check` 后 Codex / Claude hook 不重复。

### 7. Wrong vs Correct

#### Wrong

```bash
python3 .trellis/scripts/flower_update_hook.py
# hook 内部直接 npm i -g flower-trellis@latest && flower-trellis update ...
```

问题:启动 hook 变成写入型副作用,会阻塞或破坏 AI 会话启动,也绕过用户 policy。

#### Correct

```bash
flower-trellis self-check --json --target .
flower-trellis self-update --target . --yes -- --skip-all
```

原因:`self-check` 只产出结构化状态和 AI 指令;`self-update` 是可审计写入入口,
项目阶段默认 `--force`,但允许用户用 `--` 明确覆盖冲突策略。

---

## Common Mistakes

- 在多个模块各自重算包根路径 —— 应统一用 `paths.js` 的 `PKG_ROOT` / `ENHANCEMENTS_ROOT`。
- 新增自有 flag 只改了 `parse()` 没更 `OWN_FLAGS`(或反之)—— 两处必须同步。
- 把版本/manifest 读取失败当致命错误抛出 —— 这类应容错降级。
- 联网探测(版本检测)漏写超时或 try/catch —— 离线时会挂起或把错误抛进主流程,见
  [Network Probe](#network-probe-尽力而为联网探测)。
- 凭 manifest 之外的猜测去删除目标文件 —— 清理只认 manifest 里的精确 `paths`。
