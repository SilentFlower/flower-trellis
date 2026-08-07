# Brief — 优化 Check-All 判定与上下文体量

## Goal

- 在不削弱 Check-All 审计门禁的前提下，提高低风险变更命中 light 的稳定性，保留真实兜底问题的 FBK 分类，并允许窄范围、可唯一验证的源码注释事实自动修复，同时确保默认必读上下文不增长。

## Scope

- 用实际行为契约影响替换 workflow、skill、hook、快照等载体或主题域直接触发 hard-full 的规则。
- 保留公共契约、状态与数据、安全与时序、发布或 Git 控制门禁、独立行为边界、未知影响和 full 重检等行为性 full 信号。
- 将 FBK 根因分类与验证完备度解耦：具体位置、可达异常场景和保护缺口证据是硬准入；保护收益与验证方式继续报告，环境不足时保留 FBK ID 并标记部分验证。
- 在现有 `DOC-*` 中增加源码注释事实子类型，覆盖可唯一证明的机械引用，以及由本轮 diff 与规划/测试共同证明为有意变化的局部常量、默认值、次数、超时和内部实现机制。
- 新增条件加载的注释自动修复 reference；深度和 FBK 规则原位替换，统一报告结构不新增平行通道。
- 增加 Check-All 专项字节预算、深度路由、FBK、注释白名单/黑名单、分发一致性和 dogfood 幂等测试。

## Non-Goals

- 不改变 Check-All 三维检查顺序、interactive/auto-loop 处置流程、风险接受或 Git 提交门禁。
- 不自动修复普通代码、配置、测试、迁移、行为契约、业务语义或安全边界。
- 不新增 finding 编号体系、持久化状态、独立 depth router 或重复报告区。
- 不调整 0.5、old 变体或上游原生 `trellis-check`。

## Key Decisions

- hard-full 只由行为契约变化或无法闭合的影响面触发；文件载体和主题域本身不再决定 full。
- 同一真实源的多个机械投影视为一个闭合语义范围；范围可穷举且有定向验证的局部行为允许 light。
- FBK 不要求异常已经实际发生，也不因缺少运行环境而失去分类；部分验证仍阻断 strict pass。
- interactive 与 validated auto-loop 都允许主会话落地注释事实修复；专用 Check-All subagent 永远只返回候选。
- 自动修复只替换具体事实片段，不整句润色或删除注释；公共 API Javadoc/docstring、公开行为契约、Why、业务/安全语义和工具指令始终排除。
- 源码注释修复不使用 runner 的 `--doc-remediation-file`；修复后必须重读最终 diff、重算范围、复核画像并重跑定向验证。
- 主 `SKILL.md` 不超过当前 7,916 bytes；默认必读集合不超过当前 39,696 bytes。新增注释细则只在候选命中时加载，不提高任何全局预算阈值。

## Key Context

- canonical 源：`vendor/skill-garden/.trellis/0.6/.agents` 与对应 `.claude` Check-All、route agent 和必要的 Phase 2 owner。
- 分发顺序：canonical 源 → `npm run patch:targets` → `npm run sync` → 当前 dogfood enhance-only 更新；第二次 dogfood 应为零额外修改。
- 现有全局预算 checker 不单独统计 Check-All，需增加专项 UTF-8 字节预算测试。
- 规划上下文已整理到 `research/current-check-all-contracts.md`，`implement.jsonl` 与 `check.jsonl` 均通过 `task.py validate`。

## Risks / Deferred

- light 误判通过“未知影响继续 full”和 light 中单向升级控制。
- 注释误修通过事实白名单、局部事实双重证据、语义黑名单、片段级替换、主会话复核和最终 diff/验证控制；无法唯一判断时转普通 finding。
- FBK 噪声通过具体位置、可达场景和缺口证据三项硬门槛控制。
- 默认必读集合超过 39,696 bytes 时必须先去重或替换旧文本，不得提高预算或继续同步派生产物。

## Acceptance

- 约定的 skill 错别字、workflow 解释文字、机械投影同步和局部可验证行为稳定命中 light；门禁顺序、hook 状态、CLI/持久化契约和未知影响稳定命中 full。
- 静态可达但未实际复现、或暂缺验证环境的真实保护缺口仍生成稳定 `FBK-*`；泛化建议仍不报告。
- 只有可唯一验证的机械引用和局部实现事实注释漂移可自动修复；公共 API Javadoc/docstring、行为契约、Why、业务/安全语义、工具指令和可执行示例保持 audit-only。
- 注释修复只产生注释文本 diff，并复用现有 `DOC-*` 区展示修复与验证结果。
- 主入口与默认必读集合不超过基线；默认、strict 和专项预算检查均通过且未调整阈值。
- canonical agents/claude、compiled targets、`enhancements/0.6` 和当前 dogfood 保持一致，相关定向测试、`npm test` 与 diff 检查通过。

## Next Step

- Full Check-All 已通过；等待用户回复继续，进入 `trellis-update-spec`。
