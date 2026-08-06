# 故障处理与停止条件

失败时保留原始对象 ID 和本地现场，但不要复制可能含 token、cookie 或 credential helper 输出的认证日志。

| 故障 | 确定性处理 | 可重试入口 |
| --- | --- | --- |
| 身份、host 或凭据来源不清 | 停止认证与写入；只输出非敏感身份事实。疑似泄露时提示本人撤销，不接收原文 | 本人确认账号、host 和获准认证方式后重跑 live preflight |
| 角色不足或受保护分支拒绝 | 回读角色、Group 继承和保护规则；不改权限、不扩大 scope、不直推正式分支 | 项目 Maintainer 或 Group Owner 确认授权与保护契约 |
| 目录与分支不匹配或来源不明 WIP | 列出目录、分支、ahead/behind 和工作区状态；不切分支、不清理 | 本人确认归属后创建独立工作面或安排交接 |
| 错分支已经 commit | 先确认是否 push、是否已有 MR、工作区是否干净和目标分支；不直接套用 reset/stash 历史方案 | 本人选择保留 commit、建立新分支或其它可审计救援路径 |
| Project、Issue、MR 或台账归属不唯一 | 不猜目标、不跨台账重复写入 | 展示最小候选 locator，请本人确认唯一目标 |
| required source 不可达或上下文过期 | 停止依赖该来源的写入；重新读取最新 description/notes/discussion | 来源恢复后从冻结点重读；仍不可达则输出 checkpoint/草案 |
| Windows preflight 输出解码失败 | 脚本按 UTF-8 解码 `glab` 原始字节；非 UTF-8 输出统一停止为 `preflight-output-not-utf8`，不转发原始 stdout/stderr | 核对 `glab` 版本与输出来源后重跑，不以修改系统 locale 作为长期修复 |
| `glab api --input` 返回 HTTP 415 | 确认载荷是 UTF-8 JSON，并显式增加 `Content-Type: application/json`；服务端未创建对象时不报告成功 | 修正冻结配方后重新读取目标对象，确认无重复对象再写入 |
| 中文载荷或写后回读不一致 | 保留冻结载荷 hash 和真实对象 ID；不报告成功、不自动重发 | 比较预期与回读全文，由本人决定修正或终止 |
| 操作证据出现 `cross-project-bare-ref` / `render-readback-missing` / `cross-project-render-link-wrong` | 停止写入或成功声明；回到完整正文与 GitLab Markdown 渲染结果，逐条确认本地引用 allowlist 和实际目标 Project | 改为完整路径/URL，补齐渲染回读后重新冻结证据并运行 `--evidence` |
| 操作证据出现 `merge-gate-incomplete` | 不把单次 Pipeline success 声称为平台门禁；不修改项目设置 | 回读项目设置；由对应规则的 `authority` 主体决定启用平台门禁，或登记非空替代验收证据 |
| 操作证据出现 `merge-result-unverified` / `merge-result-mismatch` | 不根据 merged 状态或页面勾选推断 squash 结果，不改写已合入历史 | 回读项目 `squash_option`、MR `squash` 与 `squash_commit_sha`，记录实际差异 |
| 写入响应成功但对象无法回读 | 结果记为 unknown；不以 `success=true` 代替全文 round-trip | 按真实对象 ID 重试只读查询，状态查清前不再次写入 |
| GitLab 执行能力未 active | 可以做离线自检、只读 preflight、建议和 checkpoint，明确标注“未写入” | 等待受控真实使用和 Maintainer review 完成 |
| 工时录入请求未取得本人确认 | 只输出建议时长、归属日期和 `summary` 草案，明确标注“未写入” | 取得本人对三项的明确确认后再经 `timelogCreate` 写入 |
| 工时写入后三面回读不一致 | 结果记为 unknown；不自动重发 mutation，也不补发 quick action | 按真实 Timelog GID 重做只读回读，状态查清前不再写入；确认误录后用 `timelogDelete` 单删重录 |
| 工时说明正文出现行首 slash | 停止写入，不做剥离后重试 | 由本人改写说明后重新冻结载荷 |

所有停止输出均包含：当前目标、已确认事实、停止条件、未执行动作、需要谁做什么和可重试入口。不得把错误摘要扩张为规则裁决。
