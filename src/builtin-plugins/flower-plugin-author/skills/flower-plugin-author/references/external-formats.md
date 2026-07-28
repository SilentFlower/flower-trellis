# External Formats

Flower Runtime 只消费通过 `plugin.json` 校验的标准包。Claude Code、Codex 与 Skill-only 仓库先经过格式检测和规范化，不能让 Resolver、capability 或事务层直接解释外部 manifest。

| 外部格式 | 检测入口 | 首版导入 | 只报告、不执行 |
|---|---|---|---|
| Codex | `.codex-plugin/plugin.json`、`.agents/plugins/marketplace.json` | `skills/` | hooks、MCP、apps 与其它平台组件 |
| Claude Code | `.claude-plugin/plugin.json`、`.claude-plugin/marketplace.json` | `skills/`、`commands/*.md` 转 Skill | agents、hooks、MCP、LSP、monitors、bin、settings、themes、output styles |
| Skill-only | `SKILL.md` 或 `skills/*/SKILL.md` | Skill 目录内普通文件 | 仓库其它未声明内容 |

多个格式入口必须由用户显式选择，不能按扫描顺序猜测。没有可安全导入 Skill 的包应返回不支持，不得只因存在 manifest 就标记为可安装。

外部包的合法严格 SemVer 可保留；缺失或非法版本使用 commit 时间与 SHA 生成内部版本。上游复用同一个显式 SemVer 却改变 commit 或内容摘要时必须阻止更新，要求上游提升版本。

Claude/Codex Marketplace 支持同仓相对路径、公开 GitHub `owner/repository`、GitHub HTTPS URL 和 GitHub `git-subdir`。跨仓条目必须解析并锁定目标仓库 commit，同时保留 Marketplace 的索引仓库与索引 commit；npm、SSH、私有仓库、通用 Git host 与远程 JSON URL 只产生不支持诊断，不得静默当成本地路径。

没有 Marketplace 的仓库可把多个独立 Plugin 放在 `plugins/<plugin>/`。仓库根存在多个可识别入口时，Flower 必须展示候选让用户选择，不能按扫描顺序猜测；外部 manifest 自定义的 `skills` 路径也必须保持在当前 Plugin 根内。
