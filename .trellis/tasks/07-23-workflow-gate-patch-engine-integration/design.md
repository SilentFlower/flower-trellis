# Design — Workflow Hub Gate 原生流程融合

## Architecture

本任务不扩展 Patch Engine schema。Patch Engine 继续负责对最终 Trellis 的 workflow、state、skill、hook 和 helper 执行结构化 `replace/insert/remove`；Gate 的“深度融合”通过重分配内容所有权实现。

```text
Hub 完整 Gate 正文
        |
        v
owner inventory -> Patch 到 owning phase/skill/state/helper
        |
        +-> deterministic condition -> existing runtime helper hard guard
        |
        +-> semantic decision -> owning policy contract
        |
        v
Hub replace 为短 owner index + cross-stage order
```

## Ownership Model

每个 Gate 分成三层：

1. `primary policy owner`：保存完整语义、交互边界和异常处理。
2. `runtime owner`：只保存可确定性验证的状态、参数、读写和错误码；没有可靠判定时为空。
3. `hub residue`：只保存跨阶段必须常驻的一句边界或 owner 指针。

完整映射见 `research/owner-matrix.md`。同一规则不得在两个 primary owner 中重复。

## Patch Organization

继续使用目标导向目录：

```text
overrides/patches/
├── workflow/
│   ├── hub/                         # replace 为轻量 owner index
│   ├── phase-ownership/             # Phase 1/2/3 owner 短契约
│   └── states-*/                    # 当前状态一跳动作
├── skills/
│   ├── trellis-start/<feature>/
│   ├── trellis-brainstorm/<feature>/
│   ├── trellis-task-brief/<feature>/
│   ├── trellis-route/<feature>/
│   ├── trellis-check-all/<feature>/
│   ├── trellis-push/<feature>/
│   ├── trellis-auto-loop/<feature>/
│   └── trellis-finish-work/<feature>/
├── hooks/<platform>/<feature>/
└── scripts/<helper>/<feature>/
```

优先扩展现有 Patch，避免为同一 target/section 创建第二个 owner。operation ID 已存在时保持稳定。

## Runtime Enforcement Boundary

允许硬阻断：

- task 状态、brief 文件存在性/新鲜度、JSONL readiness。
- route target/task/context 匹配。
- auto-loop run/action/profile/task 和 record 顺序。
- Git staged/conflict/branch/upstream/exact path 状态。
- archive/journal exact paths、task progress schema。
- update CLI 是否收到所需确认参数。

禁止硬编码：

- 需求是否清晰、请求是否与当前任务语义相关。
- 是否值得更新 spec、用户是否真正表达某类产品意图。
- 需要读取自然语言和业务上下文才能判断的风险分类。

这些判断保留在 owning skill/phase，runtime helper 只接收判断后的明确动作。

## Hub Migration

`workflow/hub` 从 `insert` 的大段控制正文迁移为受 baseline 保护的轻量内容。Hub 只保留：

- 13 个 owner 的短索引。
- Request entry、auto-loop-before-interactive-stop、check-to-spec-to-push、finish-work-after-Phase-3.4 等跨阶段顺序。
- “完整规则读取 owning skill/helper”的统一机械规则。

Hub 不保留 fallback 选项、命令参数、JSON schema、报告模板、Git path 规则和错误矩阵。

## Compatibility

- 冻结迁移前的正常场景输出与状态变化，不以全文字节相等为目标，因为 Hub 会主动缩短、owner 会获得内容。
- 行为兼容比较使用场景矩阵：输入、当前 task/runtime/Git 状态、预期 owner/action、确认次数和最终状态。
- 明确允许的变化只有：Hub 体积下降、owner 内容补齐、确定性非法路径更早失败。
- full 与精细 alias 必须安装其 owner 所需的自包含 Patch；不增加新资产选择协议。

## Conflict Resolution

冲突按最终产物而不是 Patch 源文件判断：

1. 建立 `gate -> existing locations -> chosen owner -> removal/replacement` 清单。
2. 对同一 section 的多个 Patch 优先合并到现有 owner operation；不能合并时声明明确顺序并证明最终结果唯一。
3. 对 Hub、state、phase、skill 中的同义正文，保留 primary owner 全文，其他层改为一句指向或直接删除。
4. 对语义矛盾规则，按已确认目标行为选择唯一规则；不使用“高优先级覆盖旧正文”维持双轨。
5. 对 runtime/policy 不一致，runtime 只接受 owning policy 已明确授权的动作，并拒绝超出参数、task、profile、文件或 Git 状态边界的调用。
6. 在 `conflicts.json` 增加最终文件的 `required-literal`、`absent-literal`、`max-occurrences` 断言，覆盖 owner marker、旧冲突签名和跨阶段顺序。

冲突处理必须保留上游非冲突内容和用户自定义内容；selector/baseline 无法唯一定位时 preflight 失败，不做模糊追加。

## Validation Strategy

- 静态 owner coverage：13 个 Gate 全覆盖、primary owner 唯一、Hub 禁止完整正文签名。
- 冲突收敛：每项旧规则都有 chosen owner 和 remove/replace 证据，最终文件同时验证新 owner 必需签名与旧冲突签名缺失。
- Patch coverage：新增/移动 operation 有 baseline、marker、conflict assertion 和 JS/Python consumer 覆盖。
- Runtime tests：分别覆盖合法路径、非法状态硬阻断、零副作用和重复执行。
- Scenario parity：覆盖 planning、implement/check、interactive continuation、auto-loop、ordinary push、commit-only、finish-work、progress recovery、Flower update。
- Context budget：最终 workflow/Hub/state/Phase summary/SessionStart 全部测量，Hub 与 control-context 应下降。

## Rollback

- 每个 owner 迁移保持独立 Patch operation，可按 Gate/owner 回退。
- Hub replace 必须接受迁移前完整 Hub baseline；回滚时恢复旧 Hub content 与对应 owner Patch。
- 不新增持久 schema，因此回滚不需要状态迁移或清理用户项目数据。
