# 现有实现证据

核对日期：2026-09-05。只读检查 Flower 与本机 ai-fund 源码；未访问生产遥测接口。

| 事实 | 来源 | 对方案的影响 |
| --- | --- | --- |
| v1 事件只有版本检查、初始化完成、升级完成 | `src/lib/telemetry.js:20` | 无法计算失败率，需要新终态事件 |
| `platform` 来自 `process.platform` | `src/lib/telemetry.js:287` | 新增 AI 平台字段，不能改变旧字段含义 |
| 没有开发者名称时客户端整条跳过 | `src/lib/telemetry.js:275`；服务端 `validateFlowerTelemetryPayload` 接受可空名称 | v2 安装统计与名称解耦 |
| 常规节流由最后尝试时间与 updateCheck 间隔决定 | `src/lib/telemetry.js:302`、`:341`；`src/lib/manifest.js:37` 默认 8 小时 | 日活动独立于远程版本检查调度 |
| 版本检查并行但等待遥测，init/update 完成亦等待 | `src/lib/update-check.js:467`、`src/lib/self-check.js:698`、`src/commands/init.js:116`、`src/commands/update.js:346` | 新事件采用有限队列与独立发送，保留失败静默 |
| Flower 启动更新 hook 仅调用 self-check，不传 AI 平台 | `src/assets/flower_update_hook.py:_run_self_check` | 不能直接把旧事件当平台活动 |
| 两个 Flower 专属 SessionStart Patch 为 Codex/Claude，运行上下文分为 state/rules/stages | `src/patches/platforms/codex/session-start-hooks/patch.json`、`src/patches/platforms/claude/session-start-hooks/patch.json`、`src/assets/flower_session_start.py` | 采用独立日活动去重，避免分段重复；其他平台需另做覆盖研究 |
| 两个平台已配置 UserPromptSubmit，adapter 以原生 inject-workflow-state 路径定位 | `src/lib/platform-patch-adapters.js:28`；部署 `.codex/hooks.json`、`.claude/settings.json` | 有跨日用户输入观测入口，不必读取对话日志 |
| hook 源属于 Flower，部署结果归 builtin Plugin 管理 | `src/lib/flower-assets.js`、`src/builtin-plugins/skill-garden/content-adapter.js`、`.flower/state.json` | 按资产与 Patch 源修改，覆盖生命周期验证 |
| init/update 调用 plugin，plugin 又有交互回调与物化递归 | `src/commands/init.js`、`src/commands/update.js:108`、`src/commands/plugin.js:753` | 外部操作上下文必须跨嵌套传播，不能每次函数进入都计数 |
| plugin 把错误转换为数字退出码，错误码仍在 catch 中可见 | `src/commands/plugin.js:736`、`:972` 附近 | 只包顶层 CLI 会丢失分类，应在终态边界收集结构化事实 |
| self-update 调用外部项目 update，并有 dry-run/no-op 路径 | `src/commands/self-update.js:129` | 自更新整体事件与内部 update 不重复；无执行不计成功 |
| builtin Skill Garden manifest.version 强制等于 Flower CLI 版本 | `src/builtin-plugins/skill-garden/provider.js:84` | 不能把 lock 版本解释为独立上游 Skill Garden semver |
| 随包 manifest 的 sourceCommit 是当前包快照来源 | `enhancements/MANIFEST.json` | 不可据此断言目标项目已安装 commit |
| 当前 D1 保存当前设备、别名、版本历史，未保存每日活跃事实 | `ai-fund/worker/schema.sql:124`、`ai-fund/worker/src/flower_telemetry.js:218` | 历史日活与回访不能从现有最近上报时间逆推出，需要新事实 |
| 当前管理端已有设备删除 | `ai-fund/worker/src/index.js:7056`、`frontend/src/components/TrellisTelemetryPanel.vue` | 新表和首次观测锚点必须纳入现有删除一致性；归档旧 PRD 的只读设定已不是现状 |
| 管理员鉴权入口为 requireAdminResponse | `ai-fund/worker/src/index.js:7033`；`.trellis/spec/backend/api-routes.md:243` | 复用当前用户角色鉴权，不采用归档 PRD 中旧 ADMIN_NAME 比较 |

## Inspected Contracts

- Flower `.trellis/spec/flower-trellis/cli/config-and-state.md` 的遥测契约：开关、状态文件、白名单与测试隔离。
- Flower `trellis-patch-engine.md` 中 SessionStart 分段与额度保持、compiled targets 契约。
- Flower `flower-plugin-runtime.md` 中 builtin Skill Garden 的版本、ownership、冻结 replay 与原子投影。
- Flower `ai-context-budget.md` 中最终输出原则：新增遥测不向 AI 上下文塞入运行日志或指标。
- ai-fund `.trellis/spec/backend/database-guidelines.md` 中 D1 prepared statements；`api-routes.md` 中现有遥测路径与角色鉴权。

## Scope Resolution And Implementation Evidence

- 用户于 2026-09-06 确认首批 Claude Code/Codex，其他平台实际会话适配延后。
- 具体编码前，读取受影响模块完整签名和测试 fixture，冻结取消/无操作/交互计时与旧客户端迁移细节。
- 使用本地 SQLite 或 D1 测试环境验证幂等事务与保留清理，不能只依赖现有内存 SQL 替身。

## Additional Findings — 2026-09-06

- `src/plugin/runtime-errors.js` 与 `src/plugin/errors.js` 已有稳定 Plugin 错误码，可映射有限错误分类；不必上传错误文本。
- `self-update` 的前置确认/no-op 与实际执行路径已核对；全局安装后仍是旧 Node 进程运行，应在开始时保存执行器版本。
- `ai-fund/worker/src/index.js` 已有 scheduled 和独立清理作业，新事实清理可沿用调度边界，不重建定时服务。
- ai-fund 管理员鉴权以 users.role 为依据，`requireAdminResponse` 区分未登录 401 与角色不足 403。
- 首批实现范围包括两仓本地源码和迁移文件；本轮没有执行 ai-fund 代码、数据库或部署变更。

## 实施后证据

上文保留为规划时的代码基线。2026-09-06 实现后模块拆分、验证结果与局限以 [check-report.md](check-report.md) 和两仓更新后的权威 spec 为准。
