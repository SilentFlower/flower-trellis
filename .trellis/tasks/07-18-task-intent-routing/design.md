# 技术设计：Trellis Task 意图路由与声明式强化变换

## 1. 设计目标

本任务同时解决两个依赖关系明确的问题：

1. flower-trellis 需要一个可复用、严格失败、幂等的文本变换执行器，才能真正替换 Trellis 原始规则。
2. skill-garden 0.6 使用该执行器发布新的 task 意图路由，并用窄 helper 管理自动 task 的来源、dirty baseline 与安全 discard。

二者作为一个发布单元实现。变换层先完成并通过测试，意图路由再基于它落地；不拆父子任务，避免出现“声明已发布但执行器未发布”或相反的中间状态。

## 2. 边界与职责

| 层 | 职责 | 不负责 |
|---|---|---|
| `src/lib/enhancement-transform.js` | 读取声明、路径校验、preflight、managed marker、备份和写入 | 判断用户自然语言意图 |
| `src/lib/apply-enhancements.js` | 编排 preflight、变换、原有 copy/inject/tweak、最后写 manifest | 解析声明细节 |
| skill-garden `apply-trellis-transforms.py` | 让独立 `install.sh` 消费同一 schema、preflight 与 marker 协议 | 维护另一套声明格式 |
| skill-garden `overrides/transforms/` | 声明目标、锚点、操作和替换文本 | 直接写目标项目 |
| `task_intent.py` | 自动 task 创建标记、Git dirty baseline、安全 discard | LLM 意图分类、实施或归档 |
| workflow / state / skill 文案 | 定义意图优先级、路由边界、切换提示和 helper 调用条件 | 手工解析 JSON、Git porcelain 或 session 文件 |

## 3. 声明式变换协议

### 3.1 目录布局

真实源：

```text
vendor/skill-garden/.trellis/0.6/overrides/transforms/
├── intent-routing.json
├── matches/
│   ├── workflow-request-triage.md
│   ├── workflow-no-task-body.md
│   ├── brainstorm-consent.md
│   └── codex-session-start-no-task.py
└── content/
    ├── workflow-request-triage.md
    ├── workflow-no-task-body.md
    ├── brainstorm-planning-authorization.md
    └── codex-session-start-no-task.py
```

`npm run sync` 已递归复制 `overrides/`，不需要为新子目录增加额外复制分支；`MANIFEST.json` 的 override 统计需要补充 transform 声明和资源文件统计，便于快照审计。

### 3.2 JSON schema

首版只接受受控 JSON，不接受 YAML、脚本或任意正则：

```json
{
  "schemaVersion": 1,
  "id": "intent-routing",
  "aliases": ["workflow-enhancement", "intent-routing"],
  "operations": [
    {
      "id": "workflow-request-triage",
      "operation": "replace",
      "required": true,
      "targets": [
        { "kind": "workflow", "path": ".trellis/workflow.md" }
      ],
      "selector": {
        "source": "matches/workflow-request-triage.md",
        "expectedMatches": 1
      },
      "content": {
        "source": "content/workflow-request-triage.md"
      }
    }
  ]
}
```

字段约束：

- `schemaVersion` 首版固定为 `1`，未知版本直接报错。
- `id` 与 operation `id` 只允许小写字母、数字和连字符，且全声明唯一。
- `operation` 只允许 `insert`、`replace`、`remove`。
- `targets` 必须是显式路径列表；`kind` 只允许 `workflow`、`skill`、`command`、`hook`。
- `markerStyle` 只允许 `html`、`hash`、`slash`；非 hook 默认 `html`，hook 必须显式声明目标语言合法的 style。
- 所有目标路径必须是 POSIX 相对路径，解析后仍位于项目根内；拒绝绝对路径、`..`、空路径和软链逃逸。
- `replace/remove` 使用 `selector.source` 的 UTF-8 字面文本，`expectedMatches` 必须是正整数。
- `insert` 使用字面 `selector.source` 作为锚点，并额外声明 `position: before|after`。
- `replace/insert` 必须声明 `content.source`；`remove` 禁止声明内容。
- `required` 默认 `true`；只有显式 `false` 才允许 anchor mismatch 后跳过。
- `aliases` 接入现有 `--skills` 过滤；全装总是执行，精细安装只执行命中声明。

不引入通配 target、捕获组替换、动态模板变量或任意正则。首版的目标是可审计地修改已知 Trellis 文本，不是通用 patch 语言。

### 3.3 Managed marker

每个已应用操作写入稳定标记：

```text
<!-- BEGIN skill-garden transform workflow-request-triage v0.6 -->
# BEGIN skill-garden transform codex-session-start-no-task v0.6
// BEGIN skill-garden transform javascript-hook-rule v0.6
```

marker 解决三个问题：

- 第二次运行能区分“已应用”与“上游锚点消失”。
- replacement 内容升级时可以按 operation ID 原位更新；非 HTML 目标可把早期 HTML marker 迁移为声明 style。
- `remove` 留下空 tombstone，避免把已成功删除误判为 anchor drift。

同一目标存在 0 个 marker 时按原 selector preflight；存在 1 个时校验并更新 managed block；存在多个、BEGIN/END 不配对或同一 ID 同时出现多种 style 时 required 失败。

### 3.4 Preflight 与 apply

新增两个命名导出，均按项目中文 JSDoc 规范记录参数和返回值：

```js
prepareEnhancementTransforms(target, variantDir, skills)
applyPreparedTransforms(target, plan)
```

`prepareEnhancementTransforms`：

1. 读取并校验所有声明。
2. 对每个已存在目标读取原文；缺失平台入口记录 `missing-target`，不创建文件。
3. 在内存中验证 marker 或 selector 匹配次数并计算 next text。
4. 收集 optional skip；任一 required 错误时汇总后抛出，整个阶段零写入。
5. 返回包含原文、next text、目标路径、状态和诊断信息的不可变计划对象。

`applyPreparedTransforms`：

1. 在任何写入前重新读取全部目标，确认仍与 plan 原文一致；并发漂移则整体停止。
2. 对 changed 文件调用 `preserveFirstBackup()`；备份仍位于 `.trellis/.backup-flower/<target>`。
3. 只写 changed 文件，统一保留单个结尾换行；unchanged 不写盘。
4. 返回 `{changed, unchanged, skipped, targets, backupNotes}`，供编排层输出。

required anchor mismatch 的保证是“preflight 阶段目标零写入”。普通磁盘 I/O 故障不承诺跨多个文件的文件系统事务，但错误会抛到 CLI 顶层，manifest 不会更新，首次备份可用于恢复。

## 4. 强化应用流水线

`applyEnhancements()` 调整为：

1. 解析 variant。
2. **preflight 全部声明式变换**，required 失败立即退出。
3. 应用 prepared transforms。
4. 复制 skill、script、flower assets 和已启用 common skill。
5. 按旧 manifest 精确清理 stale paths。
6. 执行 additive workflow/skill override 与 shared hook override。
7. 执行 Codex/Claude 后处理。
8. **所有 required 步骤成功后**写新 manifest。

这样修复 `src/lib/apply-enhancements.js:98-129` 的提前成功问题。若后续步骤抛错，旧 manifest 仍保留；下一次全装会依据旧 manifest 与新快照重新收敛，不能宣称本轮成功。

`--skills` 精细安装继续不写 manifest、不做 stale cleanup；只执行 aliases 命中的 transform 和原有注入器。

skill-garden 独立安装器对 0.6 采用同一顺序：先解析目标 Trellis 版本与变体 → transform preflight/apply → 复制
`task_intent.py`、common 与 Trellis 强化资产 → additive hub/state。Python consumer 只使用标准库，保持与 JS
consumer 相同的 schema 类型、路径、marker style/迁移、required/optional、首次备份和 changed-only 语义。即使 `--scope all`，required 漂移也必须在 common 复制前失败。

## 5. 现有注入器迁移

### 5.1 Workflow

- hub 仍由 `workflow-inject.js` 插到 `## Phase Index` 后。
- 0.6 的 `no_task` 不再走“新 sentinel + 原 body”模式；其原 body 由 transform 整段替换为短状态守卫。
- `planning`、`planning-inline`、`in_progress`、`in_progress-inline` 暂时保留现有 additive sentinel，避免扩大无关迁移。
- `stripBlocks()` 继续清理历史 hub/state sentinels，但不得删除 `skill-garden transform` marker。
- 0.5/old 逻辑与 legacy constants 保持不变。

### 5.2 Skill 与 command

- `trellis-start` 和 `trellis-brainstorm` 通过显式 transform 修改已存在平台副本。
- `.agents`、`.claude/skills`、`.claude/commands/trellis` 各路径显式列在声明中；不存在的入口按平台缺失跳过。
- `trellis-finish-work` 等既有 additive skill override 继续由 `skill-override-inject.js` 处理，不强制一次性迁移全部旧机制。

### 5.3 SessionStart hook

- Codex/Claude SessionStart 的 no-task 引导通过 `hook` target 执行 required replace，避免会话入口重新注入机械 consent。
- Python hook 显式使用 `markerStyle: "hash"`；应用后必须通过 `python3 -m py_compile`。
- hook 已存在旧 HTML marker 时，consumer 原位迁移为 hash marker；同时存在多种 style 时拒绝继续。

## 6. 意图路由协议

### 6.1 优先级

AI-facing 文案统一使用以下优先级：

1. 当前用户消息中的显式 workflow action 或意图切换。
2. 当前请求已存在的显式切换。
3. 活动 task 状态、请求范围、风险和副作用。
4. 语言意图推断。

compact summary、旧 session 选择和普通偏好只可作为弱上下文，不能覆盖当前用户消息。首版不持久化 session-wide intent preference，以免一次“不要任务”泄漏到新请求。

### 6.2 自动行为

| 意图 | 行为 | 用户可见提示 |
|---|---|---|
| `discuss` | 直接回答 | 无 |
| `inspect` | 执行只读/本地工具动作 | 无 |
| `direct_edit` | 非破坏性本地修改，不记录 task/progress | 首次进入时一行 |
| `task_plan` | 通过 helper 自动创建/标记 task，加载 brainstorm | 一行，可提示“先讨论/不要任务”切换 |
| `workflow_action` | 直接加载对应 skill | 由对应 skill 决定 |

自动 task 只进入 planning。brief、`task.py start`、route、check、push、finish-work 均保持原门禁。

从 planning 切换为 `direct_edit` 时，只有 `meta.intentRouting.autoCreated=true` 的当前请求临时 task 调用 `discard`。手工或历史 task 不删除、不改 metadata，当前请求按 Active Task Scope Guard 走 untracked 路由。

## 7. `task_intent.py` helper

### 7.1 分发与入口

源路径：

```text
vendor/skill-garden/.trellis/0.6/scripts/task_intent.py
```

同步到 `enhancements/0.6/scripts/`，全装时复制为 `.trellis/scripts/task_intent.py`。`copy-scripts.js` 为它增加 `intent-routing`、`task-intent`、`workflow-enhancement` aliases。

首版命令：

```bash
python3 ./.trellis/scripts/task_intent.py create \
  --title "<title>" --slug <slug> [--parent <task>] [--package <pkg>]

python3 ./.trellis/scripts/task_intent.py discard --task <task-ref>
```

默认 stdout 为稳定 JSON，诊断写 stderr；非零退出码表示拒绝或失败。helper 复用 `.trellis/scripts/common/` 的路径、JSON、task resolution 与 active-session API，不手扫自定义目录结构。

### 7.2 Create

`create` 调用现有 `task.py create`，成功后在 `task.json.meta.intentRouting` 写入：

```json
{
  "autoCreated": true,
  "createdAt": "ISO-8601",
  "contextKey": "<session context key>",
  "implementationStarted": false,
  "baseline": {
    "head": "<git HEAD or null>",
    "status": ["<porcelain-v1 -z parsed entries>"]
  }
}
```

baseline 使用 Git porcelain v1 `-z` 结构化解析，保留 staged/unstaged/untracked 和 rename 双路径，不读取或保存 diff 正文。这样能标记规划前已有 dirty 状态，又不会把业务内容复制进 task metadata。

无稳定 session context key 时仍可创建 planning task，但 `contextKey=null`，自动 discard 资格关闭；后续不能猜测“当前请求”，只能要求显式高风险清理。

### 7.3 Discard safety matrix

`discard` 在任何写入前完成全部校验：

| 条件 | 失败原因 |
|---|---|
| task 不在活动 `.trellis/tasks/<name>` 直接子目录、路径穿越或软链逃逸 | `unsafe-task-path` |
| `meta.intentRouting.autoCreated !== true` | `not-auto-created` |
| 无 context key、context 不匹配或该 task 不是当前 session active task | `request-scope-mismatch` |
| `status !== planning` 或 `implementationStarted === true` | `implementation-started` |
| `children/subtasks` 非空 | `has-children` |
| `commit`、`pr_url`、`worktree_path`、progress/legacy progress 非空 | 对应关联工作原因 |
| task 路径已被 Git tracked/staged 或历史 commit 可达 | `task-already-versioned` |
| parent 元数据或父引用无法一致更新 | `parent-link-invalid` |

全部通过后：

1. 如有 parent，先从父 `children/subtasks` 精确移除当前 task，并保留原 parent JSON。
2. 收集并删除所有仍指向该 task 的 session 文件，同时保留每个 session JSON；中途失败恢复已删 session 和 parent。
3. 最后 `shutil.rmtree` 删除精确 task 目录；删除失败时恢复全部 session 和 parent。
4. create 已成功但 intent 元数据读取/写入失败时，复用同一事务补偿删除半成品 task；补偿不完整返回独立 rollback reason。
5. 返回被删除路径、清理 session 数和父引用结果。

discard 不执行 git add/commit，不删除 baseline 中的业务 dirty paths，也不提供 `--force`。不满足安全条件时由更高层明确选择人工清理方案。

## 8. 测试设计

### 8.1 JavaScript

新增 `test/js/enhancement-transform.test.js` 与必要的 apply pipeline 测试，使用临时目录和 Node `node:test`：

- 三种 operation 的首次应用和二次幂等。
- marker 内容升级、HTML→hash style 迁移和 hook 缺失 markerStyle 拒绝。
- required 0/2 次匹配汇总失败，所有目标零写入。
- optional mismatch 结构化 skip。
- marker 损坏/重复、路径穿越、source 越界拒绝。
- 目标缺失平台入口跳过。
- 首次备份只创建一次、非目标文本保留。
- apply pipeline 在 transform preflight 失败时不复制资产、不清 stale、不更新 manifest。
- 全流程成功时 manifest 最后更新。

### 8.2 Python

新增 `test/python/test_task_intent.py`，用临时 Git 仓库与 `unittest`：

- create 标记与 clean/dirty/rename baseline。
- 当前 session auto-created planning task 成功 discard。
- 每个安全条件单独失败且目录、parent、session 均不变。
- parent 引用成功清理；session 或目录删除失败时 session 与 parent 均回滚。
- create 元数据读取/写入失败时半成品 task、parent 与 session 回滚。
- 路径穿越、archive 目录、软链目标拒绝。
- baseline 中业务文件始终保留。

新增 `test/python/test_skill_garden_transforms.py`：

- Python consumer 覆盖 insert/replace/remove、required 零写入与二次幂等。
- 把当前 skill-garden working tree 复制为临时 Git 源，真实运行 `install.sh --repo`。
- 验证 intent helper 同步、旧 no_task additive 不回流、required 漂移发生在资产复制前。

`package.json` 新增：

```json
"test": "node --test test/js/*.test.js && python3 -m unittest discover -s test/python -p 'test_*.py'"
```

## 9. 同步、迁移与发布

这是两个 Git 仓库的有序变更：

1. 在 `vendor/skill-garden` 的 `beta` 分支修改 0.6 源并先完成源仓测试/审查。
2. 提交并推送 skill-garden，取得新 commit。
3. 在 flower-trellis 运行 `npm run sync`，提交执行器、快照、dogfood、测试、spec 与 submodule pin。
4. 用 `scripts/check-snapshot.mjs` 或等价 diff 验证 vendor commit 与快照一致。

不能只修改 `enhancements/0.6` 或 dogfood；也不能在未提交 skill-garden 源时提交一个指向本地脏 submodule 的 flower commit。

升级兼容：

- 旧目标已有 no_task additive sentinel 时，workflow injector 先清旧 sentinel，transform marker 保留，新 body 只出现一次。
- 旧目标已有 skill override 时，现有 strip 逻辑继续清理其管理块；transform 只处理自己声明的 marker。
- 0.5/old 不读取 0.6 transform 声明，行为不变。

## 10. 回滚与故障恢复

- required preflight 失败：无目标写入、manifest 不变，修复声明或升级上游匹配后重试。
- apply 后的普通 I/O 失败：manifest 不更新；使用 `.trellis/.backup-flower/` 首次备份恢复目标，再重跑。
- task discard 被拒：task 与 runtime 保持不变，用户可审阅阻断原因后决定人工处理。
- skill-garden 发布回滚：先回退 flower 的 submodule pin/快照/执行器，再回退 skill-garden commit，保持源与消费方配对。

## 11. Spec 沉淀与上下文预算

### 11.1 独立规范

实现完成后维护两份独立 CLI spec，并在 `.trellis/spec/flower-trellis/cli/index.md` 登记：

1. `trellis-injection-transforms.md`：本设计第 3-5、9-10 节收敛为长期可执行契约，`enhancements-model.md` 只保留流水线摘要与链接，避免同一协议维护两份正文。
2. `ai-context-budget.md`：定义 AI control-plane 注入的分层、总量、测量方法、hard/target 阈值、重复内容禁令和变更评审规则。

### 11.2 基线与预算

2026-07-18 规划阶段基线：

| 对象 | Lines | UTF-8 bytes |
|---|---:|---:|
| `.trellis/workflow.md` | 902 | 56,635 |
| 0.6 workflow hub | 127 | 10,757 |
| 五个 0.6 workflow-state 源合计 | 61 | 8,546 |
| `get_context.py --mode phase` | 260 | 17,935 |
| 当前 SessionStart 样本 | 257 | 17,841 |

修复批次完成后的 checker 参考值：完整 workflow `59,521` bytes / 941 lines，hub `12,022` / 149，当前四个 additive state 合计 `7,827` / 54，Phase summary `20,117` / 289，SessionStart `19,446` / 281。hub、Phase summary 和 SessionStart 为 warning，但均未超过 review ceiling；不调整阈值。

建议首版预算；`review ceiling` 是高等级告警阈值，不是默认测试失败线：

| 层 | Target | Review ceiling |
|---|---:|---:|
| 完整 `.trellis/workflow.md` | 60 KiB | 64 KiB |
| 0.6 hub | 11 KiB | 12 KiB |
| 单个 workflow-state | 2.5 KiB | 3 KiB |
| 当前 additive workflow-state 合计 | 9 KiB | 10 KiB |
| Phase summary | 18 KiB | 20 KiB |
| SessionStart control-plane 总输出 | 18 KiB | 20 KiB |

UTF-8 bytes 是硬指标，行数作为诊断信息。模型 tokenizer 会变化，不能把估算 token 数作为可复现 CI 门禁。

### 11.3 Checker

新增 `scripts/check-ai-context-budget.mjs`，使用命名导出提供可测试的测量函数，并支持直接执行：

```bash
node scripts/check-ai-context-budget.mjs
```

输出每一层的 actual / target / review ceiling：

- `actual <= target`：通过。
- `target < actual <= review ceiling`：打印 warning，要求评审说明增长来源，默认退出成功。
- `actual > review ceiling`：打印 high warning 和超出差异，默认仍退出成功。
- 只有测量失败、fixture 损坏、目标缺失或输出不可解析等结构性错误默认非零退出。
- 显式 `--strict` 时，超过 review ceiling 才非零退出；该模式供发布审计按需使用，不接入默认 `npm test` 大小门禁。

SessionStart 必须使用固定 fixture 调用真实 hook/extractor，不能只把源文件 bytes 相加；这样能捕获摘要器、state 选择和 wrapper 元数据导致的总量增长。

### 11.4 去重规则

- workflow hub 只放跨阶段不可丢失的门禁。
- workflow-state 只放当前状态的一跳动作和禁止事项。
- skill 放低频完整流程、选项和用户交互模板。
- helper 放解析、校验、状态读写和错误分支。
- 同一规则需要跨层出现时，上层只能保留一句边界和指向，不能复制整段正文。
- 新增任何高频注入前必须先检查能否替换旧文本；默认禁止“旧规则保留 + 新高优先级段继续追加”。
