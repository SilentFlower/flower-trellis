# 发布流程与 skill-garden 子仓库化

## Goal

为 flower-trellis(npm CLI 包,当前 `v0.2.1`,远程 `github.com/SilentFlower/flower-trellis`)建立**规范化、可重复的版本发布流程**(CHANGELOG 为唯一来源,同步到 GitHub Release,npm 发布带 provenance),并把强化包同步源从硬编码本地路径解耦为 **git submodule**,使"发布"与"重建快照"都不再依赖维护者本机的隐性状态。

## Background / Known Context

- 当前**无 CHANGELOG、无 GitHub Release、无自动化发布**;仅手动打了 `v0.2.0/v0.2.1` 两个 tag。
- 提交风格已是 **Conventional Commits**(英文 type + 中文描述),如 `feat:` / `fix:` / `chore(release):`。
- 同步脚本 `scripts/sync-enhancements.mjs` 从**硬编码** `/root/project/skill-garden`(可被 `SKILL_GARDEN_DIR` 覆盖)读取 `.trellis/`,拷成 `enhancements/` 快照并写 `MANIFEST.json`(含 `sourceCommit`)。
- `package.json`:`files` 白名单只发 `bin/src/enhancements/README.md`;有 `prepublishOnly` 钩子跑 sync;**无 `repository` 字段**(OIDC provenance 需要)。
- 环境事实:**本机无 `gh` CLI**;npm 已登录 `flower-ai`;Node v22;远程 HTTPS;当前**无 `.gitmodules`**。
- skill-garden 独立仓库 `github.com/SilentFlower/skill-garden`,本地副本 `/root/project/skill-garden`(HEAD `1dcf268`)。
- 工作区有未提交改动:`.trellis/.template-hashes.json`、`enhancements/MANIFEST.json`(发布前需处理干净)。

## Decisions(已收敛)

- [Q1] ✅ 发布链路 = **混合方案 C**(详见 Decision)。
- [Q2] ✅ submodule 挂载路径 = `vendor/skill-garden`。
- [Q3] ✅ CHANGELOG 分组 = **Conventional Commits**(Features / Bug Fixes / …),`commit-and-tag-version` 默认,开箱即用。
- [Q4] ✅ npm publish 纳入,CI 用 **OIDC Trusted Publishing** 自动带 provenance(不设 `NPM_TOKEN`)。

## Decision (ADR-lite) — 发布链路

**Context**:单人维护;CHANGELOG 为唯一来源并同步到 Release;本机无 `gh`;npm 已登录。关键硬约束:npm provenance 只能在受信云 CI 产出(本地脚本永远拿不到),且希望去掉长期 `NPM_TOKEN`。

**Decision**:采用**混合方案 C**。
- **本地**:`commit-and-tag-version`(devDependency)做 bump + 写 `CHANGELOG.md` + commit(`chore(release): vX.Y.Z`)+ 打 tag,**不 push、不 publish**;封装为 `npm run release`。维护者检查 diff 后 `git push --follow-tags origin main`。
- **CI**:`.github/workflows/release.yml`,`on: push: tags: ['v*']`。`permissions: contents: write + id-token: write`;`npm i -g npm@latest`(≥11.5.1);`npm publish`(OIDC 自动带 provenance,**不设 NPM_TOKEN**);`gh release create`(runner 自带 gh + `GITHUB_TOKEN`),notes 取自 CHANGELOG 当前版本段落。
- **一次性前置**:在 npmjs.com 为本包配置 Trusted Publisher(绑定 `SilentFlower/flower-trellis` + `release.yml`)。

**Consequences**:版本号/CHANGELOG 人工把关;publish 带 provenance 且无长期 token;本地免装 gh。代价:链路跨本地+CI,首次配置略多;CI checkout **不拉 submodule**(发布只依赖已提交快照),故 `prepublishOnly` 的 sync 需在无 skill-garden 源时**幂等/可跳过**(见 design.md §2.2)。

## Requirements

**R1 发布流程(本地端)**
- `npm run release` 一条命令完成:按约定式提交自动 bump → 更新 `CHANGELOG.md` → commit → 打 `vX.Y.Z` tag,**不自动 push/publish**。
- 发布前置断言:`enhancements/` 快照(`MANIFEST.sourceCommit`)必须与 `vendor/skill-garden` 当前 pin 一致,不一致则中止并提示先 `npm run sync` + 提交快照。

**R2 发布流程(CI 端)**
- tag(`v*`)push 触发 `release.yml`:`npm publish`(OIDC + provenance,无 NPM_TOKEN)+ `gh release create`(notes 截取自 CHANGELOG 对应版本段)。
- CI checkout 不拉 submodule;发布只依赖已提交的 `enhancements/` 快照。

**R3 skill-garden submodule 化**
- 以 `git submodule` 把 skill-garden 接到 `vendor/skill-garden`。
- `sync-enhancements.mjs` 路径解析改为三级:`SKILL_GARDEN_DIR` → `PKG_ROOT/vendor/skill-garden` → 报错并提示 `git submodule update --init --recursive`。删除硬编码 `/root/project/skill-garden`。
- `enhancements/` 快照机制保留,仍随 npm 发布,安装零网络依赖。

**R4 配套**
- 补 `package.json` 的 `repository`(+ `bugs`/`homepage`)字段,满足 provenance 要求。
- `prepublishOnly` 的 sync 在 CI(无 submodule 源但快照已存在)场景下幂等跳过。
- README 增补:发布流程、`--recurse-submodules` clone 说明、开发章节更新。

## Acceptance Criteria

- [ ] `npm run release` 在本地可一步产出 bump + CHANGELOG + commit + tag(dry-run 可预览)。
- [ ] 快照与 submodule pin 不一致时,release 前置检查能中止并给出可执行提示。
- [ ] push `vX.Y.Z` tag 后,Actions 自动完成 `npm publish`(带 provenance)+ 创建 GitHub Release,Release notes 与 CHANGELOG 该版本段一致。
- [ ] CHANGELOG.md 由约定式提交生成,分组为 Features / Bug Fixes 等,中文描述正常显示。
- [ ] 新机器 `git clone --recurse-submodules` 后可直接 `npm run sync`,无需手改路径;`SKILL_GARDEN_DIR` 覆盖仍有效。
- [ ] `npm pack --dry-run` 输出文件清单仍只含 `bin/src/enhancements/README`,不含 `vendor/`。
- [ ] `package.json` 含正确的 `repository` 字段。

## Out of Scope

- monorepo / 多包发布(本包为单包)。
- **config.yaml 多仓库化 + spec 按包重组**:已确认拆为独立后续任务(2026-06-09 决定),不在本任务范围。详见下一任务。
- 强化包改为安装时实时拉取(已确认保留快照)。
- 纯全自动语义化发布(release-please / semantic-release);保留人工把关。
- 严格 Keep a Changelog(Added/Changed/Fixed)标题映射。

## Research References

- [`research/release-pipeline.md`](research/release-pipeline.md) — 发布链路三方案对比,推荐混合 C;OIDC/provenance 2026 现状;工具维护状态。
- [`research/changelog-and-submodule.md`](research/changelog-and-submodule.md) — changelog 工具、中文描述分组、CHANGELOG 抽段;submodule 打包行为与 sync 路径改造建议。
