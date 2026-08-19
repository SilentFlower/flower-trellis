# 修复 rd-guide 内置来源 ref 失效

## Goal

rd-guide 内置来源的 `ref` 自 2026-08-06 起指向 `feat/flower-plugin-distribution`，该分支已随 rd-guide MR !97 合并被自动删除，导致该来源对所有客户端不可解析。改回 `main`（2026-07-28 引入时的原始值），同步受影响测试断言与 fixture，并提交推送到 `beta`。beta 发版与升级回读作为本任务完成后的独立发布流程继续执行。

## Background

`src/builtin-marketplaces/rd-guide.json` 只被改过两次：

| 时间 | commit | `ref` |
| --- | --- | --- |
| 2026-07-28 | `3688744 feat(plugin): add GitLab marketplace` | `main`（原始值） |
| 2026-08-06 | `4ba3cf6 fix(plugin): 修复 GitLab 私有来源安装` | `feat/flower-plugin-distribution` |

8-06 那次同时把 `baseUrl` 从 `http:` 改为 `https:`；指向 feat 分支是因为当时 `main` 上还没有 `.flower-marketplace/marketplace.json`（该文件当天才在 feat 分支上建立）。因此这是**临时调试指向，不是设计决定**，本任务是恢复原始值。

**没有任何本地手段可以绕过发版**，三条路径均有代码级封堵：

| 尝试 | 结果 | 位置 |
| --- | --- | --- |
| 用户配置覆盖 `ref` | 读取阶段裁剪为 `{id, enabled}` | `src/plugin/sources/user-source-store.js:383-385` |
| `plugin source add` 同名 `rd-guide` | 抛错「内置 Plugin source 仅支持启用或停用」 | `src/plugin/sources/user-source-store.js:304-309` |
| 换 id 自建 source | 抛错「Marketplace ID 与 source 不一致」 | `src/plugin/sources/gitlab-provider.js:69-73` |

`package.json` 的 `files` 包含 `src`，该 JSON 随包分发，只能随包更新。GitLab provider 也没有 `defaultBranch` 兜底（`gitlab-provider.js:56` 直接读 `source.ref`，与 `github-provider.js:48` 的 `ref || defaultBranch` 不同），且 `ref` 为必填非空（`user-source-store.js:91`）。

## Requirements

- R1 `src/builtin-marketplaces/rd-guide.json` 的 `ref` 改为 `main`，其余字段不动。
- R2 同步 `test/js/plugin-source-store.test.js` 中依赖该值的断言（2 处）。
- R3 **测试 fixture 必须一并修改**：该文件「不让旧用户记录覆盖内置连接定义」用例的 fixture `ref` 原为 `main`，是当时相对 builtin 的 legacy 对照值。builtin 改成 `main` 后二者重合，该条断言退化为恒真。fixture 改为 `legacy-branch`，与同一 fixture 其余字段（`旧研发指南`、`http://`、`legacy/rd-guide`、`legacy-marketplace.json`）的 legacy 命名保持一致。
- R4 提交到 `beta` 分支并推送到 `origin`（GitHub，当前 upstream）。

## Acceptance Criteria

- [x] AC1 `ref` 为 `main`，与 `3688744` 引入时的值一致；`git diff 3688744 -- src/builtin-marketplaces/rd-guide.json` 仅剩 `baseUrl` 一处差异（`http:` → `https:`，属 8-06 的正确修复，不回退）。
- [x] AC2 `node --test test/js/plugin-source-store.test.js` 全部通过。
- [x] AC3 反套套自查：把 `user-source-store.js` 的两道防线（`#readUserSources()` 对 builtin id 的裁剪、`list()` 的 `{...builtin, enabled}` 合并）同时移除后，「不让旧用户记录覆盖内置连接定义」用例必须变红；还原后恢复绿。
- [x] AC4 `npm test` 全量通过。
- [x] AC5 业务改动与当前任务记录按精确文件范围提交，`beta` 成功推送到 `origin/beta`。

## Post-Task Release Handoff

以下步骤紧随本任务完成后执行，但不参与当前 task 的 `completed` 判定：

- 按 [`release-and-publishing.md`](../../spec/flower-trellis/cli/release-and-publishing.md) 执行 beta 发版：`npm run sync`，必要时独立提交 `enhancements/` 快照并通过 `node scripts/check-snapshot.mjs`，再运行 `npm run release:dry -- --prerelease beta`。
- 把 dry-run 的版本号与完整 CHANGELOG 段落展示给 owner；普通说明性条目必须为中文，等待 owner 对真实 release 的明确确认。
- owner 确认后再次执行 `npm run sync`，处理快照变化并重新通过 `node scripts/check-snapshot.mjs`，再使用相同参数运行真实 release，最后执行 `git push --follow-tags origin beta`。
- 以 npm registry 回读 beta dist-tag，核对 GitHub prerelease 与 CHANGELOG 同源，并在干净环境验证 `rd-guide.ref` 为 `main`。
- rd-guide MR-2 合入 `main` 后，完成 `xhgj-gitlab-collaboration` 的端到端安装与逐字节比对。

## Follow-Up Dependencies / Ordering

- 后续端到端安装回读依赖 **rd-guide MR-2 合入 `main`**（把 `xhgj-gitlab-collaboration@0.5.0` 固定进 `.flower-marketplace/marketplace.json`）。在此之前 `main` 上是空索引，客户端能连上但列表为空。
- 推荐顺序：rd-guide MR-2 合入 → beta 发版 → registry 与安装回读。若先发版，客户端行为从「ref 不存在直接报错」变为「连得上、暂时无内容」，严格优于现状，不构成回退。
- **发版是对外不可逆动作，执行前须由 owner 单独确认**，不因本 PRD 已列出而视为已授权。

## Out of Scope

- 分发通道属地问题（通道挂在 `xhgj003027` 个人仓与公网 npm 包）—— 由 rd-guide MR !97 的 B4 提出，已挂 rd-guide #1 待裁决，不在本任务处理。
- rd-guide 侧的索引内容、门禁与发布手册改动，属 rd-guide 仓 MR-2 范围。

## Notes

- R1–R3 的改动在本 task 创建前已完成于工作区（源于 rd-guide 任务的 Check-All 发现 CHK-001）。创建 task 是把它从「另一个仓的顺带改动」正规化为可追踪的独立工作，不是重新实现。
- `src/builtin-marketplaces/` 下只有这一个文件，rd-guide 是当前唯一内置来源。
