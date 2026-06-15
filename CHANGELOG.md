# Changelog

本项目所有重要变更都会记录在此文件。

版本号遵循 [SemVer](https://semver.org/lang/zh-CN/);提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 规范。

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
