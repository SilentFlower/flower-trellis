# 升级链路性能诊断与优化

## Goal

缩短 Flower 新版本升级与 `ftl update` 中可避免的等待，让用户看得出耗时发生在哪个阶段；同一底层逻辑的相邻入口同步获益，保留升级正确性、配置保留与失败恢复能力。

## Background

用户报告新版本更新、`ftl update` 及相似操作很慢，缺少用户机器上的阶段数据。2026-09-17 的 Linux 研究已确认：

- Flower 自动检查每次读取完整 npm metadata；本次响应体 314127 字节，独立 dist-tags 仅 40 字节。证据：`src/lib/update-check.js:94`、`:124`、`:456`。
- self-check 已使用 interval 缓存，但 init/update 的 checkForUpdate 未复用。证据：`src/lib/self-check.js:41`、`:652`，`src/commands/init.js:84`。
- 捆绑 Trellis update 还会先等待独立 npm latest 查询，没有显式业务超时。隔离 A/B 中跳过它使预演中位数从 1360ms 变为 464ms；原有处理仅改写收到的提示，未消除等待。证据：`node_modules/@mindfoldhq/trellis/dist/commands/update.js:932`、`:1598`，`src/lib/trellis-runner.js:97`。
- 全局同步会启动 npm prefix 与 trellis --version；相同版本会跳过安装，因此不是“每次都重装”。self-update 安装的 postinstall 和项目 update 均会核对全局版本。证据：`src/lib/global-trellis-sync.js:59`、`:95`、`:132`，`scripts/sync-global-trellis.mjs:11`，`src/commands/self-update.js:210`、`:219`。
- 本地插件预演为 207–353ms；快照加沙箱物化单次 456ms。本轮证据不足以要求重构事务/摘要算法。原始记录、限制与复现方法见 `research/baseline.md`。

## Requirements

### R1：可解释的阶段耗时

用户可显式启用本地诊断，区分预检、全局包安装、全局 Trellis 同步、快照、上游更新、Plugin 重放、恢复/清理的开始、结束和耗时。同步子进程运行前即给出所处阶段；失败保留耗时证据。嵌套阶段不得相加后冒充总耗时，交互等待需与执行边界明确区分。

默认 CLI 维持简洁，长步骤遵守既有中文进度要求；帮助、JSON stdout、退出码兼容。诊断仅输出本地阶段名/耗时/结果，不添加遥测采集，不输出凭据、命令参数、绝对路径或配置内容。

### R2：降低版本检查成本

init/update 自动检查复用配置中的有效远程缓存；过期或无效缓存重新检查。没有更新或项目版本差异时无需读取历史发布说明；需要展示摘要时保持完整版本范围与既有补拉语义。强制远程检查仍能立即获知版本变化，不被缓存或 prompt suppression 错误拦截。

保留 latest/beta 选择、项目未知状态、离线降级、policy、skip/snooze、release notes 缓存、成功刷新与失败不续期等契约。串行轻量检查和必要 metadata 补拉不得把现有单轮 5 秒网络预算扩为两份。

### R3：消除 Flower 管理下的冗余上游查询

通过 Flower 驱动的项目 update（含普通、self-update 子阶段、跨版本沙箱）不再为 Trellis 独立 latest 提示发起额外网络请求，清楚说明 Trellis 随 Flower 固定。保留本地 CLI/项目版本比较、降级拒绝、模板/迁移、冲突策略及其它真实需要的网络操作；独立运行 trellis 不受影响。

### R4：减少重复全局版本探测

标准且可证明的全局安装布局优先通过本地安装证据识别实际版本，避免仅为取版本启动整套 Trellis CLI。证据缺失、不合法或入口不匹配时回退兼容路径，不能把捆绑版本当作全局版本。继续保证 npx/非全局 postinstall 边界、准确同步与失败传播；不跳过必要的真实安装。

### R5：相邻入口与性能回归

覆盖共享检查的 init、自检 self-check，以及 CLI help/version 冒烟。记录全局安装、原生模块构建与高延迟文件系统等尚未证实的问题，按同一诊断方法后续排查。提供可重复基线与优化后对照，区分网络、CPU/文件操作、子进程及交互等待。

## Acceptance Criteria

- [x] A1（R1/R5）：至少三次同条件基线与至少五次最终前后对照，记录环境、耗时范围/中位数、请求数/子进程数、退出码和有效完成标记；不将局部实验宣称为整条升级加速。
- [x] A2（R2）：新鲜可用缓存且无摘要补拉需求时零远程请求；缓存失效/强制刷新可探测新版；轻量命中无更新时不拉完整 metadata；慢网、响应体挂起和失败均受同一 5 秒预算约束。
- [x] A3（R3）：Flower 驱动的普通及沙箱更新不发送上游 latest 提示请求；其它 URL/方法/命令不被拦截；实际捆绑 Trellis 的版本校验、dry-run 与更新能正常完成。
- [x] A4（R4）：标准有效全局安装快速识别版本且不执行 trellis --version；异常/自定义入口正确回退；同版本不重装，异版本仍按精确目标同步。
- [x] A5（R1）：诊断开启时成功/失败与嵌套阶段可追踪，关闭时无计时噪声；JSON stdout 可解析，帮助无副作用；正常慢步骤有中文状态提示。
- [x] A6（R2/R3/R4）：重复更新、同/跨版本 dry-run、冲突策略透传、配置保留、外部 Plugin 冻结、disabled 状态与补偿恢复回归通过；保留 ETARGET 一次重试语义。
- [ ] A7（R5）：本地相关测试、全套 npm test、语法与临时目标 dogfood 完成；新增受影响 CLI 回归由原生 Ubuntu/Windows GitHub Actions 实际执行，匹配最终提交且必需 job 成功后才宣称跨平台验收完成。

## Non-Goals

- 不发布版本，不在当前开发项目上执行真实更新，不为研究安装/替换用户全局包。
- 不改变 npm registry、代理、认证、遥测采集和依赖选择；不以取消安全校验或备份换性能。
- 不重构 Plugin 事务、摘要与遍历，不引入跨进程内容缓存，不扩大到任意 CLI 全站重写。
- 不承诺用户机器的固定提速倍数；全局下载/解包/原生编译耗时待阶段诊断证据。
