# 历史回归证据：Brief 展示前显式预授权未被接受

## Source

- 平台：Codex
- 会话：`019fa64c-8712-7722-b2fa-5e391f0c319c`
- 日期：2026-07-28
- 项目：`/root/project/flower-trellis`
- 任务：`07-28-flower-plugin-external-adapters`

## Sequence

1. AI 已确认需求边界没有阻塞项，准备写 `design.md`、`implement.md` 并生成最终 Brief。
2. 用户说：“我允许你的brief，等会你直接开工就行。”
3. AI 表示旧 Trellis 门禁仍要求 Brief 展示后再次确认。
4. 用户再次说：“你当我默许就行”。
5. AI 再次拒绝复用预授权，生成并展示完整 Brief 后停止。
6. 用户约三小时后回复“确认”，任务才进入 `in_progress`。

## Interpretation

- 这不是普通的“按方向继续”或早期实现意图。
- 用户明确提到了 Brief，并明确授权展示后直接开工、无需再次询问。
- 当时 planning artifacts 已收敛、没有开放问题，最终 Brief 没有显示出超出已讨论范围的新要求。
- 按新合同，这一表达应由 Phase 1.4 和 `trellis-task-brief` 识别为当前任务的显式预授权；完整展示 Brief 并确认范围未扩大后，在同一回合启动。

## Regression Use

该案例作为产品级验收场景和 workflow 文本断言。自动化测试不实现自然语言解析，也不新增 runtime/helper/hash 门禁；它验证默认确认、显式预授权窄例外、Brief 必须展示和失效边界在作者源与同步产物中保持一致。
