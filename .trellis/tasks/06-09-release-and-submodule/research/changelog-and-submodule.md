# Research: CHANGELOG 自动生成 + git submodule 在 npm 包中的注意事项

- **Query**: (1) 从 Conventional Commits(英文 type + 中文描述)自动生成 Keep a Changelog 风格 CHANGELOG 的工具链对比、中文描述分组、从 CHANGELOG 抽版本段落作 Release notes;(2) git submodule 在 npm 包项目中的打包行为、接入命令、pin 语义、sync 脚本路径兼容
- **Scope**: mixed(internal: package.json / sync-enhancements.mjs / git 状态;external: 工具文档)
- **Date**: 2026-06-09

## 本仓库已确认事实(用于约束结论)

- 提交全部是 Conventional Commits,**type 前缀英文 + 描述中文**,例:
  - `feat: 新增 ft 短命令与 init/update 自身版本自动检测`
  - `fix: bin 入口补可执行位`
  - `chore(release): v0.2.1`
  - `docs(spec): 将 frontend 规范层重构为 cli 并填充真实 Node-CLI 约定`
- `package.json` 关键字段(单包、ESM):
  - `"files": ["bin", "src", "enhancements", "README.md"]`(**白名单制**)
  - 已有 `prepublishOnly: node scripts/sync-enhancements.mjs`
- 当前**无 `.gitmodules`**(`cat .gitmodules` → 不存在)。
- skill-garden 是独立 git 仓库,远程 `https://github.com/SilentFlower/skill-garden.git`,本地 `/root/project/skill-garden` HEAD = `1dcf26869e7c90be0777ebe3448501f340e05b45`。
- `scripts/sync-enhancements.mjs` 现状:`GARDEN_ROOT = process.env.SKILL_GARDEN_DIR ? resolve(...) : "/root/project/skill-garden"`(硬编码兜底),源目录为 `GARDEN_ROOT/.trellis`,缺失时 `process.exit(1)` 并提示设置 `SKILL_GARDEN_DIR`;还会 `git -C GARDEN_ROOT rev-parse HEAD` 写进 MANIFEST 的 `sourceCommit` 溯源。

工具版本(`npm view`,2026-06-09 实测):conventional-changelog-cli `5.0.0`、commit-and-tag-version `12.7.3`、release-it `20.2.0`、@release-it/conventional-changelog `11.0.1`、@changesets/cli `2.31.0`。

---

## 主题一:Conventional Commits → CHANGELOG

### 1. 工具链对比

| 工具 | 默认分组 | 是否「Keep a Changelog」(Added/Changed/Fixed) | bump 版本号 | 打 tag | 备注 |
|---|---|---|---|---|---|
| **conventional-changelog-cli** | Conventional Commits(Features / Bug Fixes / …,按 `angular`/`conventionalcommits` preset) | **否**(产出的是 CC 分组,不是 KaC 的 Added/Changed/Fixed)。可换 preset,但官方无开箱即用的 KaC preset | 否(只生成 changelog) | 否 | 最底层、最纯粹;只做「读 commit → 写 CHANGELOG 片段」。版本/tag 要自己配 `npm version` 等 |
| **commit-and-tag-version** | 同上,基于 `conventionalcommits` preset 的 Features / Bug Fixes 等 | **否**(默认是 CC 分组)。可通过 `.versionrc`/`types` 自定义每个 type 的 `section` 标题,但映射到 KaC 的 Added/Changed/Fixed 需手工配置且并非一一对应 | **是**(自动 SemVer bump) | **是** | `standard-version` 的活跃 fork(原 standard-version 已废弃)。一条命令完成 bump + changelog + commit + tag。**最贴合本任务**(本地一键、单包) |
| **release-it** + **@release-it/conventional-changelog** | 由插件用 conventional-changelog preset 生成,默认 CC 分组 | **否**(默认 CC 分组);插件支持传 `preset`/`infile`,可写入并维护 CHANGELOG.md | **是**(插件根据 commit 推断 bump) | **是** | 编排型发布工具:bump + changelog + commit + tag + **push + GitHub Release + npm publish** 一条龙。插件可设 `infile: CHANGELOG.md` 持久化 |
| **changesets** | 按 changeset 文件里**手写**的条目 + major/minor/patch 标记 | **否**(既不是 KaC 也不是 CC 自动分组;它**不解析 commit**) | 是(按 changeset 汇总) | 否(本体不打 tag,常配 action) | 面向 monorepo / 需要「人工撰写面向用户的变更说明」的场景。**与本任务方向不符**:本任务要从已有 Conventional Commits 自动生成,而 changesets 要求每次改动新增手写 changeset 文件 |

**关键结论:没有一个主流工具默认产出严格「Keep a Changelog」的 Added/Changed/Fixed 分组。** 它们的「标准」分组是 Conventional Commits 的 Features / Bug Fixes / Performance Improvements 等。两条可行路线:

- **路线 A(推荐,省事):接受 Conventional Commits 分组**(Features / Bug Fixes / …),用 `conventionalcommits` preset。PRD 写的是「Keep a Changelog 风格(Added/Changed/Fixed)**或** Conventional Commits 的 Features/Bug Fixes 分组」,后者开箱即用,与现有 `feat/fix/docs/chore` 提交天然对齐。
- **路线 B(要严格 KaC 标题):自定义 type→section 映射**。在 commit-and-tag-version 的 `.versionrc.json` 用 `types` 把 `feat`→`Added`、`fix`→`Fixed`、`refactor/perf/style`→`Changed` 等;但这是「近似映射」(CC 的 type 维度和 KaC 的语义维度并不严丝合缝,例如 `feat` 既可能是 Added 也可能是 Changed),需人工接受这种近似。

对本仓库(单包、本地一键、已有 `prepublishOnly`)最省心的组合:**commit-and-tag-version**(本地 bump+changelog+tag)或 **release-it + @release-it/conventional-changelog**(若还想一并 push + 建 GitHub Release + npm publish)。具体本地 vs CI 的取舍见兄弟文件 `research/release-pipeline.md`。

### 2. 中文描述能否正确分组?(核心确认)

**能,且无额外配置。** Conventional Commits 解析器(`conventional-commits-parser`,被上述所有解析型工具复用)的分组**只依据 commit header 的 `<type>(<scope>): ` 前缀**,即冒号前的英文 `type`/`scope`;冒号后的 `description`(subject)被当作**不透明字符串原样**放进对应分组的条目里。因此:

- `feat: 新增 ft 短命令` → 归入 Features(或映射后的 Added),条目文本 = 「新增 ft 短命令」中文原样。
- `fix: bin 入口补可执行位` → 归入 Bug Fixes(Fixed),中文原样。
- `chore(release): v0.2.1` → 默认 `chore` **不出现在 changelog**(多数 preset 把 chore/test/ci 隐藏);release 提交通常本就由工具自己生成,无需出现在条目里。

**注意事项 / 坑点:**

1. **必须严格遵守 `<type>: ` 格式**(英文 type、半角冒号 `:`、冒号后一个空格)。若误用全角冒号「:」或漏空格,解析器无法识别 type,该 commit 会落入「Other / 未分组」或被丢弃。本仓库现有提交格式正确(已抽样核对)。
2. **`BREAKING CHANGE`/`!` 触发 major**:若 commit body 含 `BREAKING CHANGE:` 或 header 用 `feat!:`,会被识别为破坏性变更并单列「⚠ BREAKING CHANGES」分组、驱动 major bump。中文描述不影响这一判定(判定看的是英文标记)。
3. **scope 是英文还是中文不影响分组**,但 scope 会原样显示在条目里(如 `docs(spec):` → 条目带 `**spec:**` 前缀)。建议 scope 保持英文以保证可读一致性。
4. **description 中的中文标点、emoji 原样进入 Markdown**,一般无问题;若描述里含 Markdown 特殊字符(如裸 `*`、`_`、反引号、`#`),可能影响渲染,但不影响分组。
5. commit-and-tag-version / release-it 生成的条目通常带 **commit hash 链接和(可选)issue 链接**,链接基于 git remote 推断,中文描述不影响链接生成。

### 3. 从 CHANGELOG.md 抽「某版本段落」作 GitHub Release notes

CHANGELOG 既然是唯一来源(PRD 已定),Release notes 应从 CHANGELOG 抽取「最新/指定版本」那一段。可行做法,按优先级:

**做法 A(推荐):工具内置,自动同步。**
- **release-it** 原生支持发布 GitHub Release,且其 GitHub Release 的 body 默认取「本次 release 生成的 changelog 片段」——即与写入 `CHANGELOG.md` 的同一段内容(`releaseNotes` 可定制)。配 `@release-it/conventional-changelog` 后,**一次命令同时写 CHANGELOG.md 并用同段内容创建 GitHub Release**,天然「单一来源」。这是最省事的「CHANGELOG = Release notes」实现。
- **commit-and-tag-version** 本身**不建 GitHub Release**(只管 changelog + tag),需配合下面的 gh CLI 抽段。

**做法 B(脚本抽段 + gh CLI):适配 commit-and-tag-version / 自写脚本。**
- 用 `gh release create <tag> --notes-file <file>`(或 `--notes-from-tag`)指定 notes 文件。先从 CHANGELOG.md 切出目标版本段落写入临时文件,再喂给 gh。
- 抽段逻辑:Keep a Changelog / conventionalcommits preset 的版本标题形如 `## [0.3.0]` 或 `## 0.3.0`。取「从该版本标题行的下一行」到「下一个 `## ` 版本标题前」为该版本 notes。可用 Node 脚本按正则切分,或社区工具:
  - **`extract-changelog-release`**(npm)——专门「从 CHANGELOG.md 抽最新版本段落」。
  - **`keepachangelog`** / `changelog-parser`(npm)——把 CHANGELOG 解析成结构化对象,再取某版本。
  - 纯 shell 也可:用 awk/sed 在两个 `^## ` 之间取块(但要小心标题格式差异,脚本更稳)。
- **本机当前无 `gh` CLI**(PRD 已记录环境事实),走做法 B 需先装 gh 或在 CI 用 `actions/github-script` / `softprops/action-gh-release`(后者支持 `body_path` 指向抽出的段落文件)。

**做法 C(CI 内置抽段):** GitHub Actions 里用 `softprops/action-gh-release` 的 `body_path`,或 `mindsers/changelog-reader-action` 直接从 CHANGELOG 读指定版本段输出给 release。适合「tag 触发 → CI 发 Release」。

**结论建议:** 若发布编排选 release-it,直接用其内置 GitHub Release(做法 A),零额外抽段代码;若选 commit-and-tag-version 或自写脚本,用做法 B(`extract-changelog-release` 抽段 + `gh release create --notes-file`)或做法 C(CI action `body_path`)。

---

## 主题二:git submodule 在 npm 包项目中的注意事项

### 1. submodule 内容**不会**进入 npm tarball(确认)

**确认:在本仓库当前 `files` 白名单配置下,submodule(如 `vendor/skill-garden`)不会被打包。** 依据:

- npm 的打包文件集由「`package.json` 的 `files` 字段(白名单)+ 始终包含的特殊文件(package.json / README / LICENSE / main 入口)−（`.npmignore`/`.gitignore` 排除项)」共同决定。本仓库 `files: ["bin","src","enhancements","README.md"]` 是**白名单**:**只有**这四项被收录,任何未列入的顶层路径(包括 `vendor/`、`scripts/`、`node_modules/`、`.trellis/` 等)**一律不进 tarball**。
- 因此把 submodule 挂在 `vendor/skill-garden`(或任何不在白名单内的路径),`npm pack` 默认就**不会**收录它。submodule 仅作为**开发期同步源**,经 `sync-enhancements.mjs` 拷成 `enhancements/` 快照后,**只有 `enhancements/` 进包**——满足 PRD 验收项「tarball 仍只含 bin/src/enhancements/README」。
- 验证手段(发布前自检):`npm pack --dry-run`(或 `npm publish --dry-run`)会列出**将被收录的完整文件清单**,确认其中无 `vendor/` 路径即可。这是最权威的实测确认方式,建议纳入发布前检查。
- 额外保险(可选):即便用 `.npmignore` 模式(非白名单),git submodule 目录通常因不被 npm 当作普通目录而易遗漏;但本仓库是白名单模式,无需依赖这层,**保持 `files` 白名单不动即可天然隔离 submodule**。

### 2. 把现有独立仓库接入为 submodule:命令与挂载路径

**标准接入命令**(在主仓库 `/root/project/flower-trellis` 根执行):

```bash
git submodule add https://github.com/SilentFlower/skill-garden.git vendor/skill-garden
git commit -m "chore: 接入 skill-garden 作为 submodule (vendor/skill-garden)"
```

- 这会创建/更新 `.gitmodules`(记录 path + url),并把 `vendor/skill-garden` 作为一个**指向特定 commit 的 gitlink** 加入主仓库索引。
- 可加 `--branch main` 让 submodule 跟踪 `main` 分支(便于后续 `git submodule update --remote` 拉最新),但**默认仍是 pin 到具体 commit**,见下文 3。

**挂载路径惯例:**
- `vendor/`:最常见的「第三方/外部供应代码」约定(Go、PHP Composer、很多 JS 项目都用),语义清晰、最稳妥。**推荐 `vendor/skill-garden`**(与 PRD Q2 示例一致)。
- `third_party/`:Google 系/大型 C++ 项目常用,语义同 `vendor/`。
- 隐藏目录(如 `.skill-garden`):可行但不利于发现性,且对「白名单 `files` 不打包」无额外好处,不推荐。
- **务必避开会进 tarball 的路径**(不要放进 `src/`、`bin/`、`enhancements/`),否则会被打包。`vendor/` 不在白名单内,天然安全。

**clone / 拉取工作流:**

```bash
# 新机器首次克隆(同时拉 submodule 内容)
git clone --recurse-submodules https://github.com/SilentFlower/flower-trellis.git

# 已经普通 clone 过、submodule 目录为空时,补拉
git submodule update --init --recursive

# 可配置让普通 git clone 默认带 submodule(全局开关)
git config --global submodule.recurse true
```

满足 PRD 验收项「新机器 `git clone --recurse-submodules` 后可直接 `npm run sync`,无需手改路径」。

### 3. submodule 的「pin 到 commit」语义,及对发布的含义

**语义:主仓库记录的是 submodule 的一个具体 commit SHA(gitlink),而非分支或最新。** 更新 skill-garden 内容后的标准工作流:

```bash
# 1) 进入 submodule,拉到想要的 skill-garden commit
cd vendor/skill-garden
git fetch origin
git checkout origin/main          # 或某个具体 tag/commit
cd ../..

# 2) 回主仓库:此时 git status 会显示 vendor/skill-garden 的 gitlink 有变更
git add vendor/skill-garden        # 把新的 pin(SHA)登记到主仓库索引
git commit -m "chore: 更新 skill-garden submodule pin 到 <new-sha>"
```

也可用 `git submodule update --remote vendor/skill-garden` 自动把 submodule 拉到其跟踪分支最新,再 `git add` + commit pin。

**对「发布前确保 enhancements 快照与 submodule pin 一致」的含义(关键):**

- `enhancements/` 是从 submodule 源 `git checkout` 出的那个 commit **拷贝出来的快照**;`MANIFEST.json.sourceCommit` 记录了快照来源 commit。
- 因此「快照与 pin 一致」= **`MANIFEST.sourceCommit` 应等于主仓库当前登记的 `vendor/skill-garden` gitlink SHA**。
- **发布前自检流程**应是:
  1. 确保 submodule 已 checkout 到目标 commit 且主仓库已 `git add` 该 pin(无未提交的 gitlink 变更);
  2. 跑 `npm run sync`(即 `sync-enhancements.mjs`)重新从 submodule 生成 `enhancements/` 快照;
  3. 校验 `enhancements/MANIFEST.json.sourceCommit === git rev-parse HEAD:vendor/skill-garden`(或 `git -C vendor/skill-garden rev-parse HEAD`),不一致则中止发布;
  4. 若 sync 后 `enhancements/` 有 diff,需先提交快照再发布,避免「发布了陈旧快照」。
- 已有 `prepublishOnly: sync-enhancements.mjs` 会在 publish 前自动跑 sync——只要 submodule 处于正确 pin,prepublish 就会把快照刷新到与 pin 一致。**建议在 sync 脚本里加一道「sourceCommit vs pin 一致性断言」**,把 PRD 的「确保一致」从约定变成强约束。

### 4. sync-enhancements.mjs 路径解析改造(兼容性建议)

现状:`GARDEN_ROOT = SKILL_GARDEN_DIR ? resolve(SKILL_GARDEN_DIR) : "/root/project/skill-garden"`(硬编码绝对路径,换机即失效)。

**建议的解析优先级(从高到低),与 PRD 一致:**

1. **`SKILL_GARDEN_DIR` 环境变量**(显式覆盖,最高优先级)——保留现有逃生通道,便于临时指向别处或在 skill-garden 仍独立 clone 的旧布局下工作。
2. **仓库内 submodule 路径**:基于脚本自身位置推导 `path.resolve(PKG_ROOT, "vendor/skill-garden")`(注意脚本里 `PKG_ROOT = path.resolve(here, "..")`,这是仓库根,因此默认应是 `path.join(PKG_ROOT, "vendor", "skill-garden")`,**而非**硬编码 `/root/project/skill-garden`)。
3. **报错并给出可执行提示**:若上面两者解析出的 `.trellis` 源目录都不存在,`process.exit(1)` 并打印明确指引,例如:
   `❌ 找不到强化包源;请执行 git submodule update --init --recursive,或设置 SKILL_GARDEN_DIR 指向 skill-garden 根。`

**兼容性要点:**
- 默认路径必须是**仓库内相对 submodule 路径**(用 `PKG_ROOT` 推导,跨机器/CI 稳定),不能再硬编码 `/root/project/...`。
- 保留 `SKILL_GARDEN_DIR` 覆盖,确保旧工作流(独立 clone skill-garden)不被破坏。
- 现有的「源目录缺失 → exit(1) + 提示」逻辑保留,只把提示文案补上 `git submodule update --init --recursive`(因为最常见的失败原因从「路径不对」变成「submodule 没初始化、目录为空」)。
- 现有 `git -C GARDEN_ROOT rev-parse HEAD` 写 `MANIFEST.sourceCommit` 的逻辑无需改——submodule 目录本身就是个 git 工作树,`rev-parse HEAD` 会返回当前 pin 的 SHA,正好用于上面 §3 的一致性断言。
- submodule 初次未 init 时目录存在但**为空**(无 `.trellis`),现有的 `fs.existsSync(SRC)` 判断能正确触发缺失分支并提示 init,无需额外处理空目录情况。

---

## External References

- Conventional Commits 规范:https://www.conventionalcommits.org/
- Keep a Changelog 规范:https://keepachangelog.com/
- conventional-changelog 生态(含 cli / preset / parser):https://github.com/conventional-changelog/conventional-changelog
- commit-and-tag-version(standard-version 活跃 fork):https://github.com/absolute-version/commit-and-tag-version
- release-it:https://github.com/release-it/release-it
- @release-it/conventional-changelog 插件:https://github.com/release-it/conventional-changelog
- Changesets:https://github.com/changesets/changesets
- npm `files` 字段 / 打包文件集:https://docs.npmjs.com/cli/v10/configuring-npm/package-json#files
- `npm pack` / `--dry-run`:https://docs.npmjs.com/cli/v10/commands/npm-pack
- git submodule 官方手册:https://git-scm.com/book/en/v2/Git-Tools-Submodules
- `gh release create`(`--notes-file`):https://cli.github.com/manual/gh_release_create
- extract-changelog-release(从 CHANGELOG 抽版本段):https://www.npmjs.com/package/extract-changelog-release
- softprops/action-gh-release(`body_path`):https://github.com/softprops/action-gh-release
- mindsers/changelog-reader-action(CI 读指定版本段):https://github.com/mindsers/changelog-reader-action

## Caveats / Not Found

- 工具版本号为 2026-06-09 `npm view` 实测;具体配置项(如 commit-and-tag-version 的 `.versionrc` `types[].section` 字段名、release-it 的 `releaseNotes` 选项)以各工具当时文档为准,本文未逐项跑通,使用前建议按上方链接核对最新配置语法。
- 「Keep a Changelog 严格 Added/Changed/Fixed」与 Conventional Commits type 之间无官方标准映射;路线 B 的 type→section 映射属团队约定的近似,需人工接受语义不完全对齐。
- 本机当前**无 `gh` CLI**(PRD 已记录),做法 B 依赖在本地或 CI 提供 gh;若发布走 CI,优先做法 A(release-it 内置)或做法 C(action `body_path`)。
- 抽段工具(extract-changelog-release / changelog-parser 等)对 CHANGELOG 标题格式有假设(`## [x.y.z]` vs `## x.y.z`),需与所选生成工具的实际输出标题格式对齐,否则抽不到段;建议生成后用 `npm pack --dry-run` 之外再人工核对一次首版 CHANGELOG 标题格式。
