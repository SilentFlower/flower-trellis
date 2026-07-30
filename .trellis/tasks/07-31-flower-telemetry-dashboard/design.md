# Flower Trellis 安装与版本监控技术设计

## 1. Scope

本任务由 `flower-trellis` 作为协调仓库，联动 `/root/project/ai-fund`：

- `flower-trellis`：生成匿名设备标识、读取开发者与版本、按更新检查周期无感上报、提供遥测开关。
- `ai-fund/worker`：接收遥测、写入 D1、提供管理员只读查询接口。
- `ai-fund/frontend`：在现有 `/trellis` 页面增加管理员专属“安装监控”Tab。

第一版不建立物理硬件指纹、不做实时在线判断、不做远程控制，也不提供设备删除或归档能力。

## 2. Architecture

```text
SessionStart / init / update
        |
        v
Flower version check cycle
        |-- npm registry check
        `-- telemetry report (parallel, best effort)
                    |
                    v
POST /api/flower-trellis/telemetry
                    |
                    v
ai-fund Worker validation
        |-- flower_devices (current state)
        |-- flower_device_developers (aliases)
        `-- flower_version_history (version changes only)
                    |
                    v
Admin-only overview / devices / history APIs
                    |
                    v
/trellis -> Installation monitoring tab
```

版本检查和遥测共用触发周期，但使用独立开关。遥测失败永远不能改变原命令结果、标准输出或退出码。

## 3. Flower Client

### 3.1 User-Level State

新增 `src/lib/telemetry.js`，复用 `src/plugin/sources/user-source-store.js` 已导出的 `flowerConfigDirectory()`，将状态保存为：

```text
<flowerConfigDirectory>/telemetry.json
```

文件结构：

```json
{
  "schemaVersion": 1,
  "deviceId": "1e5f3691-c8c4-4a0f-a835-2dc6f2b58d9a",
  "enabled": true,
  "lastAttemptAt": null,
  "lastSuccessAt": null
}
```

契约：

- 文件缺失时生成 `crypto.randomUUID()`，`enabled` 默认 `true`。
- 使用用户级目录，使 `device_id` 跨 Flower 升级和 npm 重装保持稳定。
- 写入沿用用户 source 配置的原子临时文件加 rename 模式，目录权限 `0700`、文件权限 `0600`。
- 文件损坏时普通命令静默跳过遥测，不覆盖损坏证据；显式 `telemetry enable` 可重建合法状态。
- `lastAttemptAt` 用于跨项目全局节流，避免多个项目在同一周期重复上报；`lastSuccessAt` 供显式状态查询。
- 不保存 MAC、主机名、系统用户名、项目路径、仓库地址或硬件序列号。

### 3.2 Payload Contract

客户端向固定主域名 `https://ai-api.flower-cli.com/api/flower-trellis/telemetry` 发送：

```json
{
  "schema_version": 1,
  "device_id": "1e5f3691-c8c4-4a0f-a835-2dc6f2b58d9a",
  "event": "version_check",
  "flower_version": "0.5.2-beta.0",
  "bundled_trellis_version": "0.6.5",
  "project_flower_version": "0.5.2-beta.0",
  "project_trellis_version": "0.6.5",
  "developer_name": "silentflower",
  "platform": "linux",
  "arch": "x64",
  "client_time": "2026-07-31T02:00:00.000Z"
}
```

字段规则：

- `event` 仅允许 `version_check`、`init_completed`、`update_completed`。
- `developer_name` 只读取目标项目 `.trellis/.developer` 的 `name=`，不存在或损坏时为 `null`。
- 项目版本不存在时为 `null`；不得为了补字段扫描项目内容或调用 Git 远端。
- `platform` 与 `arch` 取 Node 运行时值。
- `client_time` 只用于诊断，服务端接收时间是活跃状态与历史时间的权威来源。

### 3.3 Scheduling And Failure Isolation

常规上报与真实远端版本检查并行执行：

- `self-check`：通过现有 `buildSelfCheck(..., { fetchMetadata })` 注入包装函数；只有缓存失效并真正调用 `fetchMetadata` 时才并行上报。
- `checkForUpdate`：npm metadata 请求与遥测请求并行，保留现有 5 秒版本检查上限。
- `init` 成功：强制发送 `init_completed`，补齐首次初始化后的开发者和项目版本；该事件不宣称 npm 安装刚刚发生。
- `update` 成功且非 dry-run：强制发送 `update_completed`。
- `self-update`：外层继续调用新版 `flower-trellis update --no-update-check`；由嵌套 update 的成功上报记录实际新版本，避免旧进程上报旧包版本。

上报规则：

- `FLOWER_NO_TELEMETRY` 非空或 `enabled=false` 时立即跳过。
- 普通 `version_check` 按当前项目 `updateCheck.intervalHours` 与用户级 `lastAttemptAt` 节流。
- 完成事件使用 `force=true` 绕过节流，但仍遵守禁用开关。
- 请求使用短超时；在版本检查路径与 npm 请求并行，完成事件的额外等待上限控制在亚秒级。
- 网络错误、非 2xx、响应解析错误和状态写入失败都返回中性结果，不打印、不抛到主流程。
- `self-check --json` 的 stdout 必须保持纯 JSON，不加入遥测诊断字段。

### 3.4 CLI Control

新增 `src/commands/telemetry.js` 和 `src/cli.js` 分发：

```text
flower-trellis telemetry status
flower-trellis telemetry enable
flower-trellis telemetry disable
```

- `status` 是显式查询命令，可输出 enabled、设备 ID、最近尝试和最近成功时间。
- `enable` / `disable` 修改用户级状态，不修改项目 `updateCheck`。
- 正常 init/update/self-check 路径不显示任何遥测提示。
- README 只增加一段简短说明，列出默认开启、字段范围、不采集内容与关闭命令。

## 4. AI Fund Worker And D1

### 4.1 Module Boundary

新增 `/root/project/ai-fund/worker/src/flower_telemetry.js`，集中负责：

- 请求字段白名单与格式校验。
- 当前设备 upsert、开发者别名关联、版本变化历史。
- 活跃状态计算、聚合、分页查询和版本历史查询。

`worker/src/index.js` 只负责路由、认证、请求体大小检查和统一 Response 封装，沿用现有 `jsonResponse` / `errorResponse`。

所有新增导出函数必须有中文 JSDoc，Worker 代码继续使用两空格、单引号和分号。

### 4.2 D1 Schema

`worker/schema.sql` 新增三个幂等表：

```sql
CREATE TABLE IF NOT EXISTS flower_devices (
    device_id TEXT PRIMARY KEY,
    flower_version TEXT NOT NULL,
    bundled_trellis_version TEXT,
    project_flower_version TEXT,
    project_trellis_version TEXT,
    platform TEXT NOT NULL,
    arch TEXT NOT NULL,
    last_event TEXT NOT NULL,
    last_client_at TEXT,
    report_count INTEGER NOT NULL DEFAULT 1,
    first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS flower_device_developers (
    device_id TEXT NOT NULL,
    developer_name TEXT NOT NULL,
    first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (device_id, developer_name),
    FOREIGN KEY (device_id) REFERENCES flower_devices(device_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS flower_version_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    from_version TEXT NOT NULL,
    to_version TEXT NOT NULL,
    changed_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (device_id) REFERENCES flower_devices(device_id) ON DELETE CASCADE
);
```

索引：

- `flower_devices(last_seen_at DESC)`：活跃状态与排序。
- `flower_devices(flower_version)`：版本分布与筛选。
- `flower_device_developers(developer_name)`：开发者搜索。
- `flower_version_history(device_id, changed_at DESC)`：设备历史。

初次出现设备不写版本历史；只有已存在设备的 `flower_version` 真正变化时才新增历史。普通心跳只更新当前态、开发者最近出现时间和 `report_count`。

### 4.3 Ingest Validation

公开写接口：

```text
POST /api/flower-trellis/telemetry
```

- 成功返回 `204`，客户端不依赖响应体。
- 请求体最大 4 KiB；先读取文本并检查长度，再解析 JSON。
- 拒绝未知字段。
- `device_id` 必须是标准 UUID；版本字段最长 64；开发者名最长 100；时间必须可解析。
- `event`、`platform`、`arch` 使用允许集合或受限字符规则。
- 数据库不保存 `CF-Connecting-IP`、User-Agent 或其它网络指纹。
- 公共 npm 客户端无法安全内置写密钥，因此数据定位为 best-effort 运营统计，不作为审计证据。
- 上线时为该 POST 路径配置 Cloudflare Rate Limiting；应用代码不把 IP 写入 D1。

写入流程：

1. 查询现有 `flower_devices.flower_version`。
2. 不存在时插入当前设备。
3. 已存在时更新当前状态并递增 `report_count`。
4. 版本变化时通过 D1 batch 同时写历史和更新当前态。
5. `developer_name` 非空时 upsert `flower_device_developers`。

### 4.4 Admin Read APIs

所有查询接口先调用现有 `isAdminRequest(request, env)`，失败返回 `403`：

```text
GET /api/flower-trellis/admin/overview
GET /api/flower-trellis/admin/devices
GET /api/flower-trellis/admin/devices/:deviceId/history
```

Overview：

```json
{
  "summary": {
    "total_devices": 18,
    "total_developers": 7,
    "active_devices": 12,
    "stale_devices": 4,
    "inactive_devices": 2
  },
  "versions": [
    { "flower_version": "0.5.2-beta.0", "count": 10 }
  ]
}
```

Devices 支持 `page`、`pageSize`、`search`、`version`、`activity`，响应沿用项目分页格式：

```json
{
  "data": [
    {
      "device_id": "1e5f3691-c8c4-4a0f-a835-2dc6f2b58d9a",
      "developer_names": ["silentflower"],
      "flower_version": "0.5.2-beta.0",
      "bundled_trellis_version": "0.6.5",
      "project_flower_version": "0.5.2-beta.0",
      "project_trellis_version": "0.6.5",
      "platform": "linux",
      "arch": "x64",
      "activity": "active",
      "first_seen_at": "2026-07-01 10:00:00",
      "last_seen_at": "2026-07-31 10:00:00",
      "report_count": 42
    }
  ],
  "total": 18,
  "page": 1,
  "pageSize": 20
}
```

活跃状态由 SQL 统一派生：

- `active`：`last_seen_at >= datetime('now', '-7 days')`
- `stale`：超过 7 天且不超过 30 天
- `inactive`：超过 30 天

History 按 `changed_at DESC` 返回指定设备的版本变化记录。查询接口全部只读。

## 5. AI Fund Frontend

### 5.1 Page Composition

`frontend/src/views/Trellis.vue` 注入现有 `isAdmin`：

- 非管理员：完全保留当前产品介绍页面，不渲染监控请求或入口。
- 管理员：顶部增加“产品信息 / 安装监控”分段 Tab，默认仍为“产品信息”。
- 选择“安装监控”时才懒加载管理员数据。

新增 `frontend/src/components/TrellisTelemetryPanel.vue`，避免继续扩张现有大型页面。组件通过 props/API 组合，不自行注入全局认证状态。

### 5.2 Monitoring UI

监控面板包括：

- 紧凑汇总条：设备、开发者、最近活跃、久未上报、长期未活跃。
- 版本分布：按设备数降序，标记当前 npm latest/beta；版本事实复用公开 meta 响应。
- 筛选工具栏：搜索、Flower 版本、活跃状态。
- 分页表格：设备 ID 短格式、开发者、Flower/Trellis 版本、平台/架构、首次出现、最近活跃、状态。
- 版本历史：点击行或历史图标打开模态框，只展示版本变化记录。

表格在窄屏使用横向滚动，控件尺寸固定，筛选变化时页码重置为 1。第一版没有修改、删除或远程操作按钮。

### 5.3 Frontend API

`frontend/src/api/index.js` 新增：

- `getFlowerTelemetryOverview()`
- `getFlowerTelemetryDevices(params)`
- `getFlowerTelemetryHistory(deviceId)`

继续复用统一 `request()` 自动注入 Bearer token。管理员 UI 只是可见性控制，安全边界仍在 Worker。

## 6. Compatibility And Migration

- `telemetry.json` 是新增用户级文件，不迁移现有 `.flower/settings.json`。
- 缺少 telemetry 配置视为默认开启，既有用户升级后会在下一次有效版本检查上报。
- D1 三张表均为新增表，重新执行 `schema.sql` 即可，不需要 `ALTER TABLE`。
- 前端公开产品信息接口与现有响应结构不变。
- 旧 Flower 客户端不调用遥测接口，对新服务端无影响。

推荐上线顺序：

1. 远端 D1 执行新增 schema。
2. 部署 ai-fund Worker ingest/admin API。
3. 部署 ai-fund Pages 管理界面。
4. 配置遥测 POST 路径限频规则。
5. 发布包含遥测客户端的 flower-trellis 版本。

## 7. Rollback And Operations

- Worker 或 D1 不可用时客户端静默失败，Flower 主流程继续。
- 前端回滚只移除管理员 Tab，不影响已收集数据。
- Worker 回滚可暂时移除查询/写路由，D1 表保留以便恢复。
- Flower 紧急回滚优先发布补丁，将 telemetry 默认关闭或短路报告函数；不依赖回滚用户本地状态文件。
- D1 新表不在普通回滚中删除，避免不可恢复的数据损失。

## 8. Trade-Offs

- `device_id` 表示 Flower 安装实例，不是物理机器；同一物理机的多个系统用户可能计为多台。
- `.trellis/.developer` 是自报别名，适合运营统计，不保证实名准确。
- 公共写接口无法获得强客户端身份，严格校验和限频只能降低滥用，不能形成审计级真实性。
- 只记录版本变化历史可以保留升级轨迹，同时避免心跳事件表无限增长。
