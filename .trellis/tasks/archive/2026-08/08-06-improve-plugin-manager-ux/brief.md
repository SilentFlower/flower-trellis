# Brief — Flower Plugin 管理器体验与更新链路修复

## Goal

- 让 `flower-trellis plugin` 交互管理器可日常使用：启动快、预览可读、少问一步、状态可见、更新真能生效。

## Scope

- R1 启动提速：`plugin.js` 延迟加载 `trellis-control.js`；交互层缓存来源登录态。
- R2 预览降噪：计划输出只列真实改动，空操作折叠为一行汇总。
- R3 去平台询问：安装不再弹平台多选，改由服务层既有推断；仅在项目无平台证据时兜底提示。
- R4 发现页状态：区分未安装 / 已安装最新 / 已安装可更新三态，可更新时显示 `0.3.0 → 0.4.0`。
- R5 更新链路：安装写 `^x.y.z`；更新时自动放宽存量精确锁；跨兼容边界升级显式确认；失败原因在当前流内可见。
- CLI 侧放开 `--version` 到 `plugin update`。

## Non-Goals

- `已锁定 Plugin 包不可重放` 的 lock 漂移硬失败处理（本仓自举时因 `vendor/skill-garden` 脏工作区触发，属独立问题）。
- Marketplace 索引的跨进程磁盘缓存。
- GitLab 登录、来源管理、Plugin 创作等其他页签的交互改造。
- `flower/skill-garden` 内置 Plugin 自身的版本策略。

## Key Decisions

- 安装写入 `^x.y.z` 兼容范围而非精确版本；`0.x` 下 `^0.4.0` 等价 `>=0.4.0 <0.5.0`。
- 存量精确锁在用户对该 Plugin 执行更新时就地放宽，不做批量改写。
- Marketplace 最新版落在声明范围外时，属跨兼容边界升级，必须显式确认后才改写声明为 `^<最新版>`；拒绝则三个状态文件均不写。
- 单版本时跳过"选择版本"提示。
- 平台一律走服务层推断链（显式 → 既有 state → 项目探测），不再主动询问。
- 预览过滤依据用 `result.transaction.changed`，**不是** `beforeHash !== afterHash`——后者会把新建目录（前后皆 `null`）误判为空操作。
- 版本策略只改声明层，解析器 / 投影器 / 事务写入器不动。

## Key Context

- `src/commands/plugin.js`：`:20` 静态 import 是启动慢的主因（`@mindfoldhq/trellis` 配置器 241ms）；`:624` `printResult` 打印全量 changes；`:262` 守卫挡住 `update --version`；`:691` 是唯一 `runWithTrellisIntegrationEnabled` 使用点，已有三重守卫。
- `src/commands/plugin-interactive.js`：`:660-670` 每轮重查登录态；`:584-599` 发现页未读项目视图；`:817-836` 强制选平台并传精确版本。
- `src/plugin/application-service.js`：`:453-457` 平台兜底链；`:720-749` changes 构造；`:181-194` `service.update` 早已支持 `options.version`，无需改服务层。
- `src/plugin/install/transaction-writer.js`：`:128-152` changed/unchanged 判定；`:154-162` dry-run 同样填充 `changed`。
- `src/plugin/resolver/dependency-resolver.js`：`:216-222` 按声明 range 过滤候选——精确锁使更新永远选不到新版。
- 组织内 `rd-guide` Marketplace 每个 Plugin 只保留**一个**版本（已验证 4 个各 1 个），旧版发新版时被移除。
- `plugin-interactive.test.js`（615 行）是改动的回归基线。

## Risks / Deferred

- `state.discovery` 需从缓存"成品 items"改为缓存"原始 entries"，否则安装后状态不刷新；这是交互层改动面最大的一处，独立提交便于回退。
- 跨边界升级会把 `0.3.0` 直接带到 `0.4.0`，可能引入不兼容内容——依赖显式确认 + R2 已让预览真正可读来控制。
- 本仓 `vendor/skill-garden` 脏工作区会让本地端到端验证撞上 lock 漂移错误，验证需走临时目录夹具，不碰仓库根的真实 `.flower/plugins.json`。

## Acceptance

- `ftl plugin list` 耗时相对 676ms 基线明显下降，模块图不含 `trellis-control`；非 `--dry-run` 的 add/update/remove 仍在 `runWithTrellisIntegrationEnabled` 包裹下执行。
- 卸载单个 rd-guide Plugin 的预览只出现该 Plugin 自身路径，skill-garden 幂等重写折叠为一行；`--dry-run --json` 的 `changes` 数组与改动前一致。
- 从发现页安装全程无平台选择，`state.json` 平台与项目既有一致；空目录场景仍能得到平台提示而非直接失败。
- 发现页显示已安装徽标与版本，有新版时显示 `0.3.0 → 0.4.0`。
- 安装 `0.4.0` 后 `plugins.json` 为 `^0.4.0`；对精确锁 `0.3.0`（Marketplace 仅 `0.4.0`）执行更新，确认后声明变 `^0.4.0`、lock 与 state 变 `0.4.0`，拒绝则三文件无变化。
- `npm test` 全绿。

## Next Step

- 从 implement.md 步骤 1 开始：把 `src/commands/plugin.js:20` 的 `trellis-control.js` 静态 import 改为 `:691` 分支内的 `await import()`。
