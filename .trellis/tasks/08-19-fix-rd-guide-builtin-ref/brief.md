# Brief — 修复 rd-guide 内置来源 ref 失效

## Goal

- rd-guide 内置来源的 `ref` 指向一个已被删除的分支，导致该来源对所有客户端不可解析。改回 `main`，同步防回归测试，并把修复提交推送到 `beta`。

## Scope

- `src/builtin-marketplaces/rd-guide.json` 的 `ref`：`feat/flower-plugin-distribution` → `main`，其余字段不动。
- `test/js/plugin-source-store.test.js`：同步 2 处依赖该值的断言，并把「不让旧用户记录覆盖内置连接定义」用例的 fixture `ref` 由 `main` 改为 `legacy-branch`。
- 提交到 `beta` 并推送到 `origin`（GitHub）。

## Non-Goals

- 不处理分发通道属地问题（通道挂在个人仓与公网 npm），该条由 rd-guide MR !97 的 B4 提出并已挂 rd-guide #1 待裁决。
- 不改 rd-guide 仓的索引内容、门禁或发布手册，那属 rd-guide MR-2。
- 不改 GitLab provider 的 ref 解析逻辑，也不为 GitLab 增加 `defaultBranch` 兜底。
- 不动 8-06 那次一并修的 `baseUrl`（`http:` → `https:`），那是正确修复。
- 真实 beta 发布、registry/GitHub 回读和干净环境安装验证不计入当前 task 的完成态；它们在本 task 推送后作为独立发布流程继续执行。

## Key Decisions

- **`main` 是恢复而非新决定。** 该文件只被改过两次：2026-07-28 `3688744` 引入时就是 `main`；2026-08-06 `4ba3cf6` 为调试 GitLab 私有来源安装临时指向 feat 分支，因为当时 `main` 上还没有 `.flower-marketplace/marketplace.json`。
- **必须发版，无本地绕过。** 用户配置覆盖 `ref` 会在读取阶段被裁成 `{id, enabled}`（`user-source-store.js:383-385`）；`plugin source add` 同名会抛「内置 Plugin source 仅支持启用或停用」（`:304-309`）；换 id 自建会抛「Marketplace ID 与 source 不一致」（`gitlab-provider.js:69-73`）。`package.json` 的 `files` 含 `src`，该 JSON 随包分发。
- **测试 fixture 必须与断言一起改。** 该 fixture 每个字段都是相对 builtin 的 legacy 对照值（`旧研发指南`/`http://`/`legacy/rd-guide`/`legacy-marketplace.json`），`ref: "main"` 当时也是对照值。builtin 改成 `main` 后二者重合，该条断言会退化为恒真，因此改为 `legacy-branch` 并通过反套套自查验证。

## Key Context

- 运行链路是 builtin descriptor → `UserSourceStore` 以随包连接字段为权威合并用户 `enabled` 偏好 → `GitLabSourceProvider` 按 `source.ref` 解析固定 commit → 读取并校验 Marketplace。此次不修改 store/provider 算法。
- 当前任务在 `beta` 分支执行，upstream 为 GitHub 的 `origin/beta`；业务提交和 release tag 都推送到 `origin`。
- 发版是**本地把关 + CI 发布**：本地 `npm run release` 只 bump + CHANGELOG + commit + tag，**不 push 不 publish**；push tag 触发 `release.yml` 用 OIDC Trusted Publishing 发布。本地直接 `npm publish` 是明确的 Wrong 模式。
- `src/builtin-marketplaces/` 下只有这一个文件，rd-guide 是当前唯一内置来源。
- R1–R3 的改动在本 task 创建前已完成于工作区（源于 rd-guide 任务 Check-All 的 CHK-001），建 task 是把它正规化为可追踪工作，不是重新实现。

## Risks / Deferred

- **后续发版门禁不能跳。** `vendor/skill-garden` 工作区须干净且 pin 与 `enhancements/MANIFEST.sourceCommit` 一致；dry-run 前和 owner 确认后都要执行 sync 与快照门禁。
- **dry-run 确认是硬门禁。** 必须把版本号与 CHANGELOG 段落展示给 owner；明确确认后先再次执行 `npm run sync`，再使用相同版本策略参数执行真实 release。
- **发版是对外不可逆动作**，执行前须 owner 单独确认；当前 task 的完成或推送不构成该授权。
- 后续端到端回读依赖 rd-guide MR-2 合入 `main`；在此之前 `main` 上是空索引，客户端能连上但列表为空。
- 顺序：rd-guide MR-2 合入 → 发版 → 回读。若先发版，客户端行为从「ref 不存在直接报错」变为「连得上、暂时无内容」，严格优于现状，不构成回退。

## Acceptance

- `ref` 为 `main`，与 `3688744` 引入时一致；对该 commit 的 diff 仅剩 `baseUrl` 一处。
- `node --test test/js/plugin-source-store.test.js` 与 `npm test` 全量通过。
- 反套套自查：同时移除 `#readUserSources()` 的 builtin id 裁剪与 `list()` 的合并防线后，目标用例必须变红，还原后恢复绿。
- 业务改动与当前任务记录按精确文件范围提交，`beta` 成功推送到 `origin/beta`。

## Next Step

- Check-All 已通过，Update-Spec 判定为 no-op；下一步通过 `trellis-push` 提交并推送业务改动。当前 task 完成后立即进入独立 beta 发布流程。
