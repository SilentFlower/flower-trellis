# Config & State

> 常量、路径定位、版本读取与安装清单(状态)的约定。

---

## Overview

flower-trellis 自身几乎无内存态:配置是一组**集中常量**,运行所需的「状态」落在
**目标项目磁盘**上(`.trellis/.version`、`.flower/plugins.json`、
`.flower/plugin-lock.json`、本机 `.flower/state.json`、`.flower/settings.json`,以及
gitignored 的 `.flower/update-check.tmp` 运行缓存)。旧 `.trellis/.flower-manifest.json`
和 `.trellis/.flower-update-check.tmp` 只作为迁移 fallback 读取。
所有跨模块名单收敛到 `src/constants.js`,所有包内路径从 `src/lib/paths.js` 派生。

---

## Constants (`src/constants.js`)

集中三类名单,改动时**必须与上游同步**(注释已标注来源):

- `VARIANTS = ["old", "0.5", "0.6"]` —— 强化包支持的三个变体目录名。
- `PLATFORM_FLAGS` —— Trellis init 支持的全部平台 flag;用户未指定平台时据此判断是否补默认。
  来源为 Trellis `cli/index.ts` 的 init 注册,上游新增平台时此名单可滞后(最坏只是误补
  `--claude`,不致命)。
  - Trellis 0.6.5 起 `--devin` 是 Windsurf 更名后的主 flag,`--windsurf` 仍作为旧别名保留;
    `--zcode`、`--trae`、`--omp`、`--grok`、`--kimi`、`--snow` 是平台 flag,也要纳入
    `PLATFORM_FLAGS`。
  - `--with-statusline` 是 Claude Code 功能开关,不是平台选择,不要纳入 `PLATFORM_FLAGS`。
- `OWN_FLAGS` —— flower 自有、**不能透传给 trellis** 的 flag;值 `false`=布尔 flag,
  `true`=带取值 flag(剔除时要连带跳过其后一个 token)。

> 新增 flower 自有 flag 时,务必同时更新 `OWN_FLAGS` 与
> `src/lib/cli-args.js#parseCliArgs()`,
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
  2. 若项目内可读到状态,打印 `project` 分组,顺序固定为 `flower`(优先取
     `.flower/plugin-lock.json` 中 `flower/skill-garden` 的版本，旧项目 fallback 到
     `.trellis/.flower-manifest.json#flowerVersion`)、
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

## Scenario: Update Command Passthrough Boundaries

### 1. Scope / Trigger

- Trigger: 修改 `flower-trellis update` 的 argv 解析、非交互兼容 flag、`trellis update`
  透传参数、跨版本 dry-run 或提交前 dogfood 命令。
- Scope: `update` 可以接受 `-y` / `--yes` 作为 Flower 非交互兼容 flag，但 Trellis
  `update` 不支持该 flag；真正调用上游前必须过滤。跨版本普通 dry-run 在项目外沙箱真实生成
  新模板并执行 Plugin dry-run，来源项目保持零写入。真实更新在 Trellis 或 Plugin replay 任一步
  失败时补偿恢复升级前受管状态。`init` 的 `-y` / `--yes` 行为不变。

### 2. Signatures

```bash
flower-trellis update --target <dir> [-y|--yes] [--dry-run] [--backup-retention <n>] [trellis update flags]
flower-trellis init --target <dir> [-y|--yes] [trellis init flags]
```

```js
parseCliArgs(argv, cwd)
trellisUpdatePassthroughArgs(passthrough)
shouldUseUpdateSandbox({ dryRun, enhanceOnly, currentVersion, targetVersion })
createUpdateSandbox(projectRoot)
createUpdateSnapshot(projectRoot)
extendUpdateSnapshot(snapshot, targets)
restoreUpdateSnapshot(snapshot)
resolveSkillGardenPlatforms(projectRoot)
replayPlugins(ctx, target, dryRun, compensationSnapshot?)
update(ctx)
checkForUpdate(ctx, label)
```

### 3. Contracts

- `parseCliArgs()` 保留 `-y` / `--yes` 到 `ctx.passthrough`，供 `checkForUpdate()` 判断
  本轮为非交互模式；不得把它们登记进全局 `OWN_FLAGS`，否则 `init -y` 会失去上游语义。
- `update(ctx)` 调用 `runTrellisPty(["update", ...])` 前必须使用
  `trellisUpdatePassthroughArgs(ctx.passthrough)`；该 helper 只移除 `-y` / `--yes`，
  其它 Trellis update flag 必须原样保留。
- `--dry-run`、`--force`、`--skip-all` 等真实 Trellis update 参数继续透传；
  `--backup-retention` 仍由 `parseCliArgs()` 消费，不进入上游。
- `init(ctx)` 继续把 `-y` / `--yes` 透传给 Trellis init，并用它们选择默认平台。
- `self-update --yes` 仍由 self-update 命令自身消费；`--` 之后的项目 update 参数按
  `projectUpdateForwardArgs()` 规则转给新的 Flower update 进程。
- 普通 `update --dry-run` 在目标 `.trellis/.version` 与当前 Flower 捆绑 Trellis 版本不同时，
  `shouldUseUpdateSandbox()` 必须返回 `true`。来源项目只读复制到项目外临时目录；沙箱内移除
  `--dry-run` 并运行真实 `trellis update`，缺少批量冲突选项时只对沙箱追加 `--force`，随后对
  升级后模板执行 Plugin dry-run。无论成功失败都删除沙箱，来源项目逐字节不变。
- 同版本普通 dry-run 继续执行 Plugin 预演；`--enhance-only --dry-run` 也必须严格预检当前
  模板，不能借跨版本沙箱绕过 compatibility、required selector 或 conflict error。
- `--no-enhance --dry-run` 在跨版本时仍进入同一升级沙箱，只冻结 Skill-Garden 并预演其它已声明
  Plugin；不得吞掉外部 Plugin 的升级计划。
- 真实、非 `--enhance-only` 更新在调用上游前必须创建项目外补偿快照。范围复用上游
  `ALL_MANAGED_DIRS` 与 `shouldExcludeFromBackup()`，并额外包含 `AGENTS.md`、`.flower` 和当前
  Plugin state 登记的 owned paths；文件内容、目录/文件类型和 mode 都要记录。
- Plugin replay 必须把 `onPreflight` 透传到统一 Runtime，并在 Transaction Writer 写盘前读取
  `plan.contentMutations` 与 `plan.patchMutations` 的全部目标，通过 `extendUpdateSnapshot()` 扩展
  同一补偿快照。目标已存在时只记录该精确路径；目标不存在时记录最靠外的缺失祖先，使恢复可以
  删除本轮新建的完整目录树，同时不得扩大到已经存在的用户目录。
- `ctx.enhance=true` 的 Skill-Garden replay 必须先调用 `resolveSkillGardenPlatforms(target)`，并把结果
  转换为重复 `--platform <id>` 传给 Plugin CLI。这样 `flower-trellis update` 的平台事实来自 Trellis
  当前模板配置，而不是旧 `.flower/state.json`；普通 `plugin update --platform ...` 的显式选择语义不变。
- 补偿扫描与恢复只接受项目内普通文件/目录；软链、特殊文件、路径逃逸或非法相对路径在上游写入前
  fail closed。恢复会移除本轮新增受管路径、还原旧内容和 mode，并保留上游新建的
  `.trellis/.backup-*`。恢复不完整时抛 `UPDATE_COMPENSATION_INCOMPLETE`，保留项目外 manifest
  并报告 `failedPaths`，不得输出更新成功。
- `config.yaml` 本地保留项只在整条 Trellis + Plugin 链成功后恢复；失败补偿必须以升级前快照为准，
  不能再把更新中间态的 config 覆盖回项目。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| `flower-trellis update -y --dry-run` | Flower 识别非交互；Trellis 仅收到 `update --dry-run` |
| `flower-trellis update --yes --force` | Flower 识别非交互；Trellis 仅收到 `update --force` |
| `flower-trellis init -y` | `-y` 继续透传给 Trellis init，并默认 codex + claude |
| `flower-trellis update --backup-retention 5 --dry-run` | backup-retention 被消费；Trellis 收到 `--dry-run` |
| 目标 `0.6.5`、捆绑 `0.6.12`、普通 `update --dry-run` | 项目外沙箱真实升级到 `0.6.12` 并执行 Skill-Garden dry-run；来源树零写入 |
| 目标版本等于捆绑版本、普通 `update --dry-run` | Trellis 与 Skill-Garden Plugin 均执行预演 |
| 跨版本 `--enhance-only --dry-run` | 不跳过；对当前模板执行严格 Skill-Garden preflight |
| 跨版本 `--no-enhance --dry-run` | 沙箱升级模板；Skill-Garden 保持冻结，外部 Plugin replay 继续预演 |
| 真实 Trellis update 成功、Plugin replay 失败 | 自动还原升级前受管内容/mode，移除新增受管文件，保留 `.backup-*`，退出失败 |
| Plugin preflight 计划修改既有外部文件 | 写盘前把精确文件加入补偿快照；失败时恢复旧内容和 mode |
| Plugin preflight 计划写入尚不存在的外部目录树 | 记录最靠外缺失祖先；失败时删除本轮创建的整棵目录树，不删除既有父目录 |
| 旧 Skill-Garden state 含未启用平台 | replay 显式传入 Trellis 当前平台；新 state 收窄，错误平台 check-all agent 通过事务删除 |
| 补偿恢复任一路径失败 | 抛 `UPDATE_COMPENSATION_INCOMPLETE`，输出 manifest 与失败路径，不删除恢复证据 |
| 受管范围含软链、特殊文件或路径逃逸 | 创建快照时失败；Trellis 与 Plugin 均未开始写入 |
| 未知 Trellis update flag | 保留在 `ctx.passthrough` 并透传，除非已被 Flower 明确定义为命令级兼容 flag |

### 5. Good/Base/Bad Cases

- Good: 提交前 dogfood 使用 `flower-trellis update --target ./test-target -y --dry-run`，
  Flower 不弹自身更新确认，上游 Trellis 不收到不支持的 `-y`。
- Good: 旧 `0.6.5` 项目用新版 Flower 执行普通 dry-run，在项目外沙箱看到 `0.6.12` Trellis
  与新版 Skill-Garden 的组合结果，目标目录前后逐字节一致。
- Good: 真实 update 的 Plugin conflict 失败后，旧 workflow/skill/hook、Plugin-owned path 和 mode
  全部恢复，新增上游 `.backup-*` 仍保留用于人工审计。
- Good: Plugin preflight 才声明 `generated/tool/config.json`，且 `generated/` 原本不存在；后续写入
  失败时恢复删除整个 `generated/`，不会遗漏中间目录，也不会删除其上层既有用户目录。
- Good: 旧 `.flower/state.json` 误记 `gemini/zcode`，但 Trellis hash 只配置 Claude/Codex；
  update replay 传入 `claude/codex` 并清理纯旧 `.gemini/.zcode` check-all agent 目录。
- Base: `flower-trellis update --target ./test-target --dry-run` 与过去行为一致。
- Base: 已是捆绑版本的项目继续显示 `Plugin update 预览`，证明同版本预演没有被关闭。
- Base: `flower-trellis init --target ./test-target -y` 仍由 Trellis init 非交互创建默认平台。
- Bad: 把 `-y` 加入全局 `OWN_FLAGS`，导致 init 不再把非交互意图传给 Trellis。
- Bad: `update(ctx)` 直接使用 `ctx.passthrough` 调用上游，导致 Trellis update 报
  `unknown option '-y'`。
- Bad: 跨版本普通 dry-run 在来源旧模板上直接运行新版 Skill-Garden preflight，或只预览 Trellis
  而看不到升级后 Plugin 组合冲突。
- Bad: 为让普通 dry-run 通过而同时跳过 `--enhance-only`，使用户无法预演当前模板上的真实
  compatibility 或 Patch 冲突。
- Bad: 只备份 `.trellis`，遗漏 `AGENTS.md`、平台 root、`.flower` 或 Plugin-owned path，导致
  replay 失败后留下混合版本项目。
- Bad: 只根据旧 Plugin state 创建一次快照，不消费本轮 preflight plan；新增外部目标会在 replay
  失败后残留。也不能一律快照项目根目录，否则恢复可能误删用户数据。
- Bad: update replay 不传平台参数，让 Runtime 复用旧 state 中污染的平台集合，导致升级重新生成
  未启用的 `.gemini` 或 `.zcode` 目录。

### 6. Tests Required

- `parseCliArgs()` 必须覆盖 `update -y --yes --dry-run` 保留原始 `ctx.passthrough`，
  同时 `trellisUpdatePassthroughArgs()` 返回只含真实上游参数的集合。
- `shouldUseUpdateSandbox()` 必须覆盖跨版本普通 dry-run、同版本 dry-run、
  `--enhance-only` 和真实写入四种分支。
- 真实 CLI 回归必须用最小 `0.6.5` 项目运行到捆绑 `0.6.12` 的普通 dry-run，断言退出码为
  `0`、出现项目外沙箱提示和 Plugin update 预览，并比较完整来源树保持零写入。
- 故障注入必须覆盖 Plugin replay 失败后的旧内容/mode/Plugin-owned path 恢复、新增受管路径移除、
  `.trellis/tasks` / `.trellis/spec` / `.backup-*` 保留，以及补偿不完整的结构化错误和 manifest。
- Plugin replay 单测必须断言 `onPreflight` 在任何 writer mutation 前收到 plan；Update 补偿测试
  必须覆盖 preflight 新增的既有外部文件和不存在目录树，分别断言内容/mode 还原、最靠外缺失
  祖先删除，以及既有父目录保留。
- Update replay 回归必须覆盖旧 Skill-Garden state 平台污染：旧 state 含 `gemini/zcode`，Trellis
  `.template-hashes` 只含 Claude/Codex 时，断言 replay 后 state 收窄并清理错误平台 check-all agent。
- 快照单测必须覆盖软链/特殊文件/路径逃逸 fail closed，并与上游 `ALL_MANAGED_DIRS`、
  `shouldExcludeFromBackup()` 的排除语义保持一致。
- Dogfood 必须覆盖隔离目标上的
  `flower-trellis init --target <tmp> -y`、
  `flower-trellis update --target <tmp> -y --dry-run`、
  `flower-trellis uninstall --target <tmp> --dry-run`。
- 运行 `node --test test/js/update-backups.test.js`、完整 `npm test`、相关 `node --check`
  与 `git diff --check`。

### 7. Wrong vs Correct

#### Wrong

```js
const code = await runTrellisPty(["update", ...ctx.passthrough], target);
```

问题:`ctx.passthrough` 需要同时服务 Flower 自身的非交互更新检查和上游 Trellis 参数；
直接透传会把 `-y` / `--yes` 交给不支持它们的 Trellis update。

#### Correct

```js
const code = await runTrellisPty(
  ["update", ...trellisUpdatePassthroughArgs(ctx.passthrough)],
  target,
);
```

原因:命令级 helper 保留 `init` 的全局兼容性，同时只在 `update` 上游调用边界过滤不支持的
Flower 兼容 flag。

Plugin 外部写入的错误边界：

```js
await replayPlugins(target, options);
```

问题：初始快照只知道旧 state，无法覆盖本轮 preflight 才计算出的外部 mutation。

正确边界：

```js
await replayPlugins(target, options, compensationSnapshot);
// replay 的 onPreflight 在 writer 写盘前用 plan mutations 扩展同一快照。
```

原因：计划结果是新增写入范围的第一个完整事实源；必须在同一事务首次写盘前纳入补偿闭包。

跨版本 dry-run 的正确边界：

```js
if (shouldUseUpdateSandbox({
  dryRun,
  enhanceOnly: ctx.enhanceOnly,
  currentVersion: selectVariant(target).version,
  targetVersion: trellisVersion(),
})) {
  const sandbox = createUpdateSandbox(target);
  // 只在 sandbox.root 内真实升级，再执行 Plugin dry-run。
}
```

不得根据 `variant` 名称判断版本变化；同属 `0.6` 变体的 `0.6.5` 与 `0.6.12` 仍是跨版本。

---

## Variant Selection (`src/lib/variant.js`)

- `selectVariant(target)` 读目标 `.trellis/.version` → 返回 `{ variant, version }`。
- `resolveEnhancementSnapshot(target, variantOverride)` 可以覆盖 `variant`，但无论是否覆盖都必须保留 `selectVariant()` 读到的真实 `version`，供 0.6 compatibility policy 判断。
- 规则(逐字符移植 skill-garden `install.sh` 263-274):主版本 ≥1 或次版本 ≥6 → `0.6`;
  次版本 ≥5 → `0.5`;文件缺失/解析失败/更低 → `old`。次版本会先剥掉 `-beta.x` 后缀。
- 改这条规则前先确认上游 install.sh 的对应逻辑,保持一致。
- 映射到 `0.6` 不等于语义兼容：`0.6.12` 是当前已登记版本，同线未登记版本 warning，0.7+/1.x 由 Patch policy 阻断并提示 `--no-enhance`。

---

## Plugin State And Legacy Migration

- 新成功状态只写 `.flower/plugins.json`、`.flower/plugin-lock.json` 和本机
  `.flower/state.json`。`applyEnhancements()` 是兼容 facade，不得继续写旧 manifest。
- `flower/skill-garden` 的普通文件 ownership 位于 state `paths[]`，Patch provenance 位于
  `patches[]`。重复应用相同 lock/variant 时目标与三类状态必须 changed-only。
- `.trellis/.flower-manifest.json` 只读：正常迁移时校验 `paths[]` 的安全路径与目标存在性，
  同版本同 variant 的普通文件还要核对最终 hash；损坏、目标缺失或可证明的漂移必须在事务前失败。
- 迁移成功后旧 manifest 原字节保留，不删除、不清理字段、不继续更新；state 写入
  `migration:{source:"legacy-flower-manifest",schemaVersion:1}`。重复迁移不得重复声明或改变 lock；后续旧 manifest 被人工删除时，已有 migration 标记仍须从 previous state 原样继承。
- `uninstall` 在 Trellis 删除前冻结 state 清理计划；Trellis 成功后只删除 hash 仍匹配的
  `exclusive` 普通文件。某个用户修改项冲突时仍清理其它 hash-clean 路径；`shared`、其它 Plugin、用户修改项和无法证明 ownership 的旧路径保留，并继续记录冲突证据。

## Scenario: Linked Worktree Entry Projection

### 1. Scope / Trigger

- Trigger: 新增或修改 `trellis-worktree` skill、`worktree_setup.py`、linked Git worktree 中的
  `.trellis` / 平台入口投影、`.trellis-worktree.json`，或 hook / untracked 从 worktree 集合回找
  Trellis 根的 fallback。
- Scope: helper 只准备当前同一 Git 仓库 linked worktree 的本地 AI/Trellis 入口；普通 task、
  untracked、check、push 的阶段语义不随 worktree 准备改变。

### 2. Signatures

```bash
python3 ./.trellis/scripts/worktree_setup.py status [--target <path>] [--json]
python3 ./.trellis/scripts/worktree_setup.py prepare [--target <path>] [--json]
python3 <main-worktree>/.trellis/scripts/worktree_setup.py prepare --target <linked-worktree> --json
```

```text
<linked-worktree>/.trellis-worktree.json
```

### 3. Contracts

- `status` 只读输出 JSON；`prepare` 只能创建或修复由 manifest 证明受管的 symlink，并在目标
  linked worktree 写 `.trellis-worktree.json`。两者都不得复制目录、删除普通文件或创建源 worktree
  不存在的平台入口。
- `--target` 可指向 worktree 根、子目录或文件；缺省为当前目录。target 必须解析到 Git worktree
  toplevel，非 Git 目录返回 `reason=not-git-worktree`。
- source 解析顺序固定为：有效 manifest 的 `sourceRoot`、目标 `.trellis` symlink、同仓
  `git rev-parse --git-common-dir` 候选、`git worktree list --porcelain` 中第一个带 `.trellis`
  的其它 worktree、最后才是 target 自身。找不到时返回 `reason=source-not-found`。
- 投影路径固定从 `ENTRY_PATHS` 读取，当前只包含 `.trellis`、`.agents`、`.codex`、`.claude`。
  新增平台入口必须先扩展该常量和测试，不得在 skill 文案里声明但 helper 不处理。
- 输出字段必须稳定包含 `status`、`targetRoot`、`sourceRoot`、`source`、`manifest`、`links`、
  `actions`、`conflicts`、`missingSources`；`prepare` 额外包含 `changed`、`changedLinks`、
  `manifestWritten`。
- manifest schema 固定为
  `{schemaVersion:1, sourceRoot, targetRoot, links:[{path, source, target}], updatedAt}`。
  比较幂等性时忽略 `updatedAt`；`sourceRoot` 和 `targetRoot` 必须是绝对路径。
- hook / `untracked_flow.py` 的 Git worktree fallback 只在脚本已经被平台加载并执行后生效；
  它不能替代入口投影，也不能扩大 untracked state schema 或把状态绑定到具体 worktree。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| linked worktree 缺少四个入口且主 worktree 都存在 | `status=needs-prepare`；`prepare` 创建 symlink 并写 manifest |
| 重复运行 `prepare` | `status=ready`、`changed=false`、`changedLinks=[]`、不刷新 manifest |
| 主 worktree 缺少某个入口 | 对应 link `state=source-missing`，跳过创建，不视为冲突 |
| target 已有非受管 `.codex` / `.claude` / `.agents` / `.trellis` | `status=blocked`；`prepare` 返回 `reason=projection-conflict` 且零部分写入 |
| target symlink 指向错误源且 manifest 证明受管 | link `state=repair`，`prepare` 可先 unlink 再重建 |
| target symlink 指向错误源但不在 manifest | `projection-conflict`，不得覆盖 |
| target 不是 Git worktree | `reason=not-git-worktree` |
| 同仓 worktree 集合没有任何 `.trellis` | `reason=source-not-found` |
| target 已是主 worktree | `status=ready`，不创建 `.trellis-worktree.json` |
| linked cwd 中 hook / untracked 已能运行但无本地 `.trellis` | fallback 从同仓主 worktree 读取 `.trellis` runtime |

### 5. Good/Base/Bad Cases

- Good: 用户在 linked worktree 中请求 worktree 处理时，skill 先指导从主 worktree 运行
  `worktree_setup.py status --target <linked> --json`，确认无冲突后再运行 `prepare`。
- Good: linked worktree 只有 `.codex` 用户目录时，helper 阻断全部投影，避免创建 `.trellis`
  后留下半准备状态。
- Base: 普通主 worktree 已有 `.trellis` 时，helper 返回 ready，不写 manifest，不影响现有 Trellis 流程。
- Base: 主 worktree 没启用 `.claude` 时，linked worktree 也不自动生成 `.claude`。
- Bad: 在 linked worktree 中 hand-copy `.trellis` 或 `.codex`，会制造与主 worktree 分叉的 skill/hook
  状态，后续 update/sync 难以追踪。
- Bad: 只给 `untracked_flow.py` 加 cwd fallback，却不准备 `.codex` / `.claude` 平台入口；这种情况下平台
  hook 和 skill 仍可能根本不会加载。

### 6. Tests Required

- `test_worktree_setup.py` 必须覆盖 status、prepare、四个入口 symlink、manifest schema、重复
  prepare 幂等、已有用户平台目录冲突、非 Git target、主 worktree ready 零 manifest。
- `test_untracked_flow.py` 必须覆盖 linked worktree cwd 无 `.trellis` 时，`status` 能回退到主
  `.trellis` runtime。
- `test_workflow_state_hook.py` 必须覆盖 hook 从 linked worktree cwd 找到主 `.trellis/workflow.md`
  和 runtime helper。
- 改动 helper 或 fallback 后至少运行相关 Python 单测、`python3 -m py_compile`、`npm run sync`、
  `npm run patch:targets:check`、`git diff --check`；Patch target 改动还要先刷新 compiled targets。

### 7. Wrong vs Correct

#### Wrong

```bash
cp -R <main-worktree>/.trellis <linked-worktree>/.trellis
cp -R <main-worktree>/.codex <linked-worktree>/.codex
```

问题:复制会把入口状态变成两份可漂移内容，且无法区分哪些路径由 Trellis worktree 准备流程管理。

#### Correct

```bash
python3 <main-worktree>/.trellis/scripts/worktree_setup.py prepare --target <linked-worktree> --json
```

原因:helper 统一执行同仓 source 识别、冲突拒绝、symlink 投影、manifest 记录和幂等检查。

## Update-Check State

- 用户策略写 `.flower/settings.json#updateCheck`：`enabled` / `policy` / `intervalHours`。
- 本机缓存写 `.flower/update-check.tmp`：`lastCheckedAt` / `lastRemote` /
  `lastReleaseNotes` / `lastStatus` / `lastErrorCode` / `lastPromptedAt` /
  `lastPromptedKey` / `promptSuppressedUntil` / `promptSuppressedKey` /
  `promptSuppressionReason`；由 `.flower/.gitignore` 的 `*.tmp` 忽略。
- `readUpdateCheck(target)` 优先读新位置；缺失时依次 fallback 到旧
  `.trellis/.flower-update-check.tmp` 和旧 manifest `updateCheck`，损坏字段按默认值归一化。
- `writeUpdateCheck(target, patch)` 只写新位置，使用 `.flower/` changed-only 原子写；不得修改
  旧 manifest 或旧 tmp。首次新写即完成单向迁移，旧文件继续作为历史证据保留。
- `.flower/settings.json` 与 `.flower/update-check.tmp` 只能是普通文件；损坏 JSON、无效 settings 外层结构、目录或符号链接都必须在覆盖前失败。settings 已损坏时整次策略/缓存更新零写入，不能先刷新 cache 再报错。
- 原子写临时文件必须位于目标同目录，以排他创建写入并 `fsync` 后 rename；失败时清理临时文件。既有目标在读取和替换前都要拒绝符号链接，不能跟随到项目外写入。
- 默认视图固定为
  `{ enabled:true, policy:"ask", intervalHours:8, lastCheckedAt:null, lastRemote:null, lastReleaseNotes:null, lastStatus:null, lastErrorCode:null, lastPromptedAt:null, lastPromptedKey:null, promptSuppressedUntil:null, promptSuppressedKey:null, promptSuppressionReason:null }`。
- `lastRemote` 只记录 npm `dist-tags.latest` / `dist-tags.beta`；release notes 摘要只进入
  `lastReleaseNotes`，不得混入版本事实。
- `lastPromptedKey` / `promptSuppressedKey` 记录当前更新提示 key；远端升级 key 固定为
  `update:<tag>:<version>`，项目追平 key 固定包含项目与当前 `flower` / `trellis` 版本差异。
  key 变化表示新提示，旧版本的冷却、延后或跳过不得误挡新版本。

## Scenario: Startup Self-Update Check

### 1. Scope / Trigger

- Trigger: 新增或修改启动时自更新检查、`self-check` / `self-update` / `update-check`
  命令、`.flower/settings.json` / `.flower/update-check.tmp`、旧 manifest fallback、或 Codex / Claude Code
  SessionStart 更新检查 hook。
- Scope: 启动 hook 只做只读检查与上下文注入;所有写入型更新必须通过 CLI 命令执行,
  便于 AI 先按 policy 决策、用户审计和失败恢复。

### 2. Signatures

```bash
flower-trellis self-check --json --target <dir> [--force-remote] [--manual|--ignore-prompt-suppression] [--no-update-check]
flower-trellis self-update --target <dir> --yes [--dry-run] [--project-only] [-- <trellis update flags>]
flower-trellis update-check get --target <dir>
flower-trellis update-check set --target <dir> --policy <off|notify|ask|auto> [--interval-hours <n>]
flower-trellis update-check disable --target <dir>
flower-trellis update-check enable --target <dir>
flower-trellis update-check snooze --target <dir> [--hours <n>|--days <n>]
flower-trellis update-check skip --target <dir>
flower-trellis update-check reset --target <dir>
```

Hook 资产:

```text
src/assets/flower_update_hook.py
→ <target>/.trellis/scripts/flower_update_hook.py
```

### 3. Contracts

- `self-check --json` 始终输出 JSON,状态至少包括 `update_available`、
  `project_out_of_sync`、`up_to_date`、`disabled`、`skipped`、`offline`。
- `self-check --manual` / `--ignore-prompt-suppression` 是用户显式检查入口，只绕过
  prompt suppression(`prompt_cooldown` / `prompt_snooze` / `prompt_skip`)，不绕过
  `--no-update-check`、`FLOWER_NO_UPDATE_CHECK`、`policy=off`、npx 短路、远程探测、
  release notes、policy 或 safety 计算。SessionStart hook 不得传入该参数。
- `self-check --json` 在 `update_available` 和 `project_out_of_sync` 中应尽力输出
  `releaseNotes` 摘要。`update_available` 范围为 `currentFlower < version <= recommendation.version`;
  `project_out_of_sync` 范围为 `projectFlower < version <= currentFlower`。
- Codex / Claude Code SessionStart hook 输出只使用
  `hookSpecificOutput.additionalContext` 注入 `<flower-update>`;不要额外输出
  `additional_context` 等其它顶层兼容字段。Codex 会严格校验 SessionStart JSON schema,
  多余顶层字段会导致 `hook returned invalid session start JSON output`。
- `.trellis/scripts/common/session_context.py` / 默认 `get_context.py` 只负责项目上下文,
  不得调用 `trellis --version`、输出独立 Trellis 更新提示或创建
  `.trellis/.runtime/update-check-*.marker`;启动更新检查统一由
  `flower_update_hook.py` 调用 `flower-trellis self-check` 完成,避免重复入口和无界会话文件。
- 本地一致性读取先于远程判断,但不得在需要远程证据时提前短路:先读取 Plugin lock 的
  `flower/skill-garden` 版本(旧项目 fallback 到 manifest `flowerVersion`)、项目
  `.trellis/.version` 与当前 `flowerVersion()` / `trellisVersion()`,
  写入 `project.outOfSync` / `project.outOfSyncReasons`;随后按缓存策略取得远程 dist-tags,
  再决定最终状态和推荐命令。
- `intervalHours` 只限制 npm registry 远程探测,不限制本地 manifest / `.trellis/.version`
  读取。缓存仍新鲜时可使用 `lastRemote` 作为远程证据;缓存过期或 `--force-remote`
  时必须先联网查 dist-tags,不得因为项目 out-of-sync 提前跳过远程探测。
- 提示节流必须与远程探测节流分离：同一 `prompt.key` 默认 24 小时内最多向 SessionStart
  hook 暴露一次 actionable 状态；用户运行 `update-check snooze` 后同一 key 默认 7 天不再提示；
  用户运行 `update-check skip` 后同一 key 不再提示，直到远端目标版本或项目版本差异变化。
  `update-check reset` 只清空提示节流状态，不修改远程缓存或用户 policy。
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
  已有 Plugin 项目的 `.flower/update-check.tmp` 缓存(`lastCheckedAt` / `lastRemote` /
  `lastStatus` / `lastErrorCode=null`),让主动更新后的下次 SessionStart 使用最新远程证据。目标既无
  Plugin lock 又无旧 manifest 时跳过；写缓存失败不得阻断主流程。
- `self-check --json` 本次写入远端缓存后,返回对象内的 `updateCheck` 必须重新读取写后视图;
  顶层 `status` 与 `updateCheck.lastStatus` 不得滞后一轮。离线写入同样适用。
- `self-check --json` 由启动 hook 调用时必须记录非抑制 actionable 提示的
  `lastPromptedAt` / `lastPromptedKey`；被冷却、延后或跳过抑制时返回
  `status=skipped` 与 `reason=prompt_cooldown|prompt_snooze|prompt_skip`，并在
  `suppressedAction` 中保留原始可执行状态供诊断，但 hook 不得注入 `<flower-update>`。
- 用户显式运行 `self-update --yes` 已经是人工写入入口，预检必须等价使用
  `self-check` 的 prompt suppression 绕过语义，避免旧的稍后/跳过选择阻止用户主动升级；
  `--yes` 要求、项目更新补偿和后续 `trellis-push` 确认链路不变。
- `checkForUpdate()` 必须同时尊重 `--no-update-check`、`FLOWER_NO_UPDATE_CHECK` 以及
  settings(旧项目 fallback manifest)中的 `updateCheck.enabled=false` / `policy=off`。
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
  版本差异、`release_notes*`、`recommended_command`、`snooze_command`、
  `skip_command`、`safety_reasons` 和一条
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
- `update-check snooze|skip` 必须先通过 `buildSelfCheck(..., {writeCache:false, ignorePromptSuppression:true})`
  只读计算当前 actionable `prompt.key`，再写 `promptSuppressed*` 字段。目标没有当前
  actionable 提示时抛中文错误，不凭用户输入猜 key。`snooze` 只接受正数 `--hours` 或
  `--days`，两者不能同时出现。
- `self-update --yes` 的项目阶段必须走完整 `flower-trellis update --target <dir>
  --no-update-check ...` 链路,包含 `syncGlobalTrellis()`、上游 `trellis update` 和
  Plugin Runtime 重放；skill-garden/平台后处理与 state 更新必须在同一事务内完成。
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
| 默认运行 `python3 ./.trellis/scripts/get_context.py` | 只输出项目上下文,不执行独立版本检查,不创建 `update-check-*.marker` |
| `FLOWER_NO_UPDATE_CHECK`、`--no-update-check`、`enabled=false` 或 `policy=off` | 返回 `disabled`,不联网 |
| npx / npm exec 临时运行 | 返回 `skipped/npx_runtime`,不建议全局更新 |
| 本地 `flowerVersion` 或 `.trellis/.version` 不一致,且缓存过期 | 先查 dist-tags;远端有新版返回 `update_available` + 完整 `self-update`,远端无新版返回 `project_out_of_sync` + `--project-only` |
| 本地 `flowerVersion` 或 `.trellis/.version` 不一致,且缓存仍新鲜无更新 | 返回 `project_out_of_sync`,推荐 `self-update --project-only`,远端来源标记为 cache |
| 本地 `flowerVersion` 不一致、缓存仍新鲜无更新,但当前范围无可复用 `lastReleaseNotes` | 为 release notes 主动补拉一次 registry metadata;有摘要则输出并只写 `lastReleaseNotes`,失败或无摘要则输出 `releaseNotes.unavailable=true`,不刷新远端缓存状态 |
| 缓存的 `lastReleaseNotes.range.reason=update_available`,本次结果为 `project_out_of_sync`,且 `from` / `to` / `channel` 相同 | 复用缓存摘要并把输出 range reason 归一为 `project_out_of_sync` |
| `lastCheckedAt` 仍在 interval 内且缓存无更新且项目不 out-of-sync | 返回 `skipped/interval_not_elapsed` |
| `lastCheckedAt` 仍在 interval 内但缓存显示有更新 | 返回 `update_available`,来源标记为 cache |
| 同一 `prompt.key` 已在 24 小时内提示过 | 返回 `skipped/prompt_cooldown`,hook 静默 |
| 当前 `prompt.key` 已 snooze 且 `promptSuppressedUntil` 未到 | 返回 `skipped/prompt_snooze`,hook 静默 |
| 当前 `prompt.key` 已 skip | 返回 `skipped/prompt_skip`,hook 静默；新版本或项目版本差异变化后恢复提示 |
| registry 离线 / 超时 / 非 200 / 响应字段无效且项目不 out-of-sync | 返回 `offline`,只写 `lastStatus=offline` 和简短 `lastErrorCode`,不刷新 `lastCheckedAt` |
| registry 离线 / 超时 / 非 200 / 响应字段无效且项目 out-of-sync | 返回 `project_out_of_sync`,推荐 `--project-only`,同时标注远端 `errorCode` |
| npm 精确版本安装命中 `ETARGET` | `--prefer-online` 等待 1 秒后只重试一次;仍失败则输出最终错误和精确手动命令 |
| `init` / `update` 主动探测成功 | 写入 `.flower/update-check.tmp` 的 `lastRemote` / `lastCheckedAt` / `lastStatus`;既无 lock 又无旧 manifest 时跳过 |
| release notes metadata 缺失或损坏 | 版本判断照常;`releaseNotes.unavailable=true` 或不展示摘要 |
| 远端探测成功且生成了可用 notes 摘要 | 写入 tmp 中的 `lastReleaseNotes`;`lastRemote` 仍只写 dist-tags |
| `self-update --dry-run` | 只打印全局安装命令、项目 update 命令、版本和安全检查,不写入 |
| `self-update` 缺少 `--yes` 且非 dry-run | 抛中文错误,由 CLI 顶层统一退出 |
| 全局 npm 安装成功但项目 update 失败 | 报告未完成,给出手动 `flower-trellis update --target ... --no-update-check --force` 命令 |

### 5. Good/Base/Bad Cases

- Good: 项目 lock 记录 `flower/skill-garden@0.4.1`,当前安装 `0.4.2`,缓存仍新鲜且
  `lastRemote.latest=0.4.2`,启动 hook 注入 `project_out_of_sync` 和
  `flower-trellis self-update --target <dir> --yes --project-only`。
- Good: 项目 lock 记录 `flower/skill-garden@0.4.1`,当前安装 `0.4.2`,缓存过期且
  远端 `latest=0.4.3`,启动 hook 注入 `update_available`,推荐完整
  `flower-trellis self-update --target <dir> --yes`,并保留项目 out-of-sync 证据。
- Base: 远程探测失败时 hook 静默退出;`self-check --json` 仍返回 `offline` JSON,
  不阻断 Codex / Claude Code 启动。
- Base: 用户手动运行 `flower-trellis update --target <dir>` 时,启动探测成功后会刷新
  `.flower/update-check.tmp` 中的 `lastRemote`,随后 Plugin Runtime 不触碰 settings 和旧证据。
- Base: 用户配置 `policy=auto` 但 git dirty,`ai.mode` 降级为 `ask`,并给出
  `dirty_worktree` 原因。
- Bad: 启动 hook 直接执行 `npm i -g` 或 `flower-trellis update`。启动阶段只能注入上下文。
- Bad: `session_context.py` 再调用 `trellis --version` 并按 session ID 创建 marker;这会绕过
  Flower 策略/缓存并让 `.trellis/.runtime` 和升级快照持续堆积文件。
- Bad: 只覆盖 `.trellis/scripts/flower_update_hook.py` 或只改 manifest 就报告项目已更新。
  项目内容更新必须走完整 `flower-trellis update` 链路。
- Bad: Plugin 重放覆盖 `.flower/settings.json` 中的 `policy=auto` 或 `intervalHours=6`。
- Bad: 远程检查刷新 `lastCheckedAt` 后修改旧 manifest，或把缓存写入可提交的状态文件。

### 6. Tests Required

- 静态检查:
  - `node --check src/cli.js && for f in src/lib/*.js src/commands/*.js; do node --check "$f"; done`
  - `python3 -m py_compile src/assets/flower_update_hook.py`
  - 运行默认 `get_context.py`,断言输出正常且 `.trellis/.runtime` 不产生
    `update-check-*.marker`;同时断言旧 `_get_update_hint` / `_update_marker_path` helper 不存在。
  - 用假 `flower-trellis self-check --json` 驱动 `flower_update_hook.py`,断言 stdout
    是合法 JSON,且顶层字段不包含 `additional_context`。
  - `git diff --check`
- CLI 行为:
  - `self-check --json --target <dir> --no-update-check` 返回稳定 `disabled` JSON。
  - 强制远端成功或失败并写入 tmp 后,当次返回的 `updateCheck.lastStatus` /
    `lastErrorCode` 与写后缓存一致。
  - 自动安装使用远端已确认的精确版本和 `--prefer-online`;仅 `ETARGET` 重试一次,
    其它失败不重试。
  - 修改临时 lock 的 `flower/skill-garden` 版本,并在 `.flower/update-check.tmp` 把 `lastCheckedAt`
    设到未来,缓存无远端更新时
    返回 `project_out_of_sync`。
  - 修改临时 lock 的 `flower/skill-garden` 版本,并在 `.flower/update-check.tmp` 把 `lastCheckedAt`
    设到未来;缓存无远端更新且 `lastReleaseNotes=null` 时,模拟 registry metadata 含目标版本摘要,断言
    `self-check` 主动补拉并输出 `releaseNotes.versions`,且只写回 `lastReleaseNotes`。
  - 同一场景下模拟 registry metadata 拉取失败或缺目标摘要,断言仍返回
    `project_out_of_sync` 和推荐命令,同时输出 `releaseNotes.unavailable=true`,且不刷新
    `lastCheckedAt` / `lastStatus` / `lastErrorCode`。
  - 修改临时 lock 的 `flower/skill-garden` 版本且缓存中已有同范围 `update_available`
    release notes 时,返回 `project_out_of_sync` 并继续输出 `releaseNotes`。
  - 修改临时 lock 的 `flower/skill-garden` 版本且让缓存过期,模拟远端 `latest` 高于当前版本时,
    返回 `update_available`,推荐命令不带 `--project-only`。
  - `self-update --target <dir> --dry-run --project-only` 默认项目命令带 `--force`。
  - `self-update --target <dir> --dry-run --project-only -- --skip-all` 不再追加 `--force`。
  - `update-check set|disable|enable|get` 保留 policy / enabled 语义。
  - 同一 `update_available` 被 `self-check` 记录提示后,下一次启动检查返回
    `skipped/prompt_cooldown`;使用 `ignorePromptSuppression` 的内部命令仍可看到原始
    actionable 状态。
  - `update-check snooze --hours 2` 写入当前 `prompt.key`、未来
    `promptSuppressedUntil` 和 `promptSuppressionReason=snooze`;随后 self-check 返回
    `skipped/prompt_snooze`。
  - `update-check skip` 只跳过当前 `prompt.key`;远端推荐版本变化后必须恢复
    `update_available`。
  - `update-check reset` 清空 `lastPrompted*` 与 `promptSuppressed*`,不修改 policy、
    `lastRemote` 或 `lastReleaseNotes`。
  - `flower-trellis update --target <dir> --dry-run` 在远程探测成功时刷新已有 Plugin 项目的
    `.flower/update-check.tmp#lastRemote`;`--no-update-check` 或 `policy=off` 时不联网、不写缓存。
  - 构造旧 manifest 中含 `lastCheckedAt` / `lastRemote` / `lastReleaseNotes` 的场景,
    验证 `readUpdateCheck()` 可兼容读取,任意写入后新 settings/tmp 接管且旧 manifest 原字节保留。
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

#### Wrong: 重复的 Trellis 更新入口

```python
update_hint = _get_update_hint(repo_root)
```

问题:`get_context.py` 会绕过 Flower 的 policy、远端缓存和统一推荐命令,并为每个会话留下
永久 marker。

#### Correct: 上下文与更新检查分离

```python
print(get_context_text(repo_root))
```

原因:默认上下文保持纯读取;更新检查只由 SessionStart 的 `flower_update_hook.py` 进入
`flower-trellis self-check`。

---

## Scenario: Update Backup Retention

### 1. Scope / Trigger

- Trigger: 新增或修改 `flower-trellis update` 的时间戳备份保留参数、备份发现/删除逻辑、
  更新成功边界，或 `self-update -- ...` 的项目更新参数转发。
- Scope: 只管理目标项目 `.trellis/` 直接子目录中严格匹配
  `.backup-YYYY-MM-DDTHH-MM-SS` 的 Trellis 升级快照；`.backup-flower` 是 Patch Engine
  首次修改前基线，永远不属于自动清理范围。

### 2. Signatures

```bash
flower-trellis update --target <dir> [--backup-retention <n>] [--dry-run]
flower-trellis self-update --target <dir> --yes -- --backup-retention <n>
```

```js
parseCliArgs(argv, cwd)
normalizeUpdateBackupRetention(value)
snapshotUpdateBackups(target)
planUpdateBackupRetention(names, retention, protectedNames)
pruneUpdateBackups(target, options)
```

`DEFAULT_UPDATE_BACKUP_RETENTION` 固定为 `3`；`--backup-retention` 必须在 `OWN_FLAGS`
登记为带值 flag，由 `parseCliArgs()` 消费并写入 `ctx.backupRetention`，不得进入
`ctx.passthrough`。`self-update` 只在 `--` 后通过 `ctx.forwarded` 把该参数交给新的 Flower
项目更新进程。

### 3. Contracts

- 参数只接受非负安全整数；缺失值、负数、小数、非数字或超出安全整数范围必须在 banner、
  联网探测、上游 Trellis 和任何文件写入前抛出中文错误。`0` 表示本次完全不扫描、不清理。
- 未显式传参时每次命令使用默认值 `3`，不得写入 manifest、项目配置或运行缓存。
- 更新前后各读取一次合法备份集合，以差集识别本轮新备份并加入保护集合；即使系统时间回拨
  导致名称排序较旧，本轮新备份也不得删除。保护项多于 retention 时允许临时超额保留。
- 清理只能位于 `trellis update`、enhancements 和配置恢复 `finally` 全部完成后的成功路径。
  任一主流程异常都会跳过清理，保留历史备份与本轮上游快照。
- 候选名称必须匹配 `^\.backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$`，且是
  `.trellis/` 的普通直接子目录。扫描和每次删除前都要用 `lstat`、`realpath`、
  `path.relative` 重新验证项目根与 `.trellis/` 边界；文件、软链接、相似名称和路径逃逸零写入。
- 合法候选按名称降序保留最新项，删除列表按从旧到新执行。单项目录删除失败只记录中文
  warning 并继续，不能把已经成功的更新改判为失败。
- `--dry-run` 使用同一个保留计划并展示预计保留/删除项，但不得调用删除；
  `--enhance-only` 不创建上游升级备份，因此不扫描、不清理。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| 未传 `--backup-retention` | 完整更新成功后默认保留最近 3 份合法升级备份 |
| `--backup-retention 0` | 不读取备份目录，保留全部升级备份 |
| 参数缺失、负数、小数、非数字 | 主流程副作用前抛中文参数错误，退出码非 0 |
| 上游 update、enhancements 或配置恢复抛错 | 不进入 `pruneUpdateBackups()`，零删除 |
| 更新前或更新后快照不可靠 | 返回 `skipped` 与 warning，零删除 |
| `.trellis` 或候选真实路径逃逸 | 跳过并警告，项目外零写入 |
| 候选是 `.backup-flower`、普通文件、软链接或相似名称 | 排除或跳过，绝不删除 |
| 本轮新备份排序早于旧备份 | 仍加入 `protected`，必要时临时超过 retention |
| 单个旧备份删除失败 | 记录 warning，继续删除其它候选，update 保持成功 |
| `--dry-run` | 返回 `preview`，打印计划，文件系统不变 |

### 5. Good/Base/Bad Cases

- Good: 原有 4 份备份，本轮新增 1 份，默认成功更新后保留最新 3 份并删除最旧 2 份。
- Good: 系统时间回拨使本轮备份名称最旧，差集仍保护该目录，再用剩余额度保留最新历史备份。
- Base: `--backup-retention 0` 或 `--enhance-only` 不触发目录扫描；dry-run 只输出计划。
- Base: 某个候选因权限删除失败，其它合法旧备份继续处理，最终更新仍成功并输出 warning。
- Bad: 用 `startsWith(".backup-")` 识别候选，或直接对拼接路径执行递归删除。
- Bad: 在配置恢复 `finally` 之前清理，导致后续步骤失败时已经丢失回滚点。
- Bad: 把 `.backup-flower` 当作普通升级备份，破坏 Patch Engine 首次基线语义。

### 6. Tests Required

- `normalizeUpdateBackupRetention()` 覆盖默认值、`0`、合法覆盖、缺失、负数、小数、非数字和
  超出安全整数范围。
- `parseCliArgs()` 覆盖默认值、显式值、缺失值、负数、`OWN_FLAGS` 与 passthrough 隔离；
  `self-update -- ...` 覆盖 forwarded 原样转发。
- 临时目录测试覆盖排序、本轮保护、`.backup-flower`、非法名称、文件、软链接、`.trellis`
  路径逃逸、dry-run 零写入、单项删除失败继续和 retention=0 零扫描。
- 编排测试或等价静态契约检查必须证明清理调用位于配置恢复 `finally` 之后。
- 运行 `node --test test/js/update-backups.test.js`、完整 `npm test`、全量 `node --check`
  与 `git diff --check`；dogfood 至少用隔离目标验证 dry-run 计划且不触碰真实项目备份。

### 7. Wrong vs Correct

#### Wrong

```js
for (const name of fs.readdirSync(trellisPath)) {
  if (name.startsWith(".backup-")) fs.rmSync(path.join(trellisPath, name), { recursive: true });
}
```

问题:名称边界过宽、没有类型和真实路径校验，也没有更新成功与本轮备份保护边界。

#### Correct

```js
const beforeSnapshot = snapshotUpdateBackups(target);
// 完整更新与配置恢复成功后再调用。
pruneUpdateBackups(target, { retention, beforeSnapshot, dryRun });
```

原因:同一 helper 统一执行严格候选识别、前后差集保护、路径复核、dry-run 与非致命失败策略。

---

## Common Mistakes

- 在多个模块各自重算包根路径 —— 应统一用 `paths.js` 的 `PKG_ROOT` / `ENHANCEMENTS_ROOT`。
- 新增自有 flag 只改了 `parseCliArgs()` 没更 `OWN_FLAGS`(或反之)—— 两处必须同步。
- 把版本/manifest 读取失败当致命错误抛出 —— 这类应容错降级。
- 联网探测(版本检测)漏写超时或 try/catch —— 离线时会挂起或把错误抛进主流程,见
  [Network Probe](#network-probe-尽力而为联网探测)。
- 凭 manifest 之外的猜测去删除目标文件 —— 清理只认 manifest 里的精确 `paths`。

---

## 用户级匿名安装遥测契约

### 1. Scope / Trigger

修改 `src/lib/telemetry.js`、`telemetry` 子命令、远程版本检查或 init/update 完成路径时，必须遵守本契约。遥测默认开启但在普通运行中完全静默，任何失败都不能改变主命令输出或退出码。

### 2. Signatures

```text
<flowerConfigDirectory>/telemetry.json
flower-trellis telemetry status|enable|disable
FLOWER_NO_TELEMETRY=1
POST https://ai-api.flower-cli.com/api/flower-trellis/telemetry
```

状态字段固定为 `schemaVersion`、`deviceId`、`enabled`、`lastAttemptAt`、`lastSuccessAt`。事件固定为 `version_check`、`init_completed`、`update_completed`。

### 3. Contracts

- 状态缺失时视为启用，首次真实上报生成用户级随机 UUID；npm 重装和不同项目复用同一 ID。
- 配置目录权限 0700、文件 0600，同目录临时文件 + `fsync` + rename 原子替换；软链接或非普通文件拒绝覆盖。
- 损坏的普通 JSON 状态在后台上报中静默跳过并保留证据，只有显式 `telemetry enable|disable` 可重建；软链接或非普通文件始终拒绝覆盖。
- payload 只含随机设备 ID、事件、Flower/Trellis 当前与项目版本、`.trellis/.developer` 的 `name=`、platform、arch、client_time。
- 禁止采集 MAC、主机名、系统用户名、项目路径、仓库地址、Git 身份、IP 或 User-Agent。
- 普通 `version_check` 复用 updateCheck `intervalHours` 节流；init/update 成功事件强制上报，update dry-run 不上报。
- init/update 的 registry 请求与遥测并行；self-check 只有缓存未命中并真实请求 registry 时触发，stdout 始终只有原 JSON。
- `FLOWER_NO_TELEMETRY` 只临时停用且零写入；持久开关独立于 updateCheck。
- 网络上报默认使用 10 秒超时；测试或受控调用可用 `timeoutMs` 显式覆盖。HTTP/网络/状态写入错误全部静默降级。
- 运行真实 CLI 的 E2E helper 必须在隔离环境中默认注入 `FLOWER_NO_TELEMETRY=1`，避免测试创建用户级状态或向生产遥测地址发请求；调用方仍可在明确的遥测专项测试中显式覆盖该默认值。
- 普通 CLI E2E 不得为了模拟真实用户而清除该隔离变量；测试必须断言真实 init 完成后隔离配置目录内不存在 `telemetry.json`。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| 无状态文件 | 默认启用，首次上报创建 UUID 并发送 |
| `enabled=false` | 不发送、不更新尝试时间 |
| `FLOWER_NO_TELEMETRY` 非空 | 不发送且不创建状态文件 |
| 状态 JSON 损坏 | 普通路径跳过；显式 enable/disable 生成新 UUID 并原子重建 |
| 状态为软链接或非普通文件 | 普通路径跳过；显式命令也拒绝覆盖 |
| version_check 尚在 interval 内 | 返回 throttled，不联网 |
| init/update 成功 | 绕过 interval 发送完成事件 |
| update `--dry-run` | 不发送完成事件 |
| 网络失败、超过 10 秒仍未完成或非 2xx | 记录 lastAttemptAt，保留 lastSuccessAt，主命令继续 |
| 普通真实 CLI E2E 使用隔离 helper | 默认禁用遥测，不创建 `telemetry.json`，不访问生产上报地址 |
| 遥测专项测试显式覆盖 helper 默认值 | 仅在该测试隔离范围内按显式值执行 |

### 5. Good / Base / Bad Cases

- Good：同一用户在多个项目运行，服务端看到同一随机设备 ID 与不同开发者别名/项目版本，但看不到路径和仓库。
- Good：真实 init E2E 使用隔离 XDG/config 目录并默认设置 `FLOWER_NO_TELEMETRY=1`，命令行为照常完成且无遥测状态文件。
- Base：离线环境上报超时后静默返回，init/update 完成页和 self-check JSON 不受影响。
- Bad：使用 MAC/hostname 生成稳定指纹，或把遥测状态写进项目仓库。
- Bad：状态损坏时后台自动覆盖，导致用户无法检查异常证据。
- Bad：只隔离配置目录却未禁用遥测，使普通 E2E 生成大量设备 UUID 并尝试上报生产服务。

### 6. Tests Required

- 缺失状态默认开启、UUID 稳定、0700/0600、enable/disable 和环境变量零写入。
- 损坏 JSON、软链接、网络失败、显式短超时、默认 10 秒预算内的秒级响应、节流和强制事件。
- payload 精确白名单及明确不存在 MAC、hostname、username、path、repository。
- self-check 缓存命中不触发、真实远程检查触发、stdout 可直接 `JSON.parse`。
- init/update 完成事件位于成功路径，update dry-run 跳过。
- 真实 CLI E2E helper 默认包含 `FLOWER_NO_TELEMETRY=1`，同时允许专项测试通过显式 env 覆盖。
- 至少一个真实 init 测试断言隔离配置目录中不存在 `telemetry.json`。
- 运行 `node --test test/js/telemetry.test.js test/js/update-check.test.js`、完整 `npm test`、全量 `node --check` 与 `git diff --check`。

### 7. Wrong vs Correct

```javascript
// 错误：用机器硬件生成不可轮换指纹
const deviceId = hash(macAddress + hostname)

// 正确：首次上报生成用户级随机 UUID，并存入私有配置目录
const state = { schemaVersion: 1, deviceId: crypto.randomUUID(), enabled: true }
```

原因：运营统计只需要稳定随机安装标识，不需要不可撤销的硬件身份。

```javascript
// 错误：亚秒级默认值会在常见公网 TLS 建连完成前中止
const DEFAULT_TIMEOUT_MS = 800

// 正确：保留有界的 10 秒公网预算，失败后仍静默降级
const DEFAULT_TIMEOUT_MS = 10000
```

原因：遥测是尽力而为的非关键请求，但亚秒级预算会系统性误判正常公网连接；10 秒上限兼顾上报成功率和离线降级边界。

```javascript
// 错误：真实 CLI E2E 只隔离 HOME/XDG，仍会创建新设备并尝试上报
const env = { ...process.env, XDG_CONFIG_HOME: isolatedConfig }

// 正确：隔离 helper 默认关闭遥测，专项测试仍可显式覆盖
const env = { ...process.env, FLOWER_NO_TELEMETRY: '1', ...overrides }
```

原因：普通 E2E 的目标是验证 CLI 主流程，不应污染生产安装统计；显式覆盖保留了遥测专项测试验证真实触发路径的能力。
