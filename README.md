# flower-trellis

[![npm version](https://img.shields.io/npm/v/flower-trellis.svg)](https://www.npmjs.com/package/flower-trellis)
[![node](https://img.shields.io/node/v/flower-trellis.svg)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/flower-trellis.svg)](./LICENSE)

> 一条命令装好 [Trellis](https://docs.trytrellis.app/) 工程框架,并自动融合 **skill-garden** 强化包。

`flower-trellis` 是 Trellis 的 npm 封装 CLI,把原本要分两步的工作合并为一键完成:安装/升级 Trellis 本体,并在其上叠加 skill-garden 的强化包(一组 `trellis-*` 技能与统一 Patch catalog)。强化包以快照形式随包发布,安装过程**零网络依赖**。

底层调用官方 `@mindfoldhq/trellis` 的 `init` / `update`,并按目标项目的 Trellis 版本自动选择匹配的强化包变体(`old` / `0.5` / `0.6`)。

> **命名由来**:`flower-` 是这一系列 AI 工程工具的统一前缀(flower 系列),`trellis` 表示本工具负责包装 Trellis 框架。

## 安装

```bash
# 全局安装(推荐),之后可用 flower-trellis 或简写 ftl / ft
npm i -g flower-trellis

# 升级到最新版
npm i -g flower-trellis@latest

# 体验 beta 预发布版(显式 opt-in)
npm i -g flower-trellis@beta
```

也可**免安装**通过 `npx flower-trellis <命令>` 直接运行(每次执行拉取最新版,适合临时试用)。

**环境要求**:Node.js ≥ 18.17.0。

全局安装 / 升级 `flower-trellis` 时会同步全局 `@mindfoldhq/trellis` 到当前捆绑版本,因此直接运行 `trellis ...` 也会与 `flower-trellis -v` 中的 `trellis (bundled)` 保持一致。若全局 npm 目录权限不足导致同步失败,安装会中止并提示手动执行的命令,例如:

```bash
npm install -g @mindfoldhq/trellis@<版本号>
```

`npx flower-trellis ...` 属于临时免安装运行,不会改写本机全局 `trellis`。

## 用法

```bash
# 交互安装:平台多选菜单 → Trellis 原生模板/monorepo 菜单
flower-trellis init -u <your-name>

# 指定平台,跳过平台菜单(透传给 trellis)
flower-trellis init -u <your-name> --claude

# 完全非交互(平台默认 codex + claude)
flower-trellis init -u <your-name> -y

# 升级 Trellis 并按新版本重新叠加强化包
flower-trellis update

# 临时保留最近 5 份升级备份；传 0 可关闭本次自动清理
flower-trellis update --backup-retention 5

# 检查当前项目是否需要更新(稳定 JSON,供 AI / hook 使用)
flower-trellis self-check --json --target .

# 执行受控自更新:升级 flower-trellis,再默认 --force 重叠加当前项目
flower-trellis self-update --target . --yes

# 管理启动更新检查策略
flower-trellis update-check get --target .

# 查看或修改匿名安装遥测开关
flower-trellis telemetry status

# 卸载:移除 Trellis 本体并清理强化包残留
flower-trellis uninstall

# 查看版本(flower-trellis 自身 + 捆绑的 Trellis)
flower-trellis -v
```

> 已全局安装时可直接写 `flower-trellis`、`ftl` 或 `ft`(三者等价);未安装则在命令前加 `npx`。

为统计安装活跃度和版本分布，CLI 默认在远程版本检查及 `init` / `update` 成功后上报随机设备 ID、Flower/Trellis 版本、项目 `.trellis/.developer` 名称和运行平台；不采集 MAC、主机名、系统用户名、项目路径或仓库地址。可用 `flower-trellis telemetry disable` 持久停用，或用 `FLOWER_NO_TELEMETRY=1` 临时停用。

### 命令

| 命令 | 说明 |
|------|------|
| `init` | 安装 Trellis 并叠加强化包(默认命令,裸跑等同 `init`) |
| `update` | 升级 Trellis,并按新版本重新叠加强化包 |
| `self-check` | 输出启动更新检查 JSON,供 Codex / Claude Code hook 和 AI 自动化读取 |
| `self-update` | 受控升级 flower-trellis 并对目标项目执行完整 `flower-trellis update` 重叠加 |
| `update-check` | 管理 `.flower/settings.json` 内的启动更新策略和提示节流 |
| `telemetry` | 查询、启用或停用用户级匿名安装遥测 |
| `plugin` | 管理 Flower Plugin、Marketplace 来源、GitLab 授权和作者校验 |
| `uninstall` | 移除 Trellis 本体并清理强化包残留(支持 `-y` / `--dry-run`) |
| `<其它命令>` | 原样透传给 Trellis,覆盖其现有及未来子命令 |
| `-v` / `-h` | 打印版本 / 帮助 |

### 选项

| 选项 | 说明 |
|------|------|
| `--no-enhance` | 只安装 Trellis,不叠加强化包 |
| `--enhance-only` | 跳过 Trellis,仅叠加强化包(用于已有项目) |
| `--skills <a,b,...>` | 只安装指定技能(可省略 `trellis-` 前缀) |
| `--variant <old\|0.5\|0.6>` | 强制指定强化包变体(默认按 `.trellis/.version` 自动选) |
| `--target <dir>` | 目标目录(默认当前目录) |
| `--no-update-check` | 本次跳过 flower-trellis 新版本检测(等价环境变量 `FLOWER_NO_UPDATE_CHECK=1`) |
| `--backup-retention <n>` | `update` 成功后保留最近 n 份 `.trellis/.backup-<timestamp>` 快照(默认 3，`0` 表示本次不清理) |

未指定平台时,交互模式会弹出多选菜单(默认勾选 Claude Code + Codex);也可直接传 `--claude` / `--codex` / `--cursor` / `--devin` / `--zcode` / `--trae` / `--omp` / `--grok` / `--kimi` / `--snow` 等指定,或用 `-y` 跳过菜单。`--windsurf` 仍作为 Devin 的旧别名透传给 Trellis。其余未识别的 flag(如 `-u`、`-f`、`--template`、`--with-statusline`)一律透传给 Trellis。

## Flower Plugin

Flower Plugin 是 flower-trellis 的标准运行时格式。GitHub 公共仓库可自动识别 Flower、Codex、Claude Code 与 Skill-only 包，并先规范化为标准 Flower package，再进入同一套来源解析、依赖锁定、能力校验、内容投影、事务写入和卸载所有权。外部 `skills/` 与 Claude legacy `commands/*.md` 可导入；hooks、agents、MCP、LSP、monitor、bin、settings、themes、output styles 和 apps 只展示兼容性诊断，不会执行。

完整 `flower-trellis init` 会安装 Trellis,并默认声明和应用内置 `flower/skill-garden`。普通用户只需打开 Plugin 管理器:

```bash
flower-trellis plugin
```

交互管理器采用 `发现 / 已安装 / 来源 / 问题` 四个页签。Trellis 项目的 `发现` 页会展示 `flower/skill-garden` 内置入口，按 Enter 直接管理工作流强化与可选通用技能；原 `flower-trellis skill` 命令继续保留为高级兼容入口。`发现` 同时合并全部已启用来源的 Plugin，并保留来源标签和即时搜索；未登录 GitLab 来源会直接进入 Device Flow，GitHub 公共来源无需登录。`来源` 页的“新增来源”可选择 GitHub 公共仓库或 GitLab Marketplace；GitHub 会先在临时缓存中下载固定快照、检测格式、展示可导入与忽略组件，确认后才保存。ref 留空时使用仓库默认分支；出现多个格式入口时会要求选择，公开 GitHub 跨仓 Marketplace 条目和 `plugins/*` 多 Plugin 仓库也可识别。

可选通用技能包含 `aliyun-dms-query` 与 `aliyun-sls-query`：前者通过阿里云 DMS 查询纳管数据库，并让写操作以数据变更工单进入审批流；后者提供零第三方依赖的阿里云 SLS 查询脚本与排障知识。两者都支持 Codex / Claude 项目，默认不安装，也不会复制用户私有 AK/SK 配置。

安装、更新和卸载都会先展示 dry-run、依赖、capability 和目标文件变化，确认后才写入项目。Plugin 作者使用的 `plugin init`、`plugin validate` 继续保留在高级命令中，不占用普通用户的管理器首页。

独立的 `plugin add` 只建立最小 Plugin Runtime,安装目标 Plugin 及其显式依赖,不会隐式安装 `skill-garden`,因此交互管理器也可以在没有 `.trellis/` 的普通项目中使用。

项目状态分为可提交期望与本机应用结果:

| 路径 | 边界 |
|------|------|
| `.flower/plugins.json` | 可提交;只记录用户直接声明的 Plugin |
| `.flower/plugin-lock.json` | 可提交;记录固定版本、完整依赖图、来源与完整性摘要 |
| `.flower/state.json` | 本机;记录实际平台、生成路径、ownership 与 Patch provenance |
| `.flower/cache/`、`.flower/transactions/` | 本机;可清理缓存与事务恢复证据 |

`rd-guide` 是随包预注册、默认启用但惰性访问的 GitLab Marketplace。打开管理器后，`发现` 页会在已有凭据时读取远程目录；未登录时只展示授权入口，不会尝试读取仓库内容。普通交互默认使用 Device Flow，PKCE 浏览器登录保留为来源详情中的高级选项。OAuth 只申请 `read_api read_repository`，Application Secret 和 token 都不会写入项目文件。

GitHub 首版只支持 `github.com` 公共仓库和匿名 REST，不保存 PAT 或其它凭据。来源会固定确认后的格式入口；安装 lock 固定完整 commit 与 canonical digest，通过 Marketplace 发现时还会固定索引仓库和索引 commit。匿名 API 可能受每小时 60 次/IP 的主要限额影响，限流会显示为 GitHub 诊断，不会转成登录提示。

能力分为 `standard`、`integration`、`system`:外部 Plugin 不能获得 `system`;`integration` 的首次 Patch 需要项目确认,批准摘要随锁文件冻结,版本、内容或权限变化后必须重新确认。所有 Patch 在统一 preflight 后进入事务 writer,任一 required operation 失败都应保持零写入。

### 高级与自动化接口

显式子命令主要供 CI、高级调试和不可交互环境使用。完整参数以 `flower-trellis plugin --help` 为准:

```bash
flower-trellis plugin list --json
flower-trellis plugin add local/example --source plugins/example --platform codex
flower-trellis plugin verify local/example --json
flower-trellis plugin update local/example --dry-run --json
flower-trellis plugin remove local/example --dry-run --json
flower-trellis plugin source list --json
flower-trellis plugin source add public-guides --type github --repo owner/repository --ref main --format auto --json
flower-trellis plugin auth login rd-guide
flower-trellis plugin search --source rd-guide --json
flower-trellis plugin add rd-guide/example --platform codex --dry-run --json
```

维护 Plugin 或 Marketplace 时使用高级作者命令；这些命令复用 Runtime 的 manifest、完整性、依赖和 capability 真源:

```bash
flower-trellis plugin init --id rd-guide/example --name "示例规范" --profile standard --non-interactive
flower-trellis plugin validate .flower-plugin --subject plugin --json
flower-trellis plugin add flower/flower-plugin-author --platform codex --json
```

旧 `.trellis/.flower-manifest.json` 只作为迁移证据读取。下一次完整 init/update 会把期望、锁定和本机状态迁移到 `.flower/`,保留旧文件供核对;普通 `flower-trellis update` 重放已锁定版本,只有显式 `plugin update` 才解析外部 Plugin 新版本。

### 升级备份保留

上游 `trellis update` 会在写入前创建 `.trellis/.backup-<timestamp>/` 完整快照。
`flower-trellis update` 在 Trellis 更新、强化包叠加和本地配置恢复流程完成后，默认只保留最近 3 份：

- 只有名称严格符合时间戳格式的直接子目录会参与清理；`.trellis/.backup-flower/`、普通文件、
  软链接和相似名称目录不会被删除。
- 更新失败时不清理，并保留本轮上游已经创建的备份。
- `--dry-run` 只展示预计保留和删除的备份，不修改文件系统。
- `--backup-retention 0` 可关闭本次自动清理；该设置只影响当前命令，不写入项目配置。
- `self-update` 可通过 `--` 传入覆盖值，例如
  `flower-trellis self-update --target . --yes -- --backup-retention 5`。

### 自动版本检测

运行 `init` / `update` 时,flower-trellis 会顺带检测**自身**在 npm 上是否有新版本:

- **联网、尽力而为**:带 5s 超时,离线 / 超时 / 失败一律静默跳过,绝不阻断安装/升级主流程。
- **稳定版安装**:只跟随 npm `latest` 通道;发现稳定新版时安装已确认的精确版本,并使用 `--prefer-online` 避免旧 metadata 缓存。
- **beta 版安装**:版本号形如 `0.3.0-beta.1`,会同时检查 `beta` 与 `latest`;若 `latest` 已高于当前 beta,优先回归稳定版,否则安装已确认的精确 beta 版本。
- **发现新版**(交互终端):提示并询问是否立即升级;同意则执行推荐的安装命令,成功后请按提示重新运行命令(升级后强化包随新版更新,可再跑一次 `ft update` 重新叠加)。
- **非交互**(`-y` 或非 TTY):仅打印一行升级提示,不弹确认、不阻塞。
- **跳过检测**:经 `npx` 运行(本就是最新版)、或显式 `--no-update-check` / `FLOWER_NO_UPDATE_CHECK=1` 时不检测。

### 启动更新检查

运行 `flower-trellis init` / `flower-trellis update` 后,目标项目会安装轻量启动 hook:

- Codex:向 `.codex/hooks.json` 的 `SessionStart` 追加 `.trellis/scripts/flower_update_hook.py`。
- Claude Code:只向 `.claude/settings.json` 的 `SessionStart` `startup` matcher 追加该 hook,不挂 `clear` / `compact`。

启动 hook 不会直接安装 npm 包,也不会直接改项目文件。它只调用:

```bash
flower-trellis self-check --json --target .
```

发现可更新或项目已铺版本不一致时,向 AI 注入 `<flower-update>` 上下文。无更新、离线、关闭检查、npx 临时运行时默认不打扰;同一更新提示会按本机提示节流状态降噪。

检查分两层:

- **本地一致性检查**:每次启动都会比对当前安装的 `flower-trellis` / 捆绑 Trellis 版本与项目 `.flower/plugin-lock.json` / `.trellis/.flower-manifest.json` / `.trellis/.version`;不受 `intervalHours` 限制。
- **远程版本探测**:访问 npm registry 读取 `flower-trellis` dist-tags;受 `intervalHours` 节流,带超时,失败静默。
- **提示节流**:同一更新提示默认 24 小时内只注入一次;用户选择稍后时默认 7 天不再提示,选择跳过时同一版本不再提示。

策略保存在 `.flower/settings.json` 的 `updateCheck`;运行缓存保存在 gitignored 的 `.flower/update-check.tmp`,避免 `lastCheckedAt` / `lastPromptedAt` 等字段反复污染 git。旧 `.trellis/.flower-manifest.json` 和 `.trellis/.flower-update-check.tmp` 只作为兼容 fallback 读取。

settings 中只保留用户策略:

```json
{
  "updateCheck": {
    "enabled": true,
    "policy": "ask",
    "intervalHours": 8
  }
}
```

tmp 中保存本地运行缓存:

```json
{
    "lastCheckedAt": "2026-07-07T00:00:00.000Z",
    "lastRemote": { "latest": "0.4.2", "beta": null },
    "lastReleaseNotes": null,
    "lastStatus": "update_available",
    "lastErrorCode": null,
    "lastPromptedAt": "2026-07-07T00:05:00.000Z",
    "lastPromptedKey": "update:latest:0.4.2",
    "promptSuppressedUntil": null,
    "promptSuppressedKey": null,
    "promptSuppressionReason": null
}
```

旧项目如果已经在 manifest 的 `updateCheck` 里带有缓存字段,新版本会先读取兼容,并在下一次写入时清理这些旧字段。

`policy` 可选:

| policy | 行为 |
|--------|------|
| `off` | 不做启动更新检查,也不联网 |
| `notify` | 只注入提示和手动命令,AI 不主动询问或执行 |
| `ask` | 默认值;AI 发现可更新后先询问用户 |
| `auto` | 安全条件满足时 AI 可执行 `self-update`;dirty 工作区或活跃任务等情况会降级为 `ask` |

管理策略:

```bash
flower-trellis update-check get --target .
flower-trellis update-check set --policy auto --interval-hours 12 --target .
flower-trellis update-check disable --target .  # 只设置 enabled=false,不改 policy
flower-trellis update-check enable --target .   # 只设置 enabled=true,沿用原 policy
flower-trellis update-check snooze --target .   # 延后当前提示,默认 7 天
flower-trellis update-check snooze --days 3 --target .
flower-trellis update-check skip --target .     # 跳过当前提示 key
flower-trellis update-check reset --target .    # 清空提示节流状态
```

执行更新:

```bash
# 预览,不写入
flower-trellis self-update --target . --dry-run

# 执行:先升级全局 flower-trellis,再对项目执行完整 update
flower-trellis self-update --target . --yes
```

项目重叠加阶段默认等价于 Trellis 交互里的 **Apply Overwrite to all**:

```bash
flower-trellis update --target . --no-update-check --force
```

如需改用其它上游冲突策略,在 `--` 后透传:

```bash
flower-trellis self-update --target . --yes -- --skip-all
flower-trellis self-update --target . --yes -- --create-new
```

## 工作原理

`init` 的执行流程:

```
flower banner → 平台多选菜单 → Trellis 原生交互(模板 / monorepo / 冲突)→ 叠加强化包 → 平台后处理
```

- **统一品牌头部**:Trellis 子进程在伪终端(`node-pty`)中运行,其原生的模板 / monorepo / 冲突等交互完整保留,但重复打印的启动 banner 被过滤,全程只呈现一个 flower banner。
- **按平台铺设技能**:Claude 铺到 `.claude/skills`,Codex / Gemini 等铺到 `.agents/skills`;并做平台后处理:Codex 兼容清理旧 `config.toml` 的 `[features.multi_agent_v2]`,在保留上游 hooks 的基础上补全 `SessionStart`;Claude Code 只在 `startup` SessionStart 挂载启动更新检查。
- **幂等执行**:0.6 Patch 使用受管 marker 原位升级，完整预检通过后只写 changed 文件，首次修改前备份到 `.trellis/.backup-flower/`；技能资产覆盖式铺设，并通过 `.trellis/.flower-manifest.json` 精确清理已淘汰路径。0.5/old 继续使用兼容注入路径。
- **结构化 Patch**:Trellis 0.6 的 workflow、skill、hook 与平台配置统一通过 `insert / replace / remove` 预检后应用；selector/baseline 或已知最终协议冲突时在写入前停止。
- **上线事项账本**:强化包通过 Finish-Work Patch 在归档前智能识别 SQL、配置、批处理 / 部署脚本 / 数据修复、外部系统 / 依赖平台等上线事项,必要时写入任务 `release.md`;`trellis-release` 可在正式上线前核对任务文档、`release.md` 和 git 证据,生成 `YYYY-MM-DD-<release-slug>.md` 格式的版本 / 批次操作单。
- **安全中止**:`Ctrl+C` 取消后不会继续叠加。

## 强化包与更新

强化包以**快照**形式打包在 `enhancements/`(由 `npm run sync` 从 skill-garden 同步),随 npm 发布。因此两者更新节奏不同:

- **Trellis 本体**:`update` 实时升级(由 Trellis 自身拉取最新)。
- **强化包**:使用当前安装版本内置的快照。要跟进 skill-garden 的迭代,需升级 flower-trellis 本身:

  ```bash
  npm i -g flower-trellis@latest && flower-trellis update
  ```

- **0.6 兼容门禁**:当前强化快照已登记 Trellis `0.6.12`。未登记的同一 `0.6.x` 会显示 `untested-upstream` 警告，并在完整 Patch/冲突检查通过后继续；`0.7+` / `1.x` 不会自动复用 0.6 baseline。遇到未支持的新版本时，先升级 flower-trellis，或使用 `--no-enhance` 只运行纯上游 Trellis。

- **通用技能**:`flower-trellis update` 会用新版快照覆盖仓库中已经启用的 common skill,
  未启用项不会自动安装;若某个已安装 common skill 已从新版快照移除,更新会精确删除其
  `.codex/skills` / `.claude/skills` 或历史 `.agents/skills` 副本。

## 开发

skill-garden 强化包源以 **git submodule** 形式挂在 `vendor/skill-garden`,克隆时需一并拉取:

```bash
# 首次克隆(连同 submodule)
git clone --recurse-submodules https://github.com/SilentFlower/flower-trellis.git

# 已普通克隆过、vendor/skill-garden 为空时补拉
git submodule update --init --recursive
```

```bash
npm install                                    # 安装依赖
npm run sync                                   # 从 vendor/skill-garden 同步强化包快照到 enhancements/
node bin/flower-trellis.js init -u you --target /tmp/test-project   # 本地试跑(勿在本仓库根直接 init)
```

> `npm run sync` 默认从 submodule `vendor/skill-garden` 读取;可用环境变量 `SKILL_GARDEN_DIR=/path/to/skill-garden` 覆盖到外部副本(旧布局逃生通道)。

**更新强化包**(skill-garden 有新提交时,先动 pin 再重建快照):

```bash
cd vendor/skill-garden && git fetch && git checkout origin/main && cd ../..
git add vendor/skill-garden            # 登记新的 submodule pin
npm run sync                           # 重建 enhancements/ 快照(sourceCommit 跟随新 pin)
git add enhancements && git commit -m "chore: 更新强化包快照到 <sha>"
```

> **维护约束**:`workflow.md` 的旧块清理依赖 `src/lib/workflow-inject.js` 中硬编码的 sentinel 名单。修改现有块的内容无需改动名单;但当 skill-garden **新增一种 workflow 块类型**(新的 `BEGIN/END` 名)时,必须同步更新该名单,否则旧块无法被清除。

## 发布

采用「本地把关 + CI 发布」的混合流程,版本更新内容以 `CHANGELOG.md`(由 Conventional Commits 自动生成)为唯一来源:

```bash
# 1) 本地:按约定式提交自动定版本号 + 写 CHANGELOG + 打 tag(不 push、不 publish)
npm run release          # = check-snapshot(校验快照一致)+ commit-and-tag-version
npm run release:dry      # 仅预览版本号与 CHANGELOG,不落盘

# 2) 检查 CHANGELOG / package.json 版本 diff,确认无误后连 tag 一起推送
git push --follow-tags origin main
```

### 稳定版发布

推送 `vX.Y.Z` tag 后,GitHub Actions(`.github/workflows/release.yml`)自动完成:

- **`npm publish`** —— 发布到 npm `latest` dist-tag,经 npm **OIDC Trusted Publishing** 发布,自动带 provenance 来源证明,**无需** `NPM_TOKEN`。
- **`gh release create`** —— 创建 GitHub Release,notes 取自 `CHANGELOG.md` 对应版本段(与 CHANGELOG 同源)。

### Beta 发布

beta 版本必须使用 semver prerelease,例如 `0.3.0-beta.1`,并发布到 npm `beta` dist-tag:

```bash
# 方式一:让 commit-and-tag-version 生成下一个 beta 版本
npm run release -- --prerelease beta

# 方式二:明确指定 beta 版本
npm run release -- --release-as 0.3.0-beta.1

# 确认 diff 后推送发布分支与 tag
git push --follow-tags origin <branch>
```

推送 `vX.Y.Z-beta.N` tag 后,同一个 GitHub Actions(`.github/workflows/release.yml`)会自动执行 `npm publish --tag beta`,并创建 GitHub prerelease。workflow 会根据 tag 是否包含 `-beta.` 选择 `latest` 或 `beta` 通道,避免 beta 误发到 `latest`。

> **一次性前置**:首次发布前需在 [npmjs.com](https://www.npmjs.com) 的本包设置里配置 **Trusted Publisher**,绑定 `SilentFlower/flower-trellis` 仓库与唯一 workflow `release.yml`,否则 OIDC 发布会失败。
>
> **发布前自检**:`npm run release` 会先跑 `scripts/check-snapshot.mjs`,确保 `enhancements/` 快照与 `vendor/skill-garden` 当前 pin 一致且已提交,杜绝发布陈旧快照。

## 相关项目

| 项目 | 作用 |
|------|------|
| [Trellis](https://docs.trytrellis.app/)(`@mindfoldhq/trellis`) | AI 编程工程框架本体,本包作为 wrapper 调用其 `init` / `update` / `uninstall` |
| skill-garden | 强化包来源,提供 `old` / `0.5` / `0.6` 各变体 |

## 许可证

[MIT](./LICENSE)
