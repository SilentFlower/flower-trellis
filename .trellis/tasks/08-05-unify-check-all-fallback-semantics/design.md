# 技术设计：Check-All 兜底通道

## 1. 设计目标

把问题的“根因性质”与“处置是否可选”解耦。新模型不再提供可选问题通道，而是让 Check-All 对所有有证据的问题统一进入修复循环，并通过 ID 前缀说明根因属于主路径问题还是兜底问题。

```text
发现候选
  ├─ 主路径逻辑、非兜底契约、验证或数据流问题 -> CHK-*
  ├─ fail-closed、异常输入、失败降级、防御性保护缺口 -> FBK-*
  ├─ 白名单内低风险任务文档漂移 -> DOC-*
  └─ 纯偏好、无具体场景或无可验证收益 -> 不报告
```

`CHK-*` 与 `FBK-*` 都是修复项。分类只表达问题性质，不表达“必修/可选”；两类问题均按实际影响分配 P0/P1/P2。

## 2. 单一真实源与同步链

真实源继续位于：

```text
vendor/skill-garden/.trellis/0.6
        │
        ├── .agents / .claude skills 与 agent body
        ├── workflow Phase 2.2 Patch
        └── npm run sync
                │
                └── enhancements/0.6
                        │
                        └── 项目 dogfood update 投影
```

手工语义编辑只发生在 skill-garden 真实源、Flower 自有测试和项目规范。`npm run sync` 只重建 `enhancements/0.6`；当前 dogfood 副本再通过既有项目 update 投影链生成，避免多份正文独立漂移。

## 3. 分类契约

### 3.1 `CHK-*`

用于主路径或一般实现问题：

- 功能逻辑错误、需求/公开契约的非兜底违背；
- lint、typecheck、测试失败或缺失必需测试；
- 真实数据流断点、兼容性错误、发布或集成阻塞；
- 无法归入具体兜底场景的安全、数据或权限问题。

字段保持标题、来源、证据、影响、建议、位置、验证，并分配 P0/P1/P2。

### 3.2 `FBK-*`

用于保护路径问题：

- fail-closed 未实现、失效或被绕过；
- 异常、畸形、缺失、重复或冲突输入没有按声明边界处理；
- 外部依赖、读取、解析或平台能力失败时缺少受控降级；
- 防御性权限、隐私、数据完整性或删除保护缺口；
- 有具体场景和验证方式的容错、可观测性兜底缺口。

字段为标题、来源、证据、兜底场景、影响、保护收益、建议、位置、验证，并分配 P0/P1/P2。契约是否明确只影响证据和严重度，不改变 `FBK-*` 归属。

### 3.3 `DOC-*`

保持当前自动修复模型，不改变编号、白名单、黑名单和主会话写入责任。自动修复失败或越界时，根据根因转为 `CHK-*` 或 `FBK-*`，不能再转成 `OPT-*`。

## 4. 报告与修复语义

统一摘要：

```text
[通过/未通过/阻塞] 3 个维度 · CHK N · FBK N · 自动修复 DOC N · P0 N / P1 N / P2 N
```

报告顺序保持稳定：总体摘要、维度结果、DOC 自动修复、CHK 问题、FBK 兜底问题、未覆盖与风险、统一修复批次、下一步。

统一操作：

```text
修复全部
修复 CHK-001,FBK-002
仅保留报告
```

`修复全部` 包含所有 CHK/FBK，不再存在“仅 CHK”或“全部可选项”。修复结果分别显示 CHK/FBK 完成数和剩余数。

## 5. 完成链状态

```text
remaining CHK > 0 or remaining FBK > 0
  -> interactive: 停在一次修复范围选择
  -> untracked: stage=implement
  -> auto-loop: record failed -> fix/recheck
  -> direct Git / Update-Spec / Push: 不满足 strict pass

remaining CHK = 0 and remaining FBK = 0
  -> 继续现有严格通过路径
```

这会删除上一模型中 optional-only 的特殊通过分支，使 interactive、auto-loop、untracked、workflow 和 push 使用同一个判定式。

## 6. 文件与所有权

- `trellis-check-all/SKILL.md`：入口、三通道模型、修复和 disposition 总边界。
- `references/fallback-findings.md`：替代 `optional-findings.md`，拥有 CHK/FBK 分类与准入规则。
- `references/reporting-and-disposition.md`：报告模板、修复循环、auto-loop、interactive stop gate。
- `light-profile.md` / `full-profile.md` / `document-drift-auto-remediation.md`：消费新分类文件和 strict pass 判定。
- `trellis-route` 与 `check-all-agent-body.md`：subagent 返回 CHK/FBK/DOC。
- workflow Phase 2.2 Patch：检查阶段与 direct Git 的统一阻断条件。
- `trellis-push`：完成链证据和风险区识别未解决 CHK/FBK。
- `.trellis/spec/flower-trellis/cli/enhancements-model.md`：记录跨 owner 的长期契约。
- `test/js/check-all-fallback-findings.test.js`：替代 optional 测试，覆盖源、快照、dogfood 和跨 owner 语义。

## 7. 兼容与迁移

- findings 不持久化，`OPT-*` 没有磁盘迁移需求；新 Check-All 运行直接生成 `FBK-*`。
- 当前修复/重检循环若仍引用历史 `OPT-*`，本任务发布后必须重新执行 Check-All，不尝试把旧 ID 静默映射到新 ID。
- 0.5 与 old 保持原样；只更新 0.6 源、快照和当前 dogfood。
- 删除 `optional-findings.md` 后必须验证所有 source、snapshot、dogfood 和测试引用均已改为 `fallback-findings.md`。

## 8. 风险与控制

- 最大风险是把泛化“更健壮”建议变成阻断项。通过具体场景、证据、保护收益和验证方式四项准入条件控制；不满足时不报告。
- 第二风险是只改 Check-All 报告但遗漏 auto-loop、untracked 或 push，造成不同完成链结论。通过跨 owner 静态断言和完整快照测试控制。
- 第三风险是源、快照和 dogfood 漂移。只编辑真实源，使用同步脚本生成投影，并逐路径比较。

## 9. 未采用方案

- 不保留 `OPT-*` 并仅改名为“兜底”：仍会保留可选授权和 optional-only 通过分支，未解决用户提出的语义冲突。
- 不把所有兜底缺口继续放入 `CHK-*`：无法在报告中稳定表达问题性质，也会重复出现“这算不算兜底”的争议。
- 不新增独立运行时 findings 文件：本任务只调整报告与处置契约，没有跨会话持久化需求。
