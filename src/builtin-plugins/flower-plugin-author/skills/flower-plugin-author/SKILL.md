---
name: flower-plugin-author
description: 创建、更新、校验和发布 Flower Plugin 或 Marketplace 条目，并为 rd-guide GitLab MR 准备不可变版本、CI 与审核材料。用于用户要求新建或修复 Plugin、编写 Skill、申请受限 Patch、生成 Marketplace entry、排查 validate 错误或设计注册流程时。
---

# Flower Plugin Author

## 工作流

1. 先识别目标是 Plugin、Marketplace entry 还是完整 Marketplace；不要直接手写第二套 schema。
2. 新建 Plugin 时先运行 `flower-trellis plugin init`，再修改生成的 Skill 和被动内容。
3. 每次修改后运行 `flower-trellis plugin validate <path> --subject <plugin|entry|marketplace> --json`。
4. 根据真实 issue code、path 和 source 修复；不要在 Skill 中模拟 Runtime、Resolver、hash 或 capability 判断。
5. 发布前固定 tag、40 位 commit 和 canonical digest，再准备 rd-guide MR。
6. CI 使用 `--ci --non-interactive`，不得读取开发者本机 keyring 或隐式联网授权。

## 决策顺序

- 默认使用 `standard`；只有确实需要修改宿主 Markdown 时才选择 `integration`。
- 外部 Plugin 永远不能申请 `system`，不能分发生命周期 hook 或可执行 adapter。
- `scripts/` 只是被动内容；Flower Plugin v1 不执行 install/update/uninstall hook。
- integration 只允许 Runtime 支持的声明式 insert，最终权限仍由 Marketplace 上限、Runtime hard limit 和项目批准共同决定。
- 先发布不可变 Plugin，再注册 Marketplace；不要把分支名或本地工作区摘要写入 entry。

## References 路由

- Plugin manifest、目录与依赖：读 [references/manifest.md](references/manifest.md)。
- profile 和 capability：读 [references/capabilities.md](references/capabilities.md)。
- integration Patch：读 [references/patches.md](references/patches.md)。
- Marketplace entry：读 [references/marketplace.md](references/marketplace.md)。
- GitLab tag/commit 发布：读 [references/gitlab-release.md](references/gitlab-release.md)。
- rd-guide CI、MR 与 CODEOWNERS：读 [references/ci-and-review.md](references/ci-and-review.md)。

## 完成门禁

- scaffold 与 validate 均成功，JSON `ok=true`。
- 输出不含 token、绝对路径、用户名或本机凭据。
- integration 输出 `review.required=true` 时，更新绑定 Marketplace digest 的受保护 review 文件，使 MR 进入 integration owner 审核。
- 不创建 README、quick reference、changelog 或自动执行 hook。
