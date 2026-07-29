# 外部 Plugin 格式与 GitHub 公共来源研究

## 研究时间

- 2026-07-28

## 官方资料

- OpenAI Codex Plugin 打包与 Marketplace：<https://developers.openai.com/plugins/build/plugins>
- Claude Code Plugin 技术参考：<https://code.claude.com/docs/en/plugins-reference>
- Claude Code Marketplace：<https://code.claude.com/docs/en/plugin-marketplaces>
- GitHub REST API 限流：<https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api>
- GitHub 仓库内容与归档：<https://docs.github.com/en/rest/repos/contents>

## Codex

- Plugin 必须包含 `.codex-plugin/plugin.json`。
- 根目录可包含 `skills/`、`hooks/`、`.mcp.json`、`.app.json` 和展示 assets。
- repo Marketplace 位于 `.agents/plugins/marketplace.json`；Codex 也读取 legacy `.claude-plugin/marketplace.json` 入口。
- Marketplace source 支持 GitHub shorthand、Git URL、git subdir、本地路径和 npm；Git-backed entry 可使用 ref 或 sha。
- Codex 对 `.claude-plugin/marketplace.json` 的读取是目录入口兼容，不代表 Claude Code 的 agents、LSP、monitor、bin、themes 等组件可直接运行。

## Claude Code

- Plugin manifest 位于 `.claude-plugin/plugin.json`，manifest 本身可选，但 Marketplace 分发通常提供明确身份和版本。
- 根目录组件包括 `skills/`、legacy `commands/`、`agents/`、`hooks/hooks.json`、`.mcp.json`、`.lsp.json`、`monitors/monitors.json`、`bin/`、`settings.json`、themes 和 output styles。
- Marketplace 位于 `.claude-plugin/marketplace.json`。
- Marketplace plugin source 支持相对路径、`github`、`url`、`git-subdir` 和 npm；Git 来源可固定 ref 或 sha。
- Claude Code 会把安装包复制到版本化 cache，并禁止已安装 Plugin 越过自身目录引用外部文件。
- 官方安全说明明确指出 Plugin、hooks 和可执行内容属于高信任组件，可用用户权限执行代码。

## GitHub 公共仓库

- 公共资源可匿名调用 REST API和下载仓库归档。
- 未认证请求按来源 IP 计数，主要限额为每小时 60 次；首版需要把限流转成明确诊断，不应伪装成认证失败。
- archive 下载返回重定向，客户端必须受控跟随 GitHub/codeload 目标，并继续执行归档大小、条目、软链和路径边界校验。
- 安装不能只锁定 branch/tag；必须解析为完整 commit，并用解包后 canonical tree digest 锁定实际内容。

## 对 Flower 的约束结论

- 来源位置和包格式必须解耦：GitHub/GitLab 负责固定仓库字节，格式 Adapter 负责识别和归一化。
- 外部格式不能直接进入 Flower Runtime；应物化为只包含安全被动内容的标准 Flower package，再复用现有 validator、Resolver、InstallPlan 和 Transaction Writer。
- 首版自动映射 skills 和 Claude legacy commands；hooks、MCP、LSP、monitor、bin、settings、themes、output styles 和 app 只进入兼容性报告。
- `plugin init` 保持 Flower 原生输出，避免同时承担 Claude/Codex 多格式发布器职责。
