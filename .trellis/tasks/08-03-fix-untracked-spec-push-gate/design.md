# Untracked 流程游标与 Push 路由技术设计

## 1. 设计边界

Untracked 只回答一个问题：当前无任务工作下一步应该进入哪个 owner。

```text
direct edit
    |
    v
implement -> check -> spec -> push -> clear
    ^          |
    | findings |
    +----------+
```

- `untracked_flow.py`：保存 session 级工作标识和阶段游标。
- workflow / per-turn hook：把游标转换成一跳面包屑。
- `trellis-check-all`：拥有检查深度、证据和 disposition。
- `trellis-update-spec`：拥有规范评估与写入。
- `trellis-push`：拥有正式计划、用户确认、Git 预检与精确动作。

Untracked 不再验证上述 owner 是否完成，也不保存它们的证据副本。

## 2. Runtime Schema

新写入状态采用精简 schema：

```json
{
  "version": 2,
  "id": "uw-<id>",
  "summary": "<bounded work summary>",
  "source": "inferred|user-explicit",
  "stage": "implement|check|spec|push",
  "createdAt": "<UTC>",
  "updatedAt": "<UTC>"
}
```

- 不保存 baseline、scope、prepared fingerprint、workspace fingerprint、focused validation、Check-All 或 Update-Spec evidence。
- v1 reader 只提取仍有意义的字段；旧 `inspect` 映射到 `implement`，其它已删除字段忽略。
- 下一次 `advance` 或其它写操作以 v2 schema 覆盖旧状态，完成惰性迁移。
- 同一 session 已有不同事项时，`begin` 继续返回 active-work conflict，避免两个事项共用一个游标。

## 3. CLI Contract

```bash
python3 ./.trellis/scripts/untracked_flow.py begin \
  --summary "<bounded work summary>" \
  --source <inferred|user-explicit>

python3 ./.trellis/scripts/untracked_flow.py status [--verbose]
python3 ./.trellis/scripts/untracked_flow.py advance \
  --stage <implement|check|spec|push>
python3 ./.trellis/scripts/untracked_flow.py session-start-hint
python3 ./.trellis/scripts/untracked_flow.py clear \
  --reason <completed|abandoned|adopted> [--work-id <id>]
```

- `begin` 直接建立 `stage=implement`。
- `advance` 是显式游标更新，不读取 Git、不校验阶段证据，并允许回到 `implement`。
- `status` 只报告工作摘要和阶段，不因工作区发生变化返回错误。
- 删除 `prepare-edit`、`record-validation`、`record-check`、`record-spec` 命令及其内部状态机。
- `clear` 仍校验可选 work id，防止清理错误事项。

## 4. Owner Transitions

| 当前 owner | 结果 | 游标动作 |
| --- | --- | --- |
| 实现 | 完成并准备检查 | `advance --stage check` |
| Check-All | findings / 需要返工 | `advance --stage implement` |
| Check-All | strict pass 且继续 | `advance --stage spec` |
| Update-Spec | `needs-review` | 保持 `spec` |
| Update-Spec | `no-op` / `written` | `advance --stage push` |
| Trellis Push | 全部确认动作成功 | `clear --reason completed` |

这些命令记录路由事实，不证明结果真实性。owner 仍按自身契约决定结果和是否继续。

## 5. Stage-Specific Breadcrumbs

per-turn hook 读取 `(work id, stage, summary)` 后选择对应 breadcrumb key：

1. `implement`：进入实现路由，不创建 task artifact。
2. `check`：加载 `trellis-check-all`，完成后按 disposition 更新游标。
3. `spec`：加载 `trellis-update-spec`，根据结果更新游标。
4. `push`：加载 `trellis-push`；只表示“下一步是 Push”，不表示 Push 已执行或已确认。

每个面包屑只保留当前阶段的一跳指令。完整流程规则仍在 phase/skill owner 中，避免通用正文同时展示四个阶段。

## 6. Task Adoption

`task_intent.py adopt` 不再以 `read_untracked_state(..., validate_workspace=True)` 阻止 adoption：

1. 读取并校验当前事项的 id 和 stage；summary/source 只服务于 untracked 恢复，不形成 task 元数据要求。
2. 使用 task owner 已有的 Git evidence helper，在 adoption 当下捕获新的 task baseline。
3. 把 work id 和 adopted stage 写入 task meta；任务标题与描述沿用 adoption 请求参数。
4. 成功创建 task 后以 `clear --reason adopted` 清理 untracked 游标。

这使 task baseline 继续严格，但严格性位于真正需要持久任务证据的 task 边界，而不是 untracked 流程提示中。

## 7. Authoring And Distribution

产品源位于 `vendor/skill-garden/.trellis/0.6/`。修改范围包括：

- `scripts/untracked_flow.py` 与 `scripts/task_intent.py`。
- workflow state、Phase 2/3 owner、Check-All、Update-Spec 和 Trellis Push 相关 Patch/skill。
- per-turn hook 及 breadcrumb resolver/config。
- 相关 Python/JS 测试和 `.trellis/spec/flower-trellis/cli/enhancements-model.md`。

完成 vendor source 修改后运行 `npm run sync` 生成 `enhancements/0.6`，再通过既有 dogfood 路径刷新根项目副本。0.5 和 old 不修改。

## 8. Compatibility And Failure Behavior

- runtime JSON 损坏、字段类型错误或 work id 不匹配仍返回稳定错误；这些是状态文件完整性问题，不是 workspace drift。
- `begin` 的 active-work conflict 保留，防止无意覆盖另一个未完成事项。
- v1 状态兼容读取，旧证据字段不再影响推进或恢复。
- `trellis-push` 保持既有 fail-closed Git 安全检查；本任务不增加第二套 Push runtime gate。

## 9. Validation

- Python：v2 begin/status/advance/backtrack/clear、v1 迁移、active conflict、损坏 runtime、task adoption 新 baseline。
- Hook：四阶段分别选择正确一跳面包屑，尤其 `push -> trellis-push`。
- JS：旧证据命令和 workspace-drift owner 文案消失，Patch/Bundle/snapshot/dogfood 保持一致。
- 全量：sync、snapshot、Patch conflict、AI context budget、`npm test`、Python compile、diff check 和任务校验。

## 10. Rollback

若实现出现兼容问题，回退 vendor authoring source 后重新运行 sync 与 dogfood。v2 只删除可选证据字段，旧 v1 reader 可通过同一兼容层恢复读取，不涉及用户业务数据迁移。
