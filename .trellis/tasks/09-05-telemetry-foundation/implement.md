# 遥测第一批实施计划

日期：2026-09-06。依据：[prd.md](prd.md)、[design.md](design.md)、[research.md](research.md)。用户已确认完整 Brief；实现及本地验证完成，详细证据见 [check-report.md](check-report.md)。

## Scope And Repositories

- Flower 根仓：`/root/project/flower-trellis`，采集、队列、CLI、hook、相关测试与自有 specs。
- ai-fund：`/root/project/ai-fund`，Worker/schema/管理员查询、前端与相关测试/specs。
- 本任务在 Flower 统一记录跨仓进度；进入 ai-fund 实现前读取当地 AGENTS/spec、当前任务与 Git 状态，保留其无关改动。不把 Flower 的任务游标当作覆盖 ai-fund 既有活动任务的授权。
- 当前 Flower 无关改动：`.flower/plugins.json`、`.flower/plugin-lock.json`、`.agents/skills/xhgj-gitlab-collaboration/`、`.claude/skills/xhgj-gitlab-collaboration/`。
- 不修改 Skill-Garden 子仓或生成快照来代替 Flower 自有资产；若实现发现必须扩大 owner 或平台范围，先回到规划修订。

## Ordered Plan

### 1. Prepare And Freeze Contracts

- [x] 经 Brief 确认后运行 task start，进入 `trellis-route(implement)`；使用其实际路由选择，不预先派发代理。
- [x] 读取相关 Entity/DTO/方法完整定义、两仓当前 Git 状态和项目 specs，记录基线。
- [x] 以 design 的两类事件、四个操作、字段白名单和 UTC 指标建立共享 JSON fixtures；明确新旧协议差异、空值和样本口径。
- [x] 冻结 API 响应样例：空样本、正常数据、多平台重叠、队列未成熟、混用旧客户端、限流与重复批次；真实 Worker/SQLite 生成结果见 [verification/responses.json](verification/responses.json)。

### 2. Implement ai-fund Receiver And Facts

- [x] 新增可重放迁移并同步 `worker/schema.sql` 的 events/daily/observations 表、唯一约束与清理/查询索引；只在隔离库执行。
- [x] 在 `worker/src/flower_telemetry.js` 或其专用子模块实现 v2 白名单、时间窗、逐事件回执和事务幂等，保留 v1 校验契约。
- [x] 在 `worker/src/index.js` 注册 events 与 analytics 路由，复用限流绑定与当前角色鉴权。
- [x] 完成 UTC 活跃/回访/版本/质量聚合，返回分子分母、coverage、状态与实际筛选口径。
- [x] 将新事实和锚点纳入设备删除；接入独立有界 daily cleanup，不影响现有 scheduled 作业。
- [x] 用真实 SQLite/D1 fixture 验证并发重试、迟到事件、首次日期修正、清理、删除和事务失败回滚。

### 3. Implement Flower Collector And Sender

- [x] 扩展 `src/lib/telemetry.js` 的新旧共享身份/开关写入互斥，v2 可无名称；保持 telemetry.json schema 与旧字段兼容。
- [x] 增加单一 Node 入队模块、事件 schema、用户级 outbox/hint/retry 状态；锁、软链接、损坏状态和限额处理。
- [x] 增加短生命周期 sender，确认 stdio 脱离和退出预算，重试保持原事件 ID；发送前复核开关。
- [x] 新版 v1 快照调用也采用独立发送，避免两类遥测出现不同的主进程等待行为。
- [x] `telemetry status` 增加只读诊断；disable 与环境变量停用符合零后续发送/零写入边界。

### 4. Instrument CLI Operations

- [x] 在 `src/commands/init.js`、`update.js`、`self-update.js`、`plugin.js` 建立已开始执行/最终完成边界。
- [x] 显式传递操作上下文，覆盖初始化内部安装、更新重放、插件物化递归、批准预览和管理器动作。
- [x] self-update 跨进程传播抑制重复的上下文，捕获执行器原版本；子进程/全局更新失败仍记录外部终态。
- [x] 在异常转换退出码前完成有限分类；保持现有 JSON/stdout/stderr/退出码契约，不依赖解析用户文本。
- [x] 分开 execution/elapsed/unavailable 契约与展示；当前真实命令使用 elapsed，明确可能含交互等待。可捕获取消尽力记录，SIGINT 不被遥测延迟。

### 5. Integrate Claude And Codex Hooks

- [x] 新建 `src/assets/` 中静默活动 handler，经 `src/lib/flower-assets.js` 和 builtin content adapter 投影。
- [x] 在 Flower 平台 Patch 中为 SessionStart/UserPromptSubmit 注册独立 handler，显式传平台；不改三段上下文内容。
- [x] hint 快速跳过与 Node 最终去重一致；同日 pending 的到期重试仍能被再次唤起；无 CLI/禁用/不支持事件静默。
- [x] 在隔离 0.6 full 安装验证 hook 注册、重复 update/replay 幂等、ownership 与 uninstall 清理；old/0.5/其他平台不会被误加本批 handler。

### 6. Implement Admin Views

- [x] 在 `frontend/src/api/index.js` 增加受限 analytics 请求，页面沿用现有角色状态。
- [x] 在 `TrellisTelemetryPanel.vue` 与必要的 Vue 组件中交付概览、平台与版本、持续使用、操作质量四区。
- [x] 验证 UTC 日期、重叠平台、版本快照选择、成熟队列、取消样本、执行/总耗时、零样本与旧客户端覆盖说明。
- [x] 原安装列表/历史/删除继续工作，删除后刷新新统计，不残留已删除实例的事实。

### 7. Verify And Review

- [x] 按下方矩阵运行相关测试和两仓必需检查，记录命令、HEAD/工作面、结果与局限。
- [x] 用本地测试接收端与隔离数据库跑 CLI/hook → API → D1 → 管理页的代表场景，不向生产发送测试事件。
- [x] 完成 Check-All 与所需 spec 更新，将原先“事件固定为 v1”改为新旧协议边界，并更新 README 的最小字段披露。
- [x] 最终 diff 按仓列出；提交、生产迁移、部署和发版遵守各自流程。本轮实施不自动包含这些外部动作。

## Validation Matrix

| 组 | 必需场景 | 验收 |
| --- | --- | --- |
| 入口 | Claude/Codex 启动/输入，同日多次、跨日、多项目、多平台、CLI 单列，其他平台无误注入 | A1/A2 |
| 终态 | init/update/self-update/plugin add 成败、取消、no-op、帮助/预览、递归与跨进程去重 | A3/A4 |
| 状态 | 并发首次 UUID、显式停用与 in-flight 并发、临时禁用零写入、坏 JSON/软链接/锁失败 | A5 |
| 发送 | 离线、重复回执、429/503、队列满/过期、重试唤起、进程断流/退出预算 | A5/A7 |
| 数据 | 唯一约束/事务回滚、不同 payload 同 ID、日期与未来容差、72 小时窗口、成熟队列 | A2/A3/A7 |
| 生命周期 | v1/v2 混用、空别名、180 天清理与锚点、现有删除级联、Patch 安装重放卸载 | A1/A6/A7 |
| 界面 | 401/403/admin、空样本、观察中、筛选、版本快照、多平台重叠与实际分子分母 | A6/A8 |

相关现有命令（在对应仓运行；新增专项测试文件创建后纳入相应命令）：

```bash
# Flower
node --test test/js/telemetry.test.js test/js/update-check.test.js test/js/flower-update-contract.test.js test/js/plugin-lifecycle-cli.test.js test/js/plugin-interactive.test.js
python3 -m unittest discover -s test/python -p 'test_flower_session_start.py'
npm test
git diff --check

# ai-fund/worker
node --test src/flower_telemetry.test.js src/index.test.js
node --check src/flower_telemetry.js
node --check src/index.js

# ai-fund/frontend
npm run build
```

修改过的 JS 文件逐个运行 `node --check`。前端指标计算/展示的专项验证须使用固定 API fixtures，不能以构建成功替代指标验收。Windows 的 sender/退出行为需要真实 Windows 验证证据；Linux 的 mock 只能覆盖逻辑，不能代替该平台证据。本轮已在 Windows 本地隔离源码副本以原生 Node/Python 验证，见报告。

普通 CLI E2E 保持默认 `FLOWER_NO_TELEMETRY=1`。遥测专项用隔离的 XDG/config 目录和注入 env/mock/测试 endpoint，不访问固定生产接收端。

## Rollout And Rollback Points

1. schema 与 v2 接收向后兼容后，才具备发布新客户端的条件；实际远程迁移使用 ai-fund 的 SOP。
2. hook 改动只经 Flower 资产和 Patch 的正常生命周期交付；不能手改 dogfood 或覆盖原生用户 handler。
3. 有问题时独立停用 v2 发送/接收并保留新表证据；v1 和旧安装视图可继续运行。
4. 保持未关联的 Git 改动与另一仓活动任务；若出现实质范围冲突，先明确归属后继续。

## Planning Gate

2026-09-06 用户确认完整 Brief 后已启动任务。实际 implement/check 路由均为 inline；本轮完成两仓本地代码、迁移文件、验证及规范同步。提交、生产迁移与上线尚未执行。
