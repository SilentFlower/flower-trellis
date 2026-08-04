# Changelog

本项目所有重要变更都会记录在此文件。

版本号遵循 [SemVer](https://semver.org/lang/zh-CN/);提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 规范。

## [0.6.0-beta.5](https://github.com/SilentFlower/flower-trellis/compare/v0.6.0-beta.4...v0.6.0-beta.5) (2026-08-04)


### ✨ 新功能 Features

* **update:** 新增对话内 Flower 手动升级入口 ([b1df949](https://github.com/SilentFlower/flower-trellis/commit/b1df949cfc42bee5fd2d2b98fef5dd2870386bbb))

## [0.6.0-beta.4](https://github.com/SilentFlower/flower-trellis/compare/v0.6.0-beta.3...v0.6.0-beta.4) (2026-08-04)


### ✨ 新功能 Features

* **common:** 升级 humanize-writing 去 AI 味流程 ([c02910c](https://github.com/SilentFlower/flower-trellis/commit/c02910c0e9bb7f31c221f0f927df2254309f8e92))
* **trellis:** 新增 linked worktree 入口准备能力 ([5af8e7a](https://github.com/SilentFlower/flower-trellis/commit/5af8e7ad3f5fcbe839a27fd518a4d0341da9bc5d))

## [0.6.0-beta.3](https://github.com/SilentFlower/flower-trellis/compare/v0.6.0-beta.2...v0.6.0-beta.3) (2026-08-04)


### ✨ 新功能 Features

* **check-all:** 同步 Check-All fact-status 文档修复规则 ([8b48a5c](https://github.com/SilentFlower/flower-trellis/commit/8b48a5c5b074ad614351726a85525853352da990))
* **update:** 增加启动更新提示节流控制 ([d341841](https://github.com/SilentFlower/flower-trellis/commit/d34184194e260359a427da72205621579577ab65))


### 🐛 修复 Bug Fixes

* **trellis:** 同步 untracked_flow 入口限制 ([4732835](https://github.com/SilentFlower/flower-trellis/commit/47328352035b9d4c5e9972a95dd457e4d7eb9217))
* **trellis:** 衔接 untracked 检查、规范更新和推送链路 ([9f1e3b1](https://github.com/SilentFlower/flower-trellis/commit/9f1e3b16af627b9c95a373047a146d07c6ecda72))

## [0.6.0-beta.2](https://github.com/SilentFlower/flower-trellis/compare/v0.6.0-beta.1...v0.6.0-beta.2) (2026-08-03)


### 🐛 修复 Bug Fixes

* 修复 Skill-Garden update 平台状态污染 ([787d4c7](https://github.com/SilentFlower/flower-trellis/commit/787d4c797834b4a0bb909e4eb20afe0be281fde1))

## [0.6.0-beta.1](https://github.com/SilentFlower/flower-trellis/compare/v0.6.0-beta.0...v0.6.0-beta.1) (2026-08-03)


### 🐛 修复 Bug Fixes

* 同步简化 untracked 流程与 Push 路由 ([26ce73a](https://github.com/SilentFlower/flower-trellis/commit/26ce73a0a9a5dbcc3b8a623ca08b062a54a1e810))

## [0.6.0-beta.0](https://github.com/SilentFlower/flower-trellis/compare/v0.5.6-beta.1...v0.6.0-beta.0) (2026-08-03)


### ✨ 新功能 Features

* 升级 Patch Engine 适配 Trellis 0.6.12 ([3b1a32e](https://github.com/SilentFlower/flower-trellis/commit/3b1a32e1bdf6d532b467e786df5c0c5ff69e6f85))


### 🐛 修复 Bug Fixes

* 同步 Trellis 0.6.12 工作流修复 ([239ce16](https://github.com/SilentFlower/flower-trellis/commit/239ce1688d8d13af6cef2bfe64a5d8d1b5226136))
* 完善 Trellis 0.6.12 升级与平台适配 ([aefda43](https://github.com/SilentFlower/flower-trellis/commit/aefda431e4af59e15afbad4d98a598522b7916bc))

## [0.5.6-beta.1](https://github.com/SilentFlower/flower-trellis/compare/v0.5.6-beta.0...v0.5.6-beta.1) (2026-08-01)


### 🐛 修复 Bug Fixes

* **telemetry:** 将匿名遥测上报默认超时延长至 10 秒 ([5397204](https://github.com/SilentFlower/flower-trellis/commit/539720442676bca21b1d31662d28fbdf2aa9cb6d))

## [0.5.6-beta.0](https://github.com/SilentFlower/flower-trellis/compare/v0.5.5...v0.5.6-beta.0) (2026-07-31)


### ✨ 新功能 Features

* **auto-loop:** 支持依赖型多仓提交 ([618cfae](https://github.com/SilentFlower/flower-trellis/commit/618cfaef5fd8bff9f45122b424b4cec1b82a7874))
* **skill:** 集成阿里云 SLS 查询 ([b8c611f](https://github.com/SilentFlower/flower-trellis/commit/b8c611fd5b8cc2369843401eb5fce8d7643a3769))
* **telemetry:** 添加匿名安装遥测 ([dbc6ab2](https://github.com/SilentFlower/flower-trellis/commit/dbc6ab24289f502fd0a66bf0a71e3da0d1700213))
* **workflow:** 集成稳定无任务完成流程 ([a4a02c0](https://github.com/SilentFlower/flower-trellis/commit/a4a02c068b95c2949de355fe2b7394e099b9a114))

## [0.5.5](https://github.com/SilentFlower/flower-trellis/compare/v0.5.4...v0.5.5) (2026-07-29)


### 🐛 修复 Bug Fixes

* **cli:** 修复 Windows PTY 交互状态泄漏 ([e14ffc9](https://github.com/SilentFlower/flower-trellis/commit/e14ffc922e052120a0b0993420e0b2bb5c11a8f2))
* **cli:** 修复 Windows 完成页退出挂起 ([ae2fd30](https://github.com/SilentFlower/flower-trellis/commit/ae2fd30ed9e0f378ec34a60ad1167766979539ce))

## [0.5.4](https://github.com/SilentFlower/flower-trellis/compare/v0.5.3...v0.5.4) (2026-07-29)


### ✨ 新功能 Features

* **cli:** 优化 init 与 update 交互体验 ([1248456](https://github.com/SilentFlower/flower-trellis/commit/12484563bb9f5b7f6842879c38adca02c9697584))
* **craft-rpa:** 同步网络采集与页面控制升级 ([4827e20](https://github.com/SilentFlower/flower-trellis/commit/4827e2043a2123ba331ff82c0b59ce03cbb29f6c))


### 🐛 修复 Bug Fixes

* **workflow:** 防止发布请求误触 trellis-release ([e3e4add](https://github.com/SilentFlower/flower-trellis/commit/e3e4addd953059bdaa5135ac527432f4c0f8838a))

## [0.5.3](https://github.com/SilentFlower/flower-trellis/compare/v0.5.2...v0.5.3) (2026-07-29)


### 🐛 修复 Bug Fixes

* **plugin:** 修复 Craft RPA 运行时软链重放 ([3a68641](https://github.com/SilentFlower/flower-trellis/commit/3a686414c0941ca365b9443328064ab6143cd6f8))

## [0.5.2](https://github.com/SilentFlower/flower-trellis/compare/v0.5.1...v0.5.2) (2026-07-29)


### ✨ 新功能 Features

* **0.6:** 同步 Push 门禁与意图识别 ([8abf3b1](https://github.com/SilentFlower/flower-trellis/commit/8abf3b1439d7a5dd2af0d698c4094aa6c7207fb3))
* **brief:** 同步 Brief 显式预授权流程 ([7c179af](https://github.com/SilentFlower/flower-trellis/commit/7c179affd7389cac053d28104e0d624773159c72))
* **spec-router:** 同步章节感知加载能力 ([0d51a24](https://github.com/SilentFlower/flower-trellis/commit/0d51a24e6136bb9b167cd5716eeb9958b5d8412e))
* **trellis:** 补全 Meta 架构并修复 Auto-Loop 自恢复 ([943179f](https://github.com/SilentFlower/flower-trellis/commit/943179f42e3e3d068bf98f8ff60b2aa324acc4dd))
* **plugin:** 建立契约与项目状态存储 ([3c664c3](https://github.com/SilentFlower/flower-trellis/commit/3c664c337806849d7bf040f269eb0f1ebed115f0))
* **plugin:** 支持 GitHub 外部格式与交互来源管理 ([8701039](https://github.com/SilentFlower/flower-trellis/commit/8701039ea8f8018e7e8d017c0ac5f545b9b2549b))
* **plugin:** 新增 GitLab 市场外部来源 ([3688744](https://github.com/SilentFlower/flower-trellis/commit/3688744d7663952d437f4bc4e5c8187798c45453))
* **plugin:** 新增插件能力授权策略 ([32ec993](https://github.com/SilentFlower/flower-trellis/commit/32ec993de77686fb411451c4165ca17367cf5e33))
* **plugin:** 新增插件运行时生命周期 ([0d7c5b1](https://github.com/SilentFlower/flower-trellis/commit/0d7c5b1ae4821e8cbadcd857608399c2e725c560))
* **plugin:** 添加作者工具与 CI 契约 ([4e34b87](https://github.com/SilentFlower/flower-trellis/commit/4e34b878f37fddb3732b2264b90f79b3610c82d0))
* **plugin:** 迁移 skill-garden 到插件运行时 ([2e9fd18](https://github.com/SilentFlower/flower-trellis/commit/2e9fd18123e3164a68971725269619401b2625b4))
* 增加 Check-All 下一步引导 ([fa488f8](https://github.com/SilentFlower/flower-trellis/commit/fa488f83c85983b8b8c545b85e4e42d20b290bdf))


### 🐛 修复 Bug Fixes

* **trellis:** 移除旧更新检查 marker ([a33f376](https://github.com/SilentFlower/flower-trellis/commit/a33f376d7efe15441cba8fbe0b0a67c6f1a15f6c))
* **plugin:** 优化外部来源交互与 archive 安全检测 ([4699a22](https://github.com/SilentFlower/flower-trellis/commit/4699a2211cb280e5a085c852950fda52af28c456))
* **plugin:** 修复远程更新并完成集成验收 ([3db8320](https://github.com/SilentFlower/flower-trellis/commit/3db83208a6da12c3bbcad1730e144271ff02a96a))
* **trellis:** 优化 auto-loop 重试预算与跟踪状态 ([19d7a1a](https://github.com/SilentFlower/flower-trellis/commit/19d7a1ae5302af56085e1053706442ad7cb347b0))
* **trellis:** 支持跳过 Check-All 并修复 update -y ([1bd0a12](https://github.com/SilentFlower/flower-trellis/commit/1bd0a126f91f6b915d2253f1a497bda40fc41edb))
* 修复 Windows Trellis Patch 命令漂移 ([5892e7f](https://github.com/SilentFlower/flower-trellis/commit/5892e7f7629be0a7ee075a3758f594a220c7db1f))


### ♻️ 重构 Refactor

* **trellis:** 拆分 Check-All 检查档位并同步快照 ([ef1a8c4](https://github.com/SilentFlower/flower-trellis/commit/ef1a8c434244c06cf565c449173c6d6763a0a160))


### 🧰 维护 Maintenance

* **trellis:** 同步 Flower 0.5.1-beta.1 清单 ([d3dfc27](https://github.com/SilentFlower/flower-trellis/commit/d3dfc2759927b0759b10e2ae246b68438dc3d339))
* **trellis:** 执行 Flower 自更新同步 ([f79ce33](https://github.com/SilentFlower/flower-trellis/commit/f79ce33bcc409129a054f1b59a016cdbe1ea991b))

## [0.5.2-beta.1](https://github.com/SilentFlower/flower-trellis/compare/v0.5.2-beta.0...v0.5.2-beta.1) (2026-07-29)


### ✨ 新功能 Features

* **0.6:** 同步 Push 门禁与意图识别 ([8abf3b1](https://github.com/SilentFlower/flower-trellis/commit/8abf3b1439d7a5dd2af0d698c4094aa6c7207fb3))
* **brief:** 同步 Brief 显式预授权流程 ([7c179af](https://github.com/SilentFlower/flower-trellis/commit/7c179affd7389cac053d28104e0d624773159c72))
* **spec-router:** 同步章节感知加载能力 ([0d51a24](https://github.com/SilentFlower/flower-trellis/commit/0d51a24e6136bb9b167cd5716eeb9958b5d8412e))
* **trellis:** 补全 Meta 架构并修复 Auto-Loop 自恢复 ([943179f](https://github.com/SilentFlower/flower-trellis/commit/943179f42e3e3d068bf98f8ff60b2aa324acc4dd))


### 🐛 修复 Bug Fixes

* **trellis:** 移除旧更新检查 marker ([a33f376](https://github.com/SilentFlower/flower-trellis/commit/a33f376d7efe15441cba8fbe0b0a67c6f1a15f6c))

## [0.5.2-beta.0](https://github.com/SilentFlower/flower-trellis/compare/v0.5.1-beta.1...v0.5.2-beta.0) (2026-07-29)


### ✨ 新功能 Features

* **plugin:** 建立契约与项目状态存储 ([3c664c3](https://github.com/SilentFlower/flower-trellis/commit/3c664c337806849d7bf040f269eb0f1ebed115f0))
* **plugin:** 支持 GitHub 外部格式与交互来源管理 ([8701039](https://github.com/SilentFlower/flower-trellis/commit/8701039ea8f8018e7e8d017c0ac5f545b9b2549b))
* **plugin:** 新增 GitLab 市场外部来源 ([3688744](https://github.com/SilentFlower/flower-trellis/commit/3688744d7663952d437f4bc4e5c8187798c45453))
* **plugin:** 新增插件能力授权策略 ([32ec993](https://github.com/SilentFlower/flower-trellis/commit/32ec993de77686fb411451c4165ca17367cf5e33))
* **plugin:** 新增插件运行时生命周期 ([0d7c5b1](https://github.com/SilentFlower/flower-trellis/commit/0d7c5b1ae4821e8cbadcd857608399c2e725c560))
* **plugin:** 添加作者工具与 CI 契约 ([4e34b87](https://github.com/SilentFlower/flower-trellis/commit/4e34b878f37fddb3732b2264b90f79b3610c82d0))
* **plugin:** 迁移 skill-garden 到插件运行时 ([2e9fd18](https://github.com/SilentFlower/flower-trellis/commit/2e9fd18123e3164a68971725269619401b2625b4))
* 增加 Check-All 下一步引导 ([fa488f8](https://github.com/SilentFlower/flower-trellis/commit/fa488f83c85983b8b8c545b85e4e42d20b290bdf))


### 🐛 修复 Bug Fixes

* **plugin:** 优化外部来源交互与 archive 安全检测 ([4699a22](https://github.com/SilentFlower/flower-trellis/commit/4699a2211cb280e5a085c852950fda52af28c456))
* **plugin:** 修复远程更新并完成集成验收 ([3db8320](https://github.com/SilentFlower/flower-trellis/commit/3db83208a6da12c3bbcad1730e144271ff02a96a))
* **trellis:** 优化 auto-loop 重试预算与跟踪状态 ([19d7a1a](https://github.com/SilentFlower/flower-trellis/commit/19d7a1ae5302af56085e1053706442ad7cb347b0))
* **trellis:** 支持跳过 Check-All 并修复 update -y ([1bd0a12](https://github.com/SilentFlower/flower-trellis/commit/1bd0a126f91f6b915d2253f1a497bda40fc41edb))


### ♻️ 重构 Refactor

* **trellis:** 拆分 Check-All 检查档位并同步快照 ([ef1a8c4](https://github.com/SilentFlower/flower-trellis/commit/ef1a8c434244c06cf565c449173c6d6763a0a160))


### 🧰 维护 Maintenance

* **trellis:** 同步 Flower 0.5.1-beta.1 清单 ([d3dfc27](https://github.com/SilentFlower/flower-trellis/commit/d3dfc2759927b0759b10e2ae246b68438dc3d339))
* **trellis:** 执行 Flower 自更新同步 ([f79ce33](https://github.com/SilentFlower/flower-trellis/commit/f79ce33bcc409129a054f1b59a016cdbe1ea991b))

## [0.5.1](https://github.com/SilentFlower/flower-trellis/compare/v0.4.11...v0.5.1) (2026-07-28)


### ✨ 新功能 Features

* 将 Workflow Gate 原生融入 Trellis 全流程 ([d20b417](https://github.com/SilentFlower/flower-trellis/commit/d20b417048c438d7611228b6d8f9323b1257a1b8))
  - 将请求路由、任务规划、质量检查、提交发布、auto-loop 与进度恢复等 13 个 Workflow Gate 收敛到对应的原生 phase、state、skill、hook 或 helper。
  - Workflow Hub 缩减为轻量 owner 索引和必要的跨阶段顺序，减少重复规则、上下文占用与后续所有权漂移。
  - 为可确定判断的非法状态增加零副作用硬阻断，并通过 Patch 冲突检查、上下文预算和幂等安装测试保证升级兼容性。
* **0.6:** 统一 Patch Engine 与注入流程 ([db4f943](https://github.com/SilentFlower/flower-trellis/commit/db4f9430dfdafd807726df14c0f0b7b91dcf2b83))
  - 将 0.6 的 Workflow、Skill、Hook 与平台配置统一为 `insert / replace / remove` Patch schema v2。
  - 支持 Bundle 选择、全量 preflight、changed-only apply、首次备份、旧 marker 迁移和 manifest provenance。
  - Flower JS 与 Skill-Garden Python consumer 共享 Core Patch 声明和 fixture，并保持结构化结果 parity。
* **0.6:** 增加 Patch 冲突与兼容门禁 ([2472058](https://github.com/SilentFlower/flower-trellis/commit/2472058714f0986186a84de78b6fd7ad15a2f76b))
  - 对全部 0.6 Patch 目标执行上游 baseline、Patch 与最终产物三方冲突检查。
  - 运行时、`npm test`、`check-snapshot` 与维护者脚本复用同一套 compatibility/conflict evaluator。
  - 清理 route、Check-All、Update-Spec 与 Trellis Push 的互斥协议和重复流程，并区分 info、warning 与阻断错误。
  - 结构化配置只修改受管字段，损坏 JSON/YAML/TOML、required Patch 漂移或冲突检查失败时保持零写入。
  - Trellis `0.6.5` 已完成完整验证；未登记的同线 `0.6.x` 通过全量检查后 warning 放行，`0.7+`、`1.x` 或无效版本会阻断强化。
  - `0.5` / `old` 继续使用原有 legacy 注入路径，避免稳定版升级破坏旧项目。
* **0.6:** 升级 Check-All 智能检查与自动续跑 ([92a3372](https://github.com/SilentFlower/flower-trellis/commit/92a3372fbda723f444ce6defbb10cd9c77938e8d))
* **0.6:** 支持任务意图路由与声明式强化 ([64f06ac](https://github.com/SilentFlower/flower-trellis/commit/64f06ac01369aa5823c1f48213abcf8184c20295))
* **0.6:** 自动衔接 Update-Spec 与 Trellis Push ([74340ca](https://github.com/SilentFlower/flower-trellis/commit/74340ca1a644acb44659970864e209d86363a7ce))
* **0.6:** 首次实现默认检查，连续调整可暂缓后续 Check-All ([d8a3dcd](https://github.com/SilentFlower/flower-trellis/commit/d8a3dcdd7c9783af7ac1223a0b7be0c513d8bd00))
* **skill:** 优化 Trellis 提交与推送流程 ([4359607](https://github.com/SilentFlower/flower-trellis/commit/4359607156502e378ef83302105ca9f0e4f0f1ac))
* **skill:** 自动同步已启用的 common skill ([8b36bc7](https://github.com/SilentFlower/flower-trellis/commit/8b36bc7d24e76dd8973c35378e7bb6d9c8a60ff3))
* 优化 Direct Push 检查后自动续行 ([6d6582e](https://github.com/SilentFlower/flower-trellis/commit/6d6582e4b09fada7736e4059382efd93b1866d91))
* 升级 Auto-Loop 无人值守执行 ([d847439](https://github.com/SilentFlower/flower-trellis/commit/d847439da91bde53ab8ef0e8909431bf6b856202))
* 增加 Check-All 下一步引导 ([fa488f8](https://github.com/SilentFlower/flower-trellis/commit/fa488f83c85983b8b8c545b85e4e42d20b290bdf))
* 控制 Trellis 升级备份保留 ([cead9c0](https://github.com/SilentFlower/flower-trellis/commit/cead9c0e91dd99a6fe324081a71eb2801927131b))
* 集成 Patch 顺序与编译目标 ([a2a3996](https://github.com/SilentFlower/flower-trellis/commit/a2a3996a380ad08ba667eafa8a6ba6568b5ce67e))


### 🐛 修复 Bug Fixes

* 修复 Gate 迁移后的流程入口与跨平台兼容问题 ([b8dd135](https://github.com/SilentFlower/flower-trellis/commit/b8dd135cd93928828f337dc2d799ba221d49f223))
  - 发布、部署等项目工作流动作会先发现项目 SOP，再进入准确能力，避免将 beta 发布误路由到只生成上线操作单的 `trellis-release`。
  - 恢复 planning 与 in-progress 状态下的活动任务范围隔离，防止无关请求误入当前任务流程。
  - `trellis-continue` 会在判断阶段前读取并克制展示未完成进度，同时保持不自动绑定任务、不从进度推断阶段。
  - 恢复规划语义就绪检查与最新 brief 的显式确认，避免仅因规划文件存在就自动启动任务。
  - 实现完成后重新进入 Pre-Check；交互式提交在 Git 操作前校验当前 Update-Spec 结果。
  - 将 Workflow Gate Skill 与 Update-Spec、Finish-Work 入口同步到 17 个平台的原生目录，并统一安装、检测与卸载清理。
* **0.6:** 优化 Check-All 检查与修复体验 ([55b5f12](https://github.com/SilentFlower/flower-trellis/commit/55b5f12be925c078ac769981588712e12a558d68))
* **0.6:** 将当前任务产物纳入 Trellis Push ([462c6fd](https://github.com/SilentFlower/flower-trellis/commit/462c6fd54caa6fbc2ef4ad52e61806aad4909289))
* **0.6:** 支持 Trellis Push 完成已有 Merge ([bd68a8b](https://github.com/SilentFlower/flower-trellis/commit/bd68a8bda90e866a0f8e7e2ffecccc5bb5ff091b))
* **0.6:** 简化 Trellis Push 依赖型多仓确认 ([0172139](https://github.com/SilentFlower/flower-trellis/commit/0172139696e4e25fc5d14a2c4a6229af8a759208))
* **0.6:** 防止 Python 写入失败导致任务与 session 状态漂移 ([74d5d12](https://github.com/SilentFlower/flower-trellis/commit/74d5d12dd26e19133b591e24b1a762dac20ec17d))
* **enhancements:** 修复复杂 BUG 意图路由 ([e7877a3](https://github.com/SilentFlower/flower-trellis/commit/e7877a383efc7b840faad6175d2f15a2b7882a81))
* **enhancements:** 同步 missing_task 意图恢复 ([e1fae6d](https://github.com/SilentFlower/flower-trellis/commit/e1fae6d1adab0440371062b7f35316602d147c5e))
* **enhancements:** 补齐 session fallback 清理 ([b3884cb](https://github.com/SilentFlower/flower-trellis/commit/b3884cb9e3fac25ef504bbee722333f2d3d98c0e))
* **skill:** 简化 Trellis 提交与收尾流程 ([90220a6](https://github.com/SilentFlower/flower-trellis/commit/90220a671eb92ec9c3681e6efe4946aead5d0c39))
* **update:** 修复升级缓存竞争与状态滞后 ([0dc3dd9](https://github.com/SilentFlower/flower-trellis/commit/0dc3dd9ff7dd821c6926ef63f45826dcbcd7d593))
* **update:** 防止升级后绕过 trellis-push ([8a34b91](https://github.com/SilentFlower/flower-trellis/commit/8a34b91aa381c73ee56b9ba5bed960778ba2bbd3))
* **workflow:** 强制任务 brief 确认门禁 ([7750c62](https://github.com/SilentFlower/flower-trellis/commit/7750c62417cabdf519e249deae147e1ec0ec14ac))
* 优化 Check-All 暂缓引导 ([e794ef7](https://github.com/SilentFlower/flower-trellis/commit/e794ef792a36d34b9072f8ec1b0531662709f738))


### 🧰 维护 Maintenance

* **trellis:** 同步 Flower 0.5.1-beta.1 清单 ([d3dfc27](https://github.com/SilentFlower/flower-trellis/commit/d3dfc2759927b0759b10e2ae246b68438dc3d339))
* **trellis:** 同步项目 Flower 版本状态 ([c4e83ab](https://github.com/SilentFlower/flower-trellis/commit/c4e83ab94df110118129d1bf6f8ad9717454dd65))
* **trellis:** 同步项目 Flower 版本状态 ([a48b356](https://github.com/SilentFlower/flower-trellis/commit/a48b356dfe4afd1ff3bb716c6e4affd51a68c699))
* **trellis:** 同步项目 Flower 版本状态到 0.5.0-beta.2 ([855fc39](https://github.com/SilentFlower/flower-trellis/commit/855fc392eaa82cc15146a897d010bdc3a8dfbb93))

## [0.5.1-beta.1](https://github.com/SilentFlower/flower-trellis/compare/v0.5.1-beta.0...v0.5.1-beta.1) (2026-07-24)


### ✨ 新功能 Features

* 优化 Direct Push 检查后自动续行 ([6d6582e](https://github.com/SilentFlower/flower-trellis/commit/6d6582e4b09fada7736e4059382efd93b1866d91))
* 升级 Auto-Loop 无人值守执行 ([d847439](https://github.com/SilentFlower/flower-trellis/commit/d847439da91bde53ab8ef0e8909431bf6b856202))
* 控制 Trellis 升级备份保留 ([cead9c0](https://github.com/SilentFlower/flower-trellis/commit/cead9c0e91dd99a6fe324081a71eb2801927131b))
* 集成 Patch 顺序与编译目标 ([a2a3996](https://github.com/SilentFlower/flower-trellis/commit/a2a3996a380ad08ba667eafa8a6ba6568b5ce67e))


### 🐛 修复 Bug Fixes

* 优化 Check-All 暂缓引导 ([e794ef7](https://github.com/SilentFlower/flower-trellis/commit/e794ef792a36d34b9072f8ec1b0531662709f738))

## [0.5.1-beta.0](https://github.com/SilentFlower/flower-trellis/compare/v0.5.0-beta.7...v0.5.1-beta.0) (2026-07-23)


### ✨ 新功能 Features

* 将 Workflow Gate 原生融入 Trellis 全流程 ([d20b417](https://github.com/SilentFlower/flower-trellis/commit/d20b417048c438d7611228b6d8f9323b1257a1b8))
  - 将请求路由、任务规划、质量检查、提交发布、auto-loop 与进度恢复等 13 个 Workflow Gate 收敛到对应的原生 phase、state、skill、hook 或 helper。
  - Workflow Hub 缩减为轻量 owner 索引和必要的跨阶段顺序，减少重复规则、上下文占用与后续所有权漂移。
  - 为可确定判断的非法状态增加零副作用硬阻断，并通过 Patch 冲突检查、上下文预算和幂等安装测试保证升级兼容性。


### 🐛 修复 Bug Fixes

* 修复 Gate 迁移后的流程入口与跨平台兼容问题 ([b8dd135](https://github.com/SilentFlower/flower-trellis/commit/b8dd135cd93928828f337dc2d799ba221d49f223))
  - 发布、部署等项目工作流动作会先发现项目 SOP，再进入准确能力，避免将 beta 发布误路由到只生成上线操作单的 `trellis-release`。
  - 恢复 planning 与 in-progress 状态下的活动任务范围隔离，防止无关请求误入当前任务流程。
  - `trellis-continue` 会在判断阶段前读取并克制展示未完成进度，同时保持不自动绑定任务、不从进度推断阶段。
  - 恢复规划语义就绪检查与最新 brief 的显式确认，避免仅因规划文件存在就自动启动任务。
  - 实现完成后重新进入 Pre-Check；交互式提交在 Git 操作前校验当前 Update-Spec 结果。
  - 将 Workflow Gate Skill 与 Update-Spec、Finish-Work 入口同步到 17 个平台的原生目录，并统一安装、检测与卸载清理。

## [0.5.0-beta.7](https://github.com/SilentFlower/flower-trellis/compare/v0.5.0-beta.6...v0.5.0-beta.7) (2026-07-23)


### ✨ 新功能 Features

* **0.6:** 首次实现默认检查，连续调整可暂缓后续 Check-All ([d8a3dcd](https://github.com/SilentFlower/flower-trellis/commit/d8a3dcdd7c9783af7ac1223a0b7be0c513d8bd00))


### 🐛 修复 Bug Fixes

* **0.6:** 防止 Python 写入失败导致任务与 session 状态漂移 ([74d5d12](https://github.com/SilentFlower/flower-trellis/commit/74d5d12dd26e19133b591e24b1a762dac20ec17d))

## [0.5.0-beta.6](https://github.com/SilentFlower/flower-trellis/compare/v0.5.0-beta.5...v0.5.0-beta.6) (2026-07-22)


### 🐛 修复 Bug Fixes

* **update:** 防止升级后绕过 trellis-push ([8a34b91](https://github.com/SilentFlower/flower-trellis/commit/8a34b91aa381c73ee56b9ba5bed960778ba2bbd3))
* **workflow:** 强制任务 brief 确认门禁 ([7750c62](https://github.com/SilentFlower/flower-trellis/commit/7750c62417cabdf519e249deae147e1ec0ec14ac))

## [0.5.0-beta.5](https://github.com/SilentFlower/flower-trellis/compare/v0.5.0-beta.4...v0.5.0-beta.5) (2026-07-22)


### 🐛 修复 Bug Fixes

* **enhancements:** 修复复杂 BUG 意图路由 ([e7877a3](https://github.com/SilentFlower/flower-trellis/commit/e7877a383efc7b840faad6175d2f15a2b7882a81))

## [0.5.0-beta.4](https://github.com/SilentFlower/flower-trellis/compare/v0.5.0-beta.3...v0.5.0-beta.4) (2026-07-20)


### 🐛 修复 Bug Fixes

* **enhancements:** 补齐 session fallback 清理 ([b3884cb](https://github.com/SilentFlower/flower-trellis/commit/b3884cb9e3fac25ef504bbee722333f2d3d98c0e))

## [0.5.0-beta.3](https://github.com/SilentFlower/flower-trellis/compare/v0.5.0-beta.2...v0.5.0-beta.3) (2026-07-19)


### 🐛 修复 Bug Fixes

* **enhancements:** 同步 missing_task 意图恢复 ([e1fae6d](https://github.com/SilentFlower/flower-trellis/commit/e1fae6d1adab0440371062b7f35316602d147c5e))


### 🧰 维护 Maintenance

* **trellis:** 同步项目 Flower 版本状态到 0.5.0-beta.2 ([855fc39](https://github.com/SilentFlower/flower-trellis/commit/855fc392eaa82cc15146a897d010bdc3a8dfbb93))

## [0.5.0-beta.2](https://github.com/SilentFlower/flower-trellis/compare/v0.5.0-beta.1...v0.5.0-beta.2) (2026-07-19)


### ✨ 新功能 Features

* **0.6:** 统一 Patch Engine 与注入流程 ([db4f943](https://github.com/SilentFlower/flower-trellis/commit/db4f9430dfdafd807726df14c0f0b7b91dcf2b83))
  - 将 0.6 的 Workflow、Skill、Hook 与平台配置统一为 `insert / replace / remove` Patch schema v2。
  - 支持 Bundle 选择、全量 preflight、changed-only apply、首次备份、旧 marker 迁移和 manifest provenance。
  - Flower JS 与 Skill-Garden Python consumer 共享 Core Patch 声明和 fixture，并保持结构化结果 parity。
* **0.6:** 增加 Patch 冲突与兼容门禁 ([2472058](https://github.com/SilentFlower/flower-trellis/commit/2472058714f0986186a84de78b6fd7ad15a2f76b))
  - 对全部 0.6 Patch 目标执行上游 baseline、Patch 与最终产物三方冲突检查。
  - 运行时、`npm test`、`check-snapshot` 与维护者脚本复用同一套 compatibility/conflict evaluator。


### 🐛 修复 Bug Fixes

* **workflow:** 清理 route、Check-All、Update-Spec 与 Trellis Push 的互斥协议和重复流程。
* **config:** 结构化配置只修改受管字段，损坏 JSON/YAML/TOML 时失败且不覆盖用户配置。
* **install:** required Patch 或冲突检查失败时，Patch、资产、stale 清理和 manifest 保持零写入。
* **diagnostics:** 将未安装目标记为 info，并将 optional skip 与阻断错误分开报告。


### 🔒 兼容与安全

* Trellis `0.6.5` 已登记并通过完整验证。
* 未登记的同线 `0.6.x` 在完整 Patch 与冲突检查通过后 warning 放行。
* `0.7+`、`1.x` 或无效版本会阻断强化，并提示使用匹配版本或 `--no-enhance`。
* `0.5` / `old` 继续使用原有 legacy 注入路径。


### 🧰 维护 Maintenance

* **trellis:** 同步项目 Flower 版本状态 ([c4e83ab](https://github.com/SilentFlower/flower-trellis/commit/c4e83ab94df110118129d1bf6f8ad9717454dd65))

## [0.5.0-beta.1](https://github.com/SilentFlower/flower-trellis/compare/v0.5.0-beta.0...v0.5.0-beta.1) (2026-07-18)


### ✨ 新功能 Features

* **0.6:** 升级 Check-All 智能检查与自动续跑 ([92a3372](https://github.com/SilentFlower/flower-trellis/commit/92a3372fbda723f444ce6defbb10cd9c77938e8d))
* **0.6:** 自动衔接 Update-Spec 与 Trellis Push ([74340ca](https://github.com/SilentFlower/flower-trellis/commit/74340ca1a644acb44659970864e209d86363a7ce))


### 🐛 修复 Bug Fixes

* **update:** 修复升级缓存竞争与状态滞后 ([0dc3dd9](https://github.com/SilentFlower/flower-trellis/commit/0dc3dd9ff7dd821c6926ef63f45826dcbcd7d593))


### 🧰 维护 Maintenance

* **trellis:** 同步项目 Flower 版本状态 ([a48b356](https://github.com/SilentFlower/flower-trellis/commit/a48b356dfe4afd1ff3bb716c6e4affd51a68c699))

## [0.5.0-beta.0](https://github.com/SilentFlower/flower-trellis/compare/v0.4.12-beta.2...v0.5.0-beta.0) (2026-07-18)


### ✨ 新功能 Features

* **0.6:** 支持任务意图路由与声明式强化 ([64f06ac](https://github.com/SilentFlower/flower-trellis/commit/64f06ac01369aa5823c1f48213abcf8184c20295))
  - 自动识别 discuss、inspect、direct_edit、task_plan、workflow_action。
  - 支持“先讨论 / 不要任务 / 走任务 / 直接做”等当前请求内意图切换。
  - 高置信复杂请求可自动创建 planning task，但不越过 brief、start 和 route 门禁。
  - 新增 task_intent.py，记录 session 来源、Git dirty baseline 和自动创建元数据。
  - 支持安全 discard 自动 planning task，并清理 task、父引用和 session。
  - skill-garden 支持对 workflow、skill、command、hook 执行 insert / replace / remove。
  - 新增 required preflight、optional skip、首次备份和 managed marker 幂等升级。
  - JS 与 Python 双 consumer 使用同一份 transform 声明。
  - 新增 AI context budget，默认分级告警，支持 strict 发布审计。
  - 新增 Node/Python 零依赖测试体系。


### 🐛 修复 Bug Fixes

* **0.6:** 将当前任务产物纳入 Trellis Push ([462c6fd](https://github.com/SilentFlower/flower-trellis/commit/462c6fd54caa6fbc2ef4ad52e61806aad4909289))
* **hooks:** SessionStart 不再重新注入机械 task consent。
* **hooks:** Python hook 使用合法 hash marker，并支持旧 HTML marker 迁移。
* **install:** task-intent / intent-routing 精细安装会同步完整 intent unit。
* **install:** --scope all 在复制任何资产前完成 required preflight。
* **package:** npm 发布包不再包含 Python bytecode cache。
* **task:** create/discard 失败时补偿恢复 task、parent 和 session。
* **task:** 手工或历史 task 不会被 auto-discard 误删。
* **manifest:** 所有 required 强化步骤成功后才写成功 manifest。


### 🔒 兼容与安全

* 0.6 的 no_task 原正文改由 transform 接管，不再叠加重复 sentinel。
* 0.5、old 和官方 Trellis 源保持不变。
* required selector 漂移时零写入失败，不退化为猜测或追加。
* workflow、hub、state、Phase summary 和 SessionStart 均纳入上下文预算。

## [0.4.12-beta.2](https://github.com/SilentFlower/flower-trellis/compare/v0.4.12-beta.1...v0.4.12-beta.2) (2026-07-14)


### 🐛 修复 Bug Fixes

* **0.6:** 优化 Check-All 检查与修复体验 ([55b5f12](https://github.com/SilentFlower/flower-trellis/commit/55b5f12be925c078ac769981588712e12a558d68))
* **0.6:** 支持 Trellis Push 完成已有 Merge ([bd68a8b](https://github.com/SilentFlower/flower-trellis/commit/bd68a8bda90e866a0f8e7e2ffecccc5bb5ff091b))
* **0.6:** 简化 Trellis Push 依赖型多仓确认 ([0172139](https://github.com/SilentFlower/flower-trellis/commit/0172139696e4e25fc5d14a2c4a6229af8a759208))

## [0.4.12-beta.1](https://github.com/SilentFlower/flower-trellis/compare/v0.4.12-beta.0...v0.4.12-beta.1) (2026-07-14)


### 🐛 修复 Bug Fixes

* **skill:** 简化 Trellis 提交与收尾流程 ([90220a6](https://github.com/SilentFlower/flower-trellis/commit/90220a671eb92ec9c3681e6efe4946aead5d0c39))

## [0.4.12-beta.0](https://github.com/SilentFlower/flower-trellis/compare/v0.4.11...v0.4.12-beta.0) (2026-07-13)


### ✨ 新功能 Features

* **skill:** 优化 Trellis 提交与推送流程 ([4359607](https://github.com/SilentFlower/flower-trellis/commit/4359607156502e378ef83302105ca9f0e4f0f1ac))
* **skill:** 自动同步已启用的 common skill ([8b36bc7](https://github.com/SilentFlower/flower-trellis/commit/8b36bc7d24e76dd8973c35378e7bb6d9c8a60ff3))

## [0.4.11](https://github.com/SilentFlower/flower-trellis/compare/v0.4.10...v0.4.11) (2026-07-09)


### ✨ 新功能 Features

* **update-check:** 迁移运行缓存到 tmp ([986659a](https://github.com/SilentFlower/flower-trellis/commit/986659a7d3678384be055dcae0067c2c31c836fb))

## [0.4.10](https://github.com/SilentFlower/flower-trellis/compare/v0.4.9...v0.4.10) (2026-07-08)


### 🐛 修复 Bug Fixes

* **flower:** 项目侧待更新提示会显示对应版本更新摘要 ([cc98c02](https://github.com/SilentFlower/flower-trellis/commit/cc98c021eb0536f693f50651854093a4795d9e93))

## [0.4.9](https://github.com/SilentFlower/flower-trellis/compare/v0.4.8...v0.4.9) (2026-07-08)


### 🐛 修复 Bug Fixes

* **flower:** 强化项目知识发现门禁 ([d21b17e](https://github.com/SilentFlower/flower-trellis/commit/d21b17e860d3b91bb5c69c3921620d60b49608d5))
* **flower:** 恢复 in_progress 完成门禁 ([304f5fa](https://github.com/SilentFlower/flower-trellis/commit/304f5fadfab139638cfa9658f168448a1f26f9e6))

## [0.4.8](https://github.com/SilentFlower/flower-trellis/compare/v0.4.7...v0.4.8) (2026-07-08)


### ✨ 新功能 Features

* **flower:** 支持从 skill-garden 分发 hook override,并在 Codex 已有 `SessionStart` 时去掉重复的 `trellis-start` 提示。


### 🐛 修复 Bug Fixes

* **flower:** 修复项目版本追平提示不展示 release notes 的问题。

## [0.4.7](https://github.com/SilentFlower/flower-trellis/compare/v0.4.6...v0.4.7) (2026-07-07)


### 🐛 修复 Bug Fixes

* **flower:** 同步 brainstorm planning gate ([3d2944e](https://github.com/SilentFlower/flower-trellis/commit/3d2944ebec9ae040a064d9974b170f046f4bf845))
* **flower:** 同步 workflow 提示压缩 ([b7083ce](https://github.com/SilentFlower/flower-trellis/commit/b7083ce553ed4fda8190e30d7882358f70cb0449))

## [0.4.6](https://github.com/SilentFlower/flower-trellis/compare/v0.4.5...v0.4.6) (2026-07-07)


### ✨ 新功能 Features

* **update:** 注入跨版本更新摘要并联动 push 确认 ([bbdb23c](https://github.com/SilentFlower/flower-trellis/commit/bbdb23c33eac9948235c65f6be6f18764f90a88d))

## [0.4.5](https://github.com/SilentFlower/flower-trellis/compare/v0.4.4...v0.4.5) (2026-07-07)


### 🐛 修复 Bug Fixes

* **update:** 修复自动更新检查链路,确保远端版本缓存可靠刷新,并强化 Codex 更新确认提示 ([d208917](https://github.com/SilentFlower/flower-trellis/commit/d20891791a93490f47022aa59485c401ac599322), [95eb10e](https://github.com/SilentFlower/flower-trellis/commit/95eb10e0c8e624662160897cd4bebe55e65b04bb), [f05f7bf](https://github.com/SilentFlower/flower-trellis/commit/f05f7bf0b75d07bd8ad4959b23720a425baa559b))

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
