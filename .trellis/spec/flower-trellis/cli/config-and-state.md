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
| 目标 `0.6.12`、捆绑 `0.6.14`、普通 `update --dry-run` | 项目外沙箱真实升级到 `0.6.14` 并执行 Skill-Garden dry-run；来源树零写入 |
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
- Good: 旧 `0.6.12` 项目用新版 Flower 执行普通 dry-run，在项目外沙箱看到 `0.6.14` Trellis
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
- 真实 CLI 回归必须用最小 `0.6.12` 项目运行到捆绑 `0.6.14` 的普通 dry-run，断言退出码为
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

不得根据 `variant` 名称判断版本变化；同属 `0.6` 变体的 `0.6.12` 与 `0.6.14` 仍是跨版本。

---

## Variant Selection (`src/lib/variant.js`)

- `selectVariant(target)` 读目标 `.trellis/.version` → 返回 `{ variant, version }`。
- `resolveEnhancementSnapshot(target, variantOverride)` 可以覆盖 `variant`，但无论是否覆盖都必须保留 `selectVariant()` 读到的真实 `version`，供 0.6 compatibility policy 判断。
- 规则(逐字符移植 skill-garden `install.sh` 263-274):主版本 ≥1 或次版本 ≥6 → `0.6`;
  次版本 ≥5 → `0.5`;文件缺失/解析失败/更低 → `old`。次版本会先剥掉 `-beta.x` 后缀。
- 改这条规则前先确认上游 install.sh 的对应逻辑,保持一致。
- 映射到 `0.6` 不等于语义兼容：`0.6.14` 是当前已登记版本，同线未登记版本 warning，0.7+/1.x 由 Patch policy 阻断并提示 `--no-enhance`。

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

## Scenario: Project-Level Trellis Disable And Recovery

### 1. Scope / Trigger

- Trigger: 修改 `src/lib/trellis-control.js`、`src/commands/trellis.js`、Trellis control schema、
  Project Store 控制状态，或让 update / self-update / Plugin 写链在 disabled 项目中运行。
- Scope: 开关始终覆盖整个项目和全部已配置平台；不支持平台级关闭，也不删除 `.trellis` 用户数据、
  Plugin 声明、lock、state 或活动任务。

### 2. Signatures And State

```bash
flower-trellis disable [--dry-run] [--force] [--target <dir>] [--json]
flower-trellis enable  [--dry-run] [--force] [--target <dir>] [--json]
flower-trellis status  [--target <dir>] [--json]
```

```text
.flower/trellis-control.json
.flower/trellis-detached/<transaction-id>/manifest.json
.flower/trellis-detached/<transaction-id>/files/
.flower/trellis-detached/<transaction-id>/disabled/
```

```js
inspectTrellisControl(projectRoot)
disableTrellis(projectRoot, options?)
materializeTrellis(projectRoot, options?)
finalizeTrellisEnable(projectRoot)
enableTrellisExact(projectRoot, options?)
runWithTrellisIntegrationEnabled(projectRoot, operation)
```

### 3. Contracts

- 命令面以 `flower-trellis status|enable|disable` 为一等命令；`flower-trellis trellis <子命令>`
  保留为等价别名。两种写法必须走同一份参数解析、退出码和 JSON 契约，不得出现行为分叉。
- `disable` 的目标真源只允许来自 Trellis `.template-hashes.json`、
  `getConfiguredPlatforms()` + `collectPlatformTemplates()` 和 `flower/skill-garden` Plugin state；
  不得按目录名猜测 ownership。重复物理路径必须稳定去重并保留全部 owner provenance。
- `.trellis/**` 和 `.flower/**` 永远不是 detach 目标。`AGENTS.md` 只移除唯一完整的
  `TRELLIS:START/END` 管理块；共享 JSON 只结构化移除 Trellis 节点；独占文件只有 hash-clean
  或显式 `force` 才能删除。
- 全部目标在第一处写盘前完成路径、文件类型、ownership、冲突和恢复材料 preflight。
  软链、特殊文件、非法 POSIX 相对路径、项目外逃逸、损坏 state/manifest 或无法拆分的修改必须
  fail closed。普通冲突退出码为 `3` 且零写入。
- `--force` 只允许处理恢复证据完整时的独占文件冲突、共享 JSON 恢复冲突或 drifted 重收敛；
  `repair-required` 即使显式 force 也禁止覆盖。drifted 重收敛必须把旧 manifest 的全部原始恢复材料
  迁移到新事务，只对重新出现的入口执行 detach，并在新 control state 落盘后才清理旧事务。
- control state 与 detached manifest 都使用 schema 校验。manifest 保存原始字节、mode、owner、
  mutation kind、before/after hash 和材料路径；事务逐项记录 `completed`，失败时逆序回滚。
  回滚不完整必须写 `repair-required` 并保留 journal/evidence，不能伪装为成功。
- `enable` 先对全部目标做恢复 preflight。独占文件恢复关闭前原始字节；共享 JSON 做
  base/desired/current 三方合并，数组按 matcher/id/name/path/command 等稳定身份递归匹配；
  模板减法命中同一数组节点但仍保留用户子节点时，必须保留 matcher/id/name 等匹配身份，不能把
  用户 hook 组改成无 matcher 的全局组；
  `AGENTS.md` 按管理块局部锚点恢复。关闭期间新增的无关用户内容
  必须保留；冲突默认全量阻断，`force` 前先保存当前现场。
- 共享 JSON ownership 只来自平台模板节点或对已确认受管路径的明确引用，禁止仅因字符串名称包含
  `trellis` 而删除用户节点；已经中和的共享 JSON 不产生 mutation，也绝不能退化为独占文件删除或
  被 `status` 误报为 drifted。
- 用户级 `trellis enable` 在精确 materialize 后必须运行当前 Flower/Trellis update 与 Plugin replay，
  完整成功才删除 control state。任一步失败由项目外 update snapshot 恢复调用前 disabled 现场。
- disabled 项目上的真实 `flower-trellis update` 和 Plugin mutating lifecycle 使用
  `runWithTrellisIntegrationEnabled()` 临时 materialize；成功后以最新 ownership 重新 disable，失败后
  恢复调用前 disabled 树。Plugin preflight 的 content/Patch 精确目标必须扩展到外层补偿快照；即使目标
  位于普通 Update 为保护用户数据而排除的 `.trellis/spec`，也只对该明确目标及其缺失祖先强制取证，
  不得扩大到整个 spec。外层恢复不完整时必须持久化 `repair-required`。dry-run 不得为了临时恢复而写来源项目。
- 直接上游 `trellis update` 不读取 Flower control state，允许其产生入口漂移；
  `status` 必须检查真实目标并返回 `drifted`，不能只信任状态文件。稳定状态至少包括
  `enabled`、`disabled`、`drifted`、`repair-required`、`not-initialized`。
- disable / enable 后必须提示重启 AI 会话；已经启动的会话、auto-loop 或外部 worker 不在本功能的
  撤回范围内。

### 4. Validation Matrix

| 条件 | 结果 |
|---|---|
| clean 多平台项目 disable | 全部平台入口一次 detach；`.trellis` 与 `.flower` 数据保留 |
| 重复 disable / enable | 返回 `unchanged`，不重写目标 |
| disable / enable `--dry-run` | 返回真实目标与冲突，来源项目零写入 |
| 修改过的独占目标 | 默认冲突且零写入；`--force` 保存原字节后继续 |
| 共享 JSON 在 disabled 期间新增用户字段 | enable 后用户字段与 Trellis 节点同时存在 |
| 共享 hook 组追加用户 hook | disable 保留原 matcher；enable 仍为单一组且保留全部用户 hook |
| 已中和 JSON 仅含用户配置 | `status=disabled`，重复 disable 返回 `unchanged` |
| materialize 或 normalize 中途失败 | 恢复调用前完整 disabled 状态 |
| Plugin 修改精确 `.trellis/spec` 目标后外层失败 | 精确恢复该目标，不回滚其它用户 spec |
| disabled 状态出现任一 Trellis 入口 | `status=drifted` 并列出路径 |
| control/manifest/material 损坏或 journal 未完成 | `status=repair-required`，保留证据 |
| disabled 项目执行 Flower update / Plugin 写命令 | 操作完成后仍为 `disabled`，外部 Plugin 内容保留 |

### 5. Good / Base / Bad Cases

- Good: Claude 与 Codex 同时启用，`disable` 一次移除两平台入口并保留 `.trellis` 用户数据；
  关闭期间用户向共享 hook 组追加节点，`enable` 后仍保持原 matcher、单一 hook 组和全部用户节点。
- Base: 项目已经完整 disabled 时重复 `disable` 返回 `unchanged`；项目已经 enabled 时重复
  `enable` 返回 `unchanged`，两者都不重写目标或恢复证据。
- Bad: disabled Plugin 写链只快照普通 Update 范围，遗漏计划修改的 `.trellis/spec` 精确目标；
  后续失败会留下无法恢复的用户数据变化。必须在 Plugin preflight 后扩展外层快照，并在补偿不完整时
  持久化 `repair-required`。

### 6. Tests Required

- `trellis-control.test.js` 覆盖目标发现、管理块/共享 JSON 拆分、修改冲突、force 原样恢复、
  dry-run/幂等、软链、故障回滚、drifted、repair-required、真实 CLI 与 disabled Plugin lifecycle。
- Update 测试覆盖 disabled 包装、项目外补偿与失败恢复；Plugin lifecycle 测试覆盖外部内容不会被
  Trellis reconciliation 删除。
- 隔离项目 dogfood 覆盖 Claude + Codex init、disable、status、enable、update dry-run 和
  uninstall dry-run；不得在当前开发仓执行真实 disable。
- 修改本契约后必须运行完整 `npm test`、`npm pack --dry-run --json`、相关 `node --check`、
  `git diff --check` 和 snapshot / compiled-target 一致性检查。

### 7. Wrong Vs Correct

**Wrong**:只写一个 `disabled=true` 或设置 Hook 环境变量，却保留项目 Skills、Agents、Commands、
`AGENTS.md` 管理块和平台配置入口。

**Correct**:先从所有权真源生成全项目计划，保存可验证恢复材料，再事务性 detach 全部可发现入口；
恢复时三方合并共享配置，并在当前版本规范化成功后才清除 control state。

## Scenario: Branch-Local Trellis Worktree

### 1. Scope / Trigger

- Trigger: 新增或修改 `trellis-worktree` skill、`worktree_setup.py`、Flower `worktree` facade、
  linked Git worktree 的分支本地 Trellis/平台入口、schema v1 迁移、common-dir registry/锁，
  或 hook / untracked 的 worktree 根解析。
- Scope: 每个 worktree 只加载当前分支自己的 `.trellis`、`.agents`、`.codex`、`.claude`、
  `.flower` 和本地 runtime；普通 task、untracked、check、push 阶段语义不改变。

### 2. Signatures

```bash
flower-trellis worktree status [--target <path>] [--json]
flower-trellis worktree prepare [--target <path>] [--developer <name>] \
  [--inherit-route-prefs] [--json]
flower-trellis worktree migrate [--target <path>] [--dry-run] [--json]
flower-trellis worktree create --target <path> --branch <branch> [--base <ref>] \
  --task-title <title> --task-slug <slug> [--developer <name>] [--json]
flower-trellis worktree create --target <path> --branch <branch> [--base <ref>] \
  --task-title <title> --task-slug <slug> [--developer <name>] \
  --yes --plan-fingerprint <sha256> [--json]
flower-trellis worktree remove --target <path> [--json]
```

```text
<git-common-dir>/trellis/registry-v1.json
<git-common-dir>/trellis/locks/registry.lock/
```

### 3. Contracts

- `status` 只读；稳定状态为 `ready-local`、`needs-init`、`needs-prepare`、
  `needs-migration`、`blocked`、`error`。输出稳定包含 target/Git 身份、branch、HEAD、entry、
  local state、legacy、registry、actions、conflicts 和 reason，不再输出新流程 `sourceRoot`。
- `--target` 可指向 worktree 根、子目录或文件；缺省为当前目录。target 必须解析到 Git worktree
  toplevel，非 Git 目录返回 `reason=not-git-worktree`。
- `.trellis` 必须是当前 worktree 的真实目录；平台入口按目标 `.template-hashes.json` 和当前真实
  目录识别，未启用平台可以缺失。任何整目录 symlink 一律进入 legacy 或 conflict 分支。
- Hook、untracked helper 等向上解析项目根时，必须先检查当前目录的本地 `.trellis`，随后在遇到
  第一个 `.git` 文件、目录或 symlink 时停止；不得越过嵌套仓库 / linked worktree 边界命中父项目。
- Flower `worktree` facade 作为外部 bootstrap 入口时，不得从目标目录的生成文件推断 Python
  命令；目标可能仍是 legacy symlink。只允许使用显式 `TRELLIS_PYTHON_CMD` 或当前平台默认值。
- `prepare` 默认只创建目标自己的 `.trellis/.developer`、`.trellis/.runtime/sessions` 和 registry
  元数据；身份来自 `--developer`、目标本地文件或 common registry，不读取其它 worktree 文件。
  仅显式 `--inherit-route-prefs` 时，Flower facade 才把当前控制 worktree 作为 engine `--source`；engine
  必须先验证 source/target canonical git-common-dir 和开发者身份相同，再读取 source 的普通文件
  `.trellis/.route-prefs.tmp`。目标偏好已存在时保留，来源缺失或无合法值时完成 prepare 但报告未继承。
  获取 registry 锁后必须重新读取并校验 registry，再进行任何目标本地写入。
- schema v1 `.trellis-worktree.json` 只读兼容。自动迁移要求 manifest target/path 白名单有效、
  symlink 仍指向 manifest 声明来源，并且目标分支 `HEAD` 能重建全部受管真实目录。
  旧 `sourceRoot` 只用于验证 symlink，禁止作为迁移内容源。
- 迁移先在目标项目外临时目录执行 `git archive HEAD` 和内容验证，再事务替换 symlink；成功删除
  v1 manifest，失败恢复原链接和 manifest。新流程不再创建 worktree manifest。
- registry 固定为 `{schemaVersion:1,developer?,worktrees:{<id>:{path,gitDir,branch,head,task,
  trellisVersion,updatedAt}}}`；ID 从 canonical git-dir 哈希派生，写入使用同目录临时文件、
  `fsync` 和原子替换。
- registry 写入前必须全表校验：同一 worktree ID 的 path/gitDir 不得漂移，不同 ID 不得复用
  path 或 gitDir，同一 task 路径不得绑定多个 worktree，非对象条目必须失败关闭。
- registry 写操作先用原子 `mkdir` 获取 `registry.lock/`；无法可靠证明旧 owner 已退出时必须阻断，
  不得无锁覆盖。
- `create` 必须在 task 规划文件产生前运行，并固定为两阶段：不带 `--yes` 时只读返回
  `status=confirmation-required`、`changed=false`、`requiresConfirmation=true` 和 plan fingerprint；真实
  创建必须同时传 `--yes --plan-fingerprint <sha256>`。engine 重新计算完整计划，任一事实变化都返回
  `reason=create-plan-changed` 和最新计划，且零写入。
- `create --base` 缺省时使用来源当前分支；来源 detached 时回退 `HEAD`。计划必须展示 source 仓名、
  canonical path、branch、HEAD，requested/effective base 与 resolved commit，以及 target branch/path/task。
  来源根仓 tracked/staged/untracked/conflict 状态只作为 warning，明确 `includedInBase=false`；不得复制、
  stash、提交或把 dirty 自动升级为 blocker。
- 计划必须按 selected base commit 盘点根仓与 mode `160000` gitlink，记录各 repository name/path/base
  commit；根仓固定 `selected=true`、`createsBranch=true` 并记录 target branch，submodule 固定
  `selected=false`、`createsBranch=false`、`targetBranch=null`。已初始化来源 submodule 额外记录
  branch/HEAD，但不得 fetch、checkout 或复制 working tree。
- create/prepare 唯一允许继承的个人偏好是 `.trellis/.route-prefs.tmp`：只读取普通文件，只接受
  `implement=inline|subagent` 和 `check=check-all-inline|check-all-subagent`，按 implement/check 固定顺序
  重写规范值，禁止复制原始字节。create 仅在目标 developer 与来源 `.developer` 相同时自动继承。
- 不继承 current task/session、untracked/pre-check/auto-loop/Ralph、agent 临时状态、`.flower/state.json`、
  `.claude/settings.local.json`、cache、transaction 或 backup。handoff 必须返回 cwd、workspaceRoot、
  `requiresNewSession=true` 和原因；目标后续规划必须在新会话开始。
- 确认后执行顺序为：校验 path/branch/base/fingerprint -> `git worktree add -b` -> local readiness ->
  目标 developer/runtime/规范化 route 偏好 -> `task.py create --no-start` -> `set-branch` -> registry ->
  handoff。失败只逆序清理本轮创建的 task/worktree/branch/registry。
- `remove` 要求 registry 精确匹配、Git clean、无活动 session/锁，且绑定 task 不处于 planning 或
  in_progress；主 worktree 和唯一 worktree 永远不得通过该命令移除。成功只移除 worktree 和
  registry 条目，保留 branch。Git remove 后若 registry 提交失败，必须用原 branch/HEAD 重建
  worktree，并恢复删除前快照中的 gitignored Trellis/平台本地状态；补偿不完整时返回独立 reason。
- hook 和 `untracked_flow.py` 只能向上查找当前 cwd 本地 `.trellis`。Hook 已加载但 cwd 缺本地
  Trellis 时输出 `worktree-local-trellis-missing` bootstrap 诊断，不读取其它 worktree workflow/runtime。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| 目标存在真实 `.trellis`、本地 identity/runtime | `status=ready-local`；零 symlink/manifest 写入 |
| 目标存在版本化内容但缺 identity/runtime | `status=needs-prepare`；prepare 只写本地状态和 registry |
| 当前分支缺 `.trellis`，其它 worktree 有 Trellis | `status=needs-init`；不得扫描或选择其它 worktree |
| schema v1 manifest 和 symlink 完整，目标 HEAD 可重建 | dry-run=`migration-ready`；真实迁移后目录本地化并删除 manifest |
| schema v1 来源无法由目标 HEAD 重建 | `reason=migration-source-unavailable`；symlink/manifest 原样保留 |
| manifest 损坏、target 不符、symlink 漂移或用户路径冲突 | `status=blocked`；任何写操作零部分写入 |
| registry lock 已存在 | `reason=registry-lock-held`；不得 last-write-wins |
| registry 中 ID/path/gitDir 漂移、路径碰撞或 task 重复绑定 | `status=blocked` 或稳定冲突 reason；prepare/create 在本地写入前停止或完整回滚 |
| create 首次调用 | 返回只读完整计划与 fingerprint；target/branch/registry 均不变化 |
| 来源 current branch 或显式 base ref 变化、HEAD/dirty/submodule/route 偏好变化 | 旧 fingerprint 返回 `reason=create-plan-changed` 与最新计划；零写入 |
| 来源 route 偏好是 symlink/目录/无合法值，或 create 目标开发者不同 | 不读取或不继承；其它 create 计划事实仍可确认 |
| prepare 未传 `--inherit-route-prefs` | 不读取任何其它 worktree；只准备目标本地身份/runtime/registry |
| prepare 显式继承但 source/target 不同仓或不同开发者 | 稳定错误且目标本地状态零部分写入 |
| create 中 task 或 readiness 失败 | 回滚本轮新 worktree/branch/registry，不删除预先存在对象 |
| remove 遇到 dirty、active task/session/lock 或 registry drift | 失败关闭，worktree 和 branch 保留 |
| remove 目标是主 worktree 或唯一 worktree | `reason=remove-main-worktree-forbidden`；目标目录保持不变 |
| Git remove 成功但 registry 写入失败 | 重建 worktree 并恢复 gitignored 本地状态；成功补偿返回 `registry-write-failed`，补偿不完整返回 `worktree-remove-rollback-failed` |
| remove 成功 | worktree/registry 条目删除，branch 保留 |
| target 不是 Git worktree | `reason=not-git-worktree` |
| linked cwd 中 hook 已能运行但无本地 `.trellis` | 输出 bootstrap 诊断，不包含其它 worktree task/untracked 内容 |
| linked cwd 直接调用 untracked helper 且无本地 `.trellis` | `reason=not-trellis-project` |

### 5. Good/Base/Bad Cases

- Good: 两个分支分别提交不同 workflow/spec/skill，两个 worktree 都只读取自己的文件。
- Good: 新并行任务先运行 `flower-trellis worktree create`，再在 handoff cwd 启动新会话规划。
- Good: legacy migration 的候选内容只来自目标 `HEAD`，旧 source 分支更新不会进入迁移结果。
- Good: remove 在 registry 故障注入后恢复原 worktree、task 文件和 `.trellis/.runtime` 本地状态。
- Base: 当前分支未启用 `.claude` 时，缺少 `.claude` 不阻断 ready-local。
- Bad: 把 `.trellis` 或平台目录 symlink 到另一个 worktree；分支切换会跨目录污染运行语义。
- Bad: 把 tasks/spec/workspace/session 放进 common-dir registry；registry 只能保存机器映射和锁。
- Bad: 为了 remove 方便使用 `--force` 绕过 dirty/task/session 检查或顺带删除 branch。
- Bad: bootstrap 为选择 Python 解释器而读取 legacy `.trellis/workflow.md`；这会再次执行其它分支配置。

### 6. Tests Required

- `test_worktree_setup.py` 必须覆盖 ready/prepare、双分支本地内容、needs-init、registry/锁、legacy
  成功迁移/不可重建/漂移、registry 全局碰撞与重复 task、create 只读计划/当前分支默认/detached
  fallback/submodule/dirty/fingerprint 变化、route 偏好规范化与同开发者继承、prepare 显式继承边界、
  create/remove、主 worktree 删除保护，以及 registry 写失败后的 worktree/本地状态补偿。
- `test_untracked_flow.py` 必须覆盖 linked worktree cwd 无 `.trellis` 时不读取主 runtime，并覆盖
  嵌套 `.git` 边界不能命中父 Trellis。
- `test_workflow_state_hook.py` 必须覆盖 linked cwd 只输出 local-missing 诊断及嵌套 `.git` 边界。
- `worktree-cli.test.js` 必须覆盖 facade parse、确认参数、prepare route 来源注入、无 shell Python
  命令调用、禁用 legacy 生成证据和真实 CLI status。
- 改动 helper 或 fallback 后至少运行相关 Python 单测、`python3 -m py_compile`、`npm run sync`、
  `npm run patch:targets:check`、`git diff --check`；Patch target 改动还要先刷新 compiled targets。

### 7. Wrong vs Correct

#### Wrong

```bash
ln -s <main-worktree>/.trellis <linked-worktree>/.trellis
ln -s <main-worktree>/.codex <linked-worktree>/.codex
```

问题:整目录链接让一个分支执行另一个分支的 workflow、spec、task 和平台配置。

#### Correct

```bash
flower-trellis worktree create --target <linked-worktree> --branch feature/example \
  --task-title "Example" --task-slug example
# 检查返回计划后执行：
flower-trellis worktree create --target <linked-worktree> --branch feature/example \
  --task-title "Example" --task-slug example \
  --yes --plan-fingerprint <returned-sha256>
```

原因:先确认来源分支、基线提交、多仓清单和本地状态边界，再由目标分支自己的 Trellis 创建 planning
task；common-dir 只保存机器映射，后续在 handoff cwd 的新会话继续。

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
POST https://ai-api.hub.flower-cli.com/
```

状态字段固定为 `schemaVersion`、`deviceId`、`developerName`、`enabled`、`lastAttemptAt`、`lastSuccessAt`；旧状态缺少 `developerName` 时只读兼容为 `null`，下一次真实上报自动补齐。事件固定为 `version_check`、`init_completed`、`update_completed`。

### 3. Contracts

- 状态缺失时视为启用，首次真实上报生成用户级随机 UUID；npm 重装和不同项目复用同一 ID。每次真实上报同时缓存本次有效 `developerName`，供后续项目上下文不完整时回退。
- 配置目录权限 0700、文件 0600，同目录临时文件 + `fsync` + rename 原子替换；软链接或非普通文件拒绝覆盖。
- 损坏的普通 JSON 状态在后台上报中静默跳过并保留证据，只有显式 `telemetry enable|disable` 可重建；软链接或非普通文件始终拒绝覆盖。
- `developer_name` 按目标项目 `.trellis/.developer` 的有效 `name=`、目标目录可见的 Git `user.name`、用户级状态缓存的顺序解析；项目自报名称优先，Git 只读取名称，不读取邮箱或远端。
- payload 只含随机设备 ID、事件、Flower/Trellis 当前与项目版本、解析后的 `developer_name`、platform、arch、client_time；三种身份来源都缺失时整条事件不发送，且不创建或更新时间戳状态。
- 禁止采集 Git 邮箱、MAC、主机名、系统用户名、项目路径、仓库地址、IP 或 User-Agent。
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
| `.trellis/.developer` 缺失或没有有效 `name=`，Git `user.name` 有效 | 使用 Git 名称发送，并与设备 ID 一起缓存 |
| 项目名称与 Git 名称都缺失，状态缓存有效 | 使用缓存名称发送，设备 ID 保持不变 |
| 项目、Git、缓存三种身份来源都缺失 | 返回 `missing_developer`，不发送且不创建或更新遥测状态 |
| version_check 尚在 interval 内 | 返回 throttled，不联网 |
| init/update 成功 | 绕过 interval 发送完成事件 |
| update `--dry-run` | 不发送完成事件 |
| 网络失败、超过 10 秒仍未完成或非 2xx | 记录 lastAttemptAt，保留 lastSuccessAt，主命令继续 |
| 普通真实 CLI E2E 使用隔离 helper | 默认禁用遥测，不创建 `telemetry.json`，不访问生产上报地址 |
| 遥测专项测试显式覆盖 helper 默认值 | 仅在该测试隔离范围内按显式值执行 |

### 5. Good / Base / Bad Cases

- Good：同一用户在多个项目运行，服务端看到同一随机设备 ID 与不同开发者别名/项目版本，但看不到路径和仓库。
- Good：目标项目缺少 `.trellis/.developer`，但本地 Git 配置为 `silentflower`；事件使用 `silentflower` 并写入用户级缓存，后续无项目上下文的版本检查仍关联同一名称和设备 ID。
- Good：真实 init E2E 使用隔离 XDG/config 目录并默认设置 `FLOWER_NO_TELEMETRY=1`，命令行为照常完成且无遥测状态文件。
- Base：离线环境上报超时后静默返回，init/update 完成页和 self-check JSON 不受影响。
- Bad：使用 MAC/hostname 生成稳定指纹，或把遥测状态写进项目仓库。
- Bad：状态损坏时后台自动覆盖，导致用户无法检查异常证据。
- Bad：只隔离配置目录却未禁用遥测，使普通 E2E 生成大量设备 UUID 并尝试上报生产服务。

### 6. Tests Required

- 缺失状态默认开启、UUID 稳定、旧状态兼容、`developerName` 缓存、0700/0600、enable/disable 和环境变量零写入。
- 开发者名称覆盖项目优先于 Git、Git 优先于缓存、缓存兜底，以及三种来源都缺失时零上报。
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

```javascript
// 错误：项目文件缺失时立即放弃，丢失本机已有的有效开发者身份
const developerName = readProjectDeveloper(target)
if (!developerName) return { status: "missing_developer" }

// 正确：按明确优先级解析，并把有效名称与设备状态一起缓存
const developerName = readProjectDeveloper(target) ||
  readGitDeveloper(target) ||
  state.developerName
state = writeTelemetryState({ ...state, developerName })
```

原因：`.trellis/.developer` 仍是项目身份真源，但 Git `user.name` 和用户级缓存可以在项目文件缺失或 SessionStart 上下文不完整时保持名称与随机设备 ID 的稳定关联；三者都不可用时才停止上报，避免伪造身份。
