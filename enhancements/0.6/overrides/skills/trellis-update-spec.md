### HIGHEST PRIORITY: skill-garden autonomous spec evaluation

<!-- BEGIN skill-garden skill override trellis-update-spec v0.6 -->

> 来源：github.com/SilentFlower/skill-garden。本注入块覆盖上游 Update-Spec 的交互式“是否更新”判断和完成后的流程去向；上游七段式 code-spec 内容要求继续有效。

## Autonomous Result Contract

每次调用必须自行完成判断，并返回唯一结果：

```yaml
spec_update_result:
  status: no-op | written | needs-review
  reason: string
  evidence: [string]
  changed_files: [path]
  validation: [string]
```

- `no-op`：没有形成可复用的可执行契约、现有 spec 已完整覆盖、仅有一次性实现/文案/格式变化，或用户在当前请求中明确要求跳过 spec。
- `written`：代码或测试证据支持新的可执行契约，目标权威 spec 唯一明确，且写入和定向验证均已完成。
- `needs-review`：目标 spec、业务语义、冲突处理或验证失败无法从仓库证据唯一解决。

不得进入上游 Interactive Mode，也不得询问“是否要更新 spec”。只有 `needs-review` 可以停止，并且只问一个解除当前歧义所必需的问题。

## Evidence Order

判断时按以下顺序读取真实证据，不能只依赖聊天摘要、任务标题或主观判断：

1. 当前任务 `implement.jsonl` / `check.jsonl` 及其引用文件。
2. 当前任务 `prd.md`、`design.md`、`implement.md`。
3. 本轮 Check-All 最终结论和实际验证证据。
4. 当前任务实际 diff、源码、测试和提交证据。
5. `spec_router.py` 命中的现有 spec 与对应 index。

无活动任务但用户显式调用 Update-Spec 时，使用当前请求、实际 diff、源码/测试和现有 spec；不得虚构任务证据。

## Minimal Write Boundary

写入前记录当前 dirty baseline。`written` 必须同时满足：

- Update-Spec 新增的修改全部位于 `.trellis/spec/**`；不得修改业务代码、测试、workflow、skill、任务 artifacts 或其它文件。
- 只修改承载新契约所需的最小章节和最少文件；不得顺带重写、扩写、整理或格式化无关内容。
- 优先更新现有权威 spec；只有没有合适文档时才新增文件，并同步对应 index。
- 不得为了避免 `no-op` 而写原则性总结。新增内容必须包含可执行签名、字段、边界、错误矩阵、案例或测试断言等具体契约，并遵循上游七段式要求。

写入后复读 spec diff，并与源码和测试反向核对。至少运行：

```bash
git diff --check -- .trellis/spec
```

适用时继续运行 index/link、代码签名或项目专用 spec 验证。可唯一修复的验证问题在本 skill 内修复并重验；无法唯一修复时返回 `needs-review`。若本次 Update-Spec 产生了 `.trellis/spec/**` 之外的修改，返回 `needs-review`（reason=`boundary-violation`），立即停止且不得进入 Push，并返回检查流程处理。`written` 完成后不额外触发一次人工 Check-All。

## Workflow Disposition

- Interactive：当用户在已通过的 Check-All 停止点后表达“下一步”或同义继续意图，本轮调用完成后，`no-op` / `written` 必须在同一轮加载 `trellis-push` 并展示其唯一确认计划；`needs-review` 停止且不得生成 Push 计划。
- Interactive direct push：若已通过 Check-All、用户直接要求 push 且没有当前有效的 `spec_update_result`，先执行本 skill；只有 `no-op` / `written` 可以进入 `trellis-push`。
- Validated auto-loop：`no-op` / `written` 执行 `record --action run_spec_update --result ok` 后立即 `next`；`needs-review` 执行 `record --action run_spec_update --result blocked --failure-type spec-needs-review`，不得伪装成 `no-op`。

已有当前有效的 `no-op` / `written` 结果时不得重复询问或重复运行；实际 diff、Check-All 结论或用户 spec 意图变化后必须重新求值。

<!-- END skill-garden skill override trellis-update-spec v0.6 -->
