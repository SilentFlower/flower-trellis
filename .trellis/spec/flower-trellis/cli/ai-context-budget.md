# AI Context Budget

> 控制 Trellis workflow 与高频注入上下文的总量、分层职责和重复内容，预算默认用于评审告警。

---

## Scope / Trigger

以下改动必须读取本规范并运行预算 checker：

- 修改 `.trellis/workflow.md`、skill-garden 0.6 hub 或 workflow-state。
- 修改 `get_context.py --mode phase`、SessionStart hook、workflow-state hook 或 task-status 注入。
- 把长流程从 skill/helper 移入高频 prompt，或在多个层重复同一规则。
- 调整任何 target/review ceiling。

这里控制的是 Trellis AI control-plane。业务 PRD、design、implement、spec 正文按需读取，不把全部内容常驻 SessionStart。

## Signatures / Output Contract

```bash
node scripts/check-ai-context-budget.mjs
node scripts/check-ai-context-budget.mjs --strict
```

每个测量对象输出 `status`、`name`、`actual bytes`、`lines`、`target`、`review`，存在规划前基线时再输出 `baseline delta`。默认模式只有结构性错误非零退出；`--strict` 额外把 `high-warning` 转为非零退出。禁止让 warning 静默消失或在默认 `npm test` 中变成大小硬门禁。

## Layer Ownership

| 层 | 应保留 | 禁止 |
|---|---|---|
| workflow hub | 跨阶段不可丢失的门禁、优先级、短指向 | helper schema、完整交互模板、重复 skill 流程 |
| workflow-state | 当前状态的一跳动作、关键禁止事项 | 复制 hub 长段、解析 runtime/JSON/Git |
| workflow body | 官方阶段结构和低频 walkthrough | 与 hub 同义的第二份完整规则 |
| skill | 完整语义流程、选项、交互边界 | 手工实现可确定脚本逻辑 |
| helper | 解析、验证、状态读写、错误矩阵 | 产品意图推断和长 prompt |
| SessionStart | 当前状态、精简 workflow summary、spec index | 全 workflow、全 task artifacts、重复 breadcrumb |

同一规则确需跨层出现时，上层只保留一句边界和权威入口。默认禁止“旧规则保留 + 新高优先级段继续追加”。

## Deterministic Metrics

硬指标使用 UTF-8 bytes，行数作为诊断。不同模型 tokenizer 会变化，token 估算不能作为可复现门禁。

规划前基线（2026-07-18）：

| 对象 | Lines | Bytes |
|---|---:|---:|
| 完整 `.trellis/workflow.md` | 902 | 56,635 |
| 0.6 hub | 127 | 10,757 |
| 当时五个 workflow-state 源合计 | 61 | 8,546 |
| `get_context.py --mode phase` | 260 | 17,935 |
| SessionStart 样本 | 257 | 17,841 |

意图路由 dogfood 后参考值（2026-07-18）：

| 对象 | Lines | Bytes | 状态 |
|---|---:|---:|---|
| 完整 workflow | 941 | 59,521 | target 内 |
| 0.6 hub | 149 | 12,022 | warn |
| 当前四个 additive state 合计 | 54 | 7,827 | target 内 |
| Phase summary | 289 | 20,117 | warn |
| fixture SessionStart | 281 | 19,446 | warn |

Check-All 智能深度与 auto-loop return gate dogfood 后参考值（2026-07-18）：

| 对象 | Lines | Bytes | 状态 |
|---|---:|---:|---|
| 完整 workflow | 943 | 59,748 | target 内 |
| 0.6 hub | 151 | 12,243 | warn,低于 12 KiB review ceiling |
| 当前四个 additive state 合计 | 54 | 7,833 | target 内 |
| Phase summary | 291 | 20,338 | warn,低于 20 KiB review ceiling |
| fixture SessionStart | 283 | 19,667 | warn,低于 20 KiB review ceiling |

Update-Spec 自主判断与 post-check resume-chain dogfood 后参考值（2026-07-18）：

| 对象 | Lines | Bytes | 状态 |
|---|---:|---:|---|
| 完整 workflow | 945 | 59,743 | target 内 |
| 0.6 hub | 153 | 12,236 | warn,低于 12 KiB review ceiling |
| 当前四个 additive state 合计 | 54 | 7,835 | target 内 |
| Phase summary | 293 | 20,331 | warn,低于 20 KiB review ceiling |
| fixture SessionStart | 285 | 19,660 | warn,低于 20 KiB review ceiling |

本轮首次把 resume-chain 作为独立 hub 长段追加时,hub=13,035 B、Phase summary=21,130 B,
均成为 high-warning 并导致 strict 失败。最终通过替换压缩现有 Interactive Post-Check Stop Gate
消除重复,未调整任何 target/review ceiling;默认与 strict 均通过。

## Budget Table

| 层 | Target | Review ceiling |
|---|---:|---:|
| 完整 `.trellis/workflow.md` | 60 KiB | 64 KiB |
| 0.6 hub | 11 KiB | 12 KiB |
| 单个 workflow-state | 2.5 KiB | 3 KiB |
| 当前 additive workflow-state 合计 | 9 KiB | 10 KiB |
| Phase summary | 18 KiB | 20 KiB |
| SessionStart control-plane 总输出 | 18 KiB | 20 KiB |

预算语义：

- `actual <= target`：`ok`。
- `target < actual <= review ceiling`：`warn`，评审说明增长来源，默认退出成功。
- `actual > review ceiling`：`high-warning`，默认仍退出成功。
- 测量失败、fixture 损坏、目标缺失、输出不可解析：结构性错误，默认失败。
- `--strict` 时 high-warning 非零退出，仅供发布审计按需使用。

大小默认不作为 `npm test` 硬门禁，这是明确产品决策；warning 不能被静默吞掉。

## Checker

checker 必须测量当前 dogfood 完整 workflow、0.6 hub、当前存在的每个 additive state 与总和、真实 Phase summary，以及使用临时 Trellis fixture 调用真实 SessionStart hook 后的 `additionalContext`。已由 transform 接管并删除源文件的 `no_task` 不得为了凑固定数量重新计入 additive state。

SessionStart fixture 不能读取当前活动 task 或 runtime。输出包含 actual、lines、target、review ceiling 和有基线时的 delta。

## Change Review

新增高频内容前依次检查：

1. 能否替换旧内容，而不是追加？
2. 能否只放在 skill/helper，由 hub/state 保留一句指向？
3. Phase summary 和 SessionStart 是否都会携带它，导致双倍成本？
4. 能否删除同义旧规则抵消增长？
5. checker 的 actual/delta/status 是什么？

运行模式分流必须先于普通停止边界表达,但高频层只保留最短判定:

- hub:validated auto-loop 的 `record + next` 优先,否则 interactive stop。
- hub 的 interactive gate 可再保留一句用户继续后的 `Update-Spec -> Push` 去向,但不得复制
  三态字段、证据顺序、最小写入或 self-validation 规则。
- in_progress state:各保留一句同义 guard,不复制 depth/Update-Spec 矩阵、runner 参数或 report 模板。
- Check-All skill:保存 requested/effective profile、hard-full/light eligibility 和 disposition 全文。
- Update-Spec skill override:保存 no-op/written/needs-review、证据、写入边界和 self-validation 全文。
- auto-loop runner/skill:只保存确定性 state/record 字段和命令签名。

调整 target/review ceiling 必须同时提交调整原因、旧/新实际基线、无法通过去重解决的证据和本 spec 的预算表更新。禁止只为消除 warning 提高常量。

## Validation Matrix

| 条件 | 结果 |
|---|---|
| 某层超过 target | warning，测试继续 |
| 某层超过 review ceiling | high-warning；默认继续，strict 失败 |
| SessionStart hook 无 JSON 或无 additionalContext | 结构错误，失败 |
| workflow/hub/state 文件缺失 | 结构错误，失败 |
| tokenizer 更新 | 不影响硬指标 |
| 新规则同时复制到 hub/state/skill | 评审阻断，先去重 |
| hub/state 写入 check-depth 参数矩阵或 hard-full 全表 | 评审阻断,细节下沉 Check-All/auto-loop skill |
| hub/state 写入 Update-Spec 三态字段、证据矩阵或写入检查表 | 评审阻断,细节下沉 Update-Spec override |
| 新 resume-chain 使 hub/Phase summary 超过 review ceiling | 先压缩或替换现有 stop gate;不得先调高阈值 |

## Good / Base / Bad Cases

- Good：新增规则替换旧正文，或只进入 skill/helper；各层 actual 不超过 target。
- Good：hub 先写一条 Auto-Loop Return Gate,state 各写一句 guard,完整深度与 record 协议只在 skill/helper。
- Good：Check-All stop 保留在 hub;用户继续后的 Update-Spec/Push 只写一个短去向,完整三态和
  self-validation 只存在 Update-Spec override。
- Base：确有必要的新门禁使某层落在 target 与 review ceiling 之间；打印 warning，评审说明 delta 后继续。
- Bad：为消除 warning 直接提高阈值、同一长规则复制到多个高频层、fixture 不可解析或目标缺失；前两项拒绝评审，结构性错误直接失败。

## Tests Required

```bash
npm test
node scripts/check-ai-context-budget.mjs
node scripts/check-ai-context-budget.mjs --strict
```

断言点：默认模式在 warn/high-warning 时退出 0；结构性错误退出非 0；strict 仅在 high-warning 时退出非 0；SessionStart fixture 返回非空 `additionalContext`；state 合计从当前目录动态枚举，不写死文件数量。
另需静态断言 Auto-Loop Return Gate 位于 Interactive Post-Check Stop Gate 之前,两个
in_progress state 只含短例外,不含 `--effective-check-depth` 等 runner 细节;Post-Check gate
保留 stop + resume 去向,但不含 `spec_update_result` 字段、证据顺序或 `.trellis/spec/**` 写入矩阵。

## Wrong vs Correct

**Wrong**：每出现一个例外，就在 hub、两个 state 和 skill 各复制一段完整说明。

**Correct**：helper 保存确定性逻辑，skill 保存完整语义，hub/state 只留下必须高频出现的一句门禁。

**Wrong**：预算 warning 出现后直接提高 review ceiling。

**Correct**：先看 delta，删除重复正文；确有不可压缩的新门禁时，记录理由和新基线再调整 spec。
