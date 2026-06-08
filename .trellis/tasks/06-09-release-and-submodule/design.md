# Design — 发布流程与 skill-garden 子仓库化

> 技术设计。边界、契约、数据流、兼容性与回滚。配合 `prd.md` 的 Decision 段阅读。

## 1. 发布链路(混合方案 C)

### 1.1 本地端 — commit-and-tag-version

- 新增 devDependency:`commit-and-tag-version`(standard-version 的活跃 fork,只动本地、不 push/不 publish,正好契合"本地把关")。
- `package.json` scripts:
  - `"release": "node scripts/check-snapshot.mjs && commit-and-tag-version"` — 发布前先断言快照一致(§3),再 bump。
  - `"release:dry": "commit-and-tag-version --dry-run"` — 预览版本号与 CHANGELOG 变更,不落盘。
- 维护者流程:
  1. `npm run release`(或先 `release:dry` 预览)
  2. 检查 `CHANGELOG.md` 与 `package.json` 的 version diff
  3. `git push --follow-tags origin main`(commit + `vX.Y.Z` tag 一并推上,触发 CI)
- 首版说明:已有 `v0.2.0/v0.2.1` tag,`commit-and-tag-version` 首次运行会基于最近 tag 之后的提交生成 CHANGELOG 段;本次改动含 `feat`(发布流程 + submodule),预计 bump 到 **0.3.0**。首版 CHANGELOG 若回溯到历史区段可人工裁剪一次。
- 配置文件 `.versionrc.json`(可选,最小化):用 `conventionalcommits` preset 默认即可;如需隐藏/显示特定 type 再加 `types`。**不做** KaC 映射(Out of Scope)。

### 1.2 CI 端 — .github/workflows/release.yml

```
on:
  push:
    tags: ['v*']
permissions:
  contents: write      # 建 Release / 上传
  id-token: write      # OIDC 必需
jobs.release (ubuntu-latest):
  1. actions/checkout@v4            # 默认:不拉 submodule
  2. actions/setup-node@v4          # node 20 + registry-url=https://registry.npmjs.org
  3. npm i -g npm@latest            # OIDC 需 npm ≥ 11.5.1
  4. npm publish                    # OIDC 自动带 provenance,不设 NODE_AUTH_TOKEN
                                    # 不跑 npm ci:publish 无需依赖,prepublishOnly 的 sync 只用项目源码
  5. 抽取 CHANGELOG 当前版本段 → gh release create "$GITHUB_REF_NAME" --notes-file <tmp>
                                    # runner 自带 gh + 自动 GITHUB_TOKEN
```

- **一次性前置(人工)**:npmjs.com → 包设置 → Trusted Publisher,绑定 `SilentFlower/flower-trellis` 仓库 + workflow 文件 `release.yml`。
- **不设** `NPM_TOKEN`/`NODE_AUTH_TOKEN` secret(OIDC 模式不需要)。

### 1.3 CHANGELOG → Release notes 抽段(§契约:单一来源)

- `commit-and-tag-version` 默认标题格式:`## [0.3.0](<compare-url>) (YYYY-MM-DD)`。
- CI 抽段:新增 `scripts/extract-changelog.mjs`(零依赖,自写):读 `CHANGELOG.md`,从第一个 `^## ` 版本标题到下一个 `^## ` 之间为最新版本段,写入临时文件供 `gh release create --notes-file` 使用。
  - 自写而非依赖 `extract-changelog-release`:避免 CI 多一个网络/版本耦合,且标题格式我们自己可控。
  - 校验:抽出的 tag 版本号应与 `$GITHUB_REF_NAME`(去掉前缀 `v`)一致,不一致则 fail(防止漏更新 CHANGELOG 就打了 tag)。

## 2. sync-enhancements.mjs 改造

### 2.1 三级路径解析(替换硬编码)

```
优先级:
1. process.env.SKILL_GARDEN_DIR          # 显式覆盖,保留逃生通道
2. path.join(PKG_ROOT, "vendor", "skill-garden")   # 默认:仓库内 submodule(替换原 /root/project/skill-garden)
3. 都不存在 .trellis 源 → exit(1),提示:
   "❌ 找不到强化包源;请执行 git submodule update --init --recursive,或设置 SKILL_GARDEN_DIR。"
```

- `PKG_ROOT` 已有(`path.resolve(here, "..")`),直接复用。
- `git -C GARDEN_ROOT rev-parse HEAD` 写 `MANIFEST.sourceCommit` 逻辑**不变**——submodule 目录本身是 git 工作树,`rev-parse HEAD` 返回当前 pin SHA,正好供 §3 断言复用。

### 2.2 CI 幂等 / 可跳过(关键)

**问题**:CI `npm publish` 触发 `prepublishOnly → sync-enhancements.mjs`,但 CI 不拉 submodule,源缺失会 `exit(1)`,publish 失败。

**方案**:sync 脚本在"源 `.trellis` 缺失"时,**不再无条件报错**,而是:
- 若 `enhancements/MANIFEST.json` 已存在(快照已提交)→ 打印 `⚠ 跳过 sync:未找到强化包源,沿用已提交的 enhancements/ 快照`,`exit(0)`(幂等跳过)。
- 若快照也不存在 → 才 `exit(1)` 报错(真正的异常:既无源又无快照)。

这样:本地源在 → 正常重建;CI 源缺失但快照在 → 安全跳过;两头都没有 → 明确失败。无需在 workflow 里加 `SKIP_SYNC` 这类旁路,语义自洽。

### 2.3 不进 tarball(验收保障)

- `vendor/skill-garden` 不在 `files` 白名单 → `npm pack` 默认不收录。implement 用 `npm pack --dry-run` 实测确认清单只含 `bin/src/enhancements/README`。

## 3. 发布前快照一致性断言(scripts/check-snapshot.mjs)

**风险**:更新了 `vendor/skill-garden` 的 pin,却忘了 `npm run sync` + 提交快照 → 发布陈旧快照。

**断言**(`npm run release` 的前置):
1. 读 `enhancements/MANIFEST.json.sourceCommit`。
2. 取 `git -C vendor/skill-garden rev-parse HEAD`(当前 pin)。
3. 不相等 → 报错中止:`❌ enhancements 快照(<a>)与 submodule pin(<b>)不一致,请先 npm run sync 并提交快照再发布。`
4. 另检查 `git status` 中 `enhancements/` 无未提交改动(快照已落盘)。

> 职责分离:**更新强化包**是一条独立提交(`chore: 更新强化包快照到 <sha>`,含 `.gitmodules` pin + `enhancements/`);**发布**是另一条(`chore(release): vX.Y.Z`)。断言把两者的顺序约束变成硬门禁。

## 4. 文件清单

**新增**
- `vendor/skill-garden`(submodule)、`.gitmodules`
- `CHANGELOG.md`(首次生成)
- `.versionrc.json`(可选,最小配置)
- `.github/workflows/release.yml`
- `scripts/check-snapshot.mjs`(一致性断言)
- `scripts/extract-changelog.mjs`(抽段)

**修改**
- `package.json`:加 `devDependencies.commit-and-tag-version`、`scripts.release`/`release:dry`、`repository`/`bugs`/`homepage` 字段。
- `scripts/sync-enhancements.mjs`:三级路径(§2.1)+ CI 幂等(§2.2)。
- `README.md`:发布流程、submodule clone(`--recurse-submodules`)、开发章节。

## 5. 兼容性 / 回滚

- **兼容**:`SKILL_GARDEN_DIR` 覆盖保留,旧"独立 clone skill-garden"布局不破;submodule 接入对安装用户透明(不进 tarball)。
- **回滚**:发布链路与 submodule 解耦,可分别回退——删 `release.yml` 即停 CI 发布;`git submodule deinit` + 删 `.gitmodules`/`vendor` 即回旧布局(但需保留 `SKILL_GARDEN_DIR` 或恢复默认路径,避免 sync 失效)。

## 6. Rollout 注意

- 首次 OIDC 发布前必须先在 npmjs.com 配好 Trusted Publisher,否则 `npm publish` 会失败。
- 首次发布建议先 `release:dry` + `npm pack --dry-run` 双重预览,再真正推 tag。
