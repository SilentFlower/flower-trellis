# 让 Update-Spec 自动决策并减少流程卡点

## Goal

让 `trellis-update-spec` 在 Phase 3.3 自主判断是否需要更新 code-spec，并返回
`no-op`、`written` 或 `needs-review`。保留 Check-All 通过后的现有停止点；用户明确回复
“下一步”或同义继续意图后，同一轮自动执行 Update-Spec，`no-op` / `written` 直接进入
`trellis-push` 计划，只有真实规范歧义才再次停下。

## Background

- 当前 0.6 hub 的 `Interactive Post-Check Stop Gate` 要求 Check-All 通过后停止，用户再说
  “下一步”才进入 Phase 3.3。该停止点本轮保留。证据：
  `vendor/skill-garden/.trellis/0.6/overrides/workflow.md:109-113`。
- 当前 Check-All skill 同样要求 interactive 报告后立即停止，并指向 Phase 3.3 / 3.4；本轮不修改
  Check-All 的停止边界。用户继续后必须由 workflow 自动完成 Phase 3.3 到 Phase 3.4 的衔接。
  证据：`vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-check-all/SKILL.md` 的
  `Interactive Post-Check Stop Gate`。
- 上游 `trellis-update-spec` 已要求读取真实 code-spec、使用证据、输出七段式跨层契约，但仍把
  “是否更新”留给调用方，并保留 interactive 问答。证据：`.agents/skills/trellis-update-spec/SKILL.md`。
- auto-loop 已有独立 `run_spec_update` action，并允许“无必要更新也 record ok”，因此状态机动作名
  无需改变，只需统一自主决策结果和 blocked 边界。
- 0.6 已有通用 skill override 注入器，能够把 `overrides/skills/<skill>.md` 注入目标项目已有的
  agents/claude skill 或 Claude command；目前源中只有 finish-work override。

## Requirements

### R1. Update-Spec 自主结果协议

- Phase 3.3 调用 `trellis-update-spec` 后必须自主返回：
  - `no-op`：没有形成可复用的可执行契约，或现有 spec 已完整覆盖。
  - `written`：存在代码/测试支持的新契约，目标 spec 唯一明确，已完成写入与定向验证。
  - `needs-review`：目标规范、业务语义或冲突处理无法从仓库证据唯一确定。
- `no-op` / `written` 不询问用户是否继续；`needs-review` 只询问解除歧义所需的一个问题。
- 用户在当前请求中明确说“不更新 spec / 跳过 spec”时返回 `no-op`，reason 记录用户覆盖。
- 结果必须包含 status、reason、evidence、changed files 和 validation 摘要；无变更时 changed files 为空。

### R2. 证据与写入安全

- 判断顺序固定为当前任务 artifacts / check 结论 -> 实际 diff 与源码/测试 -> 现有目标 spec / index。
- 不能根据聊天摘要、任务标题或“感觉值得记录”直接写 spec。
- `written` 只允许修改 `.trellis/spec/**`；不得借 Update-Spec 修改业务代码、workflow、skill、测试或任务文件。
- 只有签名、状态字段、兼容行为、错误矩阵、跨层边界、非显然约定等可复用知识才写入。
- 一次性实现细节、已被现有 spec 完整覆盖的内容、纯文案/格式变化必须 `no-op`。
- 新增 spec 文件时同步对应 index；优先更新现有权威 spec，避免创建同义文档。
- `written` 只修改承载新契约所需的最小章节和最少文件，不得顺带重写、扩写、整理或格式化
  无关 spec 内容。

### R3. Written 自校验

- `written` 在返回前自行核对变更仅位于允许路径、契约与实际代码/测试一致、无重复或冲突段落。
- 至少执行 `git diff --check` 和目标 spec 定向复读；适用时运行 index/link、代码签名或项目专用验证。
- 自校验失败不得返回 `written`；可确定修复时在 skill 内修复并重验，无法确定时返回
  `needs-review`。
- spec 写入后不再触发一次人工 Check-All；如果 Update-Spec 越界修改非 spec 文件，必须停止并回到检查流程。

### R4. 普通 Check-All 下一步后的自动续行

- Interactive Check-All 有问题时保持现状：输出统一问题报告并停止，等待一次修复范围选择。
- Interactive Check-All 无问题时保持现状：输出检查结果并停止，等待用户明确回复“下一步”或
  同义继续意图；不得在该停止点前自动执行 Update-Spec。
- 用户在 Check-All 通过后表达继续意图时，同一轮必须先执行 `trellis-update-spec`，不得再次询问
  是否更新 spec，也不得先生成 Push 计划。
- Update-Spec 返回 `no-op` / `written` 后，同一轮自动进入 Phase 3.4 `trellis-push` 并展示唯一
  提交确认，中间不得再次停在“下一步”。
- Update-Spec 返回 `needs-review` 时停止，不生成 Push 计划；处理后重新执行 Update-Spec 判断。
- Check-All 自身仍不生成 commit message 或文件计划；计划格式继续完全由 `trellis-push` 所有。
- 若用户在 Check-All 通过后直接要求 push，而本轮没有可验证的 Update-Spec outcome，
  `trellis-push` 前置门禁必须先补跑 Update-Spec；只有 `no-op` / `written` 才能生成提交计划。

### R5. Auto-Loop 兼容

- 保留 `run_spec_update` action 和 runner 状态机顺序。
- auto-loop 调用同一 Update-Spec 自主协议：`no-op` / `written` 均
  `record --action run_spec_update --result ok` 后立即 `next`。
- `needs-review` 使用 `record --result blocked --failure-type spec-needs-review`，不得伪装成 no-op。
- 不改变 fix/recheck 预算、commit-only 授权、route 或队列行为。

### R6. Skill-Garden 注入与精细安装

- 新增 vendor 0.6 `overrides/skills/trellis-update-spec.md`，不复制或维护整份上游 skill。
- flower 全装和 `--skills trellis-update-spec` / `update-spec` / `update-spec-enhancement`
  精细安装都必须执行该 override。
- skill-garden 独立 `install.sh` 与 flower consumer 保持相同别名和注入结果。
- 目标不存在 Update-Spec skill/command 时结构化跳过，不创建平台入口。
- agents、claude 与 command 目标存在时均使用 managed override block 幂等更新。

### R7. 上下文预算与门禁去重

- 完整 no-op/written/needs-review 判断、证据矩阵和自校验规则只放 Update-Spec override。
- workflow hub 只保留短序列：Check-All failed/passed -> 按现有边界 stop；用户随后表达
  next/continue -> Update-Spec；no-op/written -> Push；needs-review -> stop。
- `in_progress` / `in_progress-inline` 各只保留一句同义 guard，不复制结果字段或检查矩阵。
- Check-All skill 只描述通过/失败 disposition，不复制 Update-Spec 内部判断规则。
- 必须运行默认和 strict AI context budget；保持 warning 为评审信号，不提高阈值掩盖增长。

### R8. 0.6 源与分发同步

- 真实修改先落 `vendor/skill-garden/.trellis/0.6/` 和独立安装器源，再 `npm run sync`。
- `enhancements/0.6`、当前 dogfood `.agents/.claude/.trellis/workflow.md` 与 vendor 一致。
- 0.5 / old 行为不变。

## Acceptance Criteria

- [ ] Check-All 未通过仍只停在修复范围选择，不运行 Update-Spec 或 Push。
- [ ] Check-All 通过后仍输出报告并停止，Update-Spec 不在用户继续前运行。
- [ ] 用户回复“下一步”或同义继续意图后，同一轮自动执行 Update-Spec，不再询问是否更新 spec。
- [ ] 没有新知识时返回 `no-op`，并在同一轮直接展示 Trellis Push 计划。
- [ ] 有明确代码/测试证据时自动更新唯一目标 spec，返回 `written`，并在同一轮直接展示 Push 计划。
- [ ] 目标 spec 或业务语义不唯一时返回 `needs-review`，只问一个解除歧义的问题且不展示 Push 计划。
- [ ] 用户在通过后直接要求 push 且缺少 Update-Spec outcome 时，Push 前置门禁自动补跑
  Update-Spec，不允许绕过 Phase 3.3。
- [ ] `written` 只修改 `.trellis/spec/**`，完成定向自校验，不额外触发人工 Check-All。
- [ ] `written` 的文件和章节范围保持最小，不包含与新契约无关的整理、扩写或格式变化。
- [ ] 用户明确跳过 spec 时返回带 reason 的 `no-op`。
- [ ] auto-loop 对 no-op/written 自动 `record ok -> next`，对 needs-review 记录 blocked。
- [ ] 新 Update-Spec override 可注入 agents、claude 和现有 command，重复安装幂等。
- [ ] flower 与独立 install.sh 的全装/精细安装行为一致；缺目标时安全跳过。
- [ ] vendor、snapshot、dogfood 一致，0.5/old 无漂移。
- [ ] 默认与 strict 上下文预算通过，hub/state 未复制 Update-Spec 详细矩阵。
- [ ] 自动化测试覆盖三种结果、用户跳过、越界保护、Check-All pass/fail disposition、
  auto-loop mapping 和精细安装。

## Out Of Scope

- 不把 Update-Spec 改写成纯脚本；是否形成可复用知识仍是 AI 语义判断。
- 不移除或前移 Check-All 通过后的现有用户继续卡点。
- 不改变 `trellis-push` 的一次确认、精确文件范围或 push 安全边界。
- 不让 Update-Spec 修改业务代码、测试、任务 artifacts、workflow 或 skill。
- 不改变 0.5 / old 的 Phase 3.3 行为。
