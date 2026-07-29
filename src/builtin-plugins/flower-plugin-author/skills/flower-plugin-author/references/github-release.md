# GitHub Public Release

GitHub 首版只支持 `github.com` 公共仓库和匿名 REST，不读取 PAT、GitLab OAuth、SSH key 或宿主插件缓存。来源可写 `owner/repository` 或无凭据的 HTTPS URL；保存时统一规范化为 `owner/repository`。

推荐流程：

1. 把 Flower、Claude Code、Codex Plugin 或 Skill 集合提交到公共仓库。
2. 确认目标 ref 能解析到完整 40 位 commit，且 archive 内无软链、特殊文件和路径穿越。
3. 在 Flower Plugin 管理器选择“新增来源 -> GitHub 公共仓库”。
4. 输入仓库、可选 ref 和可选子目录；ref 留空时使用仓库默认分支，然后查看格式与兼容性预览。
5. 确认后保存固定 `format` 和 `entryPath`，再从“发现”页安装。

单仓分发多个 Plugin 时优先提供 Flower、Claude Code 或 Codex Marketplace；轻量仓库也可使用 `plugins/<plugin>/` 目录。Marketplace 可以引用公开 GitHub 跨仓 Plugin，但每个目标仓库都应使用可重复解析的 ref，并由 Flower 在安装时固定完整 commit。检测到多个格式入口时，由用户在预览中明确选择。

匿名 GitHub REST 主要限额是每个来源 IP 每小时 60 次。发布者应减少不必要的 Marketplace 跳转和跨仓条目；遇到限流时 Flower 返回明确诊断，不会要求 GitLab 登录。

安装 lock 同时固定实际 Plugin commit 与 canonical digest。通过 Marketplace 发现时还会固定索引仓库和索引 commit。分支和 tag 只用于发现更新，不能替代 lock 中的 commit。

不要在仓库 URL 中嵌入用户名、token 或查询参数。外部 hooks、安装脚本和可执行组件不会因为来自公开仓库而获得执行权限。
