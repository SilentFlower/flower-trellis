# npm release notes metadata research

## 结论

本任务 MVP 应使用 npm registry 中的 package metadata 承载 flower 内部 release notes 字段,不依赖 GitHub Release API 作为主路径。

## 已验证事实

- `https://registry.npmjs.org/flower-trellis` 的根文档一次响应包含:
  - `dist-tags`
  - `versions`
  - 每个版本的 package metadata
- 当前 `flower-trellis@0.4.5` 的版本 metadata 没有标准 `changelog` / `releaseNotes` 字段。
- npm 没有稳定的逐版本更新日志标准字段;自定义 package.json 字段会随版本 metadata 发布。
- 当前 npm tarball 未包含 `CHANGELOG.md`,因为 `package.json.files` 白名单没有 `CHANGELOG.md`。
- GitHub Release `v0.4.5` 的 body 可读,且发布 workflow 使用 `scripts/extract-changelog.mjs` 从 `CHANGELOG.md` 抽取对应版本段生成 Release notes。
- 用户选择优先 npm metadata,因为 GitHub 网络可用性不如 npm registry 稳定。

## 发布工具证据

`commit-and-tag-version@12.7.3` 支持 lifecycle scripts:

- `postchangelog`: CHANGELOG 生成后执行。
- `precommit`: commit 前执行。

本项目 release commit 会包含 `package.json` / `package-lock.json` / `CHANGELOG.md`。因此可以在 `postchangelog` 中把当前版本的 CHANGELOG 段写入 `package.json.flowerReleaseNotes`,并随 release commit 一起提交。

## 设计约束

- 每个版本 metadata 只保存该版本自己的 notes,不保存 recent notes map。
- 跨版本聚合在客户端完成:一次 npm registry 根文档响应已经包含各版本 metadata。
- 字段先作为 flower 内部字段,不在 README 中承诺第三方稳定 API。
- 注入到 hook 的摘要必须继续有硬上限:最多 5 个版本、总摘要最多 1600 字符、单版本最多 500 字符。
