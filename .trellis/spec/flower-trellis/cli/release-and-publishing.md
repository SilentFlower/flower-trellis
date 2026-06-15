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
| `scripts/check-snapshot.mjs` | 发布前断言;失败 `exit(1)` 阻断 release |
| `scripts/extract-changelog.mjs <version\|tag> <outFile>` | 抽 CHANGELOG 指定版本段供 Release notes(标题正则兼容 h2/h3) |
| `.github/workflows/release.yml` | 稳定版 tag `vX.Y.Z`;`npm publish` 到 `latest`(OIDC)+ `gh release create` |
| `.github/workflows/release-beta.yml` | beta tag `vX.Y.Z-beta.N`;`npm publish --tag beta`(OIDC)+ `gh release create --prerelease` |

稳定版完整发布动作:`npm run release` → 检查 diff → `git push --follow-tags origin main`。
beta 版完整发布动作:`npm run release -- --prerelease beta` 或
`npm run release -- --release-as X.Y.Z-beta.N` → 检查 diff → `git push --follow-tags origin main`。

---

## Contracts

### 链路(本地 → CI)
- 本地 `commit-and-tag-version` 只动本地(commit + tag),**绝不 push/publish**。
- push `vX.Y.Z` tag 触发稳定版 CI;CI checkout **不拉 submodule**(发布只依赖已提交的 `enhancements/` 快照)。
- push `vX.Y.Z-beta.N` tag 触发 beta CI;必须发布到 npm `beta` dist-tag。
- 稳定版 CI 步骤:`npm i -g npm@latest` → `npm publish`(OIDC,不设 NODE_AUTH_TOKEN)→ `extract-changelog` → `gh release create --notes-file`。
- beta CI 步骤:`npm i -g npm@latest` → `npm publish --tag beta`(OIDC,不设 NODE_AUTH_TOKEN)→ `extract-changelog` → `gh release create --prerelease --notes-file`。

### release.yml 硬约束
- `permissions: contents: write`(建 Release)+ `id-token: write`(OIDC 签发,**必需**)。
- **Node ≥ 22.14.0 且 npm ≥ 11.5.1**(OIDC 要求):`node-version: 22` + `npm i -g npm@latest`。
- **不跑 `npm ci`**:publish 无需依赖,`prepublishOnly` 的 sync 仅用 `src/lib` + node 内置;省去 node-pty 编译。
- 不设 `NPM_TOKEN`/`NODE_AUTH_TOKEN`(OIDC 不需要长期令牌)。
- 稳定版 workflow 可以由 `v*` 触发,但 job 必须跳过带 `-` 的 prerelease tag,避免
  `vX.Y.Z-beta.N` 被发布到 `latest`。

### release-beta.yml 硬约束
- `on.push.tags` 只匹配 `v*-beta.*`。
- publish step 必须使用 `npm publish --tag beta`,不能省略 `--tag beta`。
- 创建 GitHub Release 时必须带 `--prerelease`。
- 权限、Node/npm 版本、OIDC/no-token、不跑 `npm ci` 的约束与稳定版 workflow 相同。

### 一次性人工前置(否则首次 publish 失败)
- npmjs.com → 包 `/package/flower-trellis/access` → **Trusted Publisher** → GitHub Actions:
  org=`SilentFlower` / repo=`flower-trellis` / workflow=`release.yml` / environment 空 / allowed=`npm publish`。**区分大小写、逐字匹配**。
- beta workflow 也要单独配置 Trusted Publisher:
  org=`SilentFlower` / repo=`flower-trellis` / workflow=`release-beta.yml` / environment 空 / allowed=`npm publish`。
- `package.json` 的 `repository.url` 须指向该公开仓库(provenance + Trusted Publisher 校验依据)。

### CHANGELOG 约定(`.versionrc.json`)
- Conventional Commits 分组:`feat`→✨新功能、`fix`→🐛修复、`perf`/`refactor`/`docs` 显示;`chore`/`style`/`test`/`ci`/`build` 隐藏。
- 标题格式:minor/major `## [x.y.z](compare) (date)`,patch `### [x.y.z]...`。
- beta 标题必须保留完整 prerelease 版本,例如 `## [0.3.0-beta.1]...`;`extract-changelog.mjs`
  会按 tag 精确抽取对应段落。
- **0.x 阶段 `feat` 默认 bump patch(非 minor)**;要升 minor 用 `npm run release -- --release-as minor`。
- 中文 description 原样进条目(解析只看英文 `type`/`scope`)。

---

## Validation & Error Matrix

| 条件 | 行为 |
|------|------|
| `MANIFEST.sourceCommit` ≠ `vendor/skill-garden` HEAD | check-snapshot `exit(1)`:提示先 `npm run sync` 重建并提交快照 |
| `enhancements/` 有未提交改动 | check-snapshot `exit(1)`:提示先提交快照 |
| CHANGELOG 缺目标版本段 | extract-changelog `exit(1)`(等价"漏更新 CHANGELOG 就打 tag"的拦截) |
| Trusted Publisher 配置不匹配 | CI `npm publish` 报 **404**:逐字核对 org/repo/workflow/environment |
| Node < 22.14.0 或 npm < 11.5.1 | OIDC publish 失败 |
| beta tag 触发稳定版 workflow | 稳定版 job 的 `!contains(github.ref_name, '-')` 应跳过;若未跳过会污染 `latest` |
| beta workflow 省略 `--tag beta` | prerelease 可能被 npm 标到 `latest`,必须阻断评审 |

---

## Wrong vs Correct

### Wrong
- 本地直接 `npm publish` → 拿不到 provenance(只在受信云 CI 产出),且绑本机登录态。
- CI 里加 `npm ci` → 触发 node-pty 编译,徒增耗时与失败面。
- release.yml 用 `node-version: 20` → OIDC 要求 Node ≥ 22.14.0,publish 失败。
- beta workflow 里写裸 `npm publish` → prerelease 可能污染默认 `latest` 通道。
- 改了 submodule pin 不 `npm run sync` 就发布 → 发布陈旧快照(check-snapshot 会拦)。

### Correct
- 本地只 bump+CHANGELOG+tag(人工把关),push tag 由 CI 用 OIDC 发布(自动 provenance、免 token)。
- `node-version: 22` + `npm i -g npm@latest`,不跑 npm ci。
- 发布前 check-snapshot 断言快照与 submodule pin 一致且已提交。
- beta 版使用 `X.Y.Z-beta.N` 版本号、`vX.Y.Z-beta.N` tag、`npm publish --tag beta`。

---

## Common Mistakes

> **Warning**:www.npmjs.com 网页 versions tab 有 CDN 缓存,滞后几分钟~几十分钟。
> 验证是否发布成功以 `npm view <pkg> version`(查 `registry.npmjs.org`,实时)为准,不要看网页。

- 把 Trusted Publisher 找去账户级 packages 页 —— 它在**单个包**的 Settings 页(`/package/<pkg>/access`)。
- 期望 0.x 阶段 `feat` 升 minor —— 默认是 patch,需 `--release-as minor`。
- 只给 `release.yml` 配 Trusted Publisher,忘记 `release-beta.yml` —— beta workflow 是不同
  workflow 文件,需要独立绑定。
