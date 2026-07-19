# 当前注入冲突盘点

## 1. 对照源

- 上游 Trellis 0.6.5：`node_modules/@mindfoldhq/trellis/dist/templates/`。
- Skill-Garden Patch 源：`vendor/skill-garden/.trellis/0.6/overrides/patches/`。
- Flower 平台 Patch：`src/patches/platforms/`。
- 当前最终产物：`.trellis/workflow.md`、`.agents/skills/`、`.claude/skills/`、`.claude/commands/trellis/`、`.codex/`。

盘点单位固定为“上游原文 → Patch operation/selector/content → 最终 dogfood 结果”。

## 2. 已确认阻断级冲突候选

### C-WF-001：统一 Route Gate 与上游直接执行路径并存

- Hub `.trellis/workflow.md:235-247` 要求 Phase 2.1/2.2 先取得有效 `route_decision`。
- 上游 `Active Task Routing` 最终仍在 `.trellis/workflow.md:457-475` 直接要求 dispatch implement/check 或进入 before-dev/check。
- 上游 Phase 2.1 walkthrough `.trellis/workflow.md:673-725` 继续按平台直接 spawn subagent 或 inline 实现，没有先进入 `trellis-route`。
- 当前依赖 Hub 的“overrides lower”声明压制下层路径，属于真实所有权冲突。

### C-WF-002：Check-All audit-only 与上游自动修复检查并存

- Skill-Garden 统一入口要求 Phase 2.2 进入 Check-All，检查阶段只读、统一收集问题，用户确认后才修复。
- 上游 Phase 2.2 `.trellis/workflow.md:727-754` 仍要求 `trellis-check`/check subagent 自动修复并循环到 green。
- 两条路径的停止边界、问题报告和修改授权相反，必须精确替换下层 walkthrough，不能只提高 Hub 优先级。

### C-WF-003：Trellis Push 与上游 local-only Phase 3.4 并存

- Hub `.trellis/workflow.md:261-271` 要求 Phase 3.4 唯一进入 `trellis-push`，普通模式默认 exact commit + push。
- 上游 Phase 3.4 `.trellis/workflow.md:788-838` 自己生成 `Proposed commits`、直接运行本地 commit，并明确 `Never push`。
- Hub `.trellis/workflow.md:267` 当前明确写“fully supersedes lower walkthrough”，证明最终文件仍保留两套互斥协议。

## 3. 评审级重复/所有权候选

### C-WF-004：Update-Spec 去向在 Hub、State 和 Phase 3.3 重复

- Update-Spec Skill 已用 section replace 删除 `Interactive Mode`，自主三态协议只在最终 Skill 中完整保存。
- Hub、两个 in-progress state 和 Phase 3.3 仍分别保存 Update-Spec 去向。
- State 的一跳提示可能合理；Phase 3.3 的“review whether”需要核对是否会重新引入询问语义，或只保留为加载 Skill 的指向。

### C-WF-005：运行态重复 Hub 门禁

- `in_progress` 与 `in_progress-inline` 各重复 Task Brief、scope guard、spec discovery、route、post-check、push、finish-work 等一跳规则。
- 这些内容由 SessionStart 按状态注入，不能全部删除；需要以“失去该句是否会让当前状态走错下一跳”为标准逐条保留。
- 完整协议只能保留在 Hub/Skill，State 不得复制字段矩阵、命令模板或详细错误规则。

## 4. 已由当前 Patch Engine 解决的冲突

- `workflow-state`：五个 state 使用完整 body replace，不再保留“新 Guard + 上游旧 body”。
- Update-Spec：替换上游 `## Interactive Mode`，保留其余 code-spec 模板。
- Finish-Work：保留 frontmatter，document body 完整替换，旧 Step 1-4 不再并列。
- Start/Brainstorm：对上游明确字面段执行 replace，没有顶部 additive 覆盖。
- shared Hook：whole-file fingerprint replace；平台 JSON/YAML/TOML 使用结构化 Adapter。

这些项目仍需进入回归矩阵，但不应因为历史上发生过冲突就继续扩大 Patch 所有权。

## 5. 版本兼容风险

- `src/lib/variant.js` 把 `minor >= 6` 或 `major >= 1` 都映射到 `0.6` catalog。
- 当前依赖与集成 fixture 只覆盖 Trellis 0.6.5。
- selector 未漂移不代表新 minor/major 的语义仍兼容，因此需要 baseline 版本登记和未审核版本分级策略。

## 6. 初步处理方向

- C-WF-001/002/003：阻断级，使用 Markdown section/平台块等结构化 selector 替换上游 walkthrough，最终文件不得保留覆盖式声明。
- C-WF-004/005：评审级，按职责和上下文预算去重；无法证明可删除时保留短一跳，不做整段清空。
- Skill/Hook/配置：以当前已解决状态为 baseline，增加回归断言；只有发现新的三方矛盾才扩大修改范围。

## 7. 实施后裁决

| 编号 | 裁决 | 最终所有权 | 回归证据 |
|---|---|---|---|
| C-WF-001 | 已消除 | Active Task Routing 与 Phase 2.1/2.2 只进入 `trellis-route`；inline/subagent 由 route 结果决定 | `workflow-no-direct-dispatch-routing`、`workflow-no-direct-implement-walkthrough`、required route pointer |
| C-WF-002 | 已消除 | Phase 2.2 进入 audit-only `trellis-check-all`；修复需统一报告后的授权 | `workflow-no-auto-fix-check` 与集成反向断言 |
| C-WF-003 | 已消除 | Phase 3.4 只进入 `trellis-push`；普通模式 commit + push | `workflow-no-local-only-commit`、required finish pointer 与集成反向断言 |
| C-WF-004 | 已收敛 | Phase 3.3 保存一跳和三态去向，Update-Spec Skill 保存完整判断协议；State 只保存 check 后续分支 | 最终 Phase marker 与上下文预算 |
| C-WF-005 | 已收敛 | State 删除 spec-router 通则、Git/progress 细节和“Hub source of truth”重复，只保留当前回合动作 | states-total 从 8,546 B 降至 5,226 B |

当前 catalog 覆盖结论：Skill-Garden 20 个 Patch + Flower 4 个 Patch，共 78 个 target，实际使用 `workflow / skill / command / hook / file / json / yaml / toml` 8 种 target kind。pinned 0.6.5 全平台 fixture 为 69 ready、9 missing-target、0 warning、0 error；missing-target 仅计 info。

## 8. Check-All 修复记录

| Check | 根因 | 修复 |
|---|---|---|
| CHK-001 | warning 在 apply 后输出且缺 evidence，Skill-only 路径会吞 warning | JS/Python 在写入前输出完整 diagnostic；维护者脚本复用 JS formatter；新增时序、evidence 和 Skill-only 测试 |
| CHK-002 | policy operation/target 引用没有绑定 catalog | Patch plan 增加全 catalog `catalogOperations`；JS/Python evaluator 对未知 operation 和错误 target 结构失败 |
| CHK-003 | Phase 正向断言会被 Hub/State 的裸指针误满足 | required-literal 改为 managed marker + heading + 首句的 section 唯一签名 |
| CHK-004 | 已删除的 State Hub 句仍允许出现两次 | `max-occurrences` 从 2 改为 0，任一回流即 warning |
| CHK-005 | 维护者脚本直调 `.bin/trellis` 不兼容 Windows | 复用 `resolveTrellisBin()`，以 `process.execPath` 启动包内 JS bin |
| CHK-006 | Python `bool` 被 `isinstance(..., int)` 接受 | Python 显式拒绝 bool；两端同时校验 variant/line、完整且不重复的 tested semver、规则/operation ID |
| CHK-007 | 真实 0.7+ 结构漂移会先触发旧 baseline 预检，掩盖 unsupported 与 `--no-enhance` 指引 | JS/Python 在 prepare 前先阻断 invalid/unsupported；同线 warning 仍等完整 preflight/conflict 通过后展示；用漂移 0.7 fixture 回归 |
| CHK-008 | JS conflict target 校验未按 Windows 路径语义拒绝 drive path，与 Python policy loader 不一致 | JS 同时使用 POSIX/Windows path 语义并拒绝 drive root；两端新增 `C:/outside.md` 结构测试 |
| CHK-009 | 维护者摘要把 69 个 ready target 误标为 operation 数 | checker 单独统计声明 operation 与 target，校验 `catalogOperations` 全覆盖，并分别输出 operation/ready target |
