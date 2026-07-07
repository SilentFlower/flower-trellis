# Changelog

本项目所有重要变更都会记录在此文件。

版本号遵循 [SemVer](https://semver.org/lang/zh-CN/);提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 规范。

## [0.4.5-beta.3](https://github.com/SilentFlower/flower-trellis/compare/v0.4.5-beta.2...v0.4.5-beta.3) (2026-07-07)


### 🐛 修复 Bug Fixes

* **update:** 修复失败缓存与 Codex 更新提示 ([f05f7bf](https://github.com/SilentFlower/flower-trellis/commit/f05f7bf0b75d07bd8ad4959b23720a425baa559b))

## [0.4.5-beta.2](https://github.com/SilentFlower/flower-trellis/compare/v0.4.5-beta.1...v0.4.5-beta.2) (2026-07-07)


### 🐛 修复 Bug Fixes

* **update:** 主动更新时刷新远端缓存 ([95eb10e](https://github.com/SilentFlower/flower-trellis/commit/95eb10e0c8e624662160897cd4bebe55e65b04bb))

## [0.4.5-beta.1](https://github.com/SilentFlower/flower-trellis/compare/v0.4.5-beta.0...v0.4.5-beta.1) (2026-07-07)

## [0.4.5-beta.0](https://github.com/SilentFlower/flower-trellis/compare/v0.4.4...v0.4.5-beta.0) (2026-07-07)


### 🐛 修复 Bug Fixes

* **update:** 修正自动更新检查与 Codex hook 行为 ([d208917](https://github.com/SilentFlower/flower-trellis/commit/d20891791a93490f47022aa59485c401ac599322))

## [0.4.4](https://github.com/SilentFlower/flower-trellis/compare/v0.4.3...v0.4.4) (2026-07-07)


### 🐛 修复 Bug Fixes

* **hooks:** 修复启动更新 hook JSON 输出 ([7918e6c](https://github.com/SilentFlower/flower-trellis/commit/7918e6c62f921f293556df71168066c4a629be43))

## [0.4.3](https://github.com/SilentFlower/flower-trellis/compare/v0.4.2...v0.4.3) (2026-07-07)


### 🐛 修复 Bug Fixes

* **update:** 调整更新检查默认间隔 ([58a3ed3](https://github.com/SilentFlower/flower-trellis/commit/58a3ed302e7eed34bdcd840c05e5dd5b441078e4))

## [0.4.2](https://github.com/SilentFlower/flower-trellis/compare/v0.4.1...v0.4.2) (2026-07-07)


### ✨ 新功能 Features

* **update:** 新增启动自更新检查链路 ([2b98110](https://github.com/SilentFlower/flower-trellis/commit/2b98110861539204160070432be3f0bab5d3aea8))

## [0.4.1](https://github.com/SilentFlower/flower-trellis/compare/v0.4.0...v0.4.1) (2026-07-06)


### ✨ 新功能 Features

* **enhancements:** 新增任务范围守卫并精简工作流文案（同步 skill-garden 0.6 overrides） ([0bfcf74](https://github.com/SilentFlower/flower-trellis/commit/0bfcf7437927b741167704e2ff2af5140ddb3f83))

## [0.4.0](https://github.com/SilentFlower/flower-trellis/compare/v0.3.1...v0.4.0) (2026-07-02)


### ✨ 新功能 Features

* **auto-loop:** 新增自动任务循环 runner ([268140a](https://github.com/SilentFlower/flower-trellis/commit/268140a04df98cfe7ab70c44aabc3032b6359893))
* **push:** 支持 push snapshot helper 并同步强化包 ([da84a3c](https://github.com/SilentFlower/flower-trellis/commit/da84a3cf1482fd4f1fe46e36e1007f97fb6423a7))
* **skill:** 支持交互管理通用技能 ([48a1ff2](https://github.com/SilentFlower/flower-trellis/commit/48a1ff2a18fccdad85b56ea3a5e53b222b86b07c))
* **skill:** 支持安装 humanize-writing 增强技能 ([3413628](https://github.com/SilentFlower/flower-trellis/commit/341362881d6ccd123dbef14e080aec975eef4b94))
* **skill:** 移除 sub2api 通用技能 ([f10a7d1](https://github.com/SilentFlower/flower-trellis/commit/f10a7d1278e4d8827a4758434cfdc7c728ac5e9a))
* **trellis:** 增加项目知识发现路由 ([961587a](https://github.com/SilentFlower/flower-trellis/commit/961587a88c530c6e37f02e0809c3a318ad5666d0))


### 🐛 修复 Bug Fixes

* **auto-loop:** 支持 blocked run 原地重试 ([b1137bb](https://github.com/SilentFlower/flower-trellis/commit/b1137bbdbab7637076b49aa67ff9ff29f5202a43))
* **auto-loop:** 简化路由选择提示 ([817dfa0](https://github.com/SilentFlower/flower-trellis/commit/817dfa029cbcede0d30351c9828c16fb4bc17b97))
* **auto-loop:** 精简默认状态输出 ([3849482](https://github.com/SilentFlower/flower-trellis/commit/384948273415b6156270b442430b6902290ae4f2))
* **enhancements:** 优化 spec_router 知识发现 ([ee59673](https://github.com/SilentFlower/flower-trellis/commit/ee59673c0820ede478998b29351933fbab2651da))
* **push:** 记录 push mode 并联动 finish-work ([54d4548](https://github.com/SilentFlower/flower-trellis/commit/54d4548e4c2901c6f6676a4e11450e10e646c0fe))
* **route:** 收紧裸数字 fallback 证据规则 ([328cf43](https://github.com/SilentFlower/flower-trellis/commit/328cf43285b1181f59e928757aacaa55e7b6a112))
* **spec-router:** 减少项目知识弱匹配噪音 ([1b9a6ea](https://github.com/SilentFlower/flower-trellis/commit/1b9a6ea5f4be1285d2f3e5e4091b0df66f16e335))
* **trellis:** 修复 auto-loop commit 与 route 状态边界 ([5cb8e6c](https://github.com/SilentFlower/flower-trellis/commit/5cb8e6c7d73cbf0580abe45c0ea2fdea71c90ca1))


### 🧰 维护 Maintenance

* **trellis:** 升级捆绑 Trellis 到 0.6.5，并修复 route_state.py 状态清理 ([e05c3cf](https://github.com/SilentFlower/flower-trellis/commit/e05c3cff591ddeb529daed8ccafb4c83bea802bc))

## [0.4.0-beta.5](https://github.com/SilentFlower/flower-trellis/compare/v0.4.0-beta.4...v0.4.0-beta.5) (2026-07-02)


### ✨ 新功能 Features

* **push:** 支持 push snapshot helper 并同步强化包 ([da84a3c](https://github.com/SilentFlower/flower-trellis/commit/da84a3cf1482fd4f1fe46e36e1007f97fb6423a7))


### 🐛 修复 Bug Fixes

* **enhancements:** 优化 spec_router 知识发现 ([ee59673](https://github.com/SilentFlower/flower-trellis/commit/ee59673c0820ede478998b29351933fbab2651da))
* **push:** 记录 push mode 并联动 finish-work ([54d4548](https://github.com/SilentFlower/flower-trellis/commit/54d4548e4c2901c6f6676a4e11450e10e646c0fe))
* **route:** 收紧裸数字 fallback 证据规则 ([328cf43](https://github.com/SilentFlower/flower-trellis/commit/328cf43285b1181f59e928757aacaa55e7b6a112))

## [0.4.0-beta.4](https://github.com/SilentFlower/flower-trellis/compare/v0.4.0-beta.3...v0.4.0-beta.4) (2026-07-01)


### ✨ 新功能 Features

* **skill:** 支持交互管理通用技能 ([48a1ff2](https://github.com/SilentFlower/flower-trellis/commit/48a1ff2a18fccdad85b56ea3a5e53b222b86b07c))

## [0.4.0-beta.3](https://github.com/SilentFlower/flower-trellis/compare/v0.4.0-beta.2...v0.4.0-beta.3) (2026-07-01)


### ✨ 新功能 Features

* **skill:** 支持安装 humanize-writing 增强技能 ([3413628](https://github.com/SilentFlower/flower-trellis/commit/341362881d6ccd123dbef14e080aec975eef4b94))

## [0.4.0-beta.2](https://github.com/SilentFlower/flower-trellis/compare/v0.4.0-beta.1...v0.4.0-beta.2) (2026-06-30)


### 🐛 修复 Bug Fixes

* **auto-loop:** 支持 blocked run 原地重试 ([b1137bb](https://github.com/SilentFlower/flower-trellis/commit/b1137bbdbab7637076b49aa67ff9ff29f5202a43))
* **auto-loop:** 简化路由选择提示 ([817dfa0](https://github.com/SilentFlower/flower-trellis/commit/817dfa029cbcede0d30351c9828c16fb4bc17b97))
* **auto-loop:** 精简默认状态输出 ([3849482](https://github.com/SilentFlower/flower-trellis/commit/384948273415b6156270b442430b6902290ae4f2))
* **spec-router:** 减少项目知识弱匹配噪音 ([1b9a6ea](https://github.com/SilentFlower/flower-trellis/commit/1b9a6ea5f4be1285d2f3e5e4091b0df66f16e335))

## [0.4.0-beta.1](https://github.com/SilentFlower/flower-trellis/compare/v0.4.0-beta.0...v0.4.0-beta.1) (2026-06-29)


### ✨ 新功能 Features

* **trellis:** 增加项目知识发现路由 ([961587a](https://github.com/SilentFlower/flower-trellis/commit/961587a88c530c6e37f02e0809c3a318ad5666d0))


### 🐛 修复 Bug Fixes

* **trellis:** 修复 auto-loop commit 与 route 状态边界 ([5cb8e6c](https://github.com/SilentFlower/flower-trellis/commit/5cb8e6c7d73cbf0580abe45c0ea2fdea71c90ca1))

## [0.4.0-beta.0](https://github.com/SilentFlower/flower-trellis/compare/v0.3.1...v0.4.0-beta.0) (2026-06-29)


### ✨ 新功能 Features

* **auto-loop:** 新增自动任务循环 runner ([268140a](https://github.com/SilentFlower/flower-trellis/commit/268140a04df98cfe7ab70c44aabc3032b6359893))


### 🧰 维护 Maintenance

* **trellis:** 升级捆绑 Trellis 到 0.6.5，并修复 route_state.py 状态清理 ([e05c3cf](https://github.com/SilentFlower/flower-trellis/commit/e05c3cff591ddeb529daed8ccafb4c83bea802bc))

## [0.3.1](https://github.com/SilentFlower/flower-trellis/compare/v0.3.0...v0.3.1) (2026-06-28)

### ✨ 新功能 Features

* **enhancements:** 新增任务启动交接摘要流程，在 planning 切到 in_progress 前生成并展示 `brief.md`，实现前重述任务摘要。
* **enhancements:** 新增 `trellis-diff-brief` 技能，用于 check / push / review 前解释当前任务与 git diff 的实际改动。
* **enhancements:** 新增 `trellis-visualize` 可视化图解技能，并随包携带离线 HTML/SVG 模板。
* **update:** 升级 Trellis 时保留目标项目 `config.yaml` 的本地配置。

### 🐛 修复 Bug Fixes

* **cli:** 优化版本输出排版。
* **route:** 统一任务内路由决策复用机制，修正 check 后修复 / 复查时 implement/check 路由复用规则。
* **trellis:** 强化上线核对规则。
* **enhancements:** 使用 `.backup-flower` 保存回滚备份，避免升级注入时产生零散备份文件。
* **enhancements:** 支持上下文压缩后恢复本轮 route 选择，并将 route 状态读写下沉到 helper 脚本。
* **enhancements:** 修正 `trellis-visualize` 输出语言规则，确保中文对话下不残留无关英文模板文案。
* **enhancements:** 精简 route state helper 默认输出。
* **release:** 本地化 CHANGELOG 历史条目，并记录 CHANGELOG 中文说明约定。

### 📝 文档 Docs

* **spec:** 补充 AI 高频上下文、skill 与 helper 脚本职责边界。
* **spec:** 要求 release notes / CHANGELOG 用户可见说明使用中文。

## [0.3.1-beta.7](https://github.com/SilentFlower/flower-trellis/compare/v0.3.1-beta.6...v0.3.1-beta.7) (2026-06-26)


### 🐛 修复 Bug Fixes

* **enhancements:** 精简 route state helper 默认输出 ([afa9282](https://github.com/SilentFlower/flower-trellis/commit/afa9282b102e5cabec31b87e16d3d85ffa2866b2))
* **release:** 本地化 CHANGELOG 历史条目 ([8b1db0c](https://github.com/SilentFlower/flower-trellis/commit/8b1db0c1116ec29467e33f9b3f1313dd91198f52))


### 📝 文档 Docs

* **spec:** 要求 CHANGELOG 使用中文说明 ([2e6cb15](https://github.com/SilentFlower/flower-trellis/commit/2e6cb157010382bb69234f917f436276ca25580b))

## [0.3.1-beta.6](https://github.com/SilentFlower/flower-trellis/compare/v0.3.1-beta.5...v0.3.1-beta.6) (2026-06-26)

### ✨ 新功能 Features

* **enhancements:** `trellis-route` 支持压缩后复用本轮已选择的执行模式，减少重复询问，并将 route 状态读写下沉到随 skill 分发的 helper 脚本 ([123a1ae](https://github.com/SilentFlower/flower-trellis/commit/123a1ae2c10badf49bd6b9ba5231a75ef9e27995), [bbee078](https://github.com/SilentFlower/flower-trellis/commit/bbee07869ae56f2750823b26c0755db31c63020d))

### 🐛 修复 Bug Fixes

* **enhancements:** 使用 `.backup-flower` 保存回滚备份，避免升级注入时产生零散备份文件 ([c18370c](https://github.com/SilentFlower/flower-trellis/commit/c18370c8a471dfb01c4dbd19b21ba6b8e3eecdff))

### 📝 文档 Docs

* **spec:** 记录 AI 高频上下文、skill 与 helper 脚本的职责边界 ([d89e3b2](https://github.com/SilentFlower/flower-trellis/commit/d89e3b28b32b85f38c954c6e1e9557f78e73bf1a))

## [0.3.1-beta.5](https://github.com/SilentFlower/flower-trellis/compare/v0.3.1-beta.4...v0.3.1-beta.5) (2026-06-26)

### ✨ 新功能 Features

* **enhancements:** 新增 `trellis-visualize` 可视化图解技能，用于生成架构、流程、业务逻辑和状态流转图。([dabd102](https://github.com/SilentFlower/flower-trellis/commit/dabd102d2fde33a5bd6cf137da8c48d40e19f802))
* **update:** 升级 Trellis 时保留目标项目 `config.yaml` 的本地配置。([b9dc4e8](https://github.com/SilentFlower/flower-trellis/commit/b9dc4e8a903c04f6c420c328e2deae08d8bbe4bd))

### 🐛 修复 Bug Fixes

* **enhancements:** 随包携带 `trellis-visualize` 的 HTML/SVG 模板，确保离线生成图解时能复用统一视觉结构。([9f431ac](https://github.com/SilentFlower/flower-trellis/commit/9f431acdf32680edf2611fcf0938e8e3cdb8fad0))
* **enhancements:** 修正 `trellis-visualize` 输出语言规则，中文对话下节点、图例和说明卡片不再残留无关英文模板文案。([f8e3a9f](https://github.com/SilentFlower/flower-trellis/commit/f8e3a9f778b3afb4736e848f457a81df9f6d667f))

## [0.3.1-beta.4](https://github.com/SilentFlower/flower-trellis/compare/v0.3.1-beta.3...v0.3.1-beta.4) (2026-06-25)

### ✨ 新功能 Features

* 新增任务启动交接摘要流程：在 planning 切到 in_progress 前生成并展示 `brief.md`，实现前重述任务交接摘要，降低重新细读三件套的成本。([350f254](https://github.com/SilentFlower/flower-trellis/commit/350f254b1f5a12b0277b3437b5e540217f9b9216))
* 新增 `trellis-diff-brief` 按需技能：在 check / push / review 前读取当前任务和 git diff，在对话中解释本轮实际改动，不拉长默认 workflow。([8ba0720](https://github.com/SilentFlower/flower-trellis/commit/8ba0720bb94ddb601ce2c687a0c35a1baacd9636))

## [0.3.1-beta.3](https://github.com/SilentFlower/flower-trellis/compare/v0.3.1-beta.2...v0.3.1-beta.3) (2026-06-25)


### 🐛 修复 Bug Fixes

* **route:** 统一任务内路由决策复用机制 ([43fd7ef](https://github.com/SilentFlower/flower-trellis/commit/43fd7ef9a773888a0e5249f021a985efa1435823))

## [0.3.1-beta.2](https://github.com/SilentFlower/flower-trellis/compare/v0.3.1-beta.1...v0.3.1-beta.2) (2026-06-25)


### 🐛 修复 Bug Fixes

* **trellis:** 强化上线核对规则 ([13f109a](https://github.com/SilentFlower/flower-trellis/commit/13f109a5a788de7b5e654d46604d6cce694f772c))

## [0.3.1-beta.1](https://github.com/SilentFlower/flower-trellis/compare/v0.3.1-beta.0...v0.3.1-beta.1) (2026-06-25)


### 🐛 修复 Bug Fixes

* **cli:** 优化版本输出排版 ([2119845](https://github.com/SilentFlower/flower-trellis/commit/2119845a876884512ceb1db343f164bc8a7f9e6f))

## [0.3.1-beta.0](https://github.com/SilentFlower/flower-trellis/compare/v0.3.0-beta.4...v0.3.1-beta.0) (2026-06-25)


### 🐛 修复 Bug Fixes

* **route:** 修正 check 后修复/复查时 implement/check 路由复用规则 ([d0749e1](https://github.com/SilentFlower/flower-trellis/commit/d0749e1458b37b0195ce412c3ed0b3ea7d16ff64))

## [0.3.0](https://github.com/SilentFlower/flower-trellis/compare/v0.2.4...v0.3.0) (2026-06-18)


### ✨ 新功能 Features

* **cli:** 支持 beta 发布通道与升级检测 ([4f5a274](https://github.com/SilentFlower/flower-trellis/commit/4f5a2748579dd1853650a7748583980fe655e942))
* **cli:** 同步全局 Trellis 版本 ([e20508d](https://github.com/SilentFlower/flower-trellis/commit/e20508d18470cd5bb664903baff10bf0e7986651))
* **codex:** 强制 Codex sub-agent 调度 ([bd81154](https://github.com/SilentFlower/flower-trellis/commit/bd811545adfe70ed8c367c9a582a3f07a27dcf01))
* **trellis-release:** 新增上线批次汇总技能 ([34ed425](https://github.com/SilentFlower/flower-trellis/commit/34ed425119f14540fe7b924e8ec2cb3f599ee424))
* **trellis:** 升级 Trellis 0.6.0 ([173a145](https://github.com/SilentFlower/flower-trellis/commit/173a14505d98bdb8149a27d1f8d96fa50dec802a))
* **trellis:** 注入 finish-work 上线事项覆写 ([535efcd](https://github.com/SilentFlower/flower-trellis/commit/535efcd87cd77f9f5f7dd38232f2d581b2918018))
* **trellis:** 优化 trellis-push 执行计划 ([c33ec7c](https://github.com/SilentFlower/flower-trellis/commit/c33ec7c24f799bf88caf443dd9c8a0720a57e7d2))
* **trellis:** 优化 trellis-route 路由偏好 ([d660f4c](https://github.com/SilentFlower/flower-trellis/commit/d660f4c66b9445f06de6a6c45d455ad69452b29b))
* **trellis:** 优化版本 task wave 规划 ([ab6f085](https://github.com/SilentFlower/flower-trellis/commit/ab6f0855322bbc0c808b7a2fe1e5a80978614c24))


### 🐛 修复 Bug Fixes

* **release:** 合并 beta 与稳定版发布 workflow ([0cd8cdc](https://github.com/SilentFlower/flower-trellis/commit/0cd8cdc9f0a50be83d0951f986019778b6764879))
* **route:** 修正 2.2 检查路由边界 ([da8ffe7](https://github.com/SilentFlower/flower-trellis/commit/da8ffe7b13adbb652afec769152f06f43e691b9a))
* **trellis-push:** 放宽 snapshot bookkeeping 脏工作区规则 ([33baf94](https://github.com/SilentFlower/flower-trellis/commit/33baf9459371f1d7b43c2d4df09ff9bfe5e52e17))
* **trellis:** 修正检查路由阶段边界 ([efaeea3](https://github.com/SilentFlower/flower-trellis/commit/efaeea38a71be4a5294a1868e21e9796abc754d2))
* **trellis:** 升级 0.6.1 并修正 skill-garden 覆盖 ([e5a6cd6](https://github.com/SilentFlower/flower-trellis/commit/e5a6cd67be4efc3cbb7c5ec75b3fe88b1e446adc))
* **trellis:** 升级 0.6.2 并修正 continue 路由 ([4dffb9f](https://github.com/SilentFlower/flower-trellis/commit/4dffb9f553bed077b6d2ed9afebebaaf4dd9a776))
* **workflow:** 精简 post-check 后 trellis-push 引导 ([101fed6](https://github.com/SilentFlower/flower-trellis/commit/101fed6d2d66fcb08aa036bb6c86b71f795a73c2))


### 📝 文档 Docs

* **release:** 记录发版前 changelog 预览门禁 ([7126598](https://github.com/SilentFlower/flower-trellis/commit/71265980a94e09ba11aa690bd51ecec58b0d625c))
* **trellis:** 按 wave 排序 task 创建顺序 ([2dc4f0c](https://github.com/SilentFlower/flower-trellis/commit/2dc4f0ce845178fc9221f06152fbce2c5f26c671))
* **workflow:** 明确 inline 模式仍需路由 ([be2c4e7](https://github.com/SilentFlower/flower-trellis/commit/be2c4e749f65aa3f5557ac9bc6c14c3e0af45ba1))

## [0.3.0-beta.4](https://github.com/SilentFlower/flower-trellis/compare/v0.3.0-beta.3...v0.3.0-beta.4) (2026-06-25)

### 📝 文档 Docs

* 错误发布版本，改用 0.3.1-beta.0。

## [0.3.0-beta.3](https://github.com/SilentFlower/flower-trellis/compare/v0.3.0-beta.2...v0.3.0-beta.3) (2026-06-17)


### 🐛 修复 Bug Fixes

* **trellis:** 升级 0.6.1 并修正 skill-garden 覆盖 ([e5a6cd6](https://github.com/SilentFlower/flower-trellis/commit/e5a6cd67be4efc3cbb7c5ec75b3fe88b1e446adc))
* **trellis:** 升级 0.6.2 并修正 continue 路由 ([4dffb9f](https://github.com/SilentFlower/flower-trellis/commit/4dffb9f553bed077b6d2ed9afebebaaf4dd9a776))

## [0.3.0-beta.2](https://github.com/SilentFlower/flower-trellis/compare/v0.3.0-beta.1...v0.3.0-beta.2) (2026-06-17)


### ✨ 新功能 Features

* **cli:** 同步全局 Trellis 版本 ([e20508d](https://github.com/SilentFlower/flower-trellis/commit/e20508d18470cd5bb664903baff10bf0e7986651))
* **trellis-release:** 新增上线批次汇总技能 ([34ed425](https://github.com/SilentFlower/flower-trellis/commit/34ed425119f14540fe7b924e8ec2cb3f599ee424))
* **trellis:** 注入 finish-work 上线事项覆写 ([535efcd](https://github.com/SilentFlower/flower-trellis/commit/535efcd87cd77f9f5f7dd38232f2d581b2918018))


### 🐛 修复 Bug Fixes

* **route:** 修正 2.2 检查路由边界 ([da8ffe7](https://github.com/SilentFlower/flower-trellis/commit/da8ffe7b13adbb652afec769152f06f43e691b9a))
* **trellis:** 修正检查路由阶段边界 ([efaeea3](https://github.com/SilentFlower/flower-trellis/commit/efaeea38a71be4a5294a1868e21e9796abc754d2))
* **workflow:** 精简 post-check 后 trellis-push 引导 ([101fed6](https://github.com/SilentFlower/flower-trellis/commit/101fed6d2d66fcb08aa036bb6c86b71f795a73c2))


### 📝 文档 Docs

* **trellis:** 按 wave 排序 task 创建顺序 ([2dc4f0c](https://github.com/SilentFlower/flower-trellis/commit/2dc4f0ce845178fc9221f06152fbce2c5f26c671))

## [0.3.0-beta.1](https://github.com/SilentFlower/flower-trellis/compare/v0.3.0-beta.0...v0.3.0-beta.1) (2026-06-16)


### ✨ 新功能 Features

* **codex:** 强制 Codex sub-agent 调度 ([bd81154](https://github.com/SilentFlower/flower-trellis/commit/bd811545adfe70ed8c367c9a582a3f07a27dcf01))

## [0.3.0-beta.0](https://github.com/SilentFlower/flower-trellis/compare/v0.2.5-beta.2...v0.3.0-beta.0) (2026-06-16)


### ✨ 新功能 Features

* **trellis:** 升级 Trellis 0.6.0 ([173a145](https://github.com/SilentFlower/flower-trellis/commit/173a14505d98bdb8149a27d1f8d96fa50dec802a))


### 🐛 修复 Bug Fixes

* **trellis-push:** 放宽 snapshot bookkeeping 脏工作区规则 ([33baf94](https://github.com/SilentFlower/flower-trellis/commit/33baf9459371f1d7b43c2d4df09ff9bfe5e52e17))

## [0.2.5-beta.2](https://github.com/SilentFlower/flower-trellis/compare/v0.2.5-beta.1...v0.2.5-beta.2) (2026-06-16)


### 📝 文档 Docs

* **release:** 记录发版前 changelog 预览门禁 ([7126598](https://github.com/SilentFlower/flower-trellis/commit/71265980a94e09ba11aa690bd51ecec58b0d625c))
* **workflow:** 明确 inline 模式仍需路由 ([be2c4e7](https://github.com/SilentFlower/flower-trellis/commit/be2c4e749f65aa3f5557ac9bc6c14c3e0af45ba1))

## [0.2.5-beta.1](https://github.com/SilentFlower/flower-trellis/compare/v0.2.5-beta.0...v0.2.5-beta.1) (2026-06-15)


### 🐛 修复 Bug Fixes

* **release:** 合并 beta 与稳定版发布 workflow ([0cd8cdc](https://github.com/SilentFlower/flower-trellis/commit/0cd8cdc9f0a50be83d0951f986019778b6764879))

## [0.2.5-beta.0](https://github.com/SilentFlower/flower-trellis/compare/v0.2.4...v0.2.5-beta.0) (2026-06-15)


### ✨ 新功能 Features

* **cli:** 支持 beta 发布通道与升级检测 ([4f5a274](https://github.com/SilentFlower/flower-trellis/commit/4f5a2748579dd1853650a7748583980fe655e942))
* **trellis:** 优化 trellis-push 执行计划 ([c33ec7c](https://github.com/SilentFlower/flower-trellis/commit/c33ec7c24f799bf88caf443dd9c8a0720a57e7d2))
* **trellis:** 优化 trellis-route 路由偏好 ([d660f4c](https://github.com/SilentFlower/flower-trellis/commit/d660f4c66b9445f06de6a6c45d455ad69452b29b))
* **trellis:** 优化版本 task wave 规划 ([ab6f085](https://github.com/SilentFlower/flower-trellis/commit/ab6f0855322bbc0c808b7a2fe1e5a80978614c24))

## [0.2.4](https://github.com/SilentFlower/flower-trellis/compare/v0.2.3...v0.2.4) (2026-06-09)


### ✨ 新功能 Features

* **cli:** -v 增加 project flower 行,显示项目上次铺包的 flower 版本 ([9cbdc3b](https://github.com/SilentFlower/flower-trellis/commit/9cbdc3be48b0587a667ca1f51c29788dc2f43fec))
* **trellis:** check 后停止自动 finish-work ([7b6a4dc](https://github.com/SilentFlower/flower-trellis/commit/7b6a4dca0f612aeab7dbe82ca98a3c6aa7a07499))
* **trellis:** 正式 monorepo 化 — config.yaml 声明 packages + spec 迁移至 flower-trellis/cli ([8b153e6](https://github.com/SilentFlower/flower-trellis/commit/8b153e6c241cbd9fa03095241fc192391210f439))


### 🐛 修复 Bug Fixes

* **cli:** 平台多选/升级确认改用 @inquirer/prompts 消除 WSL 闪屏 ([2df7e41](https://github.com/SilentFlower/flower-trellis/commit/2df7e415472880ecd3dad3c88014cc4736eb26a5))
* **trellis:** 恢复 config.yaml 被 update 冲掉的 monorepo packages 声明 ([6c8320f](https://github.com/SilentFlower/flower-trellis/commit/6c8320f178037ddad986ee407bf626bbf4a89551))


### 📝 文档 Docs

* **spec:** 沉淀「交互 prompt 用 @inquirer/prompts、禁用经典 inquirer」约定 ([e637608](https://github.com/SilentFlower/flower-trellis/commit/e637608471187cf76e9109c23623b205fe22f7e5))


### 🔧 维护 Chores

* **trellis:** 更新 flower manifest 与 workflow 注入文案 ([34935e5](https://github.com/SilentFlower/flower-trellis/commit/34935e576596f554d8d9e0bedbf36663e808593f))

## [0.2.3](https://github.com/SilentFlower/flower-trellis/compare/v0.2.2...v0.2.3) (2026-06-08)


### ✨ 新功能 Features

* 同步 skill-garden 强化包(commit gate + commit-only)并重建快照 ([01f359d](https://github.com/SilentFlower/flower-trellis/commit/01f359d04d089fedeac9ffccb0b6b42722ec770a))
* 重叠加强化包刷新本仓 workflow/skills(commit gate + commit-only 生效) ([fdef47b](https://github.com/SilentFlower/flower-trellis/commit/fdef47b4bc10c157791081cf9bd169008da4e609))


### 📝 文档 Docs

* **spec:** 沉淀发版流程与 submodule 同步约定到 cli spec ([8e44924](https://github.com/SilentFlower/flower-trellis/commit/8e4492482256668404b28446fc76f6ee74b0c819))

## [0.2.2](https://github.com/SilentFlower/flower-trellis/compare/v0.2.1...v0.2.2) (2026-06-08)


### ✨ 新功能 Features

* 新增 tag 触发的 GitHub Actions 发布工作流(OIDC + provenance) ([bf6d1c7](https://github.com/SilentFlower/flower-trellis/commit/bf6d1c787c0e3b67ef37c8de868f5e868d493467))
* 新增本地一键发布流程(commit-and-tag-version + 快照一致性断言) ([e5c1c89](https://github.com/SilentFlower/flower-trellis/commit/e5c1c89b40f08107ae6cf97873e388928248fb1c))


### 🐛 修复 Bug Fixes

* 发布工作流改用 Node 22(npm trusted publishing 要求 Node ≥ 22.14.0) ([80b8ef9](https://github.com/SilentFlower/flower-trellis/commit/80b8ef9e1c338069ea0bcb9db7ecd147c538fa63))


### 📝 文档 Docs

* 补充发布流程与 submodule 使用说明 ([39db270](https://github.com/SilentFlower/flower-trellis/commit/39db2707de7148ddbc843ce47e82e545ea5e4a64))
