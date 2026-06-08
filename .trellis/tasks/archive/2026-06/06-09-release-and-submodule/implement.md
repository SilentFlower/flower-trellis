# Implement — 发布流程与 skill-garden 子仓库化

> 有序实现清单。分三阶段:submodule 接入 → 发布脚本/CI → 文档与验证。配合 `design.md`。

## 阶段 A:skill-garden submodule 化

- [ ] A1. 接入 submodule:`git submodule add https://github.com/SilentFlower/skill-garden.git vendor/skill-garden`(生成 `.gitmodules`)。
- [ ] A2. 确认 `vendor/skill-garden` pin 到目标 commit(默认其 `main` HEAD,即当前 `1dcf268` 或更新)。
- [ ] A3. 改造 `scripts/sync-enhancements.mjs`:
  - 三级路径解析(`SKILL_GARDEN_DIR` → `PKG_ROOT/vendor/skill-garden` → 报错提示 init);删除硬编码 `/root/project/skill-garden`。
  - CI 幂等:源缺失但 `enhancements/MANIFEST.json` 存在 → 警告并 `exit(0)`;两者都无 → `exit(1)`。
- [ ] A4. 跑 `npm run sync`,确认从 submodule 正确重建 `enhancements/` 快照,`MANIFEST.sourceCommit` = `git -C vendor/skill-garden rev-parse HEAD`。
- [ ] A5. 提交:`chore: 接入 skill-garden 为 submodule 并改造同步源路径`(含 `.gitmodules`、`vendor` gitlink、`sync-enhancements.mjs`、刷新后的 `enhancements/`)。

## 阶段 B:发布脚本与 CI

- [ ] B1. `npm i -D commit-and-tag-version`。
- [ ] B2. `package.json`:
  - `scripts.release` = `node scripts/check-snapshot.mjs && commit-and-tag-version`;`scripts.release:dry` = `commit-and-tag-version --dry-run`。
  - 补 `repository`(`{ "type": "git", "url": "git+https://github.com/SilentFlower/flower-trellis.git" }`)、`bugs`、`homepage`(provenance 要求)。
- [ ] B3. 新增 `scripts/check-snapshot.mjs`:断言 `MANIFEST.sourceCommit === vendor/skill-garden HEAD` 且 `enhancements/` 无未提交改动,否则中止(design §3)。
- [ ] B4. 新增 `scripts/extract-changelog.mjs`:抽 `CHANGELOG.md` 最新版本段,校验版本号与传入 tag 一致,输出到指定文件(design §1.3)。
- [ ] B5.(可选)`.versionrc.json` 最小配置(`conventionalcommits` preset)。
- [ ] B6. 新增 `.github/workflows/release.yml`(design §1.2):tag `v*` 触发,`contents: write`+`id-token: write`,`npm i -g npm@latest` → `npm ci` → `npm publish`(OIDC,不设 token)→ 抽段 → `gh release create --notes-file`。
- [ ] B7. 首次生成 CHANGELOG:`npm run release:dry` 预览;必要时人工裁剪首版历史区段。

## 阶段 C:文档与验证

- [ ] C1. README:新增「发布流程」(本地 `npm run release` → push tag → CI 自动发布)、submodule clone 说明(`git clone --recurse-submodules` / `git submodule update --init --recursive`)、更新「开发」章节(sync 源已是 submodule)。
- [ ] C2. README/AGENTS:补强化包更新工作流(进 submodule 更新 pin → `npm run sync` → 提交快照)。
- [ ] C3.(人工,一次性)npmjs.com 配置 Trusted Publisher 绑定本仓库 + `release.yml`。

## Validation

- `npm run sync` → 退出 0,`enhancements/` 正确重建,`MANIFEST.sourceCommit` 与 pin 一致。
- 临时设 `SKILL_GARDEN_DIR=/root/project/skill-garden npm run sync` → 覆盖路径仍可用。
- 模拟 CI 幂等:临时改名 `vendor/skill-garden` 使源缺失 → `npm run sync` 应警告跳过(因快照在)并退出 0。
- `npm run release:dry` → 预览 bump 到 0.3.0 + CHANGELOG 分组为 Features/Bug Fixes,中文条目正常。
- `node scripts/check-snapshot.mjs` → 一致时退出 0;手动改 pin 不 sync → 应中止报错。
- `npm pack --dry-run` → 文件清单只含 `bin/src/enhancements/README`,无 `vendor/`。
- `node scripts/extract-changelog.mjs <tag> <out>` → 正确抽出对应版本段。
- `release.yml` 用 `act` 或最小 dry-run 静态校验语法(无法本地真发 OIDC,至少 lint workflow)。

## Review Gates

- **G1(发布前人工)**:Trusted Publisher 必须先在 npmjs.com 配好,否则首次 `npm publish` 失败。
- **G2(首发把关)**:首次真正发布前,`release:dry` + `npm pack --dry-run` 双预览通过,再 `git push --follow-tags`。
- **G3**:确认工作区 `.trellis/.template-hashes.json`、`enhancements/MANIFEST.json` 等既有改动已并入合适提交,工作树干净后再发布。

## 提交计划(Conventional Commits)

- `chore: 接入 skill-garden submodule 并改造同步源路径`(阶段 A)
- `feat: 新增 commit-and-tag-version 发布流程与一致性断言`(B1–B5)
- `feat: 新增 tag 触发的 GitHub Actions 发布工作流(OIDC + provenance)`(B6)
- `docs: 补充发布流程与 submodule 使用说明`(阶段 C)
- 之后 `npm run release` 生成 `chore(release): v0.3.0`
