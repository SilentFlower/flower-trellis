# Technical Design

## Overview

本任务不修改 Plugin Source 的运行时算法，只修正随 npm 包分发的内置 `rd-guide` descriptor，并同步能证明该 descriptor 生效且不会被旧用户配置覆盖的测试。代码修复完成后提交并推送到 `beta`；beta 发版与干净环境回读作为独立发布流程紧随其后执行。

## Current Data Flow

```text
src/builtin-marketplaces/rd-guide.json
  -> UserSourceStore 读取并校验 builtin descriptor
  -> list() 以 builtin 连接字段为权威，只合并用户 enabled 偏好
  -> GitLabSourceProvider.prepareIndex()
  -> client.resolveCommit(project, source.ref)
  -> 读取 source.marketplacePath 并校验 marketplace.id === source.id
  -> 解析并安装固定版本 Plugin / Skill
```

`package.json.files` 包含 `src`，因此 descriptor 随 npm 包发布。用户侧旧 descriptor 在 `#readUserSources()` 中会压缩为 `{id, enabled}`，`list()` 再以 `{...builtin, enabled}` 合并；同名自定义来源会被 `set()` 拒绝。修复必须通过新版本包交付，不能靠本地用户配置绕过。

## Change Boundary

- `src/builtin-marketplaces/rd-guide.json`：仅把 `ref` 从已删除的 `feat/flower-plugin-distribution` 恢复为 `main`；保留 `https://gitlab.xhgjdev.com` 和其它字段。
- `test/js/plugin-source-store.test.js`：同步默认 descriptor 与旧用户配置合并后的 `ref` 断言。
- 同一旧用户配置 fixture 的 `ref` 改为 `legacy-branch`，确保测试能区分用户旧值与 builtin 新值，避免断言退化为恒真。
- 不修改 `UserSourceStore`、`GitLabSourceProvider`、source schema、默认分支解析或 rd-guide 仓的 Marketplace 内容。

## Verification Design

### Descriptor Regression

- 使用 `git diff 3688744 -- src/builtin-marketplaces/rd-guide.json` 验证当前 descriptor 相对首次引入版本只保留正确的 `baseUrl` HTTPS 差异。
- 运行 `node --test test/js/plugin-source-store.test.js`，覆盖默认 builtin、旧用户记录压缩、启停偏好和同名写入拒绝。

### Anti-Tautology Check

目标测试必须能证明两道 builtin 防线真实生效。通过可恢复的临时补丁同时移除：

- `#readUserSources()` 对 builtin ID 的 `{id, enabled}` 裁剪。
- `list()` 的 `{...builtin, enabled}` 合并。

此时「不让旧用户记录覆盖内置连接定义」用例必须失败；恢复补丁后必须重新通过，并确认 `user-source-store.js` 没有残留 diff。`legacy-branch` fixture 是该检查有效的必要条件。

### Full Regression

- 运行 `npm test` 覆盖 Node/Python 测试、Patch 冲突、compiled targets、上下文预算和输出模板。
- 运行 `git diff --check`，确认任务 diff 不含格式问题。

## Delivery Flow

```text
验证现有 R1-R3 diff
  -> Check-All
  -> Update-Spec 判定
  -> 精确提交并推送 beta
  -> 当前 task 完成
```

## Post-Task Release Handoff

```text
  -> npm run sync
  -> 如有快照变化，独立 chore(snapshot) 提交并推送
  -> node scripts/check-snapshot.mjs
  -> npm run release:dry -- --prerelease beta
  -> 展示版本号与 CHANGELOG，等待 owner 明确确认
  -> owner 确认后再次 npm run sync
  -> 如有快照变化，按同一审核规则提交
  -> 再次 node scripts/check-snapshot.mjs
  -> npm run release -- --prerelease beta
  -> 检查 release diff / commit / tag
  -> git push --follow-tags origin beta
  -> CI 通过 OIDC 发布 npm beta 并创建 GitHub prerelease
  -> registry 与干净环境回读
```

发布流程不参与当前 task 的 `completed` 判定，但必须在当前 task 推送成功后继续执行。真实 release 是独立的不可逆门禁；任务启动、代码提交或 PRD 审批都不授权执行真实 release，只有 dry-run 结果展示后的明确确认才授权继续。确认后仍须重新执行 `npm run sync`，处理确认等待期间可能产生的快照变化并重新通过 `check-snapshot`，最后才能使用相同版本策略参数执行真实 release。

## Compatibility And Migration

- 不变更 source 配置 schema，也不迁移用户文件。
- 升级新 npm 版本后，旧用户保存的完整 `rd-guide` descriptor 仍只继承 `enabled`，连接字段自动使用新包中的 `main`。
- 未安装新版本的客户端继续保留旧 descriptor，不尝试通过修改用户配置改变其行为。

## External Dependency

后续 Skill 安装回读依赖 rd-guide MR-2 已把 `xhgj-gitlab-collaboration@0.5.0` 固定进 `main` 的 Marketplace。该依赖不阻塞本任务完成；若先发布，新客户端会从「ref 不存在」改善为「可连接但索引暂时为空」，最终安装回读仍须等待 MR-2 合入后完成。

## Risks And Rollback

- `main` 尚无目标 Marketplace 条目时，来源可解析但搜索或安装目标 Skill 仍不可用；后续发布流程必须保留 MR-2 依赖说明，避免误报端到端回读完成。
- 快照与 submodule pin 不一致会阻断 release；dry-run 前和 owner 确认后都必须运行 `npm run sync`，并把快照变化独立处理。
- dry-run 与真实 release 参数不一致会导致版本和 CHANGELOG 漂移；两步固定使用 `--prerelease beta`。
- 发布前可直接回退任务的两个文件；发布后不重写已发布 tag 或 npm 版本，如需回滚必须发布新的修正 beta 版本。
