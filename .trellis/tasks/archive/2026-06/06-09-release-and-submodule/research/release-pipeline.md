# Research: 发布链路最佳实践(本地 vs GitHub Actions vs 混合)

- **Query**: 为单人维护的小型 npm CLI 包(flower-trellis,发布到 npm + GitHub,Conventional Commits)调研 2026 年版本发布链路最佳实践,在 A(纯本地一键)/ B(纯 GitHub Actions tag 触发)/ C(混合:本地 bump+changelog+tag,CI 发布)三者间取舍
- **Scope**: external(web 调研)+ internal(项目事实核对)
- **Date**: 2026-06-09

---

## 0. 本项目已确认事实(来自仓库核对)

| 事实 | 值 | 影响 |
|---|---|---|
| 包形态 | 单包 npm CLI,`name=flower-trellis`,`version=0.2.1` | 不涉及 monorepo / 多包 |
| 远程 | `https://github.com/SilentFlower/flower-trellis.git`(HTTPS) | GitHub Release 走 GitHub API |
| npm 登录 | 本机已登录账号 `flower-ai`(`npm whoami` 确认) | 本地 publish 现成可用 |
| `gh` CLI | **本机无**(`which gh` → exit 1) | 纯本地建 GitHub Release 缺工具,见 §5 |
| submodule | 当前**无** `.gitmodules`,`git submodule status` 空 | 见 §4 |
| 提交风格 | Conventional Commits(中文描述) | changelog 工具可直接消费 |
| CHANGELOG / Release / CI | 当前都没有 | 本任务从零搭建 |
| `package.json` | 有 `prepublishOnly`→`sync-enhancements.mjs`;`files` 只发 `bin/src/enhancements/README` | publish 前会跑 sync;tarball 不含 submodule 源 |

> 用户偏好:CHANGELOG.md 与 GitHub Release **两者都要**,**CHANGELOG 为唯一来源**(Keep a Changelog 风格)。

---

## Findings

### Q1. 三种发布执行位置的取舍

#### 对比表

| 维度 | A. 纯本地一键 | B. 纯 GitHub Actions(tag 触发) | C. 混合(本地 bump+changelog+tag push,CI 发布) |
|---|---|---|---|
| 谁跑 bump/changelog | 本地工具 | CI(或在本地仅打 tag) | **本地**(人工把关版本号与 changelog) |
| 谁跑 push / GitHub Release / npm publish | 本地工具 | CI | **CI**(监听 `v*` tag) |
| npm 凭证 | 本机 `flower-ai` 登录态 **或** `NPM_TOKEN` | OIDC(无 token)或仓库 `NPM_TOKEN` secret | OIDC(无 token)或 `NPM_TOKEN` secret |
| GitHub Release | 需 `gh` 或 `GITHUB_TOKEN` env(**本机无 gh**) | runner 自带 `gh` + 自动 `GITHUB_TOKEN` | runner 自带 `gh` + 自动 `GITHUB_TOKEN` |
| **npm provenance / 出处证明** | **不可能**(provenance 必须在受信云 CI 产出,见 §2) | **可**(自动) | **可**(自动) |
| 人工把关版本号/changelog | 强(本地肉眼可见) | 弱(全自动,易误发) | **强**(本地确认后才 push tag) |
| 出错回滚 | 本地可中途停 | tag 一推即全自动,补救成本高 | tag push 前可任意修正 |
| 维护成本 | 低(一份 `.release-it.json`),但依赖本机环境(node/gh/登录态) | 中(写 + 维护 workflow,需配 OIDC) | 中(本地工具 + 一段 workflow),职责清晰 |
| 可重复性 / 换机器 | 差(隐性本机状态:登录态、gh、SKILL_GARDEN 路径) | 好(环境在 CI 固化) | 好(CI 固化发布环节;本地只做"人决定"的部分) |
| 适用场景 | 内网/私包、不在意 provenance、维护者环境稳定 | 团队/纯自动、信任全自动语义化发布 | **单人 + 想要 provenance + 想保留人工把关** |

**A 优点**:一条命令完成全部;无需 CI 配置;最直观。
**A 缺点**:① 无法产出 provenance(§2);② 本机当前没有 `gh`,要么装 `gh` 要么给 release-it 配 `GITHUB_TOKEN`(§5);③ 发布质量绑定维护者本机隐性状态,换机器/重装易翻车。

**B 优点**:发布环境完全固化、可重复;runner 自带 `gh` 与 `GITHUB_TOKEN`;天然产 provenance。
**B 缺点**:① 版本号与 changelog 由 CI 生成,单人项目里"人在回路"的把关变弱,误推 tag 即误发;② workflow 内还要解决"谁来 bump 并把 CHANGELOG/版本号写回主分支"的回写问题,复杂度上去了。

**C 优点(对单人最契合)**:把"需要人判断"的事(版本号、CHANGELOG 内容)留在本地、留在维护者眼前;把"机械且需受信环境"的事(push tag 后的 GitHub Release + npm publish + provenance)交给 CI。① 绕开本机没有 `gh` 的问题(§5);② 自动获得 provenance(§2);③ tag push 前可反复修正,推了才发,误发面小。
**C 缺点**:链路跨两处(本地 + CI),需要约定"打了 `vX.Y.Z` tag 就会触发发布";首次配置略多于 A。

---

### Q2. npm Trusted Publishing(OIDC)与 provenance —— 2026 现状(评估 A vs C 的关键)

- **OIDC Trusted Publishing 已 GA**:GitHub Changelog *"npm trusted publishing with OIDC is generally available"*,**发布日期 2025-07-31**。
- **provenance 的硬限制(决定性)**:npm 官方文档 *Generating provenance statements* 明确:
  > "To publish a package with provenance, you **must build your package with a supported cloud CI/CD provider using a cloud-hosted runner**. Today this includes **GitHub Actions and GitLab CI/CD**."

  → **本地脚本(方案 A)无法产出 provenance**。这是 A 相对 B/C 的根本短板。
- **Trusted Publishing 自动带 provenance、且无需 token**:同文档:
  > "If you use trusted publishing, **provenance attestations are automatically generated** for your packages **without requiring the --provenance flag**. This provides enhanced security and **eliminates the need for access tokens** in your CI/CD workflows."
- **GitHub Actions 配置要点**(来自 release-it `docs/npm.md` 的 Trusted Publishing 段落,与 npm 官方一致):
  - workflow 加 `permissions: id-token: write`(签发 OIDC token 必需)。
  - **移除 `NODE_AUTH_TOKEN` / NPM_TOKEN**(OIDC 模式下不再需要长期令牌)。
  - **升级 npm 到 ≥ v11.5.1**(Node 20 自带 npm 10.8,需 `npm install -g npm@latest`)。OIDC 需要这个最低版本;裸 `--provenance` 则需 npm ≥ 9.5.0。
  - 在 npmjs.com 包设置里配置 "Trusted Publisher",绑定该仓库 + workflow 文件名。
  - `package.json` 的 `repository` 字段须指向公开仓库,且大小写匹配发布来源。
- **相对本地存 NPM_TOKEN 的安全优势**:OIDC 是短时、按次签发的身份令牌,不存在仓库/本机里的长期 token 可被泄露或被恶意 postinstall 脚本窃取;并自动留下可在 Sigstore 公共透明日志验证的出处证明(谁、从哪个 commit、用什么流程构建)。

> 结论:**只要在意 provenance / 想去掉长期 token,就必须把 npm publish 放进 CI(B 或 C),A 出局。**

---

### Q3. 工具维护状态 —— 2026

| 工具 | npm latest | 仓库状态 | 能做 GitHub Release? | 能做 npm publish? | 结论 |
|---|---|---|---|---|---|
| **standard-version** | `9.5.0`(2023-04-01,**已停更**) | 未 archive 但 README 自述 **DEPRECATED** | 否 | 否 | **已废弃**,勿用 |
| **commit-and-tag-version**(standard-version 的继任 fork) | `12.7.3`(2026-05-08) | 活跃(`absolute-version/commit-and-tag-version`,~628★,2026-06 仍有提交) | **否** | **否** | 只做本地 bump+changelog+tag,**不 push、不 publish、不建 Release** |
| **release-it** | `20.2.0`(2026-05-30) | 活跃(~8968★,2026-05 提交) | **是**(需 `GITHUB_TOKEN`) | **是**(支持 OIDC Trusted Publishing) | **一站式**:push + GitHub Release + npm publish + provenance |
| **@release-it/conventional-changelog** | `11.0.1`(2026-05-30) | 活跃,release-it 官方插件 | — | — | 让 release-it 用约定式提交自动 bump + 生成 CHANGELOG |

要点(均有原文佐证):
- **standard-version 已废弃**:其 README 首行 *"`standard-version` is deprecated. If you're a GitHub user, I recommend release-please... otherwise use the commit-and-tag-version fork."*
- **commit-and-tag-version 明确"只动本地"**:README *"...handling versioning, changelog generation, and git tagging for you **without** automatic pushing (to GitHub) or publishing (to an npm registry). Use of commit-and-tag-version **only affects your local git repo**."* → 用它就必须**另外**手动 push、手动建 Release(无 gh 时是痛点)、手动 publish。
- **release-it 支持 OIDC**:README *"As of July 2025, GitHub and GitLab CI workflows can now use npm's Trusted Publishing OpenID Connect (OIDC) provenance attestations."*;`docs/npm.md` 有完整 Trusted Publishing 配置段。
- **release-it 一并处理两端**:README 的 *GitHub Releases* 段(`GITHUB_TOKEN` 自动建 Release)+ npm publish 是其核心能力。

> 工具取舍:
> - 想"一个工具搞定 bump→changelog→push→GitHub Release→npm publish"(方案 A 或在 CI 里) → **release-it + @release-it/conventional-changelog**。
> - 想"本地只生成版本/CHANGELOG/tag,发布交给 CI"(方案 C 的本地端) → **commit-and-tag-version**(纯本地、零远程副作用,正好只做该做的)。

---

### Q4. git submodule 对发布 workflow 的影响

- `actions/checkout` 的 `submodules` 输入**默认 `false`**(README 原文:`submodules: ''` / `Default: false`),即**默认不拉取任何 submodule**。
  - `submodules: true` 拉取顶层 submodule;`submodules: recursive` 递归拉取嵌套 submodule。
- **本仓库实际是否需要拉 submodule**:
  - 发布产物(npm tarball)由 `files: [bin, src, enhancements, README]` 决定,**不含** submodule 源;`enhancements/` 是**已提交的快照**。
  - 因此**发布时不需要** `submodules: recursive`——CI 只需 checkout 主仓库(含已提交的 `enhancements/` 快照)即可打包发布。
  - 仅当你希望"在 CI 里重新跑 `sync-enhancements.mjs` 从 submodule 重建快照再发布"时,才需要 `submodules: true/recursive`。但当前 sync 脚本读 `SKILL_GARDEN_DIR`/硬编码本地路径,默认设计是**本地 sync 好、提交快照、CI 直接发**,与"CI 不拉 submodule"一致。
- 注意点:本项目目前**还没有** `.gitmodules`(submodule 接入是本任务另一半工作)。即便接入后,只要遵循"快照已提交、发布不依赖 submodule",发布 workflow 的 checkout **可以省略** submodule 拉取,链路更快更简单。

> 结论:发布 workflow **无需** `submodules: recursive`;保持 `actions/checkout` 默认即可。submodule 只服务于本地"重建快照",与发布解耦。

---

### Q5. 本机无 `gh` 的影响

- **对方案 A(纯本地)是负担**:本地要建 GitHub Release,要么
  ① 安装 `gh` CLI 并 `gh auth login`,要么
  ② 用 release-it,在本地 env 提供 `GITHUB_TOKEN`(PAT),release-it 经 GitHub API 建 Release(其文档 *"This works the same as on your local machine."*)。
  无论哪条,都引入"本机额外配置/额外长期凭证"。
- **对方案 B/C 反而是优势**:GitHub 托管 runner 镜像**预装 GitHub CLI 2.92.0**(`actions/runner-images` 的 Ubuntu 24.04 / 22.04 README 均列 *"GitHub CLI 2.92.0"*),且 workflow 自动注入 `secrets.GITHUB_TOKEN`,`gh release create` / `gh release upload` 开箱即用、无需任何本机或仓库凭证。
- 因此"本机无 gh"这条约束,把天平进一步推向 **C/B**:GitHub Release 这一步在 CI 里零成本,在本地是额外摩擦。

---

## 推荐方案

### 选 **C(混合)**:本地 `commit-and-tag-version` 做 bump+CHANGELOG+commit+tag+push,CI 监听 `v*` tag 做 GitHub Release + npm publish(OIDC + provenance)

**理由(对齐本项目五个约束)**:

1. **单人 + 想保留把关**:版本号与 CHANGELOG 内容是需要人判断的,留在本地肉眼确认;tag push 前可任意修正,推了才发,避免 B 的"全自动误发"。
2. **想要 provenance + 去长期 token**:npm publish 必须在受信云 CI 才能产 provenance(§2),A 永远做不到;C 把 publish 放进 GitHub Actions,用 **OIDC Trusted Publishing 自动带 provenance、且无需 `NPM_TOKEN`**。
3. **本机无 gh**:GitHub Release 这步交给自带 `gh`+`GITHUB_TOKEN` 的 runner(§5),本地无需装 gh、无需配 PAT。
4. **CHANGELOG 为唯一来源 → 同步到 Release**:本地用 conventional-commits 生成 `CHANGELOG.md`;CI 在 Release 步骤里**截取该版本对应的 CHANGELOG 片段**作为 Release notes(单一来源,二者一致)。
5. **submodule 与发布解耦**:CI checkout 用默认(不拉 submodule),直接打包已提交的 `enhancements/` 快照(§4),链路简单。

> 备选:若日后嫌"两处链路"麻烦、且接受把版本判断也交给工具,可整包切到 **A 用 release-it**——但那样要在本地装 gh/配 GITHUB_TOKEN,且**仍拿不到 provenance**。在"想要 provenance"这条硬约束下,A 不达标。

### 推荐方案 C 的关键配置要点

**本地端(维护者机器)**
- 安装 `commit-and-tag-version`(devDependency),`package.json` 加脚本:
  - `"release": "commit-and-tag-version"`(自动按提交 bump + 写 `CHANGELOG.md` + commit `chore(release): vX.Y.Z` + 打 tag,**不 push、不 publish**)。
- 维护者流程:`npm run release` → 检查 diff 的版本号与 CHANGELOG → `git push --follow-tags origin main`(把 commit + `vX.Y.Z` tag 一起推上去)。
- CHANGELOG 用 Keep a Changelog 风格(conventional-changelog preset 默认即接近)。

**CI 端(`.github/workflows/release.yml`,`on: push: tags: ['v*']`)**
- `permissions:` 需 `contents: write`(建 Release / 上传产物)与 `id-token: write`(OIDC 必需)。
- `actions/checkout`:用默认(**不加** `submodules`),只取主仓库 + 已提交快照(§4)。
- `actions/setup-node` 配 `registry-url: 'https://registry.npmjs.org'`。
- **升级 npm 到 ≥ 11.5.1**:`npm install -g npm@latest`(OIDC 前置,§2)。
- **不设 `NODE_AUTH_TOKEN`/`NPM_TOKEN`**;改为在 npmjs.com 为本包配置 **Trusted Publisher**(绑定 `SilentFlower/flower-trellis` + 该 workflow 文件名)。
- 发布两步:
  - `npm publish`(OIDC 模式自动带 provenance,无需 `--provenance`)。注意 `prepublishOnly` 会先跑 `sync-enhancements.mjs`——CI 上需保证该脚本在无本地 skill-garden 时也能跑通(或 sync 已在本地完成、快照已提交,CI 端可让 sync 成为幂等/可跳过)。
  - GitHub Release:用 runner 自带 `gh release create "$GITHUB_REF_NAME" --notes-file <本版本 CHANGELOG 片段>`(`GITHUB_TOKEN` 自动可用),notes 从 `CHANGELOG.md` 截取当前版本段落,保证"CHANGELOG 为唯一来源"。

---

## External References

- npm Docs — *Generating provenance statements*(provenance 限制、Trusted Publishing 自动产 provenance):https://docs.npmjs.com/generating-provenance-statements/
- npm Docs — *Trusted publishers*:https://docs.npmjs.com/trusted-publishers
- GitHub Changelog — *npm trusted publishing with OIDC is generally available*(GA,2025-07-31):https://github.blog/changelog/2025-07-31-npm-trusted-publishing-with-oidc-is-generally-available/
- GitHub Blog — *Our plan for a more secure npm supply chain*(2025-09,供应链加固/强化 Trusted Publishing):https://github.blog/security/supply-chain-security/our-plan-for-a-more-secure-npm-supply-chain/
- release-it README + `docs/npm.md`(Trusted Publishing/OIDC 配置、GitHub Releases、npm publish):https://github.com/release-it/release-it 、 https://github.com/release-it/release-it/blob/main/docs/npm.md
- standard-version README(自述 deprecated,荐 release-please / commit-and-tag-version):https://github.com/conventional-changelog/standard-version
- commit-and-tag-version README(只动本地、不 push/不 publish):https://github.com/absolute-version/commit-and-tag-version
- actions/checkout README(`submodules` 默认 false;`true`/`recursive`):https://github.com/actions/checkout
- actions/runner-images — Ubuntu 24.04/22.04 镜像清单(预装 GitHub CLI 2.92.0):https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md
- actions/setup-node — 发布到 npm 用法:https://github.com/actions/setup-node/blob/main/docs/advanced-usage.md

---

## Caveats / Not Found

- **版本号与日期为本次实测(2026-06-09)**:standard-version `9.5.0`(2023-04-01,停更)、commit-and-tag-version `12.7.3`(2026-05-08)、release-it `20.2.0`(2026-05-30)、@release-it/conventional-changelog `11.0.1`、runner GitHub CLI `2.92.0`、OIDC 需 npm ≥ `11.5.1`。实施前请以届时 README/Changelog 复核。
- **OIDC 的"最低 npm 版本"** 文档中给的是 `11.5.1`(release-it docs);裸 `--provenance` 文档给 `9.5.0`(npm docs)。两者口径不同,采用 OIDC 路线请以 `≥ 11.5.1` 为准。
- **`prepublishOnly` 在 CI 的可跑性未实测**:`sync-enhancements.mjs` 默认读本地/`SKILL_GARDEN_DIR` 路径,CI 上若无该源会失败;落地时需让其在"快照已提交"场景下可跳过或幂等。这是发布 workflow 的一个实现细节,留给 implement 阶段验证。
- **未实测 Trusted Publisher 在 npmjs.com 的具体表单字段**(组织/仓库/workflow 绑定 UI 可能随时间微调);以 npm 官方 *Trusted publishers* 页为准。
- 未深入 `release-please` / `semantic-release` 全自动方案(更偏"无人值守自动语义化发布"),与"单人想保留把关"诉求不符,故未纳入推荐,仅作背景提及。
