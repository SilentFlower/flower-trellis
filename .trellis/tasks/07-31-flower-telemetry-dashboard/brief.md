# Brief — Flower Trellis 安装与版本监控

## Goal

- 在不改变 `ai-fund` 现有公开 Flower Trellis 产品页的前提下，为管理员提供启用遥测且运行过 CLI 的 Flower 安装实例、开发者别名、Flower/Trellis 版本和最近活跃情况的只读运营视图。

## Scope

- `flower-trellis` 在用户配置目录持久化随机 `device_id` 和独立的 `telemetry.enabled` 状态；缺少配置时默认开启，升级和 npm 重装后保持稳定。
- 遥测复用真实远端版本检查的调度周期，并在 `init`、非 dry-run `update` 成功后补发即时事件；版本检查与遥测使用独立开关。
- 上报最小字段集：设备 ID、事件、Flower/Trellis 当前及项目版本、`.trellis/.developer` 自报别名、平台、架构和客户端时间。
- 新增 `flower-trellis telemetry status|enable|disable` 和 `FLOWER_NO_TELEMETRY` 临时关闭能力；普通 CLI 路径不提示、不交互、不改变 stdout/stderr 或退出码。
- `ai-fund` Worker 新增公开遥测写入接口，严格校验和限流，并在 D1 保存设备当前态、设备与开发者别名关系、Flower 版本变化历史。
- `ai-fund` Worker 新增管理员专属 overview、设备分页筛选和版本历史查询接口，继续复用现有 `isAdminRequest` 作为后端安全边界。
- `ai-fund` 现有 `/trellis` 页面仅对管理员增加“产品信息 / 安装监控”Tab；默认仍显示产品信息，监控面板按需加载并保持只读。
- README 简短披露遥测默认开启、采集字段、不采集内容以及查询和关闭方式。

## Non-Goals

- 不统计只安装但从未运行 Flower CLI 的设备，也不将统计值解释为 npm 绝对安装量。
- 不采集 MAC、设备序列号、主机名、操作系统用户名、项目绝对路径、仓库地址、源码内容或原始 IP。
- 不建立物理硬件指纹，不保证 `device_id` 对应唯一物理设备。
- 不把 `.trellis/.developer` 自报别名视为钉钉认证或实名身份。
- 不提供实时在线状态、命令行为日志、设备删除/归档/忽略、远程控制或远程升级。
- 不把公共写入口收到的数据用作审计证据。

## Key Context

- Flower 用户级状态复用 `src/plugin/sources/user-source-store.js` 的 `flowerConfigDirectory()`，新增 `<flowerConfigDirectory>/telemetry.json`，并沿用原子写入和 `0700/0600` 权限约束。
- 常规 `version_check` 只在 `self-check` 或 `checkForUpdate` 真正联网时触发；缓存命中不报告。完成事件为 `init_completed` 和 `update_completed`，其中 `init_completed` 不宣称 npm 安装刚刚发生。
- 上报固定发送到 `https://ai-api.flower-cli.com/api/flower-trellis/telemetry`，短超时、失败静默、不得延长或阻断主流程；测试使用 mock，不向生产接口写测试数据。
- D1 新增 `flower_devices`、`flower_device_developers`、`flower_version_history`；普通心跳更新当前态，只有 Flower 版本变化才写历史。
- 活跃状态由 Worker 依据服务端 `last_seen_at` 统一计算：7 天内 `active`，超过 7 天且不超过 30 天 `stale`，超过 30 天 `inactive`。
- 公开写接口最大 4 KiB，拒绝未知字段和非法 UUID、版本、平台、架构、事件或时间；Cloudflare Rate Limiting 必须在客户端发布前配置。
- 非管理员必须保持现有 `/trellis` DOM 和数据请求路径，不触发管理员查询；前端 `isAdmin` 仅控制展示，Worker 鉴权才是安全边界。
- 两仓实现时分别检查 dirty worktree，不覆盖用户改动；上线顺序为 D1 schema、Worker、Pages、限频、Flower npm 发布。

## Acceptance

- 非管理员看不到安装监控入口，直接调用三个管理员查询接口均得到 `403`；管理员可切换 Tab，查看聚合、版本分布、分页筛选和版本历史。
- 同一 `device_id` 重复上报只更新当前态和次数，不重复计设备；同一设备可关联多个开发者别名。
- Flower 版本未变化时不新增历史，变化时只新增一条包含旧版本、新版本和服务端时间的记录。
- 7 天和 30 天边界在聚合、列表和筛选中采用相同的服务端口径。
- 缺少 telemetry 配置时默认开启；关闭遥测不改变更新检查配置，关闭更新检查也不改变遥测配置。
- 缓存命中不报告，真实联网检查最多报告一次；成功初始化或更新后的即时报告能够反映实际新版本。
- 遥测失败、超时或服务端不可用时，`init`、`update`、`self-update`、`self-check --json` 的既有输出、成功语义和退出码保持不变。
- 客户端、Worker、D1 和 Vue 的字段契约一致，数据库不包含任何明确排除的敏感字段。
- Flower 测试、Worker 测试与 dry-run、前端构建、两仓 `diff --check` 通过；桌面和移动视口无重叠，空数据、加载和错误状态可用。

## Next Step

- 用户确认本 Brief 后运行 `python3 ./.trellis/scripts/task.py start .trellis/tasks/07-31-flower-telemetry-dashboard`，再进入实现路由；实现顺序为 ai-fund D1/Worker、ai-fund 管理前端、Flower 客户端、跨仓验证和上线操作单。
