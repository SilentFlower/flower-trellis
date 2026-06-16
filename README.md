# flower-trellis

[![npm version](https://img.shields.io/npm/v/flower-trellis.svg)](https://www.npmjs.com/package/flower-trellis)
[![node](https://img.shields.io/node/v/flower-trellis.svg)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/flower-trellis.svg)](./LICENSE)

> 一条命令装好 [Trellis](https://docs.trytrellis.app/) 工程框架,并自动融合 **skill-garden** 强化包。

`flower-trellis` 是 Trellis 的 npm 封装 CLI,把原本要分两步的工作合并为一键完成:安装/升级 Trellis 本体,并在其上叠加 skill-garden 的强化包(一组 `trellis-*` 技能与 workflow override)。强化包以快照形式随包发布,安装过程**零网络依赖**。

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

# 卸载:移除 Trellis 本体并清理强化包残留
flower-trellis uninstall

# 查看版本(flower-trellis 自身 + 捆绑的 Trellis)
flower-trellis -v
```

> 已全局安装时可直接写 `flower-trellis`、`ftl` 或 `ft`(三者等价);未安装则在命令前加 `npx`。

### 命令

| 命令 | 说明 |
|------|------|
| `init` | 安装 Trellis 并叠加强化包(默认命令,裸跑等同 `init`) |
| `update` | 升级 Trellis,并按新版本重新叠加强化包 |
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

未指定平台时,交互模式会弹出多选菜单(默认勾选 Claude Code + Codex);也可直接传 `--claude` / `--codex` / `--cursor` 等指定,或用 `-y` 跳过菜单。其余未识别的 flag(如 `-u`、`-f`、`--template`)一律透传给 Trellis。

### 自动版本检测

运行 `init` / `update` 时,flower-trellis 会顺带检测**自身**在 npm 上是否有新版本:

- **联网、尽力而为**:带 2.5s 超时,离线 / 超时 / 失败一律静默跳过,绝不阻断安装/升级主流程。
- **稳定版安装**:只跟随 npm `latest` 通道;发现稳定新版时提示 `npm i -g flower-trellis@latest`。
- **beta 版安装**:版本号形如 `0.3.0-beta.1`,会同时检查 `beta` 与 `latest`;若 `latest` 已高于当前 beta,优先提示 `npm i -g flower-trellis@latest`,否则提示更新到 `npm i -g flower-trellis@beta`。
- **发现新版**(交互终端):提示并询问是否立即升级;同意则执行推荐的安装命令,成功后请按提示重新运行命令(升级后强化包随新版更新,可再跑一次 `ft update` 重新叠加)。
- **非交互**(`-y` 或非 TTY):仅打印一行升级提示,不弹确认、不阻塞。
- **跳过检测**:经 `npx` 运行(本就是最新版)、或显式 `--no-update-check` / `FLOWER_NO_UPDATE_CHECK=1` 时不检测。

## 工作原理

`init` 的执行流程:

```
flower banner → 平台多选菜单 → Trellis 原生交互(模板 / monorepo / 冲突)→ 叠加强化包 → codex 后处理
```

- **统一品牌头部**:Trellis 子进程在伪终端(`node-pty`)中运行,其原生的模板 / monorepo / 冲突等交互完整保留,但重复打印的启动 banner 被过滤,全程只呈现一个 flower banner。
- **按平台铺设技能**:Claude 铺到 `.claude/skills`,Codex / Gemini 等铺到 `.agents/skills`;并对 codex 做后处理(兼容清理旧 `config.toml` 的 `[features.multi_agent_v2]`,在保留上游 hooks 的基础上补全 `SessionStart`)。
- **幂等执行**:`workflow.md` 注入前先按 `BEGIN/END` 标记清除旧块再重注入(块数恒定,不会翻倍,首次注入前备份 `.bak`);技能文件覆盖式铺设,并通过 `.trellis/.flower-manifest.json` 记录已铺路径,升级时删除已淘汰项。
- **安全中止**:`Ctrl+C` 取消后不会继续叠加。

## 强化包与更新

强化包以**快照**形式打包在 `enhancements/`(由 `npm run sync` 从 skill-garden 同步),随 npm 发布。因此两者更新节奏不同:

- **Trellis 本体**:`update` 实时升级(由 Trellis 自身拉取最新)。
- **强化包**:使用当前安装版本内置的快照。要跟进 skill-garden 的迭代,需升级 flower-trellis 本身:

  ```bash
  npm i -g flower-trellis@latest && flower-trellis update
  ```

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
