# Changelog

本项目所有重要变更都会记录在此文件。

版本号遵循 [SemVer](https://semver.org/lang/zh-CN/);提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 规范。

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
