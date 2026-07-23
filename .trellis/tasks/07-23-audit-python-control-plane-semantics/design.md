# Trellis Python 控制面语义边界技术设计

## 1. 设计目标

本次修改同时解决七类已确认问题，但不建立新的旁路更新机制：

- F1：Open Questions 显式状态与历史裸列表兼容。
- F2：auto-loop route 授权保持 task scope。
- F3/F4：task start/finish 不再假成功。
- F6：task store 核心写入失败可见，父子关系可补偿。
- F7：runtime JSON 抗截断并区分损坏状态。
- F9：progress 恢复扫描暴露损坏候选。

正常路径必须保持现有 task schema、auto-loop queue schema、route 优先级、跨仓上下文能力和 CLI 人类输出。

## 2. 权威源与 Patch Engine 边界

### 2.1 上游已有文件

以下目标来自 Trellis 0.6.5 基础模板，所有差异必须由
`vendor/skill-garden/.trellis/0.6/overrides/patches/` 表达：

- `.trellis/scripts/task.py`
- `.trellis/scripts/common/active_task.py`
- `.trellis/scripts/common/paths.py`
- `.trellis/scripts/common/task_store.py`
- 已安装平台中的 `trellis-brainstorm` Skill

优先扩展已有所有权明确的 Patch：

- F1 的规划契约扩展 `skills/trellis-brainstorm/planning-handoff`。
- F3 扩展 `scripts/task-start-brief-gate`，避免另一个 Patch 重写同一 start 区域。
- F4 扩展 `workflow/state-missing-task` 已有 active-task clear operation，并补充 task.py/paths.py operation。
- F6 新建职责单一的 task-store write-integrity Patch。
- F7 新建 runtime-state-integrity Patch，只修改上游 session runtime 实现。

新增 Patch 必须进入明确 Bundle。没有精细安装语义的控制面基础 Patch 使用 full-only Bundle；不得为了复用而给现有 Skill alias 隐式附带整套无关 Patch。

### 2.2 Skill-Garden 自有资产

以下文件是强化包新增资产，安装前目标项目中可能不存在，继续由既有资产复制链路管理：

- `scripts/auto_loop.py`
- `scripts/task_progress.py`
- `scripts/task_intent.py`
- `.agents/.claude` 中的 `trellis-auto-loop` Skill
- `.agents/.claude` 中的 `trellis-route/scripts/route_state.py`

这些文件从 vendor 对应源修改，`npm run sync` 生成 `enhancements/0.6`，再由
`copy-scripts.js` / `copy-skills.js` 铺设。Patch Engine 不允许用 `missing=create`
创建普通文件，因此不得为满足形式要求伪造 Patch。

### 2.3 统一交付链路

```text
vendor Skill-Garden 权威源
  ├─ overrides/patches -> JS/Python Patch preflight -> 修改上游已有文件
  └─ scripts/skills    -> 受管资产复制
            ↓
        npm run sync
            ↓
   enhancements/0.6 发布快照
            ↓
 flower enhance-only 应用到 dogfood
            ↓
 provenance + cmp + 二次应用零变更
```

## 3. F1：Open Questions 契约

### 3.1 确定性解析

`auto_loop.py` 将 `## Open Questions` 内条目分为：

- `- [ ] 内容`：未解决，立即阻塞。
- `- [x] 内容` / `- [X] 内容`：已解决，不阻塞。
- 普通 `- 内容`：历史裸列表，进入 AI review action。
- 无章节或无有效条目：直接通过。

`TBD` 不再是特殊放行值。`- TBD` 属于历史裸列表，必须进入 review；
`- [ ] TBD` 明确阻塞。

### 3.2 历史兼容 AI review

runner 新增 action `review_open_questions`。action 返回：

- 原始裸列表条目。
- PRD 原始字节的 SHA-256。
- 结构化回写说明。

Skill 负责语义判断并调用：

```text
record --action review_open_questions \
  --result <ok|blocked> \
  --review-verdict <resolved|blocking|ambiguous> \
  --summary <判断摘要>
```

runner 在 record 时重新计算 PRD hash；内容变化则拒绝陈旧 review。结果保存在当前
run item 的 `open_questions_review`，包含 hash、verdict、items、summary、reviewed_at。

- `resolved`：允许同一 PRD hash 继续 start gate。
- `blocking`：以 `open-questions` 阻塞。
- `ambiguous`：以 `open-questions-ambiguous` 保守阻塞。

PRD 修改后 hash 失配，旧 review 自动失效。review 只存 runtime，不修改 PRD，也不把
自然语言判断下沉到 Python 关键词表。

### 3.3 新文档收敛规则

`trellis-brainstorm` 的 Patch 内容明确：仍未解决的问题使用 `- [ ]`；已解决项移入需求、
决定或删除；无问题时删除章节，不写 `- [x] 无问题` 占位。

## 4. F2：route 授权 task scope

`route_state.py::_auto_route_mode` 接收当前 task。读取 session 绑定、global pointer 或唯一
running run 后，只有队列中存在相同规范 task ref 且 item 尚未完成时，才允许读取该 run 的
`route_authorization`。

run 与 task 不匹配时返回 miss，不写当前 session 的 runtime route decision。全局/唯一 run
fallback 保留，用于 auto-loop 先启动、active task 后绑定的正常场景。

## 5. F3/F4：start/finish 失败语义

### 5.1 start

planning task 的正常 session 模式按以下顺序执行：

1. brief gate 通过。
2. 保存原 task 数据并写入 `in_progress`。
3. 状态写入失败则返回非零，不设置 pointer、不执行 hook。
4. 设置 active pointer。
5. pointer 设置失败则补偿恢复原 task 数据；无论补偿是否成功都返回非零并给出恢复提示。
6. 两项成功后才输出成功并执行 `after_start`。

降级模式不写 pointer，但 planning -> in_progress 写入失败时同样返回非零且不执行 hook。
已是 `in_progress` 的任务继续允许幂等绑定 pointer。

### 5.2 finish

新增结构化 clear result，至少包含原 active task、是否清理成功和错误信息。

- 无当前任务或多 session 无法安全选择：保持现有 no-op 语义。
- session 文件删除失败：返回非零，不输出 cleared，不执行 `after_finish`。
- `clear_current_task()` 传播真实结果，不再固定返回 true。
- F7 识别到 session corrupt 时保留原文件并失败，不自动删除证据。

## 6. F6：task store 写入完整性

### 6.1 create

- 当日相同 slug 的 active task 目录已存在时直接失败，不覆盖旧 `task.json`。
- 初始 `task.json` 写入失败时停止，不生成后续文件、不执行 hook，并尽力清理由本次调用创建的目录。
- `--parent` 的双向关系写入失败时恢复父子原始快照；新建任务无法完成显式 parent 关系时创建命令失败并清理本次新目录。
- active pointer 自动设置继续 best-effort；失败输出 warning，但任务创建成功。
- `task_intent.py` 只有确认 active task 等于新任务时才返回 `autoDiscardEligible=true`。

### 6.2 父子关系与 set-* 命令

`create --parent`、`add-subtask`、`remove-subtask` 共用局部双文件补偿 helper。任一写入失败时
恢复两个原始 JSON；补偿失败时输出需人工检查的精确路径。

`set-branch`、`set-base-branch`、`set-scope` 必须检查 `write_json()`，失败返回非零且不输出成功。

### 6.3 archive

archive 前必须存在且可读取 `task.json`。写入 completed/completedAt 失败时，在 session 清理和
目录移动之前停止。子任务批量更新、目录移动和 Git 提交的完整原子事务不在本次范围。

## 7. F7：runtime JSON 完整性

F7 只覆盖 `.trellis/.runtime/**`。各独立资产保持自包含的小型 helper，不新增需要额外复制映射的
共享普通文件资产。

写入统一采用：同目录临时文件 -> flush -> fsync -> `os.replace`。失败时清理临时文件、保留旧目标。

读取区分：`ok`、`missing`、`corrupt`、`io_error`。

- auto-loop 当前 run corrupt：返回结构化错误，非 force 不创建第二个 run。
- 仅 pointer corrupt 且存在唯一健康 running run：恢复该 run 并原子重建 pointer。
- 历史损坏 run 在 status diagnostics 中可见，不参与健康候选。
- 当前 session corrupt：active task 返回可诊断 source，不进行 single-session fallback。
- route 当前 session corrupt：返回 miss/error reason，不套用 prefs 或其它 auto run，也不覆盖损坏文件。

普通 task/config JSON 继续使用现有 I/O 契约。

## 8. F9：progress 扫描诊断

无 active task 时的 status JSON 保持 `status`、`candidates` 和退出码兼容，按需附加：

- `invalidCandidates`：已确认是 in_progress，但 progress schema 无效。
- `scanWarnings`：task.json 无法读取，无法判断是否为候选。

健康候选继续可用；损坏项不自动选择、不修改、不阻塞其它候选。文本模式在候选列表后显示简短警告。

## 9. 兼容性与风险控制

- F5：新增回归测试证明 repo 外相对路径和绝对路径仍可作为 JSONL context；不增加 containment。
- F8/F10/F11/F12：不修改对应实现。
- CLI 正常输出、task schema、auto-loop schema version 保持兼容；新增字段均为可选诊断或 item 内部状态。
- Patch selector 以 Trellis 0.6.5 npm 模板为 baseline，禁止以已 Patch 的 dogfood 文本反推上游 selector。
- Patch operation 交叉目标必须服从现有 owner，避免两个 managed block 重写同一区域。

## 10. 回滚

- Patch/资产尚未 sync：恢复 vendor 工作树即可。
- 已 sync 未应用：恢复 `enhancements/` 生成差异。
- 已应用 dogfood：使用 `.trellis/.backup-flower/` 首次备份或回退对应 Patch/资产后重新 enhance-only。
- runtime 格式不升 schema version；回退后新增可选 item 字段会被旧代码忽略。
