# GitLab Immutable Release

1. 在 Plugin 仓库完成测试和 `plugin validate`。
2. 提交全部发布字节，记录 40 位 commit。
3. 创建与 manifest 版本一致的 tag，例如 `v1.0.0`，并保护 tag。
4. 用该 commit 的 checkout 计算 canonical digest。
5. 在 rd-guide entry 同时写 tag、commit 和 digest。

不要使用 `main`、`master`、`HEAD`、普通分支或浮动 tag。CI 只使用只读受控凭据拉取固定 commit，不读取开发者 keyring，也不把 token 写入 URL、日志或 JSON issue。
