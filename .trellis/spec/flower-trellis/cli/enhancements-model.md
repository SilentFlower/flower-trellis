# Enhancements Model

> 强化包(skill-garden)的快照、变体与叠加流水线 —— flower-trellis 的核心机制。

---

## Overview

flower-trellis 在 Trellis 之上通过内置 `flower/skill-garden` system Plugin 叠加强化包：
强化文件仍随包发布为离线快照，安装/升级时按目标 Trellis 版本选择变体，最终由
Plugin Runtime 的统一计划、事务、lock 和 state 管理。整条链路**处处幂等**。

---

## Snapshot (`enhancements/` + `scripts/sync-enhancements.mjs`)

- `enhancements/<variant>/` 是 skill-garden `.trellis` 的**离线快照**,使最终用户安装时
  零网络即可叠加。
- 由开发期脚本 `scripts/sync-enhancements.mjs` 生成(`npm run sync`,并挂在
  `prepublishOnly`),**最终用户不会运行它**。脚本会先整体清旧快照再全量递归拷贝
  `.agents` / `.claude` / `overrides`,并写 `MANIFEST.json` 记录 `syncedAt` /
  `sourceCommit` 供溯源；0.6 `variants[].policyFiles` 必须登记 `compatibility.json` 和 `conflicts.json`。
- `enhancements/common/.common` 保存可选 common skill 快照。`MANIFEST.json.common`
  除当前 `codexSkills` / `claudeSkills` 外,还累计保存 `removedSkills` tombstone:
  同步脚本在清空旧快照前读取上一次 manifest,把“旧版存在、新版消失”的名称加入
  tombstone,并移除重新出现在当前快照中的名称。首次迁移保留已知历史移除项
  `sub2api-account-json-fix`,让旧仓库升级时能精确清理残留。
- **改 0.6 强化 skill / Patch 时,先改源再同步**:`vendor/skill-garden/.trellis/0.6/`
  是 `npm run sync` 的真实输入。不要只改 `enhancements/0.6/` 或当前项目 `.agents/` /
  `.claude/`;否则下一次 sync 会把改动覆盖回源里的旧版本。正确顺序是:
  1. 改 `vendor/skill-garden/.trellis/0.6/.agents` / `.claude` / `overrides` 对应源文件;
  2. 运行 `npm run sync`;
  3. 用 `diff -u vendor/... enhancements/...` 验证发布快照与源一致;
  4. 必要时再同步当前项目已安装副本(如 `.agents/skills/...`、`.claude/skills/...`)。
- `overrides/patches/` 是 0.6 AI-facing 修改源，按 workflow/skills/hooks 目标组织；
  `overrides/bundles/` 只提供安装别名与 Patch 组合。英文协议正文只做语义级修改，不因项目
  中文文档规范整段翻译；用户实际输入的字面命令按产品约定保留原文。
- Patch 载荷继承目标文件的语言与风格:`selector.*` / `baseline-*` 必须保留目标原文，
  `content.*` 注入英文目标时使用英文、注入中文目标时使用中文。这些文件是最终内容或匹配材料，
  不按项目自有源码的维护性注释语言规则翻译。
- `overrides/compatibility.json` 与 `conflicts.json` 是共享只读 policy；vendor 与 `enhancements/0.6` 的整个 `overrides/` 文件树必须由维护者门禁逐字节一致。
- workflow hub/state、Update-Spec、Finish-Work 和 shared hook 都必须通过 Patch leaf 表达。
  需要共享正文时使用有序 `content.sources`，不得恢复独立 additive override 目录。
- Flower 自有 Codex/Claude 配置 Patch 位于 `src/patches/`，不进入 Skill-Garden 源；两类 catalog
  由 builtin Provider 交给 Plugin Patch Planner，在同一个 preflight/事务中执行。
- 随包发布靠 `package.json` 的 `files: ["bin","src","enhancements","README.md"]`。
- `vendor/skill-garden/compiled-targets/` 是 Skill-Garden 子仓内的 `all-platforms` canonical 维护审阅产物，不属于 `.trellis/` 离线安装快照；`npm run sync` 只读取 variant 源，不读取或复制该目录。vendor 子仓不进入 npm tarball，维护期 `patch-fixture.js` 也继续显式排除。
- **同步源 = git submodule `vendor/skill-garden`**(不在 `files` 白名单,不进 npm tarball)。
  `sync-enhancements.mjs` 三级路径解析:`SKILL_GARDEN_DIR` 环境变量 → `PKG_ROOT/vendor/skill-garden`
  → 都缺则 `exit(1)` 提示 `git submodule update --init --recursive`。
- **CI 幂等**:源 `.trellis` 缺失但 `enhancements/MANIFEST.json` 已存在(如 CI 未拉 submodule)→
  警告 `exit(0)` 沿用已提交快照;源与快照都无才 `exit(1)`。使 `prepublishOnly` 在"快照已提交、
  发布不拉 submodule"的 CI 场景不致失败。`syncedFrom` 记相对仓库根路径(避免绝对路径写进随包快照)。
- 发布前快照与 submodule pin 的一致性断言见 [Release & Publishing](./release-and-publishing.md)。

---

## Variants

- 三个变体:`old` / `0.5` / `0.6`(`src/constants.js` 的 `VARIANTS`)。
- 选择依据:目标项目 `.trellis/.version`(见 `variant.js` 的规则),或 `--variant` 强制覆盖变体。即使强制变体，真实 `version` 仍必须读取并进入兼容检查，不能返回空串。
- 差异:`0.6` 走 `overrides/patches/` + `overrides/bundles/` 统一 Patch catalog；
  `0.5` 走 `overrides/trellis-route.md`;`old` 无 overrides,workflow-state 文本来自
  `legacy-blocks.js` 常量。

---

## Apply Pipeline (`flower/skill-garden`)

`applyEnhancements(target, opts)` 只保留兼容参数、日志和返回结构，实际顺序固定：

1. 校验 `.trellis/`，选择 `old|0.5|0.6` 并保留真实 Trellis 版本。
2. 构造目标绑定的 `SkillGardenBuiltinProvider`；digest 绑定 Flower 版本、variant、去除
   `syncedAt` 的快照 manifest，以及当前 variant、common、Flower assets/lib/patches 和 builtin
   Plugin 的 canonical 内容；忽略 `__pycache__` / `.pyc`。
3. 通过 `PluginApplicationService.add/update()` 声明或重放 `flower/skill-garden`。
4. builtin 内容 adapter 按 `ENHANCEMENT_SKILL_TARGETS` 投影 skill/command，按原 alias 过滤
   变体脚本，并在全装时投影 Flower update hook。
5. 0.6 同时加载 Skill-Garden 与 Flower catalog，先做兼容线门禁，再做一次统一 Patch
   preflight；同 owner 内容/Patch 重叠只有最终 hash 相同时才合并。
6. old/0.5 在临时镜像中调用 workflow/Codex/Claude legacy 函数，收集最终文件与首次备份，
   目标项目本身不发生预事务写入。
7. 全装只刷新目标中已经启用的 common skill，并将其记录为 `shared` ownership；不会安装
   用户未启用的新 common skill，卸载不删除 shared 路径。
8. Plugin Transaction Writer 一次性写目标 mutation、`plugins.json`、lock 和最后的 state。
   旧 manifest 只读迁移并原字节保留，不再作为成功写链。

`init` 默认显式声明 builtin Plugin；`--enhance-only` 使用同一 Runtime。普通 `update` 只允许
skill-garden 以当前 Flower 精确版本刷新直接声明并重新选 variant，其它 Plugin lock-first 重放；
`--no-enhance` 冻结 skill-garden 的完整 lock 约束、capability grant 和 state，但仍重放外部 Plugin。
普通跨版本 `update --dry-run` 在项目外沙箱真实升级到捆绑模板并执行 Plugin dry-run，来源项目
零写入；同版本 dry-run 与 `--enhance-only --dry-run` 仍直接执行严格 Patch preflight，外部 Plugin
replay 不受影响。真实 update 的 Trellis + Plugin 链失败时由项目外受管快照补偿恢复。
独立 `plugin add` 不隐式声明 skill-garden。

---

## Scenario: Trellis 0.6.12 Platform Skill Projection

### 1. Scope / Trigger

- Trigger: Trellis 新增平台 flag、平台 Skill root 迁移，或修改 `PLATFORM_FLAGS`、
  `ENHANCEMENT_SKILL_TARGETS`、builtin 内容 adapter 和平台 stale cleanup。
- Scope: 只描述 Flower 工作流强化 Skill 的投影；平台原生 agent、command、hook 和 extension
  继续由 Trellis 模板拥有，Flower 不为无项目 hook 能力的平台伪造入口。

### 2. Signatures

```js
PLATFORM_FLAGS: string[]
ENHANCEMENT_SKILL_TARGETS: Array<{
  platform: string,
  platforms: string[],
  root: string,
  source: "agents" | "claude",
  detectPaths?: Record<string, string>,
}>
projectSkillGardenContent(options) -> ContentProjection
```

### 3. Contracts

- `PLATFORM_FLAGS` 必须包含 Trellis 当前 init 平台 flag；0.6.12 新增的
  `--omp`、`--grok`、`--kimi`、`--snow` 必须阻止 Flower 在用户已显式选平台时误补
  `--claude`。
- Codex、Gemini、Pi 与 Kimi 共享唯一 `.agents/skills` target，使用同一 `agents` canonical
  源并生成逐字节一致的 neutral 内容；不得按消费者重复生成同一路径。
- 共享物理 root 不能作为全部逻辑消费者的启用证据。自动检测必须通过 `detectPaths` 分别检查
  上游平台原生 `trellis-implement` 入口；Plugin 自己投影的 `trellis-check-all` 文件不能反向
  证明平台已启用，也不能创建 `.gemini`、`.pi` 或 `.kimi-code` 等缺失平台目录。
- Pi 不再写 `.pi/skills`。只有 state/hash 能证明是旧 Trellis/Flower 产物时才允许清理旧
  私有 root；用户修改内容必须保留并报告冲突。
- Kimi 的 `.kimi-code/skills` 只承载 Trellis 命令入口与 agent prompt，不是 Flower 工作流
  Skill root；Flower 不向该目录重复投影 shared Skill。
- OMP、Grok、Snow 的 Flower Skill root 分别为 `.omp/skills`、`.grok/skills`、
  `.snow/skills`。Grok/Kimi 没有项目 hook 时只使用 pull-based 入口；OMP/Snow/Pi 保留上游
  实际 extension/hook/agent 能力。
- 内容投影和 Patch target 只作用于目标中已经启用的平台 root；缺失平台返回
  `missing-target` 或不生成 mutation，不得创建整个平台目录。

### 4. Validation & Error Matrix

| 条件 | 结果 |
|---|---|
| 用户只传 `--grok` / `--kimi` / `--omp` / `--snow` | 识别为已选平台，不额外补 `--claude` |
| Codex、Gemini、Pi、Kimi 同时启用 | `.agents/skills` 只有一份目标 mutation，内容一致 |
| 只有 `.agents/skills` 与 Codex 原生入口 | 只选择 Codex；不创建 Gemini、Pi、Kimi 私有目录 |
| 旧 `.pi/skills` hash 匹配受管状态 | 迁移到共享 root 后安全清理旧副本 |
| 旧 `.pi/skills` 被用户修改 | 保留旧副本并报告冲突，不猜测删除 |
| Grok/Kimi 启用 | 投影对应 Skill，不创建不存在的项目 hook |
| 平台根目录未启用 | 跳过，不创建平台目录 |

### 5. Good / Base / Bad Cases

- Good: 同时启用 Codex、Pi 和 Kimi，只生成一套 `.agents/skills/trellis-*`，state 记录共享
  目标，三者读取完全相同的内容。
- Base: 仅启用 Claude，继续从 `claude` canonical 源投影 `.claude/skills`，其它平台目录不变。
- Bad: 为 Pi 保留 `.pi/skills` 的第二份 Flower Skill，导致 init/update 两条投影路径漂移。
- Bad: 把 shared Skill 同时写入 `.agents/skills` 与 `.kimi-code/skills`，混淆 Kimi 的共享
  Skill root 和私有 command/agent prompt root。

### 6. Tests Required

- 常量测试覆盖全部平台 flag，并验证四个新增 flag 不触发默认 `--claude`。
- 平台投影测试断言 Codex/Gemini/Pi/Kimi 共用一个 target，OMP/Grok/Snow 使用各自原生 root。
- 自动检测测试覆盖共享 root 只有部分消费者原生入口的场景，断言 state 只记录真实平台，且
  Check-All 投影不会创建未启用平台目录。
- stale cleanup 测试覆盖 Pi 旧副本 hash 匹配可删除、用户修改必须保留。
- 全平台 fixture、Patch conflict 和 compiled target 测试覆盖 21 个平台、全部 profile root，
  并验证缺失平台不创建目录。
- 重复 Plugin update 必须为零变化，vendor canonical、`enhancements/0.6`、compiled targets 和
  dogfood 最终内容保持一致。

### 7. Wrong vs Correct

#### Wrong

```js
{ platform: "pi", root: ".pi/skills", source: "agents" }
{ platform: "kimi", root: ".kimi-code/skills", source: "agents" }
```

#### Correct

```js
{
  platform: "codex-gemini-pi-kimi",
  platforms: ["codex", "gemini", "pi", "kimi"],
  root: ".agents/skills",
  source: "agents",
}
```

共享消费者合并成一个 target；Kimi 私有目录和 Pi extension/agent 继续由上游平台模板管理。

---

## Scenario: Codex Capability Config And Route Ownership

### 1. Scope / Trigger

- Trigger:修改 Codex `dispatch_mode` 配置、workflow-state hook banner/breadcrumb、平台 Patch adapter
  或 `trellis-route` 对 inline/subagent 的解释。
- Scope:`dispatch_mode` 只控制上游原生上下文注入/readiness 能力；本轮实现/check 执行位置始终由
  `trellis-route` runtime/prefs/当前选择决定。

### 2. Signatures

```yaml
codex:
  dispatch_mode: auto
```

```json
{
  "value": "auto",
  "commentSection": {
    "heading": "Codex (dispatch behavior)",
    "lines": ["#-------------------------------------------------------------------------------", "..."],
    "missing": "skip"
  }
}
```

```python
_resolve_codex_dispatch_mode(config: dict) -> str
_codex_mode_banner(config: dict) -> str
resolve_breadcrumb_key(status: str, platform: str | None, config: dict) -> str
```

### 3. Contracts

- Flower-managed config 规范化输出固定为 `codex.dispatch_mode: auto`，保留 `codex` 下其它 key 和
  文件其它顶层内容。`yaml-key` structured content 可同时替换上游注释段；注释段缺失且
  `missing=skip` 时只写 key，重复标题或分隔线损坏时 fail closed。
- hook 仍兼容读取 `auto|inline|sub-agent`：`sub-agent` 是 `auto` 别名，非法显式值沿用上游
  inline fallback。Flower 输出 auto 只保证 native SubagentStart context/JSONL readiness 可用，
  不默认选择 subagent，也不禁止 route 选择 inline。
- `<codex-mode>` 必须明确“trellis-route selects execution mode”；`workflow-state:*-inline` 只是
  上游兼容 breadcrumb 变体，不能作为 route evidence 或选项过滤器。
- `trellis-route` 不读取 banner 作为决策，只接受合法 runtime、个人 prefs、当前紧邻选择或已校验
  auto-loop 授权。subagent 被选中后才按 platform dispatch catalog 启动对应角色。
- Codex hook Patch 使用 `0.6.12` 上游完整函数块作为 exact selector；替换内容必须保留其它
  Skill-Garden conflict policy 需要的函数签名/规范化说明，组合 preflight 通过后才写盘。
- config 与 hook 的 route-capability 最终断言属于 Flower catalog，统一放在
  `src/patches/conflicts.json`；config policy 要求真实 `codex` 配置块为 `dispatch_mode: auto`，不能由
  注释示例误满足；可选注释段继续由 Patch 行为测试覆盖，route ownership 由必需的 hook policy
  断言。Skill-Garden 单 catalog policy 不得引用 Flower operation。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|---|---|
| config 缺少 codex block | 创建两级 key并写 auto |
| codex 使用 inline map 且含其它 key | 转成 block map，更新 dispatch_mode，保留其它 key |
| 上游注释段存在且唯一 | 原位替换为 capability/route ownership 文案 |
| 注释段缺失且 `missing=skip` | key 正常写入，不伪造整段注释位置 |
| hook selector 漂移或组合 conflict 缺少规范化契约 | preflight 失败，config/hook/state 零写入 |
| banner=auto 且 route=inline | 按 inline 执行；banner 不能覆盖 route |
| banner=inline 兼容态且 route=subagent | 按明确 route + catalog 执行，banner 不裁剪选项 |

### 5. Good / Base / Bad Cases

- Good:旧 config 为 `{ dispatch_mode: inline, other: true }`；更新后得到 auto + other，hook banner
  只声明 capability，随后用户仍可通过 route prefs 选择 inline。
- Base:注释段已被用户删除；`missing=skip` 只规范化 key，不在文件任意位置追加大段注释。
- Bad:把 auto 解释为“implement/check 默认派 subagent”，绕过 `trellis-route`。
- Bad:用字符串替换整份 config，丢失用户 `other`、channel 或 updateCheck 配置。

### 6. Tests Required

- `platform-patches.test.js` 覆盖 inline map、其它 key/注释保留、注释段缺失、重复应用零变化和
  hook capability 文案；正反断言旧默认 subagent/禁止 dispatch 语义不存在。
- 组合 fixture 必须同时加载 Skill-Garden 与 Flower catalog，证明 hook 最终内容满足双方 conflict
  assertion，并通过破坏 config/hook route-capability 文案的反例证明 Flower policy 会阻断；dogfood
  `update --enhance-only` 必须成功。
- route 静态/行为测试确认 banner、workflow inline state 和历史裸数字都不能单独形成 route decision。

### 7. Wrong vs Correct

#### Wrong

```text
dispatch_mode=auto -> default check-all-subagent
dispatch_mode=inline -> remove subagent option
```

#### Correct

```text
dispatch_mode -> native context/readiness capability
trellis-route -> current implement/check execution decision
platform-dispatch.json -> route-selected subagent launch contract
```

原因:能力、决策和平台启动是三个独立边界；混在 banner/config 中会让 route prefs、当前选择和
专用 agent 资格检查失效。

---

## Idempotency (必守)

叠加链路的每一步都要可重复执行:

- builtin adapter 对每个受管目录生成逐文件 write/remove mutation，不残留快照已删除文件。
- 精细 `--skills` 会合并既有 skill-garden state，未选择路径与 Patch provenance 原样保留。
- Patch 先 preflight 后进入事务；required selector/marker 漂移时目标与 `.flower/` 都不写，
  optional skip 必须进入结构化结果。完整规则见
  [Trellis Patch Engine](./trellis-patch-engine.md)。
- 0.6 changed 目标由 Patch Engine 调用 `preserveFirstBackup()`，备份到
  `.trellis/.backup-flower/<原相对路径>`；已存在则保留，保证备份永远是首次修改前原文。
  legacy marker/additive override 由 Patch 声明迁移，重复运行只产生 unchanged。
- `codex-tweaks`:`config.toml` 段头已注释/不存在则不再处理;`hooks.json` 合并后的
  内容一致则不写,避免覆盖 Trellis 上游 hook 参数。SessionStart 合并必须先从所有
  group 移除目标命令旧位置,再归位到目标 matcher group,避免旧版无 matcher group 与新版
  matcher group 同时触发;其它用户自定义 hooks 必须保留。
- `flower-assets` 只由全装投影，`.trellis/scripts/flower_update_hook.py` 进入 state ownership。
- common skill 只在目标精确目录已经存在时刷新；state 标为 `shared`，卸载与不可达清理跳过。
- shared hook Patch 只修改已存在平台目标，平台前置目录缺失时 `missing-target`；不得创建未启用
  平台。上游 hook 路径由 Plugin Patch provenance 记录。
- `claude-tweaks`:只追加缺失的 startup flower hook,重复运行不得重复;若历史版本把 flower
  hook 放到了 `clear` / `compact`,更新时必须移除这些非 startup 位置;若旧 hook 仍是
  8 秒 timeout,更新时必须迁移到 30 秒。

---

## Scenario: Common Skill Managed Tree Runtime Boundary

### 1. Scope / Trigger

- Trigger:common skill 会在启动后生成依赖缓存、session、profile、日志或其它运行时产物，且该
  skill 由 builtin `flower/skill-garden` 以 shared ownership 刷新。
- Scope:受管 skill 目录只保存发布快照中的静态文件；运行时数据迁到项目数据根。历史版本已经
  留在受管树内的精确已知路径可迁移兼容，但不放宽 Plugin canonical tree 的全局安全规则。

### 2. Signatures

目标树兼容扫描签名：

```js
listExistingFiles(directory, excludedPaths = [])
```

Craft RPA 运行时边界：

```text
CRAFT_RPA_SESSION_FILE=<CRAFT_RPA_HOME>/sessions/<ts>/session.jsonl
CRAFT_RPA_PROFILE_DIR=<CRAFT_RPA_HOME>/profile
CRAFT_RPA_PLAYWRIGHT_MODULE=<CRAFT_RPA_HOME>/runtime/recorder/node_modules/playwright
```

### 3. Contracts

- canonical Plugin 源树和所有未登记目标继续调用 `listCanonicalTreeFiles()`，任何软链或特殊文件
  都必须失败；兼容排除不能进入通用 canonical hash API。
- builtin common `craft-rpa` 只允许在已安装目标树跳过
  `recorder/node_modules`、`recorder/profile`、`recorder/session.jsonl`。匹配必须发生在 `lstat`
  之前，既不读取也不跟随旧软链；其它路径仍按原错误语义阻断。
- `run.sh start` 不得在受管 `recorder/` 内创建软链或安装依赖。package manifest 和
  `node_modules` 放在 `<CRAFT_RPA_HOME>/runtime/recorder/`，session/profile/module 路径通过上述
  环境变量显式传给 `launch.js` / `logger.js`。
- 旧 session/profile 软链只删除链接本身，真实目标数据必须保留；旧普通文件/目录沿用归档语义。
  `recorder/node_modules` 是可重建缓存，只允许按这个精确路径删除。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| 目标存在三个已登记 Craft RPA 运行时路径 | Plugin 重放继续，路径不进入 write/remove mutation |
| 已登记路径是指向项目数据根的软链 | 扫描不跟随软链，后续 `run.sh start` 只删除链接 |
| `recorder/unexpected-link` 或其它未登记软链 | 抛 `Plugin tree 不允许软链:<path>`，事务零写入 |
| common skill 根目录本身是软链或不是目录 | 保持 `PluginPathError` / `PluginIntegrityError` |
| runtime package manifest 变化或 Playwright 缺失 | 在数据根执行 `npm ci` 或 `npm install` 重建依赖 |
| 旧普通 session/profile 存在 | 归档到数据根，不静默覆盖或删除业务数据 |

### 5. Good/Base/Bad Cases

- Good:已安装 Craft RPA 留有旧 profile/session 软链和 `node_modules`；`flower-trellis update` 可重放，
  下一次 `run.sh start` 清理链接并在 `.craft-rpa/runtime/recorder` 重建依赖。
- Base:全新安装没有历史运行时产物；目标树走相同投影，运行数据从第一次启动起只写数据根。
- Bad:全局忽略所有 `node_modules` 或所有软链；这会掩盖未知 Plugin 漂移和路径逃逸风险。

### 6. Tests Required

- Plugin 集成测试创建三个历史运行时路径，断言重放成功、真实 profile/session 数据未变。
- 同一测试增加未登记软链，断言仍抛原 `Plugin tree 不允许软链` 错误。
- `run.sh` 测试使用 npm/node 替身，断言旧链接消失、真实目标保留、受管树无 `node_modules`，
  且三个环境变量都指向 `<CRAFT_RPA_HOME>` 下的精确路径。
- 发布前断言 Claude/Codex common skill、vendor 源和 `enhancements/common` 快照逐字节一致。

### 7. Wrong vs Correct

#### Wrong

```text
<managed-skill>/recorder/profile -> <project>/.craft-rpa/profile
<managed-skill>/recorder/node_modules/
```

#### Correct

```text
<managed-skill>/recorder/                 static release assets only
<project>/.craft-rpa/profile/             runtime profile
<project>/.craft-rpa/runtime/recorder/    runtime dependencies
```

原因:Plugin Runtime 可以继续严格校验 canonical tree，同时兼容清理历史版本留下的精确运行时路径，
不会因重放扫描跟随软链或把依赖缓存误当成发布载荷。

---

## Scenario: Native Workflow Gate Ownership

### 1. Scope / Trigger

- Trigger:新增、迁移或修改跨阶段 workflow Gate/Guard，尤其是同一规则同时出现在 Hub、Phase、
  workflow-state、Skill、Hook 或 helper 中时。
- Scope:使用现有 Patch Engine 将完整语义收敛到原生 owner；不新增 Gate Engine、平行状态机、
  gate catalog 或独立 provenance 协议。

### 2. Signatures

每个 Gate 的所有权记录固定为：

```text
Gate -> one primary policy owner -> zero or one runtime owner -> short Hub residue
```

最终产物检查使用现有 conflict rule：

```json
{
  "type": "required-literal | absent-literal | max-occurrences",
  "whenOperations": ["<owning-operation>"],
  "target": "<final-target>"
}
```

### 3. Contracts

- 每个 Gate 只能有一个 primary policy owner。完整语义、交互边界和异常处理必须位于真正执行
  该动作的 Phase、workflow-state、Skill 或 Hook；确定性状态检查可由一个 runtime helper 承担。
- Hub 只保留 owner 索引和必须常驻的跨阶段顺序，不得复制 helper schema、完整交互模板、错误矩阵、
  Git path 规则或 owning Skill 的步骤。
- workflow-state 只保留当前状态会改变下一动作的一跳门禁。它可以指向 owner，但不得成为第二份
  完整 policy owner。
- primary policy owner 必须位于真实请求或恢复入口。若完整规则只存在于更窄的下游 Skill，导致
  `inspect`、`direct_edit`、`workflow_action`、planning resume 或平台原生入口不会加载它，视为
  owner 不可达；不能用 owner 表或 marker 存在宣称能力已经保留。
- Project Knowledge Discovery 与 Active Task Scope Guard 的完整自然语言 policy 位于 workflow
  `Request Triage`；`trellis-before-dev`、brainstorm 和 active workflow-state 只保留回到该 owner
  的一跳引用。Task Progress Recovery 的读取 policy 位于 `trellis-continue`，`task_progress.py`
  负责确定性读取；`trellis-push` 只拥有业务 push 后的 progress 写入。
- 自然语言意图、需求清晰度和语义归属由 policy owner 判断；task 状态、route/task 匹配、runner
  action/profile、Git exact paths 和 progress schema 等确定事实才允许进入 runtime hard guard。
- 迁移必须通过目标导向 Patch 执行 `replace/remove/insert`。旧正文不能以“低优先级”“inactive”或
  “新规则覆盖旧规则”的形式保留，必须在最终文件中真实消失。
- `conflicts.json` 必须同时证明新 owner 的唯一签名存在、旧冲突签名缺失或出现次数为零；断言读取
  `plan.files[].next`，不得只检查 Patch 声明文件。
- Bundle/alias 必须包含其指向 owner 所需的 Patch 或 helper，避免精细安装得到只有指针、没有实现的
  不完整流程。operation ID 能原位迁移时保持稳定。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| 同一完整规则出现在两个 policy owner | owner coverage/去重测试失败，禁止发布 |
| Hub 只含 owner 索引和短顺序 | 允许，继续检查最终上下文预算 |
| Hub 或 state 仍包含旧完整 Gate heading/body | conflict assertion 失败，写盘前停止 |
| policy 判断被脚本硬编码为人工布尔 Gate 状态 | 设计不符合边界，退回 owning Skill/Phase |
| runtime helper 发现 task/route/action/schema 不匹配 | 返回稳定 blocker，目标文件和 Git 状态不变 |
| 精细 alias 包含 owner 指针但缺少 owning Patch/helper | Bundle 自包含测试失败 |
| owner 文字存在但真实 request/state/platform 入口不会加载 | reachability 测试失败，禁止发布 |
| 第二次应用仍修改 owner 或 Hub | 幂等测试失败 |

### 5. Good/Base/Bad Cases

- Good:Request Intent 完整规则位于 workflow `Request Triage`，`trellis-start` 只负责进入该 owner，
  `task_intent.py` 只执行已判定的 create/discard 安全边界。
- Good:Project Knowledge Discovery 与 Active Task Scope Guard 完整契约位于 `Request Triage`；
  no-task、planning、in-progress 和 before-dev 入口只保留一跳动作，`spec_router.py` 与
  `task_intent.py` 只负责确定性 helper 边界。
- Good:Task Progress Recovery 由 `trellis-continue` 在 Phase 判断前读取；`trellis-push` 继续只写
  progress，SessionStart/continue 不从 progress 推断 Phase、push mode 或 Git 编排。
- Base:某 Gate 原本已经由 `trellis-push` 或 `trellis-check-all` 完整拥有；迁移只删除 Hub 副本并
  增加 required/absent/max-occurrences 断言，不需要重写 owner。
- Bad:保留 Hub 全文，同时在 Skill 追加“以 Skill 为准”；两个版本仍会漂移，且高频上下文没有下降。
- Bad:为统一 13 个 Gate 新增 `gates.json` 和通用 controller；这会形成与 Trellis 原生 Phase/Skill
  平行的第二套控制面。

### 6. Tests Required

- 静态 owner matrix 覆盖全部 Gate，断言 primary policy owner 唯一、runtime owner 至多一个。
- 应用后的最终 workflow 必须只有一个 Hub marker；Hub 包含全部 owner 索引，但不包含旧 Gate heading
  和被禁止的完整规则签名。
- 对每个原生 owner 断言唯一 marker/heading/关键行为签名；对旧冲突正文使用
  `absent-literal` 或 `max-occurrences: 0`。
- JS/Python consumer 都从最终计划断言相同 owner、去重和 Bundle 自包含结果。
- reachability 场景必须覆盖 request intent、planning/in-progress 状态、continue recovery、
  implement return、direct push 及全部平台原生入口的真实先后顺序；只匹配 marker/关键词不构成通过。
- 运行 Patch conflict、strict context budget、源/快照一致性、完整场景矩阵和两次 dogfood；第二次
  Patch 修改数必须为 0。

### 7. Wrong vs Correct

#### Wrong

```text
Hub full Gate body + Skill full Gate body + "Hub wins" priority note
```

#### Correct

```text
Hub owner index -> owning Phase/Skill policy -> optional deterministic helper
```

原因:最终流程只有一个语义来源，helper 只阻断可证明的非法状态，Patch conflict 和上下文预算都能
对最终产物给出可执行的回归证据。

---

## Scenario: Trellis Meta Synchronization Gate

### 1. Scope / Trigger

- Trigger:修改 Skill-Garden 管理的 workflow、skill、hook、helper、Patch、Bundle、Plugin ownership、
  capability discovery、平台入口或定制路径，并准备完成任务、Check-All 或发布快照时。
- Scope:对 `trellis-meta` 做一次影响复核，判断稳定架构合同是否仍准确；不新增 runtime helper、
  meta manifest、长期状态或要求每次 owner 内部 SOP 变化都重写 meta。

### 2. Signatures

影响结论固定为:

```text
meta-impact: no-op | patch-required
```

判定关注的稳定合同固定为:

```text
owner identity/boundary
capability discovery path
authoring source and managed ownership
Plugin/Patch lifecycle and customization route
Bundle selection and platform distribution surface
```

`patch-required` 的作者源与验证链固定为:

```text
vendor/skill-garden/.trellis/0.6/overrides/patches/skills/trellis-meta/
  -> npm run sync
  -> compiled targets
  -> Flower dogfood
  -> final-output tests
```

### 3. Contracts

- 每项触发范围内的变更在完成前都必须执行影响复核，但复核不等于强制修改 meta。结论应写入当前
  task planning/check evidence，不新增第二套 catalog 或运行时状态。
- `no-op` 只在现有 meta 的 owner 指针、稳定职责边界、发现路径、作者源、管理模型、选择安装和平台
  分发描述仍准确时成立。复核必须读取最终 meta 与 owning capability，不能只根据文件名判断。
- owner 内部 SOP、交互模板、命令字段、重试预算或错误矩阵变化通常为 `no-op`；这些细节继续由
  owning skill/helper 持有，meta 不得复制第二份完整合同。
- owner 身份或边界迁移、能力发现入口变化、managed/project-local 分类变化、作者源变化、Plugin/Patch
  生命周期变化、Bundle 选择变化或受支持平台分发面变化必须判定为 `patch-required`。
- `patch-required` 必须修改 canonical Skill-Garden meta Patch 源；随后同步 snapshot、刷新 compiled
  targets、重放当前 dogfood，并验证各已启用平台最终语义。只改 `.agents`、`.claude`、
  `enhancements/0.6` 或 compiled target 都不构成完成。
- 若 meta 已用稳定 owner 类别和发现路径覆盖新行为，不得为了记录单个 feature 把其完整 SOP、状态结构
  或错误矩阵写入 meta。若新能力没有任何可发现 owner 路径，则不能用 `no-op` 掩盖架构缺口。
- Planning Brief 的显式预授权属于 `trellis-task-brief` 与 task-start brief guard 的内部交互合同；
  Planning handoff owner、边界和发现路径未变时，本次 meta 影响结论必须是 `no-op`。

### 4. Validation & Error Matrix

| 条件 | 结论 / 行为 |
|------|-------------|
| owner 内部 SOP 变化，现有 owner 指针与边界仍准确 | `no-op`，更新 owning capability/spec/tests，不复制到 meta |
| owner 身份、阶段归属或 guard 边界变化 | `patch-required`，更新 meta owner route 与最终断言 |
| 新增或移动 capability discovery 入口 | `patch-required`，更新发现路径并验证可达性 |
| authoring source、Plugin/Patch ownership 或 customization route 变化 | `patch-required` |
| Bundle alias、精细安装依赖或平台 target 集变化 | `patch-required`，验证选择范围和跨平台一致性 |
| 仅修改生成清单、lock hash 或 compiled plan，稳定合同未变 | 读取真实源确认后可为 `no-op`，不得仅凭生成文件判定 |
| 声称 `no-op`，但最终 meta 无法把行为路由到 owner | 复核失败，禁止完成 |
| 声称 `patch-required`，但只修改 dogfood/deployed meta | 作者源错误，禁止完成 |

### 5. Good/Base/Bad Cases

- Good:Task Brief 增加当前最终 Brief 的显式预授权；meta 已把 Planning handoff 指向
  `trellis-task-brief` 和 task-start brief guard，因此记录 `no-op`，详细预授权合同只留在 owner。
- Good:把 implement/check 执行 owner 从静态平台分支迁移到 `trellis-route`；更新 canonical meta Patch、
  sync、compiled targets、dogfood 和最终断言，记录 `patch-required`。
- Base:owner skill 只调整错误文案或内部 CLI 参数，稳定架构合同不变；复核最终 meta 后记录 `no-op`。
- Bad:每次 skill 文案变化都往 meta 追加一段摘要；meta 会变成第二份易漂移 SOP 集合。
- Bad:新增平台 target 或改变 Bundle alias 后仍记录 `no-op`，导致 meta 的分发与定制路径失真。

### 6. Tests Required

- code-spec 测试必须固定 `meta-impact: no-op | patch-required` 双态术语、五类稳定合同和 canonical
  Patch 作者源，防止规则退化成“所有变化都改 meta”或“从不改 meta”。
- meta 最终产物测试必须验证 Planning handoff 仍路由到 `trellis-task-brief` 与 task-start brief guard，
  同时不得包含 Brief 显式预授权的交互细节。
- owner/发现/所有权/Bundle/platform 变化的任务必须扩展对应 Patch final-output、选择安装、跨平台和
  compiled target 测试；`no-op` 场景至少要读取最终 meta 与 owner 证明路由仍准确。
- `patch-required` 继续执行 Patch conflict、源/快照一致性、compiled targets、dogfood 幂等、strict
  context budget 和完整测试；不得用单一文档字面量测试替代最终产物验证。

### 7. Wrong vs Correct

#### Wrong

```text
owner 内部 SOP 有变化 -> 无条件复制到 trellis-meta
```

#### Correct

```text
review stable meta contracts
  -> unchanged: meta-impact no-op; keep detail in owner
  -> changed: meta-impact patch-required; update canonical meta Patch and distribution evidence
```

原因:所有相关变更都经过复核，但只有稳定架构合同变化才修改 meta，既不会漏掉所有权/分发漂移，
也不会把 meta 扩张成 owner SOP 的重复副本。

---

## Scenario: Complex Repair Intent Routing

### 1. Scope / Trigger

- Trigger:修改 0.6 Request Intent Routing、`workflow-state:no_task`，或修复“设计反馈被当成修改
  授权”“已知精确回退仅因影响面被强制建任务”等误判。
- Scope:这里只定义 AI-facing 意图契约及其 Patch/测试归属，不新增关键词分类器，也不让
  `task_intent.py` 推断自然语言意图；分类必须基于完整当前请求、授权、确定性和副作用。

### 2. Signatures

意图分类集合固定为:

```text
discuss | inspect | direct_edit | task_plan | workflow_action
```

权威 Patch 入口固定为:

```text
workflow/intent-routing/request-triage
skills/trellis-start/no-task-routing
workflow/state-no-task
bundles/intent-routing.json
```

同步与验证入口固定为:

```bash
npm run sync
node --test test/js/apply-enhancements.test.js
python3 -m unittest discover -s test/python -p 'test_skill_garden_patches.py'
node scripts/check-ai-context-budget.mjs --strict
```

### 3. Contracts

- 询问看法、表达不适、否定方案或询问“应该怎样改”时使用 `discuss`；除非当前请求同时明确
  授权一个具体修改，否则不得把评价或方案讨论扩张成编辑授权。
- 仅要求查看、解释、验证或定位问题时使用 `inspect`，获得修复授权前不得编辑业务文件；只读
  结论本身也不能扩张授权。已经授权修复但范围未知时仍先 `inspect`，再根据实际 scope、risk
  和 side effects 重新分类。
- “允许修改”与“允许跳过任务规划”是两个独立判断。用户确认修复对象，只表示可以继续推进
  修复流程，不自动得到 `direct_edit` 结论。
- `direct_edit` 只适用于范围已知、有界、低风险、可逆、没有未决设计选择且验收简单的改动。
  权限/认证/数据范围/安全、数据库/迁移/发布/外部系统或范围未知仍是强 `task_plan` 边界。
- 共享契约、跨包或跨层、多入口一致性、配置、历史回归和系统性验证会提高证据、验证与回滚
  要求，但只是风险信号，不得仅凭这些影响面自动判定 `task_plan`。
- 精确回退或机械同步的已知修改，在行为、范围、副作用和验证方式均已确定时，仍可进入
  `direct_edit` 或匹配的 `workflow_action`；存在未决范围、方案或副作用时才升级为 `task_plan`。
- `fix item 1`、`change that`、`修一下`、`改一下` 等修复选择不是 no-task switch。只有当前请求
  明确表达 `直接做`、`不要任务` 等工作流指令时，才可覆盖自动 `task_plan`；新且无关的请求
  恢复自动推断。
- 命中 `task_plan` 只授权创建 planning task 并进入 `trellis-brainstorm`，不得越过 brief、
  `task.py start` 或 `trellis-route` 门禁直接实现。
- workflow `Request Triage` 保存完整权威语义；`trellis-start` 与 `workflow-state:no_task` 只保留
  一跳入口，Hub 只登记 owner。`task_intent.py` 继续只执行已经判定后的 create/discard。
- 修改必须从 `vendor/skill-garden/.trellis/0.6` 源 Patch 开始，经 `npm run sync` 生成
  `enhancements/0.6`，再应用到当前 dogfood workflow；禁止只改快照或最终安装副本。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| 用户只表达方案不适、否定或询问怎样改 | `discuss`，不编辑 |
| 用户只要求查明问题 | `inspect`，不编辑 |
| 用户授权修复但影响范围未知 | 先 `inspect`，得到证据后重新分类 |
| 已知有界、低风险、可逆、无未决设计且验证简单 | 可进入 `direct_edit` |
| 权限/数据范围、安全、数据库/迁移/发布/外部系统或范围未知 | 进入 `task_plan` |
| 共享契约、跨层、多入口、配置或历史回归 | 提高证据与验证要求；结合确定性判断，不自动进入 `task_plan` |
| 精确回退或机械同步且行为、范围、副作用、验证均确定 | 可进入 `direct_edit` 或匹配的 `workflow_action` |
| inspect 结论后用户说“修第 1 个”或“改一下” | 视为修复选择，不视为 no-task switch |
| 当前请求明确说“直接做”或“不要任务” | 可覆盖自动 `task_plan`，但不覆盖独立安全确认 |
| 命中 `task_plan` 后尚未完成 planning gate | 只能创建/完善任务，不得实现 |
| vendor 与 snapshot 或 dogfood 漂移 | 验证失败，禁止发布 |
| Phase summary 或 SessionStart 超过 review ceiling | strict budget 失败，先去重而非提高阈值 |

### 5. Good/Base/Bad Cases

- Good:用户说“这个方案不舒服，你觉得怎样改”；Agent 进入 `discuss`，给出判断但不修改文件。
- Good:用户要求“查并修复权限 BUG”；Agent 先只读定位，确认涉及权限边界和多入口后创建
  planning task，完成 brief/start/route 再实施。
- Base:用户要求精确回退一个已知提交中的指定 Patch；范围、副作用和验证方式均已确定，即使
  涉及 workflow skill 与生成快照，也可使用 `direct_edit` / `workflow_action` 并执行相应验证。
- Base:用户要求修复已定位的单文件文案错误；范围明确、低风险且验证简单，可使用
  `direct_edit`，不机械创建任务。
- Base:复杂修复已命中 `task_plan`，但用户在当前请求明确说“不要任务，直接做”；按显式流程
  覆盖继续，同时仍遵守生产、凭据、破坏性操作等独立安全边界。
- Bad:Agent 看到用户说“这个方案不太理想”，直接把设计反馈当成修复授权并编辑 workflow。
- Bad:Agent 只看到 `workflow`、`hook` 或“跨入口”关键词就自动创建任务，没有判断修改是否为
  范围与验证均确定的精确回退。
- Bad:为防止误判，把所有包含“修复”的请求机械升级为 `task_plan`，导致已知局部小改也必须建任务。

### 6. Tests Required

- JS apply 测试必须对应用后的最终 workflow 断言 `discuss` / `inspect` 授权边界、未知范围重分类、
  `direct_edit` 条件、强 task 边界、风险信号非自动升级、精确回退和显式覆盖语义；不得只搜索
  Patch 源文件。
- `task-intent` 与 `intent-routing` 两个精细安装 alias 都必须选择完整 Bundle，并在第二次应用后
  保持文件树不变。
- Python consumer 的真实 catalog preflight 必须从 `plan.files[].next` 断言相同最终 workflow
  语义，防止 JS/Python consumer 或快照漂移。
- `npm run sync` 后逐字节核对 vendor 与 `enhancements/0.6` 对应 Patch，并对当前 dogfood 重复
  应用两次；第二次 Patch 修改数必须为 0。
- 运行 `npm test`、Patch 冲突检查、默认及 strict AI context budget；新增文本不得通过调高
  target/review ceiling 掩盖重复内容。

### 7. Wrong vs Correct

#### Wrong

```text
用户说“这个方案不舒服” -> 推断为修改授权 -> 立即编辑
```

问题:把评价与方案讨论当成具体修改授权，没有先判断当前请求是否真的要求编辑。

#### Correct

```text
评价/询问方案 -> discuss
查看/定位原因 -> inspect
明确修改授权 -> 判断范围、设计、副作用与验证
             -> 已知有界且无未决设计: direct_edit / workflow_action
             -> 强安全边界或仍有未决问题: task_plan
```

原因:授权语义优先于领域关键词；影响面决定证据和验证强度，但只有真实未决范围、方案、副作用
或强安全边界才决定是否需要任务规划。

---

## Scenario: Stable Untracked Completion Chain

### 1. Scope / Trigger

- Trigger:无活动 task 的请求最终路由为 `direct_edit`，或修改 No-Task 的恢复、检查、规范更新、
  Push、纳管和多仓 workspace 证据行为。
- Scope:使用 session runtime 中的单一 untracked work item 衔接 Phase 2/3；不创建轻量 task，
  不复制 Check-All、Update-Spec、Push 或 task route 的完整 owner 逻辑。

### 2. Signatures

```bash
python3 ./.trellis/scripts/untracked_flow.py begin --summary "<summary>" --source <inferred|user-explicit>
python3 ./.trellis/scripts/untracked_flow.py prepare-edit --paths <path> [<path> ...]
python3 ./.trellis/scripts/untracked_flow.py record-validation --result <pass|fail|partial> --summary "<summary>"
python3 ./.trellis/scripts/untracked_flow.py advance --stage <check|spec|push>
python3 ./.trellis/scripts/untracked_flow.py record-check --result <pass|findings|partial|blocked> --summary "<summary>"
python3 ./.trellis/scripts/untracked_flow.py record-spec --result <no-op|written|needs-review> --summary "<summary>"
python3 ./.trellis/scripts/untracked_flow.py status [--verbose]
python3 ./.trellis/scripts/untracked_flow.py clear --reason <completed|abandoned|adopted|baseline-restored|invalidated>
python3 ./.trellis/scripts/task_intent.py adopt "<title>" --slug <slug>
```

session 字段固定为：

```json
{
  "untracked_flow": {
    "version": 1,
    "id": "uw-<id>",
    "mode": "direct_edit",
    "source": "inferred | user-explicit",
    "summary": "<summary>",
    "stage": "inspect | implement | check | spec | push",
    "baseline": {"version": 1, "repositories": [], "fingerprint": "<sha256>"},
    "scope": [],
    "preparedFingerprint": "<sha256> | null",
    "workspaceFingerprint": "<sha256> | null",
    "evidence": {}
  }
}
```

### 3. Contracts

- `direct_edit` 判定后立即 `begin`；首次写入和每个后续写入批次前必须 `prepare-edit`。首次
  baseline 只捕获一次，后续调用只能扩展 scope、回到 `implement` 并清除下游证据。
- 每个 session 最多一个事项。相同 summary 的 `begin` 幂等命中；不同事项在旧 workspace 仍有
  差异时返回 `active-work-conflict`。旧事项已回到原 baseline 时清理状态，不阻塞新事项。
- 仓库集合必须完整覆盖项目根仓、已初始化递归 submodule 和配置为 `git: true` 的独立 package。
  submodule 查询失败、package 不是独立仓库根或 Git 集成状态不可读时 fail closed，禁止用不完整
  fingerprint 继续修改。
- evidence 只在 `workspaceFingerprint` 匹配时有效。focused validation 后即使仍在 `implement`，
  下一次 `prepare-edit` 也必须先校验 fingerprint；不得把外部漂移吸收到新一轮 baseline。
- `status` 默认输出紧凑摘要；`status --verbose` 必须包含完整 `state`，供 Check-All、Update-Spec、
  Push 和 sub-agent 构造上下文，不允许 owner 直接读取 raw session JSON。
- untracked implement/check 每次只读取 `.trellis/.route-prefs.tmp`，不得读取或写入 task-scoped
  `route_decisions`。缺少偏好时仍走 `trellis-route` 的仅本次/保存默认选择。
- `adopt` 的 title 是位置参数。纳管必须保留 diff、原 baseline、阶段和 evidence，原子创建 planning
  task，失败时补偿新 task/session/parent，并继续保留原 untracked 状态。
- owner 路径固定为 Request Triage -> `workflow-state:untracked` / Phase 2/3 -> 对应 Skill/helper。
  owner 身份与 Bundle/平台分发变化使用 `meta-impact: patch-required`，更新 canonical meta Patch。

### 4. Validation & Error Matrix

| 条件 | 结果 |
|---|---|
| 当前 session 已绑定 task | `active-task-present`，不创建 untracked 状态 |
| 已有不同事项且 workspace 未恢复 | `active-work-conflict`，保留原状态和 dirty diff |
| 首次 `prepare-edit` 的任一 Git 仓库证据不可读 | 稳定 Git reason code，baseline 不写入 |
| focused validation 后 workspace 被其它来源修改 | `workspace-drift`，原 evidence 保留 |
| 已推进事项的 workspace 恢复原 baseline | `status=miss reason=baseline-restored` 并只清理当前字段 |
| 未通过 focused validation 就进入 check | `focused-validation-required` |
| Check-All/Update-Spec 前置证据缺失或 fingerprint 失效 | 阶段推进失败，不覆盖 runtime 其它字段 |
| adoption 任一步失败 | 删除本次新 task、恢复 session/parent、保留原 untracked 状态 |
| 重复 Plugin 应用 | helper、Patch、workflow、agent 和 meta 最终目标修改数为 0 |

### 5. Good/Base/Bad Cases

- Good:用户明确“不走 task”，实现并验证后说“下一步”；恢复同一 work id，进入 Check-All，
  不重新执行 task intent classification。
- Good:已验证修改后另一窗口改变独立 package；下一批 `prepare-edit` 返回 `workspace-drift`，不会
  把变化静默归入当前事项。
- Base:用户撤销事项的全部 workspace 变化后提出新修改；旧状态按 baseline 恢复规则清理，新请求
  重新 triage。
- Bad:只记录根仓 porcelain，忽略 submodule/package 查询失败后仍宣称 baseline 已捕获。
- Bad:把“走 Trellis 流程”解释为补建 task，或让 untracked 使用历史 task route decision。

### 6. Tests Required

- `test_untracked_flow.py` 覆盖单活跃事项、verbose status、首次 baseline、验证后漂移、baseline 恢复、
  阶段链、证据失效、跨 session、损坏 runtime 和原子写失败。
- `test_git_evidence.py` 覆盖 submodule 查询失败、`git: true` package 解析到父仓和 Git 集成状态
  不可读；断言稳定 reason code 且不返回不完整仓库集合。
- `test_task_intent.py` 使用位置 title 调用 adoption，覆盖成功元数据、diff 保留和各失败点补偿。
- 最终验证覆盖 fresh/upgrade/selective Bundle、全部平台 agent、SessionStart/per-turn hook、meta Patch、
  vendor/snapshot/compiled targets 一致性，以及第二次 dogfood 零变化。

### 7. Wrong vs Correct

#### Wrong

```text
direct edit 完成 -> 清除临时判断 -> “下一步”重新分类 -> 误建 task
```

#### Correct

```text
direct_edit -> begin(inspect) -> prepare-edit(immutable baseline) -> implement
            -> focused validation -> check -> spec -> push -> clear
```

原因:后续请求绑定可验证的 session 状态和多仓 fingerprint，流程推进不再依赖关键词或聊天记忆。

---

## Scenario: Planning Brief Review Gate

### 1. Scope / Trigger

- Trigger:修改 Phase 1.4、`trellis-brainstorm` planning handoff、`trellis-task-brief`、
  auto-loop planning start gate，或 `.trellis/scripts/task.py start` 的 `planning -> in_progress` 行为。
- Scope:交互式 planning 的 semantic readiness 与 brief review 由 workflow/Skill 负责；
  默认在完整展示 brief 后等待确认；当前对话中明确绑定最终 Brief 的预授权可作为窄例外。
  `task.py` 只校验可确定的文件状态。schema 2 auto-loop 使用绑定 planning/handoff hash 的 run manifest
  授权，不逐任务确认 brief；schema 1 outstanding action 继续按旧确认协议恢复。

### 2. Signatures

```bash
python3 ./.trellis/scripts/task.py start <task-dir>
```

```python
_validate_planning_brief(full_path, task_json_path) -> bool
```

```text
schema 2: review_planning_readiness(planning_sha256, ready|repairable|blocking)
          refresh_brief -> manifest(planning_sha256, handoff_sha256) -> start_task
schema 1: review_planning_readiness -> refresh_brief -> confirm_brief(handoff_sha256)
```

权威 planning artifacts 固定为实际存在的：

```text
prd.md | design.md | implement.md
```

`brief.md` 是从上述文件生成的派生交接视图，不是新的需求或设计权威源。

### 3. Contracts

- Phase 1.4 必须加载 `trellis-task-brief`，从最终 planning artifacts 刷新 `brief.md` 并在对话中
  完整展示。默认结束当前回合等待确认；只有用户明确把当前任务或最终 Brief 与“展示后直接开始、
  不用再次确认、视为已确认”绑定，且最终范围未变化时，才可同回合运行 `task.py start`。
- `trellis-brainstorm` 的 Quality Bar 只表示 planning artifacts 可进入最终 brief handoff；
  普通实现意图或任务创建授权不能复用为 planning review，也不能解释为 Brief 预授权。
- 预授权只取当前对话中仍明确适用于本任务的表达，不写 session runtime，也不扩展为跨会话、
  跨任务或永久偏好。范围扩大、存在未解决 Open Questions、新增高风险边界或用户撤回时失效。
- schema 2 auto-loop 在 `start_task` 前必须返回 `review_planning_readiness`，复核验收标准可测试、
  范围/非目标明确、关键决策收敛和仓库证据充分。结果绑定当前实际存在的 `prd.md` / `design.md` /
  `implement.md` 路径与内容 SHA-256；`repairable` 进入最多 3 轮 planning repair，`blocking` 只阻塞当前项。
- schema 2 readiness 为 ready 后，brief 缺失或早于任一权威 artifact 时返回 `refresh_brief`；刷新后
  runner 重算 planning/handoff hash，并在全队列 prepare 完成后写入 manifest revision。用户的 start
  指令已提供本 run 授权，因此不再返回逐任务 `confirm_brief`。
- schema 1 runtime 保持旧 action 兼容：`refresh_brief` 后仍返回 `confirm_brief`，确认绑定 planning
  artifacts 与 `brief.md` 的联合 SHA-256；不得把历史 run 自动迁移为 schema 2。
- `_validate_planning_brief()` 只对 `task.json.status == "planning"` 生效，并且必须在 active-task
  pointer、任务状态和 `after_start` hook 的任何写入或副作用之前执行。
- planning task 缺少 `brief.md`、读取任务状态失败、读取 artifact 元数据失败，或任一权威 artifact
  的 `st_mtime_ns` 严格大于 brief 时，校验返回 `False`，命令退出非零并给出刷新/review 指引。
- brief 与权威 artifact 时间相同视为未过期，避免文件系统时间粒度造成无意义阻断。
- 已经 `in_progress` 的历史任务允许在没有 brief 时通过 `task.py start` 重新绑定 session pointer；
  workflow-state 仍应提示读取三件套并建议回补，而不是从记忆生成未经 review 的 brief。
- 规则必须从 `vendor/skill-garden/.trellis/0.6` 的 Workflow/Skill/File Patch 修改，经
  `npm run sync` 生成发布快照，再应用到当前 dogfood；Hub、Phase、Skill 和 helper 只保留各自职责。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| planning task 缺少 `brief.md` | start 退出非零，状态/pointer/hook 不变，提示运行 `trellis-task-brief` |
| `prd.md`、`design.md` 或 `implement.md` 晚于 brief | start 退出非零并列出过期来源 |
| task/artifact 文件访问或解析失败 | 默认失败关闭，输出可恢复错误，不抛 traceback |
| 普通实现意图或任务创建授权 | 完整展示 brief 后等待后续确认 |
| 当前最终 Brief 有明确预授权且范围未变化 | 完整展示后允许同回合启动 |
| 范围扩大、Open Questions、高风险边界或用户撤回 | 预授权失效，回到默认确认路径 |
| brief 存在且不早于所有实际存在的权威 artifact | 允许现有 start 流程进入 `in_progress` |
| 历史任务已经是 `in_progress` 且没有 brief | 允许重新绑定，不批量强制迁移 |
| 无 session identity | 仍先执行 brief guard；通过后才进入既有 degraded mode |
| planning readiness 尚未绑定当前 artifacts | 返回 `review_planning_readiness`，不得按文件存在启动 |
| schema 2 readiness 为 repairable | 返回 `run_planning_repair`；最多 3 轮，修改后重新计算 artifact hash |
| schema 2 readiness 为 blocking/ambiguous | 以稳定 reason 阻塞当前项，独立后续任务继续 |
| schema 2 planning task 缺少/过期 brief | 返回 `refresh_brief`；成功后进入 manifest prepare，不等待逐任务确认 |
| schema 2 manifest 后 handoff 文件无授权变化 | 当前项以 `artifact-drift` 阻塞，不能沿用旧授权 |
| schema 1 brief 未确认或确认后 handoff 变化 | 等待/重新返回 `confirm_brief`，不得执行 `start_task` |
| 重复同步和 enhance-only apply | 第二次 Patch 修改数为 0，marker/provenance 不重复 |

### 5. Good/Base/Bad Cases

- Good:复杂任务同一回合完成 create 和三件套后直接调用 start；因为 brief 缺失，脚本在任何
  状态或 hook 副作用前阻断，AI 返回最终 brief handoff。
- Good:用户 review brief 后又修改 `design.md`；start 列出 `design.md` 为更新来源，要求刷新并
  重新 review。
- Good:用户明确说“最终 Brief 展示后直接开始，不用再问”；最终范围未变化且无未解决问题，
  Skill 完整展示 brief 后由主 workflow 同回合启动。
- Good:schema 2 auto-loop 对全队列完成内容绑定的 readiness review 和 brief 刷新，manifest 固化
  planning/handoff hash 后直接返回 `start_task`，运行阶段不再逐任务停顿。
- Base:轻量任务只有 `prd.md` 和更新后的 brief；校验通过，不机械要求不存在的 design/implement。
- Base:旧 `in_progress` 任务没有 brief；重新绑定成功，后续 workflow 建议回补。
- Bad:只在 `workflow-state:planning` 增加提示。该状态可能要到下一次用户输入才注入，同一回合
  create -> plan -> start 仍可绕过。
- Bad:schema 2 auto-loop 看到三件套/brief 文件存在就直接 start，或不生成 manifest 就把启动指令
  当成对任意后续内容的授权；这会绕过语义质量线和内容漂移保护。
- Bad:把“开始做吧”“可以创建任务”等普通意图视为 Brief 预授权，或把一次预授权保存为长期偏好。

### 6. Tests Required

- Python runtime 测试覆盖 create 后立即 start、brief 缺失、三种权威 artifact 任一过期、
  artifact `stat` 异常、fresh brief、历史 `in_progress` 重绑和无 session identity。
- auto-loop 测试覆盖 schema 2 readiness ready/repairable/blocking、planning repair 预算、brief 缺失/
  过期、manifest hash、合法 decision rebind 和无授权 artifact drift；schema 1 fixture 继续覆盖
  refresh 后等待确认、handoff hash 变化和确认后才能 start。
- 所有 guard 失败用例断言退出码非零、任务仍为 planning、`after_start` hook 未执行，并且不会
  覆盖 create 已建立的 planning pointer。
- JS/Python Patch consumer 都断言 Phase 1.4、Brainstorm readiness/handoff、task.py validator/guard
  的最终 marker 与语义；`.agents`、`.claude` 目标至少各覆盖一次。
- 文案契约测试必须覆盖默认等待、显式预授权同回合启动、普通意图不构成预授权，以及范围扩大、
  Open Questions 和高风险边界使预授权失效；同时断言没有新增 session helper 或 `task.py` 授权状态。
- Patch conflict policy 同时要求 handoff/readiness 两个 operation，并检查最终 workflow、skill、
  script 的唯一签名；selector/baseline 漂移继续保持全量预检零写入。
- 运行 `npm run sync`、enhance-only 二次幂等、`npm test`、Patch conflict、默认及 strict context
  budget，并逐字节比较 vendor 与 `enhancements/0.6/overrides`。

### 7. Wrong vs Correct

#### Wrong

```text
task.py create -> 写 prd/design/implement -> task.py start -> 开始实现
```

问题:planning state 的下一回合 breadcrumb 尚未注入，提示词门禁和用户 review 都被跳过。

#### Correct

```text
task.py create -> 完善最终 planning artifacts
               -> semantic readiness review(content-bound)
               -> trellis-task-brief -> 展示完整 brief
                  -> 默认:停止等待 -> 用户后续确认(content-bound)
                  -> 窄例外:当前最终 Brief 的显式预授权仍有效
               -> task.py start -> brief freshness guard -> in_progress
```

原因:workflow/skill 保留真实用户确认边界，脚本只验证缺失、过期和 I/O 失败这类确定事实；
三层职责互补且不会伪造确认状态。

---

## Scenario: Stale Task Pointer Intent Recovery

### 1. Scope / Trigger

- Trigger:shared per-turn workflow-state Hook 解析到 `ActiveTask.stale=true`,或 Codex / Claude
  SessionStart 发现 session runtime 指向不存在的任务目录。
- Scope:恢复流程只清理失效 pointer,不授权实现、编辑、任务创建或 `task.py start`。清理成功后,
  当前用户请求必须在同一轮重新进入既有 `no_task` Request Intent Routing。

### 2. Signatures

```text
workflow-state status = missing_task
shared hook stale result = (task_dir.name, "missing_task", active.source)
SessionStart stale status = MISSING TASK POINTER
cleanup command = python3 ./.trellis/scripts/task.py finish
```

Patch 与 Bundle 入口固定为:

```text
workflow/state-missing-task
hooks/inject-workflow-state/shared-runtime
hooks/codex-session-start/missing-task-routing
hooks/claude-session-start/missing-task-routing
bundles/intent-routing.json
```

### 3. Contracts

- shared Hook 必须把 `session`、`session-fallback` 等 stale 来源统一映射为固定状态
  `missing_task`;`source_type` 只保留为诊断来源,不得继续拼进 workflow-state 名称。
- `.trellis/workflow.md` 必须存在唯一 `[workflow-state:missing_task]` 权威正文,并明确:
  1. 先运行 `python3 ./.trellis/scripts/task.py finish`;
  2. 清理失败时报告并停止;
  3. 清理成功后同轮把当前请求视为 `no_task`;
  4. 完成分类前禁止编辑、创建/启动任务或归入已经失效的历史任务。
- `missing_task` state 只引用 `[workflow-state:no_task]` / Request Intent Routing,不得复制五类意图的
  完整判定规则。Hook 继续只读,不得自行修改 `.trellis/.runtime/sessions/`。
- `workflow/state-missing-task` Patch 必须同时修正 `clear_active_task()`:当显式 context key
  不可用、但 `resolve_active_task()` 已按“运行时目录中恰好一个 session 文件”返回
  `session-fallback` 时,使用该结果的真实 `context_key` 清理 pointer。存在多个 session 时继续
  拒绝猜测,不得批量删除或任选一个 session。
- `missing_task` 通过带 managed marker 的 `literal insert after` 加到唯一
  `[/workflow-state:no_task]` 后。Core `workflow-state` selector 只负责替换已有 body,不得为此
  新增平行注入器。
- shared runtime 局部 Patch 目标以 Trellis `SHARED_HOOKS_BY_PLATFORM` 的实际 per-turn
  能力为准:Claude、Codex、Gemini、Qoder、Copilot、CodeBuddy、Droid、Kiro、Trae、ZCode。
  Cursor 当前没有 per-turn workflow-state Hook,不进入目标。所有目标 `missing=skip`,不得创建
  未启用平台目录；每个 import/helper/main 分支必须独立声明 selector、baseline 和顺序关系。
- Codex / Claude 已有 SessionStart stale 分支必须与 per-turn state 保持一致;只替换已有入口,
  不为其它平台创建 SessionStart 文件。
- `intent-routing` Bundle 必须同时包含 `missing_task` workflow state、shared runtime 和 Codex/Claude
  SessionStart Patch,保证全装及 `task-intent` / `intent-routing` 精细安装都完整生效。
- 共享 Hook 不再使用 whole-file desired content。局部 replace/insert 必须以 Trellis `0.6.12`
  目标片段和已知旧 marker 为精确 baseline；未知用户改动继续返回 selector/baseline drift，
  不得用宽松覆盖换取升级成功。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| stale 来源为 `session` 或 `session-fallback` | 都输出 `status=missing_task` |
| workflow 缺 `missing_task` | 输出泛化 fallback,测试必须失败并阻止发布 |
| `task.py finish` 失败 | 报告失败并停止,不执行后续编辑或任务动作 |
| 清理成功 | 当前请求同轮按 `no_task` 分类,不再次机械询问用户下一步 |
| 平台 per-turn Hook 不存在 | `missing-target`,不创建目录或文件 |
| 目标是 `0.6.12` 上游片段或已知旧 marker | 局部 Patch 按稳定顺序收敛到当前 managed content |
| 目标含未知用户修改 | required selector/baseline drift,全量 preflight 零写入 |

### 5. Good/Base/Bad Cases

- Good:session runtime 指向已删除任务目录,shared Hook 输出 `missing_task`;AI 先运行
  `task.py finish`,成功后同轮把当前用户请求按 `no_task` 意图重新分类。
- Base:目标项目没有某个平台的 per-turn Hook 文件,Patch 返回 `missing-target`,不创建平台目录,
  其它已存在平台仍正常升级。
- Base:目标 Hook 等于 Trellis `0.6.12` 上游结构,各局部 Patch 依次命中并保留未触及的 ZCode、
  `no-trellis`、异常边界和其它上游能力。
- Bad:把 stale 来源拼成 `stale_session-fallback` workflow-state,导致 workflow 找不到正文并退化为
  `Refer to workflow.md for current step.`。
- Bad:`task.py finish` 成功后询问“下一步做什么”,或直接编辑文件,等于丢失当前用户请求的任务意图。

### 6. Tests Required

- Python Hook 行为测试覆盖 stale `session`、`session-fallback` 归一和权威 breadcrumb 加载;
  普通 `no_task`、planning、in_progress 模板输出保持不变。
- Python CLI 行为测试必须实际执行 `task.py finish`:唯一 `session-fallback` 被清理,多个 session
  保持不变且返回无当前任务,避免只验证提示文本而遗漏恢复动作。
- JS apply 测试覆盖 fresh apply、旧 marker 迁移、十个平台已有目标、缺平台 skip、
  Codex/Claude SessionStart、两个 intent alias、局部 Patch 顺序和第二次运行幂等。
- Python consumer 的真实 catalog preflight 必须断言 `task-intent` 选中完整 stale recovery Patch 集合。
- `npm run sync` 后核对 vendor、`enhancements/0.6`、当前 dogfood workflow/Hook 与 provenance;
  同时运行默认及 strict AI context budget,避免 stale state 复制长 `no_task` 正文。

### 7. Wrong vs Correct

#### Wrong

```python
return task_dir.name, f"stale_{active.source_type}", active.source
```

问题:把诊断来源写进 workflow-state 名称,会生成未声明的动态状态,让 AI 只拿到泛化 fallback。

#### Correct

```python
return task_dir.name, "missing_task", active.source
```

原因:`missing_task` 是固定伪状态;`active.source` 只作为诊断信息保留。workflow 能加载同一个恢复正文,
AI 清理 pointer 后也能继续按 `no_task` 处理当前请求。

---

## Scenario: AI-Facing Enhancement State Helpers

### 1. Scope / Trigger

- Trigger: 0.6 强化包需要在压缩后恢复 `trellis-route` 本轮选择,同时减少
  `workflow.md` / `workflow-state` 每轮注入的长规则。
- Scope: 任何需要 AI 高频读取的 workflow/state/skill 文案,如果包含本地状态读写、
  JSON / key-value 解析、严格优先级或可测试错误分支,都应拆成三层:
  高频 prompt 只写门禁和边界;skill 写流程和语义;随 skill 分发的脚本写确定性状态操作。

### 2. Signatures

随 skill 分发的 helper 必须提供窄命令接口,让正常路径只调用一次即可得到结构化结果:

```bash
python3 .agents/skills/trellis-route/scripts/route_state.py resolve --target <implement|check>
python3 .agents/skills/trellis-route/scripts/route_state.py resolve --target <implement|check> --verbose
python3 .agents/skills/trellis-route/scripts/route_state.py write --target <implement|check> --mode <mode> --source <trellis-route|numbered-fallback> [--save-pref]
python3 .agents/skills/trellis-route/scripts/route_state.py clear-pref --target <implement|check>
```

Claude 平台只安装 `.claude` 副本时,路径改为
`.claude/skills/trellis-route/scripts/route_state.py`。`.agents`、`.claude`、`enhancements/0.6`
和 `vendor/skill-garden/.trellis/0.6` 中的同名脚本必须保持一致。

### 3. Contracts

- 高频 `workflow.md` / `workflow-state`:
  - 只声明何时需要 route、什么不能算证据、必须加载 `trellis-route`、用户覆盖优先。
  - workflow hub 可用一句轻量提醒声明 compact summary、ordinary summary、SessionStart、
    replacement history、历史用户裸数字都不是 route evidence，并指向 `trellis-route`
    负责 numbered fallback 有效性；workflow-state 只保留面包屑级门禁，不重复裸数字细节。
  - 不内嵌 prefs 解析、runtime schema、fallback 选项、Python / awk 代码片段。
- `trellis-route/SKILL.md`:
  - 保留用户选项、mode 映射、轻量 check 逃生口、dispatch 指令和 helper 调用方式。
  - 明确 `1` / `2` / `3` / `4` 这类裸数字只可解释为当前可见上一条 assistant
    route 选项消息的紧邻回复；压缩摘要、历史消息、旧 target 的裸数字不得触发
    `write --source numbered-fallback`。
  - 不把机械 JSON 读写逻辑改写成 prompt 里的长代码块。
- `route_state.py`:
  - `resolve` 顺序固定为 session runtime `route_decisions.<target>` -> `.trellis/.route-prefs.tmp` -> `.trellis/.runtime/auto-loop/<run-id>.json` 临时授权。
  - prefs 或 auto-loop 授权命中时写回 `.trellis/.runtime/sessions/<context-key>.json`。
  - runtime 只保存原始合法来源:`trellis-route`、`numbered-fallback`、`route-prefs`、`auto-loop`。
  - `.runtime` 自身不是 `route_decision.source`;raw runtime JSON 必须经 helper / skill 校验后才可复用。
  - `--save-pref` 才写个人默认;不带该 flag 只写当前 session runtime。
  - 写入当前任务任一 target 的 runtime 决策前,必须清理同一 session 中属于其他任务的 `route_decisions`,避免任务切换后 check 阶段误复用上个任务的选择。
  - auto-loop 授权只在当前 session runtime 绑定 `current_auto_run`，或全局 auto-loop current 指针能指向唯一 running run 时生效；授权前还必须确认当前 task 位于该 run 的 pending/running 队列中。
  - 当前 session runtime 本身损坏，或 session 显式绑定的 run JSON 损坏/I/O 失败时必须返回结构化 miss 并失败关闭；不得继续读取 prefs、全局 pointer 或其它健康 run，也不得覆盖损坏文件。仅 missing/stale pointer 保留唯一 running run fallback。
  - 默认 stdout 必须保持精简:命中时返回 `status`、当前 `task`、`mode`、决策 `source`,以及可选 `origin`(`runtime` / `route-prefs` / `auto-loop`);未命中返回 `status` + `reason`。完整 `decision`、`path`、`context_key`、`pref_path`、`auto_path`、写回标记等诊断字段只在 `--verbose` 输出。

任务隔离属于 helper 的确定性逻辑,不要把 `task == current_task` 判断扩散到高频 workflow/state 文案里。workflow 维持轻量的 target-matched route 证据规则;`trellis-route` / `route_state.py` 负责 runtime 命中校验、写入清理和默认输出里的 `task` 诊断字段。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| 无 `.trellis/` | 返回 `status=miss/skipped`,不阻断外层流程 |
| 无 current task 或无 session context key | 返回 `no-current-task` / `no-session-context`,继续展示 route 选项 |
| session runtime 文件缺失 | 继续读 prefs/auto-loop 或展示选项 |
| session runtime JSON 损坏或 I/O 失败 | 返回 `session-runtime-corrupt/io_error`,不读 prefs/auto-loop,不覆盖原文件 |
| runtime 的 task / target / source / mode / scope 不匹配 | 返回 miss,不得复用 |
| 同一 session 切换到新任务并写入 implement/check 决策 | 写入前清理其他任务的 runtime route 决策;个人 prefs 不受影响 |
| prefs 缺失或值不合法 | 返回 miss,展示选项 |
| prefs 命中 | 返回 hit,写回 runtime,`origin=route-prefs`,`source=route-prefs` |
| auto-loop running run 存在合法 route_authorization,且当前 task 属于未完成队列 | 返回 hit,写回 runtime,`origin=auto-loop`,`source=auto-loop` |
| session 显式绑定的 auto run JSON 损坏/I/O 失败 | 返回 `session-auto-run-corrupt/io_error`,不得 fallback 到其它 run |
| auto-loop 无绑定 run / 非唯一 running run / mode 不合法 | 返回 miss,展示选项 |
| 用户明确重选 / 临时改 / 清除默认 | 忽略 runtime 和 prefs,重新进入 route 选项 |
| compact 后只剩历史裸数字 `1` 和新的 check 选项摘要 | 不得写入 check route；必须重新展示当前 target 选项并等待紧邻回复 |

### 5. Good/Base/Bad Cases

- Good: 压缩后当前上下文没有 `route_decision`;`resolve --target implement` 命中 runtime,
  输出合法 `task` / `mode` / `source`,agent 直接复用,不重复问用户;需要诊断再加 `--verbose`。
- Base: runtime miss 但 `.route-prefs.tmp` 有 `implement=inline`;`resolve` 返回
  `origin=route-prefs`,`source=route-prefs` 并写回 runtime,后续同 session 直接 runtime hit。
- Base: runtime 和 prefs 都 miss,但当前 session 的 `current_auto_run` 指向 running auto-loop state,且 `route_authorization.implement=subagent`;`resolve` 返回 `origin=auto-loop`,`source=auto-loop` 并写回 runtime。
- Base: session 绑定 run 已 stopped 或缺失,项目中只有一个健康 running run 且包含当前 task;忽略 stale pointer 后允许 fallback。
- Bad: compact summary 里只有“用户选过 inline”;workflow 不得把它当 route 证据,
  必须读取 `trellis-route` 并由 helper 校验 runtime / prefs。
- Bad: implement 阶段用户曾紧邻回复 `1`;后续 check route miss 并发生 compact,
  恢复上下文里出现旧 `1` 和 check 选项摘要时,不得把旧 `1` 当作 check 的
  `numbered-fallback`,也不得写入 `check-all-inline`。
- Bad: 同一 session 里任务 A 的 `route_decisions.check` 还在 runtime 中;切到任务 B 后不得把它当任务 B 的 check 证据。写入任务 B 任一路由时应清理任务 A 的 runtime route 决策。
- Bad: session 绑定的 `auto-bad.json` 已截断,项目中另有 `auto-good.json`;不得把损坏绑定视为 missing 并套用 `auto-good` 授权。

### 6. Tests Required

- 静态检查:
  - `git diff --check`
  - helper 脚本 `python3 -m py_compile <script>`
  - 多份 skill/script 副本用 `cmp -s` 或等价方式确认一致。
- 行为检查:
  - 清空 `route_decisions` 但保留 session 文件其他字段,验证 prefs hit 会写回 runtime。
  - 第二次 `resolve` 验证 runtime 优先。
  - `write` 不带 `--save-pref` 时验证 `.route-prefs.tmp` 不变。
  - 同一 session 从任务 A 切到任务 B 后,写入任务 B 的 implement 决策会清理任务 A 的 check 决策;随后 `resolve --target check` 对任务 B 返回 miss,除非存在个人 check 默认。
  - `write --save-pref` 验证只更新当前 target 并保留另一个 target。
  - `clear-pref --target check` 验证只清 check 默认。
  - prefs miss 时,当前 session 绑定 `current_auto_run` 且 auto-loop state 有合法授权,验证 `resolve` 命中 auto-loop 并写回 runtime。
  - session 绑定 run 损坏且存在其它健康 run 时,验证 `resolve` 返回 `session-auto-run-corrupt` 且不写 runtime。
  - auto-loop run 不包含当前 task 或队列项已 completed 时,验证授权 miss。
  - `.route-prefs.tmp` 存在时,验证个人偏好优先于 auto-loop 授权。
  - auto-loop running run 不唯一或 mode 不合法时,验证返回 miss 且不写 runtime。
  - prompt/workflow 回归:compact summary、ordinary summary、replacement history 或历史裸数字
    不能作为当前 target 的 numbered fallback；只有紧邻当前 route 选项消息的用户回复才有效。
- 同步检查:
  - 先改 `vendor/skill-garden/.trellis/0.6`,再 `npm run sync`。
  - 确认 `enhancements/0.6` 和当前 dogfood `.agents` / `.claude` 副本未漂移。

### 7. Wrong vs Correct

#### Wrong

```markdown
At every route boundary, parse .trellis/.route-prefs.tmp with awk, inspect
.trellis/.runtime/sessions/*.json manually, and if the compact summary says
"inline" then reuse it.
```

问题:高频注入塞入机械解析细节,模型可能绕过 task/target/source/mode 校验,也会把普通压缩摘要误当证据。

#### Correct

```markdown
At each route boundary, reuse only an explicit target-matched route_decision in
current context; otherwise load trellis-route. trellis-route calls:

python3 .agents/skills/trellis-route/scripts/route_state.py resolve --target implement
```

原因:prompt 保留边界,skill 保留语义,脚本负责 task 校验和跨任务 runtime 清理;压缩恢复稳定,每轮 token 也更低。

## Scenario: Pre-Check Feedback Hold

### 1. Scope / Trigger

- Trigger: Phase 2.1 首次实现必须自动进入 Check-All,但首次检查后的连续产品/UI/交互/
  业务调整需要暂缓下一次完整检查,且压缩或 resume 后不能遗忘最终检查。
- Scope:只调整进入 Phase 2.2 之前的交互决策。Interactive Post-Check Stop Gate、
  Check-All audit-only/collect-all、`CHK-*` 修复重检和 auto-loop runner action 均保持不变。

### 2. Signatures

随 0.6 `scripts/` 分发平台无关 helper:

```bash
python3 ./.trellis/scripts/pre_check_state.py status [--verbose]
python3 ./.trellis/scripts/pre_check_state.py hold --source <user-explicit|follow-up-edit> [--verbose]
python3 ./.trellis/scripts/pre_check_state.py clear [--verbose]
```

Runtime 只增加当前 session 文件中的可选字段:

```json
{
  "pre_check_preference": {
    "version": 1,
    "task": ".trellis/tasks/<task>",
    "mode": "hold",
    "source": "user-explicit | follow-up-edit",
    "updated_at": "<UTC ISO-8601>"
  }
}
```

### 3. Contracts

- 默认行为:
  - 任务首次完成实现和定向验证后,用户未明确暂缓时必须在同一流程进入
    `trellis-route(target=check)`;不得把 Check-All 表述为可选下一步并提前结束。
  - 用户当前消息明确“先不检查”时可覆盖默认,写入 `user-explicit` hold。
  - 首次 Check-All 执行后的第一条追加修改在编辑前写入 `follow-up-edit` hold,无论检查是
    干净通过还是报告了问题;
    不等待第二轮修改,不持久化修改次数。
- hold 是软偏好:
  - 只持久化 `hold`,字段缺失即默认检查;当前消息最新明确意图始终优先。
  - 暂缓期间完成修改和定向验证后停在 Phase 2.2 前,固定输出简短陈述式引导:
    “你可以继续提修改；准备检查时，使用 check-all，也可以直接说‘下一步’或‘可以检查了’。”不得机械提问或使用
    “收口”等不自然表述。
  - `check-all`、“下一步”“可以检查了”“提交”“部署”或等价继续语义先 clear 再进入检查/后续流程。
  - Check-All 开始后清除 hold;Check-All 问题修复及重检不再进入 Pre-Check gate。
- session 隔离:
  - helper 必须同时校验 `resolve_context_key()` 的直接 context key、当前 active task 和
    preference task。不得用 unique-session fallback 让新 AI session 继承旧 hold。
  - 同一 session/window 的 compact 和 resume 继续命中;不同 context key、任务不匹配、
    完成/归档后 session 清理均忽略或清除旧状态。
  - JSON 写入保留 `current_task`、route、auto-loop 等其它字段,使用同目录临时文件、
    flush/fsync 和 `os.replace`;损坏或 I/O 错误不得覆盖原文件。
- 上下文预算:
  - workflow hub/state 只保存短边界和一跳动作;完整优先级放 Phase 2.1 walkthrough/helper。
  - Codex/Claude SessionStart 通过 helper 的只读 API 恢复。无匹配 hold 时零动态行;
    命中时只追加 `Pre-check: deferred for current task; latest user intent may override.`。
- auto-loop:
  - validated runner 的 `run_implement -> run_check_all`、`run_fix -> run_recheck` 不读取 hold。
  - `trellis-auto-loop` start/resume 前静默调用 `pre_check_state.py clear`;miss/task mismatch
    是 no-op,损坏状态只记录诊断,不得阻断 runner 或增加确认卡点。
  - auto-loop 运行中的显式暂缓使用 runner blocked/retry,不写交互 hold。
- 分发:
  - 真实源先改 `vendor/skill-garden/.trellis/0.6`,再 `npm run sync` 生成快照并应用 dogfood。
  - `copyScriptAssets` 的 `workflow-enhancement`、`task-intent`、`intent-routing`、
    `auto-loop`、`auto-loop-runner`、`trellis-auto-loop` 选择性安装必须携带 helper。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| 首次实现,无显式暂缓/hold | 自动进入 Check-All |
| 当前消息明确暂缓 | 写入 `user-explicit`,停在 Phase 2.2 前并引导 |
| 首次检查后的第一条追加修改 | 编辑前写入 `follow-up-edit`;本轮只做定向验证 |
| 当前消息明确继续/提交/部署 | clear 后立即进入检查或后续流程 |
| 同 context key compact/resume | `status=hit`,SessionStart 注入一行 |
| 新 context key,但仅有一个旧 session 文件 | 不接受 fallback hold,不注入 |
| preference task 与 current task 不同 | `status=miss reason=task-mismatch`,不删除其它任务证据 |
| runtime missing/无 hold | `status=miss`,默认检查 |
| runtime corrupt/I/O error | `status=error`,不覆盖;SessionStart 省略提示并默认检查 |
| auto-loop start/resume 有陈旧 hold | 静默 clear 后 runner 正常推进 |

### 5. Good/Base/Bad Cases

- Good:首次实现通过定向测试后主 agent 直接进入 Check-All;不会像可选建议一样停住。
- Good:第一次 Check-All 执行后,即使报告了待确认问题,用户提出第一处视觉调整时 AI 仍先写
  `follow-up-edit` hold,
  修改并定向验证后提示可以继续改,也可说“下一步”进入检查。
- Good:上述修改过程中发生 compact;同一 session 的 SessionStart 只增加一行提示;
  用户随后说“可以检查了”,AI clear 并进入 Phase 2.2。
- Base:用户第一次实现时明确“先不走 check”;写 `user-explicit` 后正常停在检查前。
- Base:新 AI session 只能通过 active-task unique fallback 看见旧任务;helper 因 direct context key
  不匹配忽略旧 hold,恢复默认检查行为。
- Bad:每轮追加修改都立即跑完整 Check-All并同步三件套,造成重复成本和反馈延迟。
- Bad:把 hold 写入 `task.json` 或长期配置,导致新 session 和其他开发者继承个人交互节奏。
- Bad:auto-loop 读取 hold 并等待用户说“继续”,破坏 runner outstanding action 权威。
- Bad:暂缓完成后询问“是否收口并检查”,把软偏好变成每轮机械选择题。

### 6. Tests Required

- helper 单测覆盖 runtime missing、hold/status、clear、其它 runtime 字段保留、非法 source、
  task mismatch、同 session 恢复、不同 context key 不继承、损坏/I/O 文件不覆盖和写入失败。
- Codex/Claude 真实 SessionStart hook 测试覆盖匹配 hold 单行注入、无 hold 零动态行、
  新 session 不继承唯一旧 session hold。
- Patch/安装测试覆盖双平台 marker、helper 全装 manifest、选择性 workflow/auto-loop alias、
  二次应用幂等和 vendor/snapshot/dogfood 一致。
- 静态回归断言 auto-loop skill 在 start/resume 前 clear,runner 源不读取 pre-check 状态,
  workflow 首次实现默认进入 check 且 Post-Check gate 保持不变。
- 运行 `npm test`、`node scripts/check-ai-context-budget.mjs`、
  `node scripts/check-ai-context-budget.mjs --strict`、Python/JS 语法检查和 `git diff --check`。

### 7. Wrong vs Correct

#### Wrong

```markdown
Implementation is done. Ask the user whether to run Check-All. Persist defer=true
in task.json so future sessions keep waiting.
```

问题:首次实现可能提前结束,硬状态跨 session 泄漏,并把每轮反馈变成机械确认。

#### Correct

```markdown
First implementation defaults to Check-All. After Check-All has run once,
persist only a session-scoped hold for follow-up edits, whether the check passed
cleanly or reported findings; latest user intent and validated auto-loop override it.
```

原因:默认流程完整,高频反馈成本低,压缩可恢复,同时不会把暂缓偏好固化成长期锁。

## Scenario: Audit-Only Check-All

### 1. Scope / Trigger

- Trigger: 0.6 强化包需要让普通、轻量、全面、最终、提交前和 auto-loop 检查都进入
  Check-All,由真实任务、diff、风险和运行上下文智能选择 light/full 深度,同时保持
  audit-only collect-all 和稳定 `CHK-*` 修复循环。
- Scope: `trellis-check-all/SKILL.md` 定义深度策略、检查、报告、修复和 disposition;
  `trellis-route/SKILL.md`、`references/platform-dispatch.json` 与 `route_state.py` 只决定
  inline/subagent 执行位置和平台启动目标;`trellis-check` 是 workspace-write 自修角色，不能成为
  顶层轻量逃生口、Check-All fallback 或统一检查意图的接收者。

### 2. Signatures

check route 只允许以下两个执行位置 mode:

```text
route_decision.target = check
route_decision.mode = check-all-inline | check-all-subagent
```

平台启动目录固定为：

```json
{
  "schemaVersion": 1,
  "platforms": [{
    "id": "codex",
    "implement": { "eligible": true, "target": ".codex/agents/trellis-implement.toml", "launch": "..." },
    "checkAll": {
      "eligible": true,
      "target": ".codex/agents/trellis-check-all.toml",
      "format": "codex-toml",
      "launch": "...",
      "skillPath": ".agents/skills/trellis-check-all/SKILL.md",
      "verification": "read-only-sandbox"
    },
    "inlineOnlyReason": null
  }]
}
```

每次 Check-All 必须产生可审计画像:

```yaml
check_profile:
  context: interactive | auto-loop
  requested_depth: auto | light | full
  effective_depth: light | full
  confidence: high | fallback-full | escalated
  reasons: [string]
```

`route_state.py` 读取历史 runtime / CLI mode 时只做兼容归一化:

```text
check-inline   -> check-all-inline
check-subagent -> check-all-subagent
```

归一化后的 decision 必须只暴露 canonical mode,不得重新 dispatch 顶层 `trellis-check`。

统一问题记录必须包含固定字段:

```text
ID: CHK-001, CHK-002, ...
严重度: P0 | P1 | P2
标题 / 来源 / 证据 / 影响 / 建议 / 位置 / 验证
```

普通模式的修复选择只允许在完整报告末尾出现一次:

```text
修复全部
修复 CHK-001,CHK-003
仅保留报告
```

### 3. Contracts

- 检查阶段必须只读。允许读取文件、搜索和运行无业务写入副作用的 lint、typecheck、
  测试;禁止编辑代码、配置、测试或任务规格。
- 所有用户可见 check 入口都调用 Check-All。`trellis-route(target=check)` 只决定执行位置,
  用户说 light/full 不创建新的 route mode。
- requested depth 优先使用当前请求内最后一次明确表达:`简单检查` / `轻量检查` /
  `light check` 表示 light;`全面检查` / `全量检查` / `最终检查` / `提交前检查` /
  `full check` 表示 full;其次读取 validated auto-loop action,否则为 auto。单独说
  `check` / `check-all` 只表示进入统一入口。
- effective depth 决策顺序固定:requested full -> full;命中 hard-full -> full;
  requested light 且无 hard-full -> light;requested auto 且高置信满足 light eligibility -> light;
  其它情况 fallback full,不得机械询问用户。
- hard-full 至少包括复杂三件套完整映射、跨层/跨仓/submodule、公共 API/CLI、schema/
  持久化/缓存、迁移/历史数据、权限/安全/资金、并发/状态机/回滚、workflow/skill/hook
  注入、安装/升级/发布/push 控制面、已有 full `CHK-*` 重检和未知影响面。
- light 只有在变更可完整归属、单一局部行为、无 hard-full、引用与回归路径可穷举、
  有定向验证且不在 full 修复链时成立。执行中发现强风险只允许单向升级 full。
- 高置信 light 通过正式满足 Phase 2.2 门禁;未执行维度必须标记 `N/A`,不得伪装成 full。
- 执行顺序固定为三件套实现 -> 实现假设 -> 完整性与规范。普通实现偏差、lint/typecheck/
  测试失败和假设错误都进入统一问题集合,继续其它独立且可安全执行的检查。
- 只有业务/规划冲突导致无法判断、已知问题使后续前提失效、或验证可能产生破坏性/
  外部副作用时,才允许提前阻塞。阻塞结果仍须报告已完成范围和统一问题 ID。
- 局部文案、普通配置值、局部样式或单点条件修改可以走快速路径;未命中 API、组件上下文、
  历史数据、跨层数据流等 Trigger 的维度必须标记 `N/A`,不得展开无关检查。
- 问题 ID 首次分配后在同一修复/重检循环保持稳定;同根因的多个位置合并为一个问题,
  新根因使用下一个 ID。报告按严重度排序,但不重排 ID。
- 报告顺序固定为总体摘要、维度结果、问题清单、未覆盖与风险、修复批次。无问题时省略
  问题清单和修复操作;有问题时只在末尾询问一次修复范围,不得附带 commit/push 计划。
- 用户确认修复后,批量修复所选问题并复用当前任务合法 implement route;不存在时重新进入
  `trellis-route(target=implement)`。定向验证后复用当前 check route 执行 Check-All 重检。
- `references/platform-dispatch.json` 是平台启动契约唯一事实源，必须覆盖上游 `0.6.12` 的 21 个
  稳定平台 ID。route skill 不维护第二张 Markdown 平台表；内容投影和闭包测试必须读取同一目录。
- `check-all-subagent` 只允许 catalog 当前平台条目声明的专用 audit-only `trellis-check-all` 角色。
  目标文件存在不等于 host 已发现；运行时还要确认当前 host 暴露对应 launcher。目标缺失、host
  未发现、`eligible=false` 或 verification 不成立时阻塞并让用户重选 inline，禁止通用 agent、
  `trellis-check` 或静默 inline fallback。
- 专用角色只能读取本地 `trellis-check-all`、运行无写入验证并返回 profile、`CHK-*`、`DOC-*`、
  blocked checks 和 residual risk。其平台格式必须显式只读：Codex `sandbox_mode=read-only`、
  Kiro/Reasonix/Snow/Kimi 等使用各自 allowlist/frontmatter；Markdown 平台正文仍保留相同硬边界。
- 内容投影只为 Plugin Runtime 已选择或项目中已存在 root 的 eligible 平台写专用角色，并始终写
  `.trellis/agents/check-all.md`。Reasonix/Kimi 的 skill-as-agent 可覆盖同一目标，但引用文件必须
  一并投影；未启用平台不得因 catalog 全量存在而创建目录。
- 所有既有 workspace-write `trellis-check` 副本和 channel `check` 必须带 Check-All Intent Guard：
  收到 Check-All/full/unified/pre-commit unified 意图时停止、不写文件，并指向专用角色。
- Check-All 开始时默认 interactive;只有 runner `status` / `next` 验证 running、task 和
  outstanding check action 后才使用 auto-loop context,不得相信摘要或 raw runtime。
- interactive 默认在标准报告后停止。若触发本轮完成链的最新用户消息已明确请求普通 push
  或用户主动 `commit-only`,则只在整体通过、0 问题、无阻塞、无部分验证且无待用户接受的
  实质剩余风险时,报告后同轮进入 Update-Spec;其它结果仍停止。validated auto-loop 不展示普通
  修复选择:有问题 `record failed`,真正产品/权限/生产副作用/破坏性边界 `record blocked`,
  无问题 `record ok`;随后立即 `next`。subagent 只返回报告和 profile,主会话负责分流或 `record + next`。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| 工作区范围内无变更 | 提示无可检查变更并终止,不生成空问题清单 |
| 无 `prd.md` | 三件套实现标记 `N/A`,继续其它适用维度 |
| auto 且高置信局部低风险 | effective light;只追踪受影响条目、引用点、必要回归和定向验证 |
| requested light 命中 hard-full | effective full,confidence escalated,记录升级原因 |
| 无法高置信判断 | fallback full,不询问深度 |
| light 执行中发现影响面扩大 | 单向升级 full,补齐所有适用维度 |
| 历史 runtime mode 为 `check-inline` | 归一为 `check-all-inline`,可复用但不直达 trellis-check |
| 某个 lint/typecheck/test 失败 | 记录命令、退出状态和关键错误,继续其它独立验证 |
| 缺少历史数据或运行环境证据 | 标记 `部分验证` 或 `阻塞`,不得标记通过 |
| 规划冲突导致无法判断正确行为 | 输出统一阻塞报告,只询问解除阻塞所需的业务决策 |
| 验证可能修改生产数据或调用有副作用外部系统 | 不执行,标记阻塞或未覆盖风险 |
| 用户选择部分 `CHK-*` | 只批量修复选中 ID,未选问题保留在重检结果 |
| subagent 只有自修复型 `trellis-check` agent | 禁止 dispatch,让用户改选 `check-all-inline` |
| catalog target 存在但 host 未发现 launcher | fail closed,让用户重选 inline,不得声称 subagent 已执行 |
| 当前平台 `checkAll.eligible=false` | 展示 `inlineOnlyReason`,只允许用户显式选择 inline |
| workspace-write `trellis-check` 收到统一检查意图 | Intent Guard 停止且零写入,指向专用 `trellis-check-all` |
| 普通 interactive Check-All 无问题 | 报告画像、通过和剩余风险,指向 Phase 3.3/3.4,停止等待 |
| direct Git + Check-All 严格通过 | 展示同一标准报告,同轮进入 Update-Spec;不生成专用摘要或 Git 计划 |
| direct Git + findings/blocked/部分验证/实质风险 | 展示标准报告并停止,不运行 Update-Spec或生成 Git 计划 |
| validated auto-loop Check-All 完成 | 写回 effective depth/result/reason 并立即 next |

### 5. Good/Base/Bad Cases

- Good: 用户先说轻量检查、后改为最终检查;以最后一次表达选择 full,完成三个适用维度。
- Good: 两个验证命令和一个规划对照分别发现问题;Check-All 完成其余安全检查后输出
  `CHK-001` 至 `CHK-003`,用户回复“修复全部”,实现阶段一次修复并统一重检。
- Base: 只改一处 UI 文案且可穷举引用;auto 选择 light,API/历史数据/跨层维度标记
  `N/A`,定向验证通过后正式满足检查门禁。
- Base: 旧 runtime 保存 `check-subagent`;helper 输出 canonical `check-all-subagent`,
  后续仍执行 audit-only Check-All。
- Base: subagent 返回标准只读报告;主会话负责展示清单并询问一次修复范围,subagent 不修改文件。
- Base: 项目只启用 Codex 和 Claude;投影只新增两个原生专用 agent 与 channel `check-all`,不创建
  Gemini/Kiro 等未启用 root。
- Bad: 第一个测试失败后立即问“要不要修”,导致后续 lint、规划和跨层问题未被发现。
- Bad: 用户明确轻量检查后 route 直接 dispatch `trellis-check`,绕过 hard-full 升级和画像。
- Bad: auto-loop 检查结束后套用 interactive stop gate,等待用户说“继续”。
- Bad: `trellis-route` 找不到专用 check-all agent 时改用带自修复语义的 `trellis-check` agent。
- Bad: route skill 和内容投影各维护一张平台表,新增平台后 target/launch/format 只更新一侧。
- Bad: 报告问题后直接生成 commit message、暂存范围或 push 确认。

### 6. Tests Required

- 静态检查 `trellis-check-all` 的 `.agents` / `.claude` 源副本一致,并确认包含
  requested/effective profile、hard-full、light eligibility、稳定 `CHK-*`、Auto-Loop Return Gate
  先于 Interactive Post-Check Stop Gate。
- 静态检查 `trellis-route` 不再把 `check-all-subagent` fallback 到
  `Agent({subagent_type: "trellis-check"})`,且 dispatch prompt 第一行包含当前任务路径。
- catalog 测试必须断言 schema、21 个稳定平台 ID、eligible target 唯一性、inline-only reason、
  runtime alias 和 17 个专用 Check-All target 的闭包；不得只断言静态数组长度。
- 对所有 eligible 平台生成并解析对应 agent 格式，断言目标只读、正文一致、引用存在；再与
  `0.6.12` full compiled target 的原生 platform roots 做闭包校验。
- 投影测试覆盖显式 platform selection、已有 root 探测、无 root Claude fallback、Reasonix/Kimi
  skill-as-agent 覆盖，以及未启用平台零创建。
- conflict/最终产物测试至少断言 Codex、一个 Markdown 平台和 channel 的 workspace-write
  `trellis-check` 都包含 Check-All Intent Guard。
- 测试 `route_state.py` 把 `check-inline/check-subagent` 归一为 canonical mode,原 decision
  输入不被原地篡改,resolve 后 runtime 可升级为 canonical 值。
- `npm run sync` 后用 `cmp -s` 确认 vendor 源、`enhancements/0.6` 快照和当前 dogfood
  `.agents` / `.claude` 副本一致;确认 `old` / `0.5` 无漂移。
- 快速路径场景断言未命中 Trigger 的维度为 `N/A`,不会展开无关检查。
- collect-all 场景断言多个独立失败被完整收集,报告只出现一次修复范围选择,检查阶段文件无变化。
- 修复/重检场景断言原问题 ID 保持稳定,修复复用 implement route,重检复用 check route。
- 深度场景覆盖 auto light、显式 full、显式 light 命中 hard-full、fallback full、执行中升级,
  以及 full 修复/blocked retry 不降级。
- disposition 静态/行为测试覆盖 interactive stop 和 validated auto-loop `record + next`。
- subagent 场景至少做静态契约检查;平台有兼容 audit-only subagent 时再执行真实 dispatch 冒烟。

### 7. Wrong vs Correct

#### Wrong

```markdown
Run trellis-check. When any check fails, fix it immediately, ask whether to
continue, and use the trellis-check agent as the check-all subagent fallback.
```

问题:检查范围在第一个失败处被打断,工作区在用户确认前被修改,subagent 路径也可能绕过
Check-All 的统一问题模型和只读边界。

#### Correct

```markdown
Route every check intent through Check-All, derive an auditable light/full
profile from intent and risk, run every applicable safe read-only dimension,
then either stop once for interactive scope selection or return record + next
to the validated auto-loop runner.
```

原因:检查深度不再与执行位置耦合;用户先看到完整风险面再一次决策,auto-loop 则保持连续推进;
inline/subagent、修复和重检仍服从 Trellis 既有路由与阶段边界。

## Scenario: Project Knowledge Discovery Helper

### 1. Scope / Trigger

- Trigger: 0.6 强化包需要让 AI 在“项目局部知识可能影响做法”的决策边界主动
  发现项目 SOP / 经验 / 标准流程,但不能为每个 SOP 新增一个 Skill,也不能把
  纯问答、只读查看、打开本地工具或轻量编辑都变成检索流程。
- Scope:workflow `Request Triage` 保存完整触发、查询和读取契约，`spec_router.py` 是随 0.6
  `scripts/` 分发的通用发现器；`trellis-before-dev`、brainstorm 与 workflow-state 只保留一跳
  owner 指针。目标项目自己的 `.trellis/spec/**/*.md`(含 `spec/guides/**/*.md`)保存具体
  SOP / spec / thinking guide。

### 2. Signatures

```bash
python3 ./.trellis/scripts/spec_router.py "<short query describing the intended action>"
python3 ./.trellis/scripts/spec_router.py --limit 3 "<short query describing the intended action>"
python3 ./.trellis/scripts/spec_router.py --json "<short query describing the intended action>"
```

`copy-scripts.js` 必须让 `spec_router.py` 在全装时铺到目标 `.trellis/scripts/`,并让
`--skills workflow-enhancement` / `spec-router` / `project-knowledge` /
`knowledge-router` 精细安装也带上该脚本,避免 workflow 提示存在但脚本缺失。

### 3. Contracts

- 查询参数是“意图动作短查询”,不是机械复制用户原文。AI 应结合当前请求、即将执行的
  命令、涉及文件/系统、package/layer 和领域词构造查询。
- 发现动作位于所有请求都会经过的 `Request Triage` 决策边界；只要项目局部 SOP/约定可能改变
  正确做法，`inspect`、`direct_edit`、`task_plan` 与项目特有 `workflow_action` 都不能绕过。
  同一用户意图、workflow phase 或决策边界只运行一次，后续 Skill 消费已命中的证据。
- no-task workflow action 只有在用户明确命名 Trellis capability 或请求与该 capability 精确匹配时
  才直接加载；一般 release/publish/deploy 请求先发现项目 SOP，不能按单个关键词误路由到
  `trellis-release` 等更窄能力。
- 扫描范围固定为目标项目 `.trellis/spec/**/*.md`,其中 `.trellis/spec/guides/**/*.md`
  是共享 thinking guide 层,必须保留真实路径参与匹配。
- Markdown 可选声明简单 frontmatter:`kind` / `triggers` / `load` / `priority`。
  只支持 `key: value` 与 `key:` 后接 `- item`;不要引入 YAML 依赖。该能力只作
  向后兼容,不要推广为主路由机制,也不要要求项目为每份 spec 维护 `triggers`。
- 主路由机制是非侵入式文档结构:路径/文件名、H1-H3 标题、`.trellis/spec/**/index.md`
  中指向具体文档的链接文本与同一行描述、正文样本。已有 path / 标题 / index / trigger
  锚点的文件候选继续使用正文前缀样本；没有文件锚点时，只能使用单个最佳章节的直接正文
  样本形成候选，不得跨章节拼接零散弱证据。没有 frontmatter 的文件必须仍可参与检索。
- 路径匹配只使用 `.trellis/spec/` 内的相对路径,不要让公共前缀
  `.trellis/spec` 参与打分;否则查询里的 `spec` 会命中所有文档。
- 查询、路径、标题、index 描述、正文样本都必须 token 化后用 token set 匹配;
  禁止把 `token in text` 这类任意子串命中作为有效匹配依据。英文路径里的
  `/`、`-`、`_`、`.` 等分隔符应产生独立 token;中文连续文本用有限 n-gram
  保留 `发版` 命中 `发版流程` 这类能力。
- 默认候选要偏保守:最多返回 3 条。候选必须具备强锚点或足够强的组合证据:
  路径/标题/index 描述命中非弱词 token,或正文样本命中足够多非弱词 token。
  仅少量正文命中不能成为高置信候选。
- 弱匹配计数要过滤项目知识路由自身和轻量操作的高频泛词,例如 `project`、
  `context`、`read`、`matched`、`spec`、`workflow`、`to`、`flow`、`commit`、
  `changes`、`documentation`、`readme`、`typo`;它们可以出现在 reason 中,
  但不能凑成强匹配。
- 标题匹配应扫描完整 Markdown 标题；章节解析只识别 fence 外的 H1-H3 ATX 标题，并保留
  原文件 1-based 行号。章节范围从当前标题延伸到下一个同级或更高级标题前；章节正文样本从
  当前标题下一行开始，到下一个任意标题前，不能把标题 token 再计为正文证据，也不能让父章节
  吸收子章节的零散正文证据。
- `Tests Required`、validation matrix、Good/Base/Bad cases、Wrong vs Correct 等测试、验证和
  示例章节的正文不得参与文件或章节路由，避免规范中的负例关键词反向召回整份文档；其标题
  仍可参与明确查询。带编号标题应先去除编号再判断。已有文件锚点继续使用前缀证据时，必须在
  原 `MAX_BODY_CHARS` 字符窗口内遮蔽这些章节正文，不得通过删除正文把更靠后的内容拉入前缀。
- 默认输出保留候选路径、kind、score、confidence、load、priority、reason 和 action 的现有字段，
  新增 `load_strategy: full | sections | outline` 与 `sections`；不输出完整 spec 或章节正文。
  `sections` 条目包含 heading、start_line、end_line、score、confidence、estimated_bytes。
- 文件 UTF-8 字节数不超过 12 KiB 时使用 `full`。长文档存在可靠章节时使用 `sections`，最多
  选择 2 个互不重叠章节且估算总量不超过 12 KiB；没有可靠章节、单个相关章节超预算或全部
  章节无法装入预算时使用 `outline`。H1 文档标题只负责文件召回，存在 H2/H3 时不能让所有
  子章节自动相关。
- workflow 对 high-confidence 匹配按 `load_strategy` 消费：`full` 读取全文，`sections` 只读取
  列出的行号范围，`outline` 先检查标题再读取相关范围；只有选中上下文不足时才逐步扩展。
  medium-confidence 仅在 path / heading / index description / reason 明确相关时采用同一计划。
- 无 `.trellis/`、无 `.trellis/spec/`、读取失败或无匹配都不阻断流程;输出
  “No relevant project SOP/spec matched. Continue with the normal workflow.”
- `trellis-before-dev` 只能提示返回 `Request Triage` owner 并消费匹配结果，不得维护更窄的触发矩阵。
  brainstorm/workflow-state 同样只保留短指针，不复制查询构造、置信度读取或跳过条件。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| 查询命中 frontmatter `triggers` | 作为向后兼容信号参与加权并列出 matched triggers,但不要求新文档维护 triggers |
| 查询命中文件路径 / 标题 / index 描述 / 正文 | 按确定性分数和 confidence 排序,默认最多返回 3 条 |
| 相关文件不超过 12 KiB | 输出 `load_strategy: full`，不额外列出章节 |
| 长文档后半部分存在可靠的小章节 | 输出 `load_strategy: sections` 和原文件行号范围，总量不超过 12 KiB |
| 长文档只有文件锚点、相关章节超预算或无法可靠定位 | 输出 `load_strategy: outline`，先检查标题再按范围读取，不默认全文加载 |
| 父子章节同时命中 | 选择证据更强、更具体且范围更小的非重叠章节，最多 2 个 |
| 查询词分散在多个无关章节 | 不得聚合成正文候选或章节计划 |
| 查询词只出现在测试矩阵或 Good/Bad 负例正文 | 不得反向召回整份规范 |
| 文件已有单个路径锚点，额外查询词只出现在 `Tests Required` 正文 | 保留合法路径锚点的 medium 结果；负例正文不得进入 reason 或把候选提升为 high |
| 同一 token 同时出现在章节标题与查询中 | 只计为标题证据，不得再计入正文命中阈值 |
| 仅命中正文普通词或弱词且未达到强匹配阈值 | 视为无匹配,避免无关查询误报 |
| 查询只命中 `.trellis/spec` 公共路径前缀 | 不算路径命中 |
| 查询命中 `to` / `flow` / `commit` / `changes` 等泛词 | 不得仅凭这些词返回候选 |
| 查询 guides 相关意图 | 返回 `.trellis/spec/guides/**/*.md` 真实路径 |
| no-task 一般 beta/release/publish 意图 | 先运行 discovery 并读取命中 SOP，再决定准确 capability |
| non-trivial inspect/direct_edit 可能受项目约定影响 | 仍在 Request Triage 运行 discovery，不因意图类型跳过 |
| index.md 链接描述命中具体文档 | 给被链接的具体文档加权;index 本身不应挤掉更具体候选 |
| Markdown 无 frontmatter | 退化到路径 / 标题 / 正文轻量匹配 |
| frontmatter 不完整或不是简单 YAML | 忽略复杂部分,继续扫描正文 |
| 无 `.trellis/` 或 `.trellis/spec/` | 返回无匹配提示,退出码 0 |

### 5. Good/Base/Bad Cases

- Good: 用户准备发版,AI 查询 `beta release publish tag changelog`,返回
  `.trellis/spec/.../release-and-publishing.md`,且 `confidence: high`；长文档只列出相关章节
  行号并使用 `action: read matched sections before acting; expand only if needed`，然后先读局部
  SOP 再执行命令。
- Good: 小于 12 KiB 的相关文档输出 `load_strategy: full`，保留全文读取的简单路径。
- Good: 长文档仅通过路径召回、没有可靠章节时输出 `outline`，AI 先检查标题而不是读取全文。
- Good: 用户要求非平凡 inspect/direct edit，Request Triage 在选择做法前运行 discovery；随后
  before-dev 只复用已读规范，不重复执行更窄版本。
- Good: 用户提到跨层/复用经验,AI 查询 `cross layer reuse thinking guide`,返回
  `.trellis/spec/guides/cross-layer-thinking-guide.md` 和 code reuse guide。
- Base: 项目没有 frontmatter,仍可通过文件名、标题、index 描述和正文关键词命中。
- Bad: 普通绘图请求 `draw architecture diagram visualize flow` 只因 `flow` 返回 CLI
  spec;应过滤为无匹配。
- Bad: `commit push changes to beta branch` 只因 `to` / `changes` 返回 thinking guide
  或 directory structure;应过滤为无匹配。
- Bad: `edit README documentation typo small change` 只因 `documentation` 返回模块规范;
  应过滤为无匹配。
- Bad: 把具体公司 SOP 复制进 skill-garden;项目私有知识只能留在目标项目 `.trellis/spec/`。

### 6. Tests Required

- `python3 -m py_compile vendor/skill-garden/.trellis/0.6/scripts/spec_router.py`
- `python3 -m py_compile enhancements/0.6/scripts/spec_router.py`
- `python3 -m py_compile .trellis/scripts/spec_router.py`
- `python3 -m unittest discover -s test/python -p 'test_spec_router.py'`
- 章节测试覆盖 frontmatter 原始行号、fenced code 伪标题、H1 文档标题隔离、父子范围去重、
  最多 2 个章节和 12 KiB 总预算。
- 加载策略测试覆盖小文件 `full`、后半段相关章节 `sections`、只有文件锚点或章节超预算时
  `outline`，并断言输出不包含正文。
- 路由回归测试覆盖单章节后半段正文可召回、跨章节弱证据不得聚合、测试/验证/示例章节正文
  不得反向召回；已有路径锚点时也不得由负例正文提升置信度。
- 章节评分测试必须断言标题 token 不会再次计入正文命中，并覆盖单标题命中加单正文命中仍为
  medium 的边界。
- 查询发版意图,断言返回 release SOP。
- 查询 guides 意图,断言返回 `.trellis/spec/guides/` 下文档。
- 查询无关意图,断言返回无匹配提示,至少覆盖:
  - `open IntelliJ IDEA for current project local tool launch`
  - `edit README documentation typo small change`
  - `draw architecture diagram visualize flow`
  - `commit push changes to beta branch`
- 查询输出必须保留旧 JSON 字段，并包含 `load_strategy` 和 `sections`；action 必须同时反映
  confidence 与加载策略。
- `npm run sync` 后用 `cmp -s` 确认源、`enhancements/0.6`、dogfood 副本一致。
- 用临时目标跑 `--skills workflow-enhancement`,确认同时铺设 workflow 覆写和
  `.trellis/scripts/spec_router.py`。
- 可达性测试覆盖 no-task beta release、non-trivial inspect/direct_edit、planning/in-progress
  active-task state，断言 discovery 位于 capability routing、artifact ownership 和编辑之前。

### 7. Wrong vs Correct

#### Wrong

```markdown
Create one new skill for each SOP, ask every spec file to maintain
frontmatter triggers, or ask the model to remember to search all spec files by
itself.
```

问题:Skill 数量膨胀,frontmatter triggers 会漂移成第二套机器索引,且依赖模型记忆时
下次仍可能忘记 SOP 存在。

#### Correct

```markdown
Workflow says when to run discovery and how to consume `load_strategy`;
`.trellis/scripts/spec_router.py` returns candidate SOP/spec paths plus bounded
section ranges from natural document structure (path/title/index/body), while
project-specific SOP content stays in `.trellis/spec/`.
```

原因:高频提示保持短小,发现和局部加载逻辑可测试,项目私有内容不进入 skill-garden,
spec 文档不需要额外维护一套 triggers,长文档也不再默认整份进入上下文。

## Scenario: Auto Loop Unattended Runner

### 1. Scope / Trigger

- Trigger:0.6 `trellis-auto-loop` 接收一次用户启动授权，对显式任务队列完成全量 prepare，
  再无人值守推进到本地 `commit-only` 终态。
- Scope:`auto_loop.py` 负责 schema、manifest、依赖、dirty baseline、预算和 action 状态机；
  `trellis-auto-loop/SKILL.md` 负责语义边界与 action 调度；`decision_log.py` 保存可审计 AI 决策；
  `trellis-push` 独占动态多仓执行链、确定性生成和逐步 Git 安全预检；`trellis-route`、Check-All
  和 `trellis-finish-work` 继续拥有各自完整流程，runner 不执行 Git 或生成命令。

### 2. Signatures

```bash
python3 ./.trellis/scripts/auto_loop.py start \
  --tasks <task> [<task> ...] \
  [--depends-on <dependent>=<dependency>] \
  --profile commit-only \
  [--check-depth auto|light|full] \
  [--route-implement inline|subagent] \
  [--route-check check-all-inline|check-all-subagent]
python3 ./.trellis/scripts/auto_loop.py next [--run-id <run-id>] [--verbose]
python3 ./.trellis/scripts/auto_loop.py record \
  [--task <task>] --action <action> --result <ok|failed|blocked> \
  [--owned-dirty <task>=<repository>::<path>] \
  [--protected-retained <repository>::<path>] \
  [--doc-remediation-file <repository>::<path>] \
  [--files <repository>::<path> ...] \
  [--retained-files <repository>::<path> ...] \
  [--commit <primary-or-last>] \
  [--repo-commit <repository>::<hash> ...] \
  [--commit-message <message>] [...]
python3 ./.trellis/scripts/auto_loop.py decide \
  --task <task> --topic <topic> --option <option> [--option <option> ...] \
  --choice <choice> --summary <summary> --risk low|medium \
  --confidence low|medium|high [--requirement <id>] [--file <repository>::<path>]
python3 ./.trellis/scripts/auto_loop.py retry-blocked [--run-id <run-id>] [--task <task>] [--check-depth auto|light|full] [--route-implement inline|subagent] [--route-check check-all-inline|check-all-subagent] [--all] [--verbose]
python3 ./.trellis/scripts/auto_loop.py status [--run-id <run-id>] [--verbose]
python3 ./.trellis/scripts/auto_loop.py stop --reason "<reason>"

python3 ./.trellis/scripts/decision_log.py status --task <task> --json
python3 ./.trellis/scripts/decision_log.py review \
  --task <task> --verdict accepted|changes-requested \
  [--decision-id <DEC-id>] [--notes <text>]
```

`copy-scripts.js` 必须让 `auto_loop.py` 和 `decision_log.py` 在全装时铺到目标
`.trellis/scripts/`。选择性 `trellis-auto-loop` 与 `trellis-finish-work` 都必须携带
`decision_log.py` 和 archive decision guard，不能只安装 Skill 指针。

### 3. Contracts

- 新 run 写 `schema_version=2`，状态固定为 `preparing -> awaiting_input|running -> completed|completed_with_blocked|globally_blocked|stopped`。schema 1 只兼容读取和恢复既有 action，不自动迁移或降级写回。
- 用户发出 start 指令即授权本次 `commit-only` run。prepare 生成追加式 manifest revision，绑定原始/执行顺序、依赖、profile、route、check depth、repository baseline 及每项 planning/handoff hash；prepare 完成后不得二次确认 manifest。
- prepare 必须扫描全部显式任务后才进入 running。任务状态只允许 `planning|in_progress`；staged、Git conflict、merge/rebase/cherry-pick/revert 等未完成集成在 runtime 创建前全局阻断。
- implement/check route 必须来自 `trellis-route` 校验过的 session runtime、个人 prefs 或用户本次临时选择。runner 不自行猜测 inline/subagent；`check_depth` 与 route mode 相互独立。
- 所有 dirty path 使用 `<repository>::<path>` 唯一键分类为某任务 `owned_dirty` 或 `protected_retained`。分类必须全覆盖、互斥且 hash 未漂移；protected 文件不得被 action 或 commit 使用，每次 record 重新校验内容摘要。
- `## Open Questions` 是人工边界：`- [ ]` 和历史裸列表统一进入整队列 `resolve_open_questions`，run 保持 `awaiting_input`；`- [x]`、空章节或无章节放行。AI 不得代答、删除、改写或勾选，所有问题收敛后才可 record ok。
- planning item 依次执行 `review_planning_readiness`、必要的 `run_planning_repair`、`refresh_brief`。repair 仅处理不改变目标且可由仓库证据确定的问题，单任务最多 3 轮；schema 2 不返回逐任务 `confirm_brief`。
- 依赖只来自 `--depends-on` 或 planning artifacts 的明确契约，不从任务顺序、parent/child 或代码引用猜测。prepare 拒绝缺失、自依赖和循环；稳定拓扑排序只移动满足依赖所需的任务，并把原始/执行顺序写入 manifest。
- AI 只可通过 `decide` 记录任务目标内、低/中风险、可逆且可测试的自主选择。Open Questions、高风险、生产/费用/权限/隐私、破坏性公开契约、push/merge/release/deploy/archive 必须 blocked。
- `decisions.jsonl` 使用 append-only decision/review 事件；decision ID 单调递增，review 绑定当前全部 decision digest。新增 decision 会使旧 review 失效，损坏 JSONL 默认失败关闭。
- decision 修改 planning/handoff 时，`--file` 必须列出全部 `<repository>::<path>`。下一次同任务 record 比较逐文件 hash；全部变化获授权时追加绑定 decision ID 的 manifest revision，否则进入匹配 action 的 artifact drift 处理。
- `next` 发出的 action 必须写入 outstanding 状态；`record` 必须传匹配 action。`run_check_all` / `run_recheck` 的 outstanding action 还要保存 `prd.md`、`design.md`、`implement.md`、`brief.md` 的逐文件 baseline；检查结果必须保存 requested/minimum/effective depth 和原因，minimum/full 不得回写 light。
- Check-All 自动修复当前任务 `implement.md` 或 `brief.md` 时，每个实际变化文件必须通过重复的 `--doc-remediation-file` 精确声明。声明集合必须与 action baseline 后的真实变化完全一致；`prd.md`、`design.md`、其它任务和其它文件拒绝重绑。合法 DOC 修复重算 planning/handoff hash，追加 `change_source=check-doc-remediation` 和 files 的 manifest revision 与 item audit event。
- 未声明或未完全授权的 Check record artifact drift 返回 `status=retryable`，保持 item running 和原 outstanding action，不得调用 `next`。agent 只能撤回本 action 误改、补充合法 DOC 声明后重录，或用 `--result blocked --failure-type artifact-drift` 明确结束。其它 action、protected drift 和 `next` 发出 action 前的跨 action 漂移继续 terminal blocked。
- 任务级 failure、planning repair 预算耗尽、terminal artifact drift、protected 冲突、spec needs-review 或 commit-only 归属失败只阻塞当前项，并传播到显式依赖项；独立任务继续。队列结束后不自动执行第二遍恢复扫描。
- `fix_recheck` 预算计数表示已记录的 failed recheck 次数；`MAX_FIX_RECHECK=3` 必须实际允许 3 个 `run_fix` action。只有计数大于预算时才以 `retry-budget-exhausted` 阻塞；用户显式 `retry-blocked` 恢复该原因时必须把 `attempts.fix_recheck` 重置为 `0`，避免刚恢复就再次阻断。
- `artifact_reconcile` 只属于同一个 Check outstanding action；`MAX_ARTIFACT_RECONCILE=3` 允许前 3 次 retryable 重录，第 4 次转为 terminal `artifact-drift`。成功 Check record 把计数重置为 `0`；用户显式 `retry-blocked` 恢复 terminal artifact drift 时也重置该预算。
- `retry-blocked` 只重置稳定 recoverable reason，复用同一 run；不得用 `start --force` 替代正常恢复。schema 2 队列含 blocked 项时终态为 `completed_with_blocked`。
- `commit_only` 必须复用 `trellis-push` 内部执行路径。Push 根据当前任务 design/implement、项目 SOP/spec、受版本控制的脚本入口及明确输入输出、可验证的 Git/submodule 关系，动态组织任意数量的 `commit -> generate -> commit`；不得硬编码仓库、命令或步骤数，也不得仅因多个仓库、submodule pin 或证据充分的本地生成而 blocked。
- 生成命令必须来自受版本控制的稳定入口，并能证明工作目录、依赖顺序和预期影响路径；只允许本地、确定性、可重复、无外部副作用的 argv。证据冲突、任意 shell、网络写入、push、发布、部署、归档、凭证或生产数据操作必须在执行前失败关闭。
- Push 在每个 commit/generate 前后重新检查 branch、HEAD、未完成 Git 集成、staged、全部 dirty 和 retained 摘要；只使用 exact paths 和 `git commit --only`，排除 runtime、route prefs、protected paths 及其它任务目录。retained 只有在前后内容摘要不变且与 planned/generated paths 不冲突时才可保留；计划外 dirty、未知 staged、retained 漂移、归属歧义或 branch/HEAD 漂移必须在后续副作用前停止。
- 已完成的前置提交不得自动 reset、rebase、revert、amend 或改写。重试时 Push 从真实 Git 状态重新规划，验证已记录 commit 的仓库、对象、message 和文件集合后跳过；确定性生成可以重跑，最终无变化的提交步骤可以跳过。
- `record --repo-commit` 只接受 run 已登记仓库中的 7-64 位十六进制本地 commit object；仓库不可读返回 `repo-commit-repository-unreadable`，同仓同 hash 重复记录幂等，同仓不同 hash 返回 `repo-commit-conflict`。成功、failed 和 blocked 都保留可选 `commits[]`，不提升 schema version。
- `commit` 继续作为主仓或最后提交的兼容字段。存在 `commits[]` 时，显式 `--commit` 必须唯一匹配其中一个已验证完整 hash 或其前缀，否则返回 `repo-commit-primary-mismatch`；未传时使用最后一个 repo commit。没有 `--repo-commit` 的旧单仓 `--commit` 调用保持原行为。
- 只有 Push 已确认现场安全、失败来自确定性生成未收敛或可重新规划的本地预检时，才用 `--result failed --failure-type commit-repairable`。前三次失败保留 commits 并重新发出同一个 `commit_only`，第 4 次以 `commit-repair-budget-exhausted` blocked；`retry-blocked` 重置 `attempts.commit_repair`，但保留已完成 commits。该路径不得复用 Check 的 `status=retryable` 协议。
- item `completed` 只表示本地提交完成，不修改 `task.json.status`。任务继续保持 `in_progress`，直到用户以后显式执行 finish/archive。
- Auto-Loop 内部调用 Push 时跳过 Push Step 5 的任务进度写入、进度提交和 progress push；runner 仍在 item `completed` 或 `blocked` 后写本地 `task.json.progress` 作为恢复提示，但只能使用 `updatedAt`、`completedSteps`、`partialStep`、`nextStep`、`notes` 五字段 schema。completed progress 有多仓提交时记录 `<repository>:<short-hash>` 列表，blocked progress 保留已完成 commits、失败原因并把 `nextStep` 指向精确 `retry-blocked --run-id <run-id> --task <task>` 命令。该写入不得修改 `task.json.status`、不得触发 push/archive/finish-work、不得保存 push mode、分支或 Git 编排计划。
- `trellis-finish-work` 在归档前运行 Decision Audit；`task.py archive` 在任何状态写入、session 清理或目录移动前再次调用 deterministic review guard。无 decision 放行，当前 digest 未 accepted、changes-requested 或日志损坏时零副作用失败。
- `<run-id>.json` 是 runner 热状态文件，只保留调度和恢复必需字段：当前 queue/item 状态、attempts、blocked reason、commit、outstanding action、manifest revision/hash 和 audit 文件引用。完整 manifest revision 历史必须写入旁路 `<run-id>.manifest.jsonl`，每行是 `type=manifest_revision`、`revision`、`sha256`、`created_at`、完整 `payload` 的审计事件；旧 runtime 中的 `manifest_revisions` 数组在下一次 `_write_state()` 时幂等迁移到 JSONL，并从主 JSON 删除。
- 默认 stdout 只返回 run/action/计数/简短 blocked 与决策摘要；manifest、dirty、依赖链、protected drift、完整 decision data 和 resume capsule 只在 `--verbose` 输出。runtime 继续使用同目录临时文件、flush/fsync 和 `os.replace` 原子写入。
- 默认 `status` / `resume` 不得加载或展示完整 audit JSONL；`--verbose` 最多展示 `manifest_audit_path` 和有限 `manifest_tail`。完整 audit 只在明确 debug artifact-drift 或审计时按路径读取，避免 AI 恢复上下文无脑加载大型内部历史。
- canonical 源位于 `vendor/skill-garden/.trellis/0.6`，经 `npm run sync` 生成快照，再由 enhance-only 更新 dogfood。第二次应用必须为零修改；Auto-Loop Skill 只保留语义边界和 action 调度，确定性 schema/校验/错误矩阵留在 runner/helper。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| task 状态不是 planning/in_progress | start 返回 `task-status-not-runnable`，不创建 runtime |
| staged、conflict 或未完成 Git 集成 | start 返回 `git-global-safety-block`，不创建 runtime |
| dirty 分类遗漏、重复或出现未知 key | record 返回 `dirty-classification-incomplete` / `dirty-path-classified-twice`，保持 prepare action |
| dirty 分类期间内容变化 | 返回 `dirty-baseline-drift`，不得接受陈旧分类 |
| 任一任务存在 `- [ ]` 或历史裸 Open Questions | 整个 run 保持 `awaiting_input`，返回批量 `resolve_open_questions` |
| Open Questions 尚未全部收敛就 record ok | 返回 `open-questions-still-unresolved` |
| readiness 为 repairable | 返回 `run_planning_repair`，最多 3 轮 |
| repair 未改 artifact 或预算耗尽 | 返回 `planning-repair-no-change` 或以 `planning-repair-budget-exhausted` 阻塞当前项 |
| brief 刷新后仍过期 | 返回 `brief-still-stale`，保持 prepare action |
| 依赖缺失、自依赖或循环 | start 返回 `invalid-task-dependencies`，不进入 running |
| 前置任务 blocked | 依赖项以 `blocked-dependency` 结束，独立项继续 |
| 非 Check action 的 manifest 后 artifact 无 decision 变化 | 当前项以 `artifact-drift` 阻塞 |
| decision 列明全部变化 artifact | record 重算 planning/handoff hash，追加绑定 decision ID 的 manifest revision |
| Check action 修改当前任务 implement/brief 且声明集合完全匹配 | record 重算 hash，追加 `check-doc-remediation` manifest revision 后继续消费检查结果 |
| DOC 声明包含 PRD/design/其它任务或声明与实际变化不一致 | 返回 `doc-remediation-file-not-allowed` / `doc-remediation-files-mismatch`，outstanding action 保留 |
| Check record 存在未声明或 decision 未覆盖的 artifact 变化 | 前 3 次返回 `status=retryable reason=artifact-drift`，保留 outstanding action；不得 `next` |
| 同一 Check action 第 4 次仍无法消解 artifact drift | 当前项以 terminal `artifact-drift` blocked |
| Check record 显式 `blocked + artifact-drift` | 立即 terminal blocked，不继续消耗自纠预算 |
| action files 命中 protected key | 当前项以 `protected-path-conflict` 阻塞 |
| protected 内容在 action 期间变化 | 记录 repository/path/前后 hash，以 `protected-baseline-drift` 阻塞当前项 |
| requested/minimum full 却 record light | 返回 `check-depth-below-minimum`，outstanding action 保留 |
| `fix_recheck` 计数等于 `MAX_FIX_RECHECK` | 下一步仍返回第 3 个 `run_fix`，不得提前阻断 |
| 第 3 次 recheck 仍 failed，计数大于预算 | 当前 item 以 `retry-budget-exhausted` blocked |
| `retry-blocked` 恢复 `retry-budget-exhausted` | item 回到 pending，`attempts.fix_recheck=0` |
| `retry-blocked` 恢复 terminal `artifact-drift` | item 回到 pending，`attempts.artifact_reconcile=0` |
| schema 2 存在任务级 blocked，独立任务已处理完 | run 进入 `completed_with_blocked` |
| runtime 损坏或仓库不可读 | 返回结构化全局错误或 `globally_blocked`，不得另建状态掩盖原 run |
| decision log 无决策 | finish/archive 不增加 review 阻断 |
| 当前 decision digest 未 accepted 或日志损坏 | archive 在任何副作用前退出非零 |
| commit_only 成功 | exact 本地 commit 并回写 hash/files/message；任务状态仍为 `in_progress` |
| `--repo-commit` 仓库未登记、hash 非法、对象非 commit 或仓库不可读 | 返回对应结构化错误；不消费 outstanding action，不崩溃 |
| 同仓重复记录相同 commit / 不同 commit | 相同提交幂等合并；不同提交返回 `repo-commit-conflict` |
| 多仓显式 `--commit` 不能唯一匹配 `commits[]` | 返回 `repo-commit-primary-mismatch`；唯一前缀规范化为完整 hash |
| 安全的 commit-only 可恢复失败累计 1-3 次 | 保存部分 commits 和失败摘要，保持 `current_step=commit_only`，下一次 `next` 重新发出同一 action |
| 第 4 次 `commit-repairable` 失败 | 当前 item 以 `commit-repair-budget-exhausted` blocked，保留 commits |
| `retry-blocked` 恢复 commit repair 预算耗尽 | `attempts.commit_repair=0`，已完成 commits 保留，重新进入 `commit_only` |
| branch/HEAD 漂移、retained 漂移、未知 staged、归属歧义或外部副作用风险 | 不标记 `commit-repairable`，立即 blocked 并停止后续副作用 |
| commit_only 成功后写 task progress | 只更新五字段 `task.json.progress`，`task.json.status` 保持 `in_progress` |
| item blocked 后写 task progress | `partialStep` 记录 blocked reason，`nextStep` 指向显式 `retry-blocked` 恢复命令 |
| 旧 runtime 主 JSON 含 `manifest_revisions` | 下一次写入迁移到 `<run-id>.manifest.jsonl`，主 JSON 删除全量数组并保留 audit 引用 |
| `status` / `resume` 默认输出 | 不内联完整 manifest audit 历史；只在 verbose 展示有限 tail 和路径 |

### 5. Good/Base/Bad Cases

- Good:三个 planning 任务先共同完成 dirty 分类、Open Questions 收敛、readiness/repair 和 brief
  刷新，再生成 manifest；running 后连续执行，不出现逐任务 `confirm_brief`。
- Good:任务 B 显式依赖 A，任务 C 独立；A blocked 后 B 记录完整依赖链并进入
  `blocked-dependency`，C 继续到 commit-only，run 最终为 `completed_with_blocked`。
- Good:AI 先用 `decide --file .::.trellis/tasks/x/prd.md` 记录低风险选择，再修改 PRD；下一次
  record 追加 manifest revision，并把 decision ID 写入任务 manifest 条目。
- Good:主仓和子仓都有 `notes.txt`，protected 分类和 action files 始终使用不同的
  `repository::path`，不会因同名路径互相阻塞。
- Good:热状态 JSON 只保存当前 manifest hash、queue 状态和 audit 路径；完整 revision payload 在
  `<run-id>.manifest.jsonl` 中逐行追加，artifact-drift 调试时才按路径读取。
- Good:Check-All 机械勾选当前任务 `implement.md` 后，record 精确传入该文件的
  `--doc-remediation-file`；runner 审核实际变化集合、追加 manifest revision，再推进到 spec update。
- Good:第一次 Check record 漏掉 DOC 声明时返回 retryable；agent 不调用 `next`，补齐声明后用原
  `run_check_all` 重录成功。
- Good:前置仓 commit 成功、确定性生成第一次未收敛；agent 用 `failed + commit-repairable` 回写该仓
  `--repo-commit`，runner 重新发出 `commit_only`，Push 验证并跳过前置提交后继续剩余链。
- Good:后续仓存在不相交的 retained dirty；生成前后摘要一致，Push 只提交 exact planned/generated
  paths，最终 record 全部 repo commits，并以主仓或最后提交填充兼容 `commit`。
- Base:任务没有 AI decision；后续 finish/archive 直接沿用既有流程，不增加确认。
- Base:schema 1 runtime 恢复到 outstanding `confirm_brief`；继续旧 action，不写 schema 2 字段。
- Base:旧调用只传 `record --commit <hash>`；runner 不要求 `commits[]`，单仓结果和 progress 文案保持兼容。
- Base:auto-loop 本地提交完成后只写 `task.json.progress.nextStep` 提示 finish/archive，任务仍保持
  `in_progress`。
- Bad:prepare 只检查第一个任务就进入 running；后续任务的 Open Questions 会重新制造人工卡点。
- Bad:AI 直接编辑 planning artifacts，再补 decision；旧 manifest 已经失去内容绑定，必须按
  `artifact-drift` 处理。
- Bad:任何 `record` 漂移都立即清空 `last_action` 并进入 `completed_with_blocked`；这会让本 action
  可证明的 Check-All DOC 修复无法补充声明，也迫使用户手工恢复内部协议错误。
- Bad:把 Check record 的 `status=retryable` 扩大到 implement、spec update、commit-only 或 protected
  drift；commit-only 自修复必须使用普通 `failed + commit-repairable`，其它变化继续失败关闭。
- Bad:把完整 commit plan/cursor 写进 runtime，新增 `commit-plan` / `commit-step`，或让 runner 执行 Git、
  generator 和任意 shell；这些都重复 Push 所有权并扩大持久化攻击面。
- Bad:接受未登记仓库、不可解析 commit、与 `commits[]` 不一致的主 commit，或因仓库目录消失直接抛异常；
  恢复状态会失真且无法审计部分成功。
- Bad:把队列项 `completed` 同步写入 `task.json.status=completed`；这会绕过 finish/archive 生命周期。
- Bad:把全量 `manifest_revisions` 继续塞进 `<run-id>.json` 或默认 `status/resume` 输出，导致 AI 恢复时加载大型审计历史。
- Bad:progress 保存 push mode、分支、完整提交计划或业务 Git 编排状态，导致 `trellis-continue` 误恢复 Git 行为。
- Bad:只给 Auto-Loop 或 Finish-Work 安装 `decision_log.py`，却没有 task-store archive guard；直接
  调用 `task.py archive` 仍可绕过 review。
- Bad:为缩短 Skill 删除安全边界但没有 runner/helper 或其它 owner 承接；上下文预算不是减少契约的理由。

### 6. Tests Required

- runner 测试覆盖 schema 1 恢复和 schema 2 全状态链：全队列 prepare、Open Questions、readiness/
  repair 预算、brief、manifest、依赖排序/传播、部分失败继续和三种终态。
- auto-loop 回归测试必须覆盖 3 个 `run_fix` action、`retry-budget-exhausted` 显式恢复重置预算、
  terminal/blocked progress 五字段可读、旧 `manifest_revisions` 迁移到 JSONL、主 JSON 不再保留全量历史。
- Git baseline 测试覆盖 staged/conflict 全局阻断、跨仓同名路径、分类全覆盖、protected path 冲突、
  action 期间 hash 漂移和 exact commit files。
- decision 测试覆盖 append、递增 ID、risk/choice 校验、digest、accepted、changes-requested、新 decision
  使旧 review 失效、artifact rebind、未授权变化和原子写失败保留旧文件。
- archive 测试断言无 decision 放行，未审查/changes-requested/损坏日志在状态写入、session 清理和
  目录移动前零副作用失败；accepted 后保持既有归档行为。
- Check-All 测试覆盖 requested/minimum/effective depth、legacy full fallback、failed -> fix -> full
  recheck、DOC manifest 重绑、非法路径、声明/实际不一致、retryable 后成功、3 次预算后阻塞、
  显式 blocked 和 validated auto-loop 成功 record 后立即 `next`。
- commit-only runner 测试覆盖旧单 `--commit` 兼容、多 `--repo-commit` 幂等保存、默认短 hash/verbose
  完整列表、task progress 多仓摘要，以及未登记仓库、非法 hash、非 commit object、仓库不可读、
  同仓冲突和主 commit 不匹配的结构化错误。
- commit repair 测试必须断言前三次 `failed + commit-repairable` 都重新发出同一 `commit_only`，第 4 次
  进入 `commit-repair-budget-exhausted`，`retry-blocked` 重置预算但保留 commits；非 repairable 安全
  失败立即 blocked 且不消耗预算。
- Skill 静态契约测试覆盖 Auto-Loop/Push 的多仓本地生成、受约束证据推断、retained 摘要校验、
  Step 5 跳过边界、runner 本地 progress 所有权、三轮修复和 no-push 边界，并比较 `.agents` / `.claude`。
- selective install 对 `trellis-auto-loop`、`auto-loop`、`trellis-finish-work`、`finish-work` 分别断言
  runner/helper、decision log 和 archive guard 自包含。
- 运行 `npm test`、Patch conflict、compiled targets、strict AI context budget、Python `py_compile`、
  `git diff --check`，并比较 vendor、enhancements、dogfood 副本。连续第二次 enhance-only 修改数必须为 0。

### 7. Wrong vs Correct

**Wrong**:start 后立即执行队列第一个任务，后续任务轮到时再处理 Open Questions、brief 和 route。

**Correct**:schema 2 先 prepare 全队列并生成内容绑定的 manifest，running 阶段只消费冻结 action；
任务级 failure 结构化记录并继续独立任务。

**Wrong**:Skill 中描述“AI 可以修改 planning”，runner 只在 next 时比较一个联合 hash，无法证明哪些
文件由哪条 decision 授权。

**Correct**:`decide` 先保存 decision 与逐文件 baseline，下一次 record 只允许 `--file` 列明的变化，
成功后追加绑定 decision ID 的 manifest revision；未授权 Check record 先在同一 outstanding action
内有限自纠，其它 action 稳定阻塞。

**Wrong**:Check-All 自动更新 `implement.md` 后，record 只传 `--result ok`；runner 立即清空
outstanding action 并要求用户显式 `retry-blocked`。

**Correct**:Check action 保存逐文件 baseline；合法 DOC 修复通过 `--doc-remediation-file` 精确重绑。
漏声明时返回 retryable 并保留原 action，agent 补齐声明后重录，只有无法归因或预算耗尽才 terminal blocked。

**Wrong**:`status --verbose` 直接内联所有 `manifest_revisions`，并把 task progress 当作后续 push/commit 计划恢复。

**Correct**:`status --verbose` 只展示 `manifest_audit_path` 和有限 `manifest_tail`；完整 revision 写在
`<run-id>.manifest.jsonl`，task progress 只展示 auto-loop 的下一步恢复提示，不携带 Git 编排状态。

**Wrong**:为多仓链新增持久化 `commit-plan` / `commit-step`，让 runner 执行 Git 或 generator；失败后
只传一个不属于已完成提交集合的 `--commit`，丢失前置仓结果。

**Correct**:Push 每次从任务证据和真实 Git 状态重建动态链；部分成功用重复
`--repo-commit <repository>::<hash>` 回写，安全失败以 `failed + commit-repairable` 触发有限重试，最终
成功时 `--commit` 唯一匹配已验证的 `commits[]`。

---

## Scenario: Autonomous Update-Spec And Post-Check Resume

### 1. Scope / Trigger

- Trigger:普通 interactive Check-All 通过后保留用户继续卡点;已经进入当前 Check-All 完成链且
  最新消息明确请求普通 push 或用户主动 `commit-only` 时,严格通过后不应再次要求“继续”。
  两条路径进入 Update-Spec 后都不再询问是否更新 spec,也不应在 Update-Spec 与 Trellis Push
  之间再停一次。显式进入 `trellis-push` 后的行为由 Push owner 负责，不由本场景反向补门禁。
- Scope:`overrides/patches/skills/trellis-update-spec/autonomous-evaluation/` 保存自主三态、证据、最小写入和自校验;
  workflow hub/state 只保存停止点与 resume-chain;auto-loop skill/runner 保存确定性 record 映射;
  Patch Engine 和独立 Python consumer 负责替换已有上游入口。

### 2. Signatures

Update-Spec 结果固定为:

```yaml
spec_update_result:
  status: no-op | written | needs-review
  reason: string
  evidence: [string]
  changed_files: [path]
  validation: [string]
```

普通继续流程:

```text
Check-All passed -> report + stop -> user next/continue
  -> trellis-update-spec
     no-op/written -> trellis-push plan in the same turn
     needs-review  -> one focused question, no Push plan
```

当前 Check-All 完成链内的 direct Git 条件续行:

```text
latest user intent = ordinary push | user commit-only
  -> Check-All strict pass -> existing standard report -> trellis-update-spec
     no-op/written -> trellis-push plan in the same turn
     needs-review  -> stop, no Push plan
  -> findings/blocked/partial/material risk -> standard report + stop
```

auto-loop 保持原 action 顺序:

```text
run_check_all -> run_spec_update -> commit_only
  no-op/written -> record ok -> next
  needs-review  -> record blocked(spec-needs-review)
```

### 3. Contracts

- Check-All 的 interactive stop 保持默认行为。仅当已经进入当前 Check-All 完成链，且触发本轮
  完成链的最新用户消息明确请求普通
  push 或用户主动 `commit-only`,且 Check-All 整体通过、0 问题、无阻塞、无部分验证、无待用户
  接受的实质剩余风险时,先展示现有标准报告,再同轮运行 Update-Spec。不得从历史、摘要、dirty
  状态或 auto-loop 内部 action 推断该意图,也不得新增 direct Git 专用摘要。
- 该窄例外只控制已经启动的 Check-All completion chain，不授权 Check-All 或 Update-Spec 拦截
  已经进入 `trellis-push` 的请求；Push owner 只读取完成链证据并决定 Git 计划。
- 通过后用户表达 next/continue,或当前 Check-All 完成链内的 direct Git 严格通过时,若没有当前有效结果,同一轮必须先调用
  `trellis-update-spec`;不得询问“是否更新 spec”或先生成提交计划。
- `no-op` 用于无可复用契约、现有 spec 已覆盖、一次性实现、纯文案/格式变化或用户当前明确
  skip;不得为了避免 no-op 写原则性总结。
- `written` 只在代码/测试证据充分且目标权威 spec 唯一时成立。新增修改只能位于
  `.trellis/spec/**`,并且只改承载新契约所需的最小章节和最少文件;不得顺带整理、扩写或格式化
  无关内容。新增 spec 文件时同步对应 index。
- `needs-review` 只用于目标、语义、冲突或验证失败无法从仓库证据唯一解决的情况,只问一个
  解除当前歧义所需的问题。
- 证据顺序固定为任务 JSONL 引用 -> prd/design/implement -> Check-All 证据 -> 实际 diff、源码、
  测试/提交 -> `spec_router.py` 命中的现有 spec/index。聊天摘要和任务标题不能单独授权写入。
- `written` 返回前必须复读 spec diff、反向核对源码/测试并运行
  `git diff --check -- .trellis/spec`;适用时继续跑 index/link、签名或项目专用验证。无法唯一修复
  时降为 `needs-review`,越界修改不得进入 Push。spec 写入后不额外触发一次人工 Check-All。
- interactive 的 `no-op` / `written` 在同一轮加载 `trellis-push`,但最终 exact plan 确认不变;
  `needs-review` 不得进入 Phase 3.4。已有仍有效结果不重复运行,证据或用户意图变化后重新求值。
- auto-loop 必须调用同一三态协议:`no-op` / `written` record ok 后立即 next;
  `needs-review` record blocked 且 failure-type 固定为 `spec-needs-review`。
- override 源只维护增量块,不复制上游整份 skill。flower 与独立安装器的全装和三个精细别名
  必须一致；Patch targets 覆盖已安装平台的真实 skill、command、workflow、prompt 与 Gemini TOML
  入口，存在才注入，不存在时跳过且不创建平台入口。
- 真实源先改 `vendor/skill-garden/.trellis/0.6`,再 `npm run sync` 和 dogfood update;
  `enhancements/0.6`、当前 `.agents/.claude` 与 vendor 语义一致,0.5/old 不变。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| 普通 Check-All passed,用户尚未继续 | 报告并停止,不运行 Update-Spec |
| 当前 Check-All 完成链内 direct Git + strict pass | 展示现有标准报告,同轮运行 Update-Spec |
| 当前 Check-All 完成链内 direct Git + findings/blocked/partial/material risk | 标准报告并停止,不运行 Update-Spec或生成 Git 计划 |
| 用户 next/continue,无新契约 | 返回 no-op,同轮进入 Trellis Push |
| 新契约有代码/测试证据且目标唯一 | 最小 written + 自校验,同轮进入 Trellis Push |
| 现有 spec 已完整覆盖 | no-op,不得重复写同义内容 |
| 目标 spec 或业务语义不唯一 | needs-review,只问一个问题,不生成 Push 计划 |
| 用户在已有有效 Check-All 的完成链内要求 push/commit-only,无当前结果 | 先补跑 Update-Spec,不得绕过 Phase 3.3 |
| 请求已经进入 `trellis-push` | 本场景不反向补跑 Check-All/Update-Spec；由 Push owner 记录证据并生成计划 |
| Update-Spec 新增非 `.trellis/spec/**` 修改 | needs-review/boundary-violation,停止并返回检查流程,不得进入 Push |
| written 自校验失败且修复不唯一 | needs-review,不得伪报 written |
| validated auto-loop 得到 no-op/written | `record ok -> next` |
| validated auto-loop 得到 needs-review | `record blocked --failure-type spec-needs-review` |
| 精细安装目标入口不存在 | 结构化 skip,不创建 skill/command |

### 5. Good/Base/Bad Cases

- Good:普通 Check-All 通过后先停止;用户说“下一步”,Update-Spec 判断现有规范已覆盖并返回 no-op,
  同一轮展示 Trellis Push 计划。
- Good:当前请求已经进入 Check-All 完成链，且用户先要求 push；严格通过后展示原标准报告，
  同轮运行 Update-Spec 并展示唯一 Trellis Push 计划，最终 Git 动作仍等待确认。
- Good:实现新增确定性 CLI 契约;Update-Spec 只更新现有权威场景的一个章节,定向验证通过后
  返回 written 并进入 Push。
- Base:用户明确“不更新 spec,直接走”;结果为 no-op/user-explicit-skip,随后仍由 Trellis Push
  展示最终确认。
- Bad:普通 Check-All 报告刚输出就自动写 spec,或当前 Check-All 完成链内的 direct Git 有部分
  验证/实质风险仍自动续行 Update-Spec。
- Bad:`trellis-push` 已经开始后，本场景又把请求拉回 Phase 2.2 或 Phase 3.3。
- Bad:为了让每次任务都有 spec diff,重写整份规范或顺带格式化无关章节。
- Bad:Update-Spec 返回 needs-review 后仍生成提交计划,或 auto-loop 把它记录成 ok。

### 6. Tests Required

- 静态断言 override 包含三态、证据顺序、`.trellis/spec/**`、最小修改、self-validation、
  interactive/auto-loop disposition。
- 静态断言 Check-All 仍只有一个 Interactive Post-Check Stop Gate;普通检查报告后停止,当前
  Check-All 完成链内的 direct Git strict pass 使用原标准报告并同轮进入 Update-Spec,其它结果
  停止；同时断言已经进入 `trellis-push` 后不会反向加载 Check-All/Update-Spec。
- JS consumer 覆盖全装、三个精细别名、全部平台原生 skill/command/workflow/prompt/TOML 目标、
  缺目标和二次运行幂等。
- Python 独立安装器覆盖相同别名、目标和 skip 行为。
- auto-loop 静态/行为测试覆盖 no-op/written ok+next 与 needs-review blocked。
- `npm run sync` 后比较 vendor/snapshot/dogfood;重复 enhance-only 的相关文件 hash 不变。
- 运行 `npm test`、默认/strict AI context budget、JS/Python/Bash 语法与 `git diff --check`。

### 7. Wrong vs Correct

#### Wrong

```text
ordinary Check-All passed -> auto Update-Spec -> ask whether to write -> stop -> ask whether to push
```

问题:普通检查提前越过既有 post-check 停止点,用户继续后仍保留两个机械卡点。

#### Correct

```text
Check-All passed -> report + stop -> user next
  -> autonomous Update-Spec(no-op/written/needs-review)
  -> no-op/written loads Trellis Push in the same turn

direct Git already in Check-All completion chain -> strict pass -> same standard report
  -> autonomous Update-Spec(no-op/written/needs-review)
  -> no-op/written loads Trellis Push in the same turn

explicit Trellis Push entry -> Push owner records available completion evidence
  -> Git preflight and one confirmation plan
```

原因:普通检查保留用户继续边界；已经启动的 Check-All 完成链可消费 direct Git 条件续行；
一旦进入 Push owner，上游结果只作为审计证据，不再反向增加阶段或确认卡点。

---

## Scenario: Minimal Trellis Push And Task Progress

### 1. Scope / Trigger

- Trigger:普通 `trellis-check` / `trellis-check-all` 完成后,主 agent 可能绕过 Phase 3.4
  `trellis-push`,自行草拟 `Proposed commits`、commit message 和 commit-only 确认；显式 Push
  也可能因缺少 Check-All/Update-Spec 被拉回上游阶段或增加“运行/跳过检查”确认；大型或多仓
  计划还可能把普通文件全部铺开,造成高噪声输出。
- Scope:Phase 2.2 / in-progress state 负责 post-check 一跳边界，Phase 3.4 进入 `trellis-push`；
  Hub 只登记 owner 和跨阶段顺序。`trellis-check-all` 负责纯检查汇总；`trellis-push` 负责只读完成链
  证据、exact plan、一次确认、业务 Git 动作和普通 push 后的 task progress trigger；
  `task_progress.py` 只负责窄 schema 读写;
  `trellis-auto-loop` 仍只使用本地 commit-only 预授权。

### 2. Signatures

普通流程状态序列:

```text
trellis-check-all
  -> ordinary post-check report + stop -> user continue
     or direct Git strict pass -> same standard report + same-turn continuation
  -> autonomous Phase 3.3 trellis-update-spec
  -> Phase 3.4 trellis-push plan
  -> user confirmation
  -> exact git add / git commit --only / push
  -> exact current-task record / progress commit / push
```

显式 Push 入口:

```text
explicit trellis-push | push confirmation
  -> record Check-All evidence: passed | not-run | stale | findings | blocked | partial
  -> record Update-Spec evidence: no-op | written | needs-review | not-run | stale
  -> Git preflight + one plan; non-passing completion evidence is disclosed as risk
```

普通多仓计划可以在仓库间展示一个本地生成命令；命令成功且生成后的 dirty paths 未超出预计 exact files 时沿用同一次确认。

auto-loop 状态序列保持不变:

```text
run_check_all -> run_spec_update -> commit_only
  -> trellis-auto-loop validates
  -> trellis-push internal commit-only
  -> trellis-auto-loop record / next
```

展示阈值:

```text
planned_files <= 8  ->逐项展示
planned_files > 8   ->按目录归组,文件摘要最多 12 行,支持“展开文件”
retained_dirty      ->逐项标注 untracked/unstaged/staged,不折叠
risk_items          ->始终逐项展示,不折叠
```

### 3. Contracts

- post-check 标准报告只含检查维度/问题数、实际验证、剩余风险、结论和下一步。普通检查输出后
  等待用户继续;direct Git 只有严格通过时才在同轮续行。不得包含 commit message、planned/staged
  files、`Proposed commits`、commit-only 决策或提交确认提示,也不维护专用精简摘要。
- 普通 Check-All 通过后仍停止;用户继续后 Phase 3.3 自主返回三态。用户在检查前已明确请求
  普通 push/用户 `commit-only` 时,strict pass 展示标准报告后同轮进入 Phase 3.3。两条路径均由
  no-op/written 同轮加载 `trellis-push`,needs-review 停止。
- 除 auto-loop 内部 commit-only 外，普通 push 或用户 `commit-only` 已经构成明确 Git 意图。
  `trellis-push` 在读取 Git 计划前只记录当前可验证的 Check-All / Update-Spec 证据，不补跑、
  不切换阶段、不要求用户改写成“跳过检查后 push”，也不增加运行/跳过检查的二选一确认。
- Check-All 证据状态固定为 `通过`、`未运行`、`已失效`、`存在 findings`、`blocked` 或
  `部分验证`；Update-Spec 证据状态固定为 `no-op`、`written`、`needs-review`、`未运行` 或
  `已失效`。没有当前可验证证据时使用 `未运行`，不得从历史、摘要或 dirty 状态猜测通过。
- 完成链状态不阻止读取 Git 状态或生成提交计划。`未运行`、`已失效`、findings、blocked、
  部分验证或 `needs-review` 必须同时进入计划风险区，但不得派生第二次确认。
- 当前 `spec_update_result.status=written` 只有在结果仍适用于实际 diff 时才展示为 `written`；
  结果外出现其它变化时标记为 `已失效` 并披露风险，不得因此把请求拉回 Phase 2.2。
- 只有 Git 层面的确定性安全条件可以阻断计划，包括冲突或未完成集成状态、exact files 无法
  归属、分支/upstream 不满足安全执行条件，以及普通 push 会携带无法归属的历史 ahead commits。
- Push 计划必须在仓库计划前展示“完成链证据”，包含 Check-All 与 Update-Spec 当前状态；
  exact files、commit message、保留 dirty、风险和最终一次确认继续使用原有计划契约。
- Phase 3.4 必须加载 `trellis-push`;在该 skill 外草拟提交计划不能作为等价替代。
- workflow hub 只声明 Phase 3.4 门禁和格式所有权:详细计划/结果格式完全由 `trellis-push`
  管理。hub 不复制模板、字段顺序、仓库显示名、retained 用户标签或 8/12 文件阈值。
- Phase 3.4 Patch 必须直接替换与 `trellis-push` 冲突的上游 `Proposed commits`、本地直接 commit
  和 `Never push` walkthrough；不得保留旧正文后再依赖 Hub 声明其 inactive。
- 普通 `trellis-push` 默认 commit + push 当前分支;commit-only 只来自用户明确意图或已经由
  auto-loop 校验的内部调用。分支合并、release、finish-work 和 runner 状态不属于该 skill。
- `trellis-push` 内部始终保存 exact planned files 与 exact retained/unrecognized dirty paths;
  紧凑展示只影响对话,执行仍只能 `git add -- <exact files>` 和
  `git commit --only -- <exact files>`。
- 普通确认模式下,计划外 untracked、unstaged、staged 文件全部保留并展示,不阻塞当前任务
  提交;提交前后必须验证计划外 staged 列表保持不变。auto-loop commit-only 继续要求 staged
  区为空,不扩大预授权。
- `retained` 只作为内部集合名,含义固定为“本次排除并保持原状的 dirty paths”。用户界面统一
  显示“保留未提交的变更（dirty）”,并标注 Git 状态;clean files 不进入该集合。unknown ahead、
  branch/upstream 异常和归属不确定等真正风险单独进入“风险”区。
- 分仓标题优先使用 config package 名,否则使用 Git top-level 目录名。内部输入别名 `root`、
  `parent`、`main repo` 不得直接出现在用户输出中。
- 每仓 planned files 不超过 8 个时完整展示;超过 8 个时按目录归组,普通文件摘要最多
  12 行,并允许用户展开同一 exact set。展开不是执行确认,也不能重新推断范围。
- 保留 dirty 和风险条目始终逐项展示,不受阈值限制。
- 多仓库逐仓独立生成 commit message、branch/upstream、文件范围和 push 结果;普通模式对完整
  计划只确认一次。计划/结果复用原有总览 → 分仓 → 任务进度 → 保留 dirty 的视觉顺序,
  但只显示精简后的 commit/push/progress;不重复展示 Spec review、check、release 或 finish-work 信息。
- 普通模式存在活动任务时,当前任务目录中可归属的 dirty/untracked 产物与预计由 helper 更新的
  `task.json` 组成独立任务记录 exact files。它们不进入业务 commit,也不显示为 retained;
  其他任务目录和无关 dirty/staged 文件保持原状。计划顶部的仓库/commit/file 总数必须包含
  任务记录提交所在 Git root、该提交和 exact files,并展示固定 message、branch/upstream 与
  exact files 或同一 exact set 的分组摘要。
- 当前任务目录可能整体未跟踪,默认 `git status --short` 会把它折叠为 `?? <task-dir>/`。
  发现任务记录 exact files 时必须运行
  `git status --short --untracked-files=all -- <task-dir>`,并拒绝把折叠目录当成文件、展示条目
  或 pathspec。
- 普通 `PUSH` 的多仓计划可用一行展示本地生成命令、工作目录和后续仓预计 exact files;
  仅在后续仓 `retained=0` 时使用,未知内容与增删行显示“生成后计算”。
- 前置仓成功后运行已展示命令并复用现有提交前预检。命令成功且后续仓 dirty paths 未超出
  预计 exact files 时直接继续;出现计划外路径或现有计划边界变化时重新规划。内容/hash/统计变化不重问。
- 无活动任务时仍可处理当前会话可明确归属的文件,但跳过 task progress。无法证明来源的
  dirty 文件全部作为 unrecognized 排除,直到用户明确指定后重新生成计划。
- commit message 只能由 `trellis-push` 最终草拟/采用;优先级为用户明确提供 > 任务材料与
  实际 diff > 最近提交风格。
- auto-loop 继续保持唯一 `profile=commit-only`、`commit_only` action 和 runtime schema;
  普通默认 push 不扩大 auto-loop 的远端授权。auto-loop 自己校验 action/profile/task、空 staged
  区和文件归属,再把 exact files/message 交给内部执行器;`trellis-push` 不读写 runner runtime。
- 当前任务进度 schema 固定为 `updatedAt`、`completedSteps`、`partialStep`、`nextStep`、`notes`;
  不保存 push mode、业务 commit hash、分支或完整计划。`task_progress.py write` 必须拒绝额外字段,
  只接受 `status=in_progress`；普通最终分支携带 `--complete` 时在同一次原子替换中写 progress、
  `status=completed` 和 UTC 日期 `completedAt`，并移除 legacy `last_push_snapshot`。
- Task Progress Recovery 的读取 owner 是 `trellis-continue`：它在加载 Phase Index/选择恢复步骤前运行
  `task_progress.py status --json`。`in_progress` 只 relay `partialStep`、`nextStep` 和必要 notes；
  `completed` 当前任务或 candidate 只指向显式 finish-work/archive。不得自动 rebind、由 progress
  推断 Phase、恢复 push mode 或恢复 Git/commit 编排。
- `completed` 是 Phase 3.4 与 archive 之间的可观察活动态；最终 progress 写入不得清理当前 session
  指针。`[workflow-state:completed]` 禁止自动恢复 implementation/Update-Spec/push，只允许显式
  finish-work，或用户明确决定后运行 `task_progress.py reopen --task <task> --json`。reopen 只允许
  `completed -> in_progress`，清空 `completedAt` 并保留 progress；范围变化仍刷新 Brief 并重新批准。
- `task_progress.py write` 必须在完整 schema 校验后，将 JSON 写入目标目录内的临时文件，执行
  flush + `fsync` 后用 `os.replace` 原子替换 `task.json`。校验失败、临时写入失败或 replace 失败时，
  旧 `task.json` 字节保持不变，并清理本次临时文件。
- 普通业务 commit/push 全部成功时先不带 `--complete` 写完整 progress，并用固定 message 对首次确认的
  当前任务 exact files 生成独立 commit 后立即 push，不增加第二次确认；该集合包含 helper 更新后的
  `task.json` 和首次计划时已存在且可归属的当前任务产物。只有 progress commit/push 成功后，才用
  同一份 final progress 携带 `--complete` 在本地原子写入 completed/completedAt；该预归档生命周期
  变化不再创建第二个 progress commit，由显式 finish-work 的 archive bookkeeping commit 承接。
- 已有成功仓库而后续失败时不带 `--complete` 写 partial/next/failure notes，任务保持 `in_progress`。
  用户 commit-only、auto-loop 内部 commit-only 和尚无成功 Git 动作的失败都不得触发 completed。
  finish-work 负责后续 release audit、archive 移动和 journal，不能作为普通 push 延后当前任务规划
  产物首次入库的理由。
- progress 写入/commit/push 失败不回滚业务结果，最终报告必须分开显示 business 与 progress sync；
  权威任务状态保持 `in_progress`。若 progress push 已成功但本地 `--complete` 写入失败，只重试完成态
  helper，不重做业务 push 或 progress push。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| 普通 check 汇总准备输出 commit message / planned files | 停止;只输出检查报告与下一步 |
| 显式 Push 缺少 Check-All | 记录 `未运行` 并进入风险区，继续 Git 预检与计划 |
| Check-All 报告过期、存在 findings、blocked 或部分验证 | 记录对应状态并进入风险区，继续 Git 预检与计划 |
| Update-Spec 缺少/过期或为 needs-review | 记录对应状态并进入风险区，继续 Git 预检与计划 |
| Check-All / Update-Spec 均有效 | 展示实际状态，继续 Git 预检与计划 |
| 计划存在冲突、无法归属 exact files 或其它 Git 安全阻塞 | 停止并报告确定性 Git 问题 |
| Phase 3.4 未加载 `trellis-push` 却准备 commit | 阻断;进入本 skill 重新生成计划 |
| 旧 Phase 3.4 `Proposed commits` / `Never push` 正文仍存在 | conflict assertion 失败，禁止依赖 Hub 优先级继续 |
| 普通 `trellis-push` 未收到 commit-only 意图 | mode 必须是 commit + push |
| auto-loop outstanding action/profile/task 不匹配 | auto-loop 不得调用内部 commit-only,写回 failed/blocked |
| 单仓 planned files = 8 | 逐项完整展示 |
| 单仓 planned files > 8 | 按目录归组,文件摘要最多 12 行,提供“展开文件” |
| 存在 retained dirty | 在“保留未提交的变更（dirty）”中逐项标注 Git 状态,不作为默认阻塞 |
| 存在 risk items | 在独立“风险”区逐项完整展示,即使超过 12 行也不得折叠 |
| 用户请求“展开文件” | 展示当前 exact planned files,不改变计划、不执行 |
| 执行前 planned set / branch / upstream / conflict / push 目标变化 | 原确认失效,重新生成并确认计划 |
| 只有 retained dirty 变化 | 更新保留摘要并继续,不得让当前任务计划失效 |
| 生成命令后 dirty paths 未超出预计 exact files | 复用现有预检并继续,不二次确认 |
| 后续仓存在 retained dirty、命令失败或出现计划外 dirty path | 不使用旧确认,重新规划 |
| 当前任务存在 dirty/untracked 规划产物 | 纳入任务记录 exact files,不显示为 retained |
| 当前任务目录整体未跟踪 | 使用 `--untracked-files=all` 展开文件级 exact set,不得提交目录 pathspec |
| 其他任务目录存在 dirty/untracked 文件 | 保持 retained,不得进入当前任务记录提交 |
| 业务结束后当前任务 exact path set 扩大 | 原确认失效,重新生成并确认计划 |
| 普通模式存在计划外 staged 文件 | `git commit --only` 提交 exact planned files,保留原 staged 列表 |
| 无活动任务且 dirty 来源不明 | 全部放入 unrecognized,默认不提交 |
| 多仓第二仓执行失败且第一仓已 push | 保留第一仓结果,写 partial progress 与下一恢复动作 |
| 业务动作成功但 progress push 失败 | 不回滚业务提交;单独报告 progress sync failed，任务保持 in_progress |
| 普通业务 commit/push 全部成功 | 先写/提交/推送 final progress，再 `write --complete` 激活本地完成态 |
| progress push 成功但完成态写入失败 | 不重做已成功 push；任务保持 in_progress，只重试 `write --complete` |
| partial、用户 commit-only 或 auto-loop commit-only | 不带 `--complete` 或跳过 Step 5，任务保持 in_progress |
| completed 当前任务或 candidate 被 continue 发现 | 只指向显式 finish-work/archive，不进入 Phase 2/3.3/3.4 |
| 用户明确要求重做 completed 任务 | `reopen` 清 completedAt、保留 progress；必要时重新批准 Brief |
| progress JSON 带额外字段 | helper 拒绝写入,防止旧 Git 编排状态混入 |
| progress schema 非法 | 写盘前失败，原 `task.json` 字节不变 |
| 临时写入或 `os.replace` 失败 | 删除临时文件，原 `task.json` 字节不变 |
| 只有 legacy `last_push_snapshot` | status 映射为新 summary;下一次成功 write 迁移为 `progress` |
| continue 读取到 progress/candidates | 只展示允许字段并建议显式 rebind；不改变 task/session/Phase/Git |

### 5. Good/Base/Bad Cases

- Good:普通 check-all 通过后只报告三维检查、验证命令、Redis 未实机验证风险和下一步,等待用户;
  用户继续后自动完成 Phase 3.3,no-op/written 同轮进入 `trellis-push`。
- Good:Flower 更新结果或用户显式进入 `trellis-push`，当前没有 Check-All/Update-Spec；计划显示
  两项 `未运行` 并列入风险，同时展示 exact files 和 commit message，只等待原有一次最终确认。
- Good:当前 Check-All 存在 findings、Update-Spec 为 `needs-review`；两项状态进入同一计划风险区，
  不再追加“是否跳过”确认，Git 安全预检通过后仍可由用户一次确认执行。
- Good:单仓 20 个普通 planned files 按目录压成 6 行,2 个未识别 dirty 文件仍逐项展示;
  用户回复“展开文件”后看到原 20 个 exact paths。
- Good:两个业务仓库各自拥有 commit message 和 branch/upstream,顶部显示执行顺序和一行任务
  progress,用户只确认一次；业务 push 后先生成独立 progress commit/push，确认同步成功后才原子进入
  completed，当前 session 继续指向该待归档任务。
- Good:`skill-garden` push 后按计划运行 `npm run sync`;生成后没有计划外 dirty path,直接继续
  `flower-trellis` commit/push,不要求第二次确认。
- Good:当前任务有 2 个业务 planned files 和 6 个 untracked 任务产物,另一个规划任务有
  untracked 文件且 index 中有 1 个无关 staged 文件;业务 commit 只提交 2 个 planned files,
  随后的任务记录 commit 提交 6 个任务产物与更新后的 `task.json`,另一个任务和 staged 文件
  仍显示为 retained 并保持原状。
- Base:无活动任务但当前会话明确修改 2 个文件,它们进入 planned;仓库中另外 3 个旧 dirty
  文件进入 unrecognized 并排除。
- Bad:check-all 汇总后直接输出 `Proposed commits` 并说“不会推送”;这同时绕过 post-check、
  Phase 3.3 和 `trellis-push` 默认 push 语义。
- Bad:`trellis-push` 因 Check-All 缺失返回 Phase 2.2，或弹出“运行 Check-All / 跳过并继续”二选一。
- Bad:`trellis-push` 因 Update-Spec 缺失/过期自动加载 Phase 3.3，而不是在计划中披露状态。
- Bad:为了缩短输出把 staged/conflict 文件折叠成“其他 12 个文件”;风险范围不可审计。
- Bad:普通计划沿用 auto-loop 的 commit-only 文案;auto-loop 预授权不能泄漏到普通流程。
- Bad:为减少一次确认增加独立中间步骤流程、验证协议或新状态;现有计划和提交前预检已经足够。
- Bad:生成后出现预计列表外文件仍沿用旧确认,或仅因预计文件的 hash/统计变化重复询问用户。
- Bad:progress 记录 business commit hash 或 push mode,再让 finish-work 根据它决定是否 push。
- Bad:partial push、commit-only 或 auto-loop item completed 直接把 `task.json.status` 写成 completed。

### 6. Tests Required

- `git diff --check`
- `npm run sync` 后确认 vendor、`enhancements/0.6`、当前 `.agents` / `.claude` 对应 skill
  和 workflow override 语义一致。
- 静态扫描 post-check 文案,确认只允许检查结果/验证/风险/结论/下一步,且禁止
  `Proposed commits`、commit message、planned files 和提交确认。
- 静态扫描普通用户继续和当前 Check-All completion chain 内的 direct Git strict-pass 两条
  resume-chain，确认正常 workflow 仍沿用标准报告并经 Update-Spec 进入 `trellis-push`。
- 静态与行为测试覆盖显式 Push 在 Check-All/Update-Spec 未运行、已失效、findings、blocked、
  部分验证或 `needs-review` 时仍生成计划，并把状态写入“完成链证据”与风险区。
- 静态断言 `trellis-push` 不返回 Phase 2.2、不加载 `trellis-check-all` / `trellis-update-spec`、
  不包含运行/跳过检查二选一；auto-loop internal commit-only 继续复用既有
  `run_spec_update -> commit_only` 预授权而不重复记录交互证据。
- 静态扫描 Phase 3.4 文案,确认必须加载 `trellis-push`,普通默认 push,commit-only 仅来自
  明确用户意图或合法 auto-loop 预授权。
- 静态扫描最终 Phase 3.4，确认旧 `Proposed commits`、local-only、no-push walkthrough 已被
  `replace/remove` 消除，而不是依赖 Hub 优先级声明。
- 静态扫描 Hub，确认只登记 `trellis-push` owner 和必要跨阶段顺序，不重复 Skill 的展示细节。
- 用 8 个、9 个和超过 12 个目录分组行的模拟计划验证展示阈值;风险文件始终逐项显示。
- 模拟单仓、多仓、无活动任务、用户展开文件、计划漂移、部分仓库失败六类输出。
- 模拟普通多仓生成命令:生成后 dirty paths 未超出预计 exact files 时只确认一次;新增计划外
  dirty path 时停止并重新规划。静态确认 skill 没有独立 `Step 4.1`、validation 协议或新状态。
- 静态验证计划和结果模板保留原有总览/分仓结构,用户可见文本不单独使用裸 `retained`,
  retained dirty 与真正 risk 分区展示。
- 在临时 Git 仓库验证 `git commit --only -- <planned files>` 不消费计划外 staged 文件,
  并验证 retained-only 变化不会触发计划重确认。
- `python3 -m py_compile` 验证 `task_progress.py`；临时任务覆盖新 progress 读写、额外字段拒绝、
  legacy 读取与下一次 write 迁移、`--complete`、session pointer 保留、completed candidate、reopen，
  并模拟 schema 非法与 `os.replace` 失败，断言旧文件不变且无临时文件残留。
- 临时多仓/裸远端覆盖普通成功、部分失败、progress sync 失败和显式 commit-only;验证 progress
  commit 只包含首次确认的当前任务产物与更新后的 `task.json`,其他任务保持原状;commit-only
  不 push 也不生成远端 progress。
- 回归 `auto_loop.py start` 仍只接受/default `profile=commit-only`,并保持
  `run_check_all -> run_spec_update -> commit_only`;静态确认 runner `status/record` 只在
  `trellis-auto-loop` skill,不在 `trellis-push`。
- `trellis-continue` 全装/精细安装同时铺设 recovery Patch 与 `task_progress.py`，并覆盖所有平台
  原生 continue 入口；最终产物断言 progress status 位于 Phase Index 之前，completed 分支只指向
  finish-work/reopen，不恢复实现。

### 7. Wrong vs Correct

#### Wrong

```markdown
Check-all 已通过。
Proposed commits:
1. fix(api): 修复会话一致性
回复 ok 执行提交,不会推送。
```

问题:check 阶段越权生成 Phase 3.4 内容,且普通流程擅自选择 commit-only。

```markdown
缺少有效 Check-All。请选择：
- 运行 Check-All
- 跳过检查并继续 push
```

问题:Push owner 把审计状态升级成新的交互门禁，导致显式 Push 多一次确认。

#### Correct

```markdown
Check-all 已通过。
验证:5/5 通过。
剩余风险:Redis 未实机执行。
下一步:继续后自动执行 Phase 3.3,再进入 Phase 3.4 trellis-push。
```

```markdown
## Trellis Push 计划

[PUSH] 1 个仓库 · 1 个 commit · 2 个文件 · 保留未提交 1 · 风险 0
顺序：flower-trellis -> task progress

### 完成链证据
- Check-All：通过
- Update-Spec：written

### 1. flower-trellis
`fix(api): 修复会话一致性`
分支：`beta` -> `origin/beta`
变更：2 个文件
计划提交：src/api.js、test/api.test.js
Push：执行

### 保留未提交的变更（dirty）
- [untracked] notes/local.md

任务进度：completed=实现与检查 | partial=无 | next=finish-work
确认执行请回复 `确认`。
```

原因:check 报告与 Git 计划职责分离，正常完成链仍在用户继续后进入 Phase 3.3；显式 Push
进入 Phase 3.4 后只披露上游证据，不反向补门禁。默认 push、文件范围和一次确认都由唯一入口负责。

---

## Scenario: Finish-work Release Audit And Exact Bookkeeping

### 1. Scope / Trigger

- Trigger:Phase 3.4 已完成后显式运行 finish-work,工作区仍保留其他规划任务、旧 archive、
  其他窗口的 untracked/unstaged/staged 文件。
- Scope:`trellis-release audit-current` 负责当前任务单任务上线核对;finish-work 只负责调用该
  模式、当前任务 archive 与本次 journal bookkeeping;不重复提交业务代码,不把工作区整体
  clean 或任务进度当作提交/自动 push 条件。

### 2. Signatures

```bash
python3 ./.trellis/scripts/task_progress.py status --task <task> --json
python3 ./.trellis/scripts/task.py archive <task> --no-commit
```

```text
in_progress -> trellis-push final progress commit/push -> local write --complete -> completed
completed -> trellis-finish-work -> archive
completed -> explicit reopen -> in_progress
```

### 3. Contracts

- finish-work 必须先读取权威 `task.json` 生命周期；只有 `status=completed` 且 `completedAt` 存在
  才能进入 decision/release/archive。progress 文本不能替代状态。`in_progress` 返回 Phase 3.4，
  损坏/未知状态 fail closed；finish-work 不制造 completed。
- finish-work 在移动前记录 task source/name/children、branch、upstream、`HEAD` 与 upstream HEAD,
  以及 `@{u}..HEAD`;只有开始时 upstream 存在且两端 HEAD 完全相同才设置 `baseline_synced=true`。
- 归档前自动调用 `trellis-release audit-current`。该模式只读取当前任务 artifacts、现有
  `release.md` 和 Git 证据:高置信有上线事项时创建/更新 task `release.md`;高置信无事项时
  no-op;证据不确定时写 `Needs human review`。它不生成 `.trellis/releases/` 批次文件、不确认、
  不提交/推送，也不执行 SQL、配置、脚本或外部系统操作。
- 普通 `trellis-release` 批次模式仍按既有任务集合核对、生成批次草案并在写盘前等待用户确认;
  `audit-current` 的无确认语义不得泄漏到批次模式。
- archive 和 journal 写入统一使用原生命令的 `--no-commit`,再由 finish-work 使用 exact paths
  和 `git commit --only` 生成 bookkeeping commits。
- archive commit 只允许归档前源路径、`task.py archive` stdout 返回的
  `.trellis/tasks/archive/YYYY-MM/<task>` 目标路径,以及实际被修改的 child `task.json`。
  禁止暂存 `.trellis/tasks/archive`、`.trellis/tasks`、`.trellis/workspace` 或 `.trellis` 根目录。
- journal commit 只允许 `add_session.py` 本次实际修改的 journal/index 文件。计划外 staged
  文件在提交前后必须保持原状。
- `session_auto_commit=false` 时只落盘和报告精确 dirty paths,不生成 bookkeeping commit,
  不自动 push。
- `baseline_synced=true` 时,完成 exact bookkeeping commits 后确认 branch/upstream 未变化,且
  新增 ahead set 只包含本轮 archive/journal commits,然后自动 push。无关 dirty/staged 不阻断。
- finish-work 开始时已有 ahead、分支 behind/diverged、无 upstream,或执行期间出现并发 commit /
  branch/upstream 变化时,完成本地 bookkeeping commits 但不自动 push。不得读取 progress 或
  legacy task 字段决定 Git 行为。
- `task.py archive` 重复 completion-state 与 decision guard，只接受 completed + completedAt；归档
  只移动目录、清理指针和维护 parent/child 关系，不重写 status/completedAt。归档 completed 父任务
  时只清活动子任务的 `parent`，不得改变子任务 status/progress。

### 4. Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| 其他规划任务存在 untracked 文件 | 保留并报告;继续当前任务 archive/journal commit |
| 旧 archive 下存在未跟踪任务 | 不纳入 exact destination;继续 |
| index 中已有计划外 staged 文件 | `git commit --only` 隔离并验证 staged 列表保持不变 |
| 当前任务 status=in_progress | archive 前停止并返回 Phase 3.4 `trellis-push` |
| 当前任务 status=completed 且 completedAt 存在 | 保留活动指针进入 decision/release/archive |
| completedAt 缺失、task.json 损坏或未知状态 | fail closed，不运行 release/archive/journal |
| audit-current 高置信无上线事项 | status=no-op,不创建 release.md,继续 finish-work |
| audit-current 高置信有上线事项 | 写/更新当前任务 release.md,由 archive 自然纳入 |
| audit-current 证据不确定 | 写 Needs human review,继续并在最终结果保留风险 |
| 开始时 `HEAD == upstream HEAD` | push 本轮 bookkeeping commits,不要求工作区 clean |
| finish-work 前已有 ahead commits | 完成本地 bookkeeping commits,不自动 push |
| 无 upstream 或分支 behind/diverged | 完成本地 bookkeeping commits,不猜测远端目标 |
| `session_auto_commit=false` | 只落盘,不 commit/push |

### 5. Good / Base / Bad Cases

- Good:普通 push 已同步最终 progress，随后本地原子激活 active + completed；用户显式 finish-work 后
  由 archive bookkeeping commit 承接完成态，archive 内保留原 completedAt，session 指针才被清理。
- Base:completed 父任务有一个 in_progress 子任务；归档父任务只把子任务 parent 置空，子任务继续活动。
- Bad:finish-work 看到 progress.nextStep=archive 就替 in_progress 任务写 completed 并移动目录。
- Bad:archive 每次重写 completedAt，丢失真实业务完成日期。

### 6. Tests Required

- 临时仓库中同时创建当前任务、旧 archive、其他规划任务 untracked 文件和计划外 staged 文件;
  验证 archive/journal commits 的 `git show --name-only` 只包含 exact allowed paths。
- 验证两个 `git commit --only` 完成后,计划外 staged/untracked/unstaged 状态保持不变。
- 验证 `audit-current` 的 `no-op` / `written` / `needs-review` 三种结果,并回归普通批次模式仍需确认。
- 验证工作区 dirty 但开始 `HEAD == upstream HEAD` 时允许 push;验证开始已有 ahead、无 upstream、
  behind/diverged 时只生成本地 bookkeeping commits。
- 验证 archive 拒绝 in_progress/缺 completedAt，接受 completed 并保留 completedAt；覆盖 decision
  失败零写入、completed parent/child 解除关系和归档后 session pointer 清理。
- 静态扫描 finish-work override,确认不再出现“`git status --porcelain` clean 才 push”或暂存
  archive/workspace 根目录的指令,也不包含 release 证据推断正文或 progress/legacy Git 联动。

### 7. Wrong vs Correct

#### Wrong

```text
finish-work -> task.py archive writes completed -> move task -> clear pointer
```

#### Correct

```text
trellis-push -> push final progress while in_progress -> local atomic completed + completedAt
finish-work -> validate completed -> decision/release audit -> archive without lifecycle rewrite
```

原因:业务完成与会话收尾是两个可恢复边界；`completed` 必须在归档前可被 workflow-state、continue
和 session 恢复观察，archive 只负责最终移动与 bookkeeping。

---

## Faithful Porting (溯源)

大量逻辑是从 skill-garden `install.sh` **逐字符移植**而来(`fs-utils` 的 `install_one`、
`variant.js` 263-274、`copy-skills` 的 `should_install`、`workflow-inject` 的 362-557
内嵌 Python)。约束:

- 改这些逻辑前先核对上游 install.sh 对应段落,保持语义一致。
- 移植代码要保留「移植自 install.sh xxx」的 Why 注释,标明出处与对齐点。
- `constants.js` 的平台/变体名单同理,与 Trellis `cli/index.ts`、skill-garden 对齐。

---

## Common Mistakes

- 改了叠加逻辑却不跑 `npm run sync` 重建快照,或反过来改了快照不对应上游版本。
- 只改 `enhancements/0.6/` 中的 skill / workflow 覆盖,没有改
  `vendor/skill-garden/.trellis/0.6/` 源 —— 下一次 `npm run sync` 会覆盖掉手工快照改动。
- 把本地状态读写、JSON/key-value 解析和长 fallback 规则塞进高频 workflow/state 文案,
  而不是下沉到随 skill 分发的 helper 脚本。
- 在 `--skills` 精细模式下触发 manifest 清理 —— 清理只允许全装。
- 注入/写盘类新逻辑没做「内容相同则不写」的幂等判断。
- 移植上游逻辑时「优化」掉了与 install.sh 的一致性,导致升级行为漂移。
