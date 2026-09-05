# Trellis Check-All 结果

[通过] 3 个维度 · CHK 0 · FBK 0 · 自动修复 DOC 2 · P0 0 / P1 0 / P2 0

- 工作：Codex / Claude SessionStart 分段注入与额度保留。
- 范围：Flower 分段资产、平台 Adapter / catalog、Plugin 内容投影、预算测量、回归、本项目受管生成配置和任务记录。初始外部 Plugin 变更不属于本任务；同步前后其声明、lock、state 和文件摘要一致。
- 画像：requested=auto · effective=full · confidence=high；配置迁移与并发执行行为变化。
- 结论：源码、配置、真实安装链和回归通过；宿主新会话的实际模型接收留作下述会话验证，不声称已经验证模型遵循工作流。

## 维度结果

| 维度 | 状态 | 验证 |
| --- | --- | --- |
| 三件套实现 | 通过 | R1–R6 / AC1–AC6 均映射到源码、安装链和定向测试；真实宿主接收按规划的验证边界单独记录 |
| 实现假设 | 通过 | 原生生成器签名、标准 JSON 通道、历史额度继承、并行无顺序依赖、绑定只由 state 执行；官方文档核对宿主按 handler 接收规则 |
| 完整性与规范 | 通过 | 全量测试、语法、真实 CLI、预算、打包、受管产物和重复生成检查通过 |

## 验收映射

| 条目 | 实现 / 证据 |
| --- | --- |
| R1 / AC1 | src/assets/flower_session_start.py；Codex / Claude 平台 Patch 分别注册 state、rules、stages；test/js/apply-enhancements.test.js 验证最终安装配置 |
| R2 / AC1 | matcher=startup\|clear\|compact；旧含 resume 分组迁移清理；Flower 更新检查仍独立匹配 startup；隔离目标执行四种 source 逐项验证 |
| R3 / AC2 / AC3 | 原生 state 输出移除完整 trellis-workflow 块，规则摘要在 Planning Artifacts 章节前无损拆分；并行测试拼回正文与原文相等；rules/stages 不调用 native main；Claude 环境文件绑定去重 |
| R4 / AC4 | Adapter 保留原单 handler 和分段独立 additionalContextLimit；覆盖 5000、6000、0、缺省、冲突和非法输入；真实 update 后 [5000,6000,0] 保留 |
| R5 / AC6 | builtin content-adapter 投影独占资产；统一 Plugin 事务应用；本项目仅三个目标变化，再次 dry-run 为 0；npm pack 包含源资产与 Claude Patch |
| R6 / AC5 | 缺少原生文件、损坏 Python、非 JSON 输出、缺少章节边界均输出可见诊断；超限保留尾部正文并告警；预算 checker 拒绝错误诊断充当成功上下文 |
| AC6 | 源资产与 .trellis/scripts 生成副本逐字一致；预算事实文档同步；Skill-Garden 子仓与 enhancements 快照没有内容漂移 |

## 输出大小

隔离真实 init 安装后的实际 handler 输出，startup / clear / compact 均成功，resume 无输出：

| 平台 | 分段 | 字符 | UTF-8 bytes | o200k_base tokens（辅助测量） |
| --- | --- | ---: | ---: | ---: |
| Codex | state | 2044 | 2046 | 448 |
| Codex | rules | 6791 | 6807 | 1482 |
| Codex | stages | 5013 | 5036 | 1202 |
| Claude | state | 2051 | 2053 | 450 |
| Claude | rules | 6791 | 6807 | 1482 |
| Claude | stages | 5013 | 5036 | 1202 |

state 随开发者、任务、工作区等变化；预算 checker 的无任务 fixture 为 Codex 1950 / Claude 1957 字符。两端 rules / stages 使用同一份 workflow，测量相同。所有当前分段小于 8000 字符。

本项目 Codex 三段均继承 additionalContextLimit=5000；全新安装未主动设置该字段。o200k_base 是本地辅助计数，不等于宿主实际 token 估算或模型接收证据。Codex 默认近似 2500 tokens、按 handler 独立限制及 0 的含义已对照[官方文档](https://learn.chatgpt.com/docs/hooks#large-hook-output)；Claude 单值 10000 字符及多个值全部交付已对照[官方文档](https://code.claude.com/docs/en/hooks#add-context-for-claude)。

## 已执行验证

- npm test：退出 0，519 个 JavaScript 测试、318 个 Python 测试通过。
- Patch 冲突检查：48 个 Patch、142 个 operation、915 个 ready target，warning 0。
- canonical compiled targets：839 个文件、419 个变更 target，无漂移；输出模板 27 个 skill 检查通过。
- node scripts/check-ai-context-budget.mjs 及 --strict：退出 0。既有 states-total=13119 bytes 为 warn，低于 review ceiling=14336；本任务未改状态正文或原字节阈值。
- 修改的 7 个 ESM 模块和 3 个 Python 文件语法通过；git diff --check 通过。
- npm run sync：仅产生 syncedAt 更新时间，已清除该无关差异，源快照内容一致。
- npm pack --dry-run --json：分段资产和新增 Claude catalog 文件均包含在包内。
- 隔离 /tmp 目标真实 init 成功；完整 update dry-run、实际 enhance-only update、uninstall dry-run 成功；自定义分段额度保留。
- 当前项目受管 enhance-only update：新增分段脚本、更新两份启动配置；再次 dry-run 变化 0；外部 Plugin 内容和安装态一致。

## 自动修复

| ID | 类型 | 文件 | 修复 / 验证 |
| --- | --- | --- | --- |
| DOC-001 | fact-status | .trellis/spec/flower-trellis/cli/ai-context-budget.md | 测量对象从 Codex 单份输出同步为两平台三段输出、实际字符指标和最大平台合计；与 checker 和回归输出核对 |
| DOC-002 | implementation-note / brief-stale / check-record | 本任务 implement.md、brief.md、check-report.md | 同步已完成步骤、当前阶段和真实验证边界；重读并核对命令结果 |

## 未覆盖与风险

- [上线后验证：宿主新会话] 在项目根目录新建 Codex / Claude 会话，核对宿主 hook 日志或会话上下文是否包含三份 trellis-session-part，且无超长输出落盘预览。由实际宿主使用者执行；本轮没有发起额外模型请求，未伪报已经观察到真实接收。
- Codex 对新建或变更的非 managed hook 可能要求用户在 /hooks 信任当前定义；需要时先完成宿主复核，再新建会话观察 startup 注入。[官方信任规则](https://learn.chatgpt.com/docs/hooks#review-and-trust-hooks)。本任务不代写信任记录。
- resume 按设计不补注入，观察新效果应使用新会话；旧会话已有内容不会因本次文件变更自动替换。
- 实际 Windows 宿主未运行；已有 python / py -3 生成及重复安装回归通过。CLI 继承现有在项目根目录执行的相对路径约定。

## 下一步

先观察新会话效果。普通交互在本次 Check-All 后停止；用户回复继续后进入 trellis-update-spec，再由后续 owner 处理提交计划。本任务未提交或推送。
