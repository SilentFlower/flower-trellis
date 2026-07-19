# Release & Publishing

> flower-trellis 的发版流程:**本地把关 + CI 发布**(npm OIDC Trusted Publishing)。
> 同步源 submodule 见 [Enhancements Model](./enhancements-model.md)。

---

## Overview

混合发布链路:**本地决定发什么、CI 负责发出去**。版本更新内容以 `CHANGELOG.md`
(Conventional Commits 自动生成)为唯一来源,同步到 GitHub Release。npm 发布走
OIDC Trusted Publishing,自动带 provenance、无长期 token。稳定版发布到 npm `latest`
dist-tag;beta 预发布版发布到 npm `beta` dist-tag。

---

## Signatures(命令 / 脚本 / workflow)

| 入口 | 作用 |
|------|------|
| `npm run release` | `node scripts/check-snapshot.mjs && commit-and-tag-version`;断言通过后 bump + 写 CHANGELOG + commit `chore(release): vX.Y.Z` + 打 tag。**不 push、不 publish** |
| `npm run release:dry` | `commit-and-tag-version --dry-run`,预览版本号与 CHANGELOG,不落盘 |
| `scripts/check-snapshot.mjs` | 发布前断言 submodule/快照干净一致，再执行 pinned Trellis Patch 冲突门禁；失败 `exit(1)` |
| `scripts/check-patch-conflicts.mjs` | 通过 `resolveTrellisBin()` + `process.execPath` 跨平台启动 pinned Trellis，全平台 fixture 覆盖全部声明 Patch/target/target kind 并运行共享 evaluator |
| `scripts/extract-changelog.mjs <version\|tag> <outFile>` | 抽 CHANGELOG 指定版本段供 Release notes(标题正则兼容 h2/h3) |
| `scripts/lib/changelog-section.mjs` | CHANGELOG 指定版本段抽取的共享逻辑,供 GitHub Release notes 与 npm metadata 共用 |
| `scripts/write-release-notes-metadata.mjs [--dry-run]` | `postchangelog` 后把当前版本 CHANGELOG 段写入 `package.json.flowerReleaseNotes` |
| `.github/workflows/release.yml` | 稳定版 tag `vX.Y.Z` 与 beta tag `vX.Y.Z-beta.N`;按 tag 选择 `npm publish` 到 `latest` 或 `npm publish --tag beta`(OIDC)+ 创建 GitHub Release/Prerelease |

稳定版完整发布动作:`npm run sync` → 必要时提交 `enhancements/` 快照 →
`npm run release` → 检查 diff → `git push --follow-tags origin main`。
beta 版完整发布动作:`npm run sync` → 必要时提交 `enhancements/` 快照 →
`npm run release -- --prerelease beta` 或 `npm run release -- --release-as X.Y.Z-beta.N`
→ 检查 diff → `git push --follow-tags origin <branch>`。

### 发版前 CHANGELOG 预览门禁
- 正式执行 `npm run release...` 前,必须先执行对应的 dry-run 命令并展示将生成的版本号与 CHANGELOG 段落。
- 稳定版预览:`npm run release:dry`;beta 预览:`npm run release:dry -- --prerelease beta` 或与正式命令一致的 `--release-as X.Y.Z-beta.N`。
- 预览后必须等待用户明确确认,才能执行真实 `npm run release...`。用户未确认时,不得修改 `package.json`、`package-lock.json`、`CHANGELOG.md`,不得 commit/tag。
- 用户确认后,真实 release 命令必须使用与 dry-run 相同的版本策略参数,避免预览的 CHANGELOG 与实际生成内容不一致。
- 用户确认后,真实 release 前必须先跑 `npm run sync`。如果该命令产生 `enhancements/` diff,先展示新增审核项并提交快照;不要把 `check-snapshot` 失败当作正常 release 步骤的一部分。

### 发版前快照门禁
- `npm run release...` 会先执行 `scripts/check-snapshot.mjs`;它是最后防线,不是常规修复入口。正常流程应在真实 release 前主动完成 `npm run sync` 和快照提交。
- `npm run sync` 后若只有 `enhancements/MANIFEST.json` 的 `syncedAt` / `sourceCommit` 变化,说明快照内容未变、仅把随包发布的 source commit 指针补到当前 `vendor/skill-garden` pin;仍必须作为独立 `chore(snapshot): ...` 提交。
- `npm run sync` 后若出现除 `MANIFEST.json` 以外的快照文件变化,必须把文件列表和摘要展示给用户审核,确认后再提交。
- 快照提交完成后先跑 `node scripts/check-snapshot.mjs`;只有通过后才能继续执行真实 `npm run release...`。
- `check-snapshot` 在 git 快照门禁通过后还必须执行 `check-patch-conflicts`；warning 允许继续，error/结构漂移阻断发布。
- 如果真实 `npm run release...` 已经被 `check-snapshot` 阻断,停止发布流程,展示阻断原因和修复 diff;完成 `npm run sync` + 快照提交 + `check-snapshot` 通过后,重新从 release 命令开始。

---

## Contracts

### 链路(本地 → CI)
- 本地 `commit-and-tag-version` 只动本地(commit + tag),**绝不 push/publish**。
- `package.json` 的 `commit-and-tag-version.scripts.postchangelog` 必须运行
  `node scripts/write-release-notes-metadata.mjs`;该脚本在 CHANGELOG 生成后、release commit 前
  写入 `package.json.flowerReleaseNotes`。
- `flowerReleaseNotes` 是 flower 内部 npm metadata,字段结构为
  `{version,source:"CHANGELOG.md",body,truncated}`。`version` 必须等于当前
  `package.json.version`;每个 npm 版本只保存自己的 CHANGELOG 段落,不保存 recent map。
- push `vX.Y.Z` tag 触发稳定版 CI;CI checkout **不拉 submodule**(发布只依赖已提交的 `enhancements/` 快照)。
- push `vX.Y.Z-beta.N` tag 触发同一 CI;必须发布到 npm `beta` dist-tag。
- 稳定版 CI 步骤:`判定通道 latest` → `npm i -g npm@11.18.0` → `npm publish`(OIDC,不设 NODE_AUTH_TOKEN)→ `extract-changelog` → `gh release create --notes-file`。
- beta CI 步骤:`判定通道 beta` → `npm i -g npm@11.18.0` → `npm publish --tag beta`(OIDC,不设 NODE_AUTH_TOKEN)→ `extract-changelog` → `gh release create --prerelease --notes-file`。

### release.yml 硬约束
- `permissions: contents: write`(建 Release)+ `id-token: write`(OIDC 签发,**必需**)。
- **Node ≥ 22.14.0 且 npm ≥ 11.5.1**(OIDC 要求):`node-version: 22` + `npm i -g npm@11.18.0`。npm 版本固定在 11 线,不要追 `npm@latest` 的新 major。
- **不跑 `npm ci`**:publish 无需依赖,`prepublishOnly` 的 sync 仅用 `src/lib` + node 内置;省去 node-pty 编译。
- 不设 `NPM_TOKEN`/`NODE_AUTH_TOKEN`(OIDC 不需要长期令牌)。
- workflow 由 `v*` 触发,必须先判定通道:tag 包含 `-beta.` 时使用 `npm publish --tag beta` 且创建 GitHub prerelease;不带 `-` 时使用裸 `npm publish` 发布到 `latest`。
- 其他 prerelease tag(带 `-` 但不是 `-beta.`)必须失败退出,避免被错误发布到 `latest`。

### 一次性人工前置(否则首次 publish 失败)
- npmjs.com → 包 `/package/flower-trellis/access` → **Trusted Publisher** → GitHub Actions:
  org=`SilentFlower` / repo=`flower-trellis` / workflow=`release.yml` / environment 空 / allowed=`npm publish`。**区分大小写、逐字匹配**。
- npm 每个包只能绑定一个 Trusted Publisher workflow;稳定版与 beta 必须共用 `release.yml`,不要写逗号分隔的多个文件名。
- `package.json` 的 `repository.url` 须指向该公开仓库(provenance + Trusted Publisher 校验依据)。

### CHANGELOG 约定(`.versionrc.json`)
- Conventional Commits 分组:`feat`→✨新功能、`fix`→🐛修复、`perf`/`refactor`/`docs` 显示;`chore`/`style`/`test`/`ci`/`build` 隐藏。
- 标题格式:minor/major `## [x.y.z](compare) (date)`,patch `### [x.y.z]...`。
- beta 标题必须保留完整 prerelease 版本,例如 `## [0.3.0-beta.1]...`;`extract-changelog.mjs`
  会按 tag 精确抽取对应段落。
- **0.x 阶段 `feat` 默认 bump patch(非 minor)**;要升 minor 用 `npm run release -- --release-as minor`。
- 中文 description 原样进条目(解析只看英文 `type`/`scope`)。
- AI 拟写会进入 CHANGELOG 的 commit description / release notes 时,必须使用中文说明用户可见变更;技术 token 可保留英文,例如 `CHANGELOG.md`、`npm run sync`、`route_state.py`、`vX.Y.Z-beta.N`。
- dry-run 预览里如果出现英文普通说明性条目,不得继续真实 release;先把对应 commit description 或 release 说明改写为中文,重新 dry-run 并再次展示给用户确认。

---

## Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| 未先展示 dry-run CHANGELOG 就准备执行真实 release | 停止;先运行对应 `npm run release:dry...`,展示版本号与 CHANGELOG 段落并等待确认 |
| dry-run 参数与计划执行的真实 release 参数不一致 | 停止;重新用真实计划参数 dry-run 并展示更新后的 CHANGELOG |
| `MANIFEST.sourceCommit` ≠ `vendor/skill-garden` HEAD | check-snapshot `exit(1)`:提示先 `npm run sync` 重建并提交快照 |
| `vendor/skill-garden` 工作区有未提交改动 | check-snapshot `exit(1)`:提示先提交 skill-garden 源改动并更新 submodule pin,避免发布未提交源生成的快照 |
| `enhancements/` 有未提交改动 | check-snapshot `exit(1)`:提示先提交快照 |
| vendor/snapshot `overrides/` 文件树不一致或 pinned fixture 出现 conflict error | check-snapshot `exit(1)`:同步快照或升级 baseline/Patch 后重跑 |
| `npm run sync` 只改 `MANIFEST.syncedAt` / `sourceCommit` | 展示为快照指针更新,独立提交后再跑 `node scripts/check-snapshot.mjs` |
| 真实 release 已被快照门禁阻断 | 不继续 tag/push;按 `npm run sync` → 审核 diff → 提交快照 → `check-snapshot` 通过 → 重跑 release |
| CHANGELOG 缺目标版本段 | extract-changelog `exit(1)`(等价"漏更新 CHANGELOG 就打 tag"的拦截) |
| `postchangelog` 找不到当前版本 CHANGELOG 段 | `write-release-notes-metadata.mjs` `exit(1)`,阻断本地 release |
| CHANGELOG dry-run 出现英文普通说明性条目 | 停止;先改为中文描述,重新 dry-run 并展示新版 CHANGELOG |
| Trusted Publisher 配置不匹配 | CI `npm publish` 报 **404**:逐字核对 org/repo/workflow/environment |
| Node < 22.14.0 或 npm < 11.5.1 | OIDC publish 失败 |
| beta tag 走裸 `npm publish` | prerelease 可能被 npm 标到 `latest`,必须阻断评审 |
| Trusted Publisher workflow 写 `release.yml,release-beta.yml` | npm 会当作一个不存在的文件名,OIDC 不会生效 |
| `npm@latest` 新 major 的 provenance 依赖缺失 | CI `npm publish` 报 `Cannot find module 'sigstore'`:固定 npm 11 线后重新触发发布 |

---

## Wrong vs Correct

### Wrong
- 本地直接 `npm publish` → 拿不到 provenance(只在受信云 CI 产出),且绑本机登录态。
- CI 里加 `npm ci` → 触发 node-pty 编译,徒增耗时与失败面。
- release.yml 用 `node-version: 20` → OIDC 要求 Node ≥ 22.14.0,publish 失败。
- beta 分支另建 `release-beta.yml` → npm 单包只能信任一个 workflow,容易造成 beta OIDC 404。
- beta tag 里写裸 `npm publish` → prerelease 可能污染默认 `latest` 通道。
- 改了 submodule pin 不 `npm run sync` 就发布 → 发布陈旧快照(check-snapshot 会拦)。
- 用 dirty submodule 工作区生成快照后直接发布 → npm 包里会含有未提交、不可追溯的 skill-garden 内容(check-snapshot 必须拦)。
- 用户还没看过 dry-run CHANGELOG 就直接跑 `npm run release` → 版本号和发布说明未经确认,容易把不符合预期的条目写入正式 tag。
- 真实 release 被 `check-snapshot` 阻断后继续尝试 tag/push → 跳过了快照审核,应先补 `npm run sync` 与快照提交。
- AI 生成英文 commit description,导致 CHANGELOG 普通说明条目是英文 → 不符合中文发布说明约定;应先改写为中文再 release。

### Correct
- 本地只 bump+CHANGELOG+tag(人工把关),push tag 由 CI 用 OIDC 发布(自动 provenance、免 token)。
- `node-version: 22` + `npm i -g npm@11.18.0`,不跑 npm ci;`actions/checkout@v5` 与 `actions/setup-node@v5` 避免旧 action runtime deprecation warning。
- 真实 release 前先确认 `vendor/skill-garden` 工作区干净,再 `npm run sync`;如有快照 diff,审核并提交后再用 check-snapshot 断言快照与 submodule pin 一致、submodule 源无未提交改动且快照已提交。
- beta 版使用 `X.Y.Z-beta.N` 版本号、`vX.Y.Z-beta.N` tag、同一 `release.yml` 内的 `npm publish --tag beta`。
- 真实 release 前先用相同参数跑 `npm run release:dry...`,把将生成的 CHANGELOG 段落展示给用户,得到明确确认后再执行真实 release。
- 真实 release 的 `postchangelog` 会把同一 CHANGELOG 段写入 `flowerReleaseNotes`,并随
  release commit 一起进入 npm registry metadata;GitHub Release 与 npm metadata 必须同源。
- CHANGELOG 普通说明条目使用中文;只保留命令、文件名、包名、函数名、tag、环境变量等技术 token 的英文原文。

---

## Common Mistakes

> **Warning**:www.npmjs.com 网页 versions tab 有 CDN 缓存,滞后几分钟~几十分钟。
> 验证是否发布成功以 `npm view <pkg> version`(查 `registry.npmjs.org`,实时)为准,不要看网页。

- 把 Trusted Publisher 找去账户级 packages 页 —— 它在**单个包**的 Settings 页(`/package/<pkg>/access`)。
- 期望 0.x 阶段 `feat` 升 minor —— 默认是 patch,需 `--release-as minor`。
- 在 Trusted Publisher 的 workflow 字段填 `release.yml,release-beta.yml` —— npm 不会拆分,必须只填 `release.yml`。
