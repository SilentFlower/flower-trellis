# Brief — 审计 Trellis Python 控制面语义边界

## Goal

修复 auto-loop 对 PRD `Open Questions` 的机械误判，并收紧 Trellis Python 控制面中已确认会导致错误阻塞、错误授权、假成功或损坏状态静默降级的语义边界。

## Scope

- F1：采用 Markdown checkbox 作为新 PRD 的确定性契约；`- [ ]` 阻塞，`- [x]` 不阻塞，无章节或空章节直接放行。历史普通列表项进入带 PRD hash 的 AI review，`blocking` 和 `ambiguous` 保守阻塞。
- F2：auto-loop route 授权前验证当前任务属于所选 run 的未完成队列，防止跨任务复用临时授权。
- F3/F4：修复 `task.py start` 和 `finish` 的假成功；关键写入、pointer 设置或清理失败必须返回非零，失败路径不得执行成功 hook，并在 start 的 pointer 失败时补偿状态。
- F6：收紧 task store 核心写入结果，包括重复 slug、create、set-*、父子任务双向关系和 archive 前置状态写入；双文件第二次写入失败时恢复第一次写入。
- F7：仅对 `.trellis/.runtime/**` 使用同目录临时文件、`fsync` 和原子替换；读取区分 missing、corrupt 与 I/O error，当前 run/session/route 损坏时不得静默跨任务 fallback。
- F9：progress 扫描在保持现有 schema 主字段和退出码兼容的前提下，附加 `invalidCandidates` 与 `scanWarnings`。
- 增加跨仓 JSONL 回归测试，确保 `flower-trellis` 中的任务仍可按次读取和修改 `/root/project/ai-fund` 等 sibling repository。
- 所有上游已有 Trellis 文件修改通过 Skill-Garden Patch Engine operation 表达；Skill-Garden 自有 runner/skill 资产从 vendor 权威源修改，经 `npm run sync` 和 Flower enhance-only 铺设。

## Non-Goals

- 不限制仓库外或 sibling repository 路径，不新增外部仓库 allowlist。
- 不修改 brief freshness 的 mtime 契约。
- 不新增 task CLI `--json` 接口，不修改 workflow heading parser，不扩展完整 YAML 支持。
- 不建立完整 task store、archive 或 Git 跨文件事务。
- 不手改 `enhancements/0.6` 快照或当前 dogfood 作为真实源，也不把新增资产伪装成普通文件 Patch create。

## Key Context

- 当前误阻塞来自 Python 对 `Open Questions` 普通列表项的机械解析；`- 无。当前实现口径已确认。` 被视为未决，而精确 `TBD` 反而被放行。
- 确定性状态由 Python runner 处理；只有历史裸列表需要 AI 语义复核。复核结果必须结构化回写并绑定 PRD SHA-256，内容变化后旧结论失效。
- 权威修改位于 `vendor/skill-garden`。上游文件差异进入 `overrides/patches`，自有资产进入既有 scripts/skills 复制链路；随后同步快照并通过正式增强入口更新 dogfood。
- Patch 必须有 bundle、精确 selector/baseline、managed marker、冲突断言、JS/Python preflight 覆盖和二次应用零变更证明。
- 正常 task schema、auto-loop queue schema、route 优先级、CLI 人类输出和跨仓上下文能力保持兼容。

## Acceptance

- `Open Questions` checkbox、空章节、无章节、`TBD`、历史已解决、真实未决、ambiguous 和陈旧 hash 均有行为测试。
- route 跨任务授权被拒绝，当前任务命中和正常 fallback 继续工作。
- start/finish、task store 和 runtime JSON 的失败路径返回真实错误，不输出假成功，不误执行 hook，并在设计范围内完成补偿或保留损坏证据。
- progress 健康候选仍可用，损坏候选和扫描错误可诊断。
- `../ai-fund/...` 与绝对外部路径继续通过 JSONL 上下文验证。
- vendor、`enhancements/0.6` 与 dogfood 结果可追溯且一致；第二次 enhance-only 的 Patch 修改数为 0，目标文件 hash 不变。
- 定向 Python 测试、Patch Engine JS/Python 测试、冲突检查、context budget、完整 `npm test`、snapshot consistency 和 `git diff --check` 全部通过。

## Next Step

用户确认本 brief 及 `prd.md`、`design.md`、`implement.md` 后，运行 `task.py start` 进入实现阶段；实现严格从 Skill-Garden vendor 权威源开始，并按 Patch Engine、sync、dogfood、幂等验证的顺序推进。
