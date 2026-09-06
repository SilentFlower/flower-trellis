# Release Operations

## Conclusion

Needs human review.

任务实现与检查已完成，业务提交 `5eaf6af`、任务记录提交 `0d693d9` 均已包含在 `origin/main`。受管配置更新已完成本项目和隔离目标验证；真实 Codex / Claude 宿主接收、必要的 hook 信任复核及 Windows 实机验证仍需实际使用者确认，不阻断任务归档。[09-05-codex-sessionstart-context-limit]

## Evidence Checked

- `task.json`、`prd.md`、`design.md`、`implement.md`。
- `implement.jsonl`、`check.jsonl`、`check-report.md`。
- 核对前不存在 `release.md`。
- `git show --stat 5eaf6af`、该提交的 `.codex/hooks.json` 与 `.claude/settings.json` 差异。
- `git show --stat 0d693d9` 及其已完成任务记录；两个提交均通过 `origin/main` 祖先检查。
- 归档开始时 `HEAD` 与 `origin/main` 均为 `49eddc0`，任务目录干净，无待审核决策。

## Drift Check

Missing release.md.

`implement.md` 和 `check-report.md` 保留了检查当时的“尚未提交或推送”及下一阶段说明；这些描述已被 `task.json` 的完成状态和上述 Git 提交证据取代。检查报告中的测试结果是 2026-09-05 的历史证据，本次收尾未重新运行测试。宿主和 Windows 验证边界继续保留。[09-05-codex-sessionstart-context-limit]

## SQL Changes

None

## Configuration Changes

现有项目通过 Flower 受管更新同步 `.trellis/scripts/flower_session_start.py`、`.codex/hooks.json` 和 `.claude/settings.json`。确认两平台均注册 `state`、`rules`、`stages`，匹配 `startup|clear|compact`；更新检查仍独立匹配 `startup`。Codex 原有合法 `additionalContextLimit`（包括 `0`）及分段独立额度应保留；无配置时保留宿主缺省行为。本项目的配置变更已包含在 `5eaf6af`，本次归档不再次执行升级。[09-05-codex-sessionstart-context-limit]

## Batch / Deployment Scripts / Data Repair

分段脚本与平台配置须通过同一受管更新流程部署。没有独立数据库修复、一次性批处理或新增定时任务；隔离安装、更新及重复更新幂等已有检查记录。[09-05-codex-sessionstart-context-limit]

## External Systems / Dependent Platforms

依赖实际 Codex / Claude 宿主执行新 handler。检查报告记录 Codex 可能要求使用者在 `/hooks` 复核并信任变更；是否需要由宿主实际提示确定，本次不代写信任记录。Needs human review：两端真实宿主接收与 Windows 实机结果尚无完整验证记录。[09-05-codex-sessionstart-context-limit]

## Release Order

先完成受管脚本和配置更新，再按宿主要求完成信任复核，最后在项目根目录新建会话观察三段注入。`resume` 按设计不补注入，旧会话内容不会自动替换。[09-05-codex-sessionstart-context-limit]

## Rollback Notes

回退时同步恢复此前可用版本的分段资产与两端 hook 配置，保留用户额度和无关 handler；不能只删除脚本而留下指向它的命令。回退后重新核对宿主信任状态并新建会话验证。本次不执行回退。[09-05-codex-sessionstart-context-limit]

## Post-release Verification

- 历史自动化证据：519 个 JavaScript 测试、318 个 Python 测试通过；配置迁移、并行分段、异常、预算和隔离安装链检查通过。[09-05-codex-sessionstart-context-limit]
- 由实际使用者核对 Codex / Claude 新会话日志或上下文包含三份完整 `trellis-session-part`，没有超长输出落盘预览；本地输出等价性不替代真实宿主接收证据。[09-05-codex-sessionstart-context-limit]
- 由 Windows 使用者验证实际宿主启动和生成命令；现有 `python` / `py -3` 生成回归不替代 Windows 实机结果。[09-05-codex-sessionstart-context-limit]
