# Flower Trellis 安装与版本监控实施计划

## 1. Preparation

1. 读取本任务 `prd.md`、`design.md` 和 curated JSONL 上下文。
2. 在 `flower-trellis` 确认当前分支与 dirty 范围，在 `/root/project/ai-fund` 单独确认分支与 dirty 范围；不得覆盖两个仓库中的用户改动。
3. 确认 `https://ai-api.flower-cli.com` 仍是 ai-fund Worker 主域名，文档和产物中不得写入默认 `workers.dev` 地址。

## 2. AI Fund Backend First

1. 更新 `/root/project/ai-fund/worker/schema.sql`：
   - 新增 `flower_devices`。
   - 新增 `flower_device_developers`。
   - 新增 `flower_version_history`。
   - 新增版本、活跃时间、开发者和历史索引。
2. 新增 `/root/project/ai-fund/worker/src/flower_telemetry.js`：
   - 实现请求字段白名单和格式校验。
   - 实现设备 upsert、开发者 upsert 和版本变化历史。
   - 实现服务端 7/30 天活动状态计算。
   - 实现 overview、分页 devices 和 history 查询。
   - 所有导出函数补齐中文 JSDoc。
3. 更新 `/root/project/ai-fund/worker/src/index.js`：
   - 导入 telemetry 模块的显式命名导出。
   - 新增公开 `POST /api/flower-trellis/telemetry`。
   - 新增三个 admin-only GET 路由并复用 `isAdminRequest`。
   - 保持统一 CORS、错误响应和分页格式。
4. 新增 `/root/project/ai-fund/worker/src/flower_telemetry.test.js`：
   - 合法/非法 payload。
   - 未知字段与 4 KiB 限制。
   - 首次设备、重复心跳、版本变化、开发者多别名。
   - 7 天和 30 天边界。
   - overview、筛选、分页和 history。
5. 更新 `/root/project/ai-fund/.trellis/spec/backend/api-routes.md` 与 `database-guidelines.md`，记录接口和 D1 契约。

## 3. AI Fund Frontend

1. 更新 `/root/project/ai-fund/frontend/src/api/index.js`，新增三个管理员查询函数。
2. 新增 `/root/project/ai-fund/frontend/src/components/TrellisTelemetryPanel.vue`：
   - 汇总条、版本分布、筛选、分页表格和历史模态框。
   - 使用 `ref()` / `computed()`，筛选变化时重置页码。
   - 固定表格和控件尺寸，移动端横向滚动，不嵌套卡片。
   - 只读界面，不提供修改或删除命令。
3. 更新 `/root/project/ai-fund/frontend/src/views/Trellis.vue`：
   - 注入现有 `isAdmin`。
   - 管理员显示“产品信息 / 安装监控”分段 Tab。
   - 非管理员保持现有 DOM 与数据请求路径。
   - 仅切入监控 Tab 时挂载/加载监控组件。
4. 更新 `/root/project/ai-fund/README.md` 的功能和部署说明，记录 D1 schema 与管理员监控入口。
5. 更新相关 frontend spec，记录管理员 Tab、筛选状态和响应式表格契约。

## 4. Flower Client State And Reporter

1. 新增 `src/lib/telemetry.js`：
   - 复用 `flowerConfigDirectory()`。
   - 规范化、读取和原子写入 `telemetry.json`。
   - 默认生成 `deviceId` 且 `enabled=true`。
   - 读取 `.trellis/.developer`、当前 Flower/Trellis 与项目版本。
   - 构造严格白名单 payload。
   - 实现全局节流、强制完成事件、短超时和静默降级。
2. 新增 `src/commands/telemetry.js`：
   - `status`、`enable`、`disable`。
   - 显式命令输出中文状态；普通运行路径无输出。
3. 更新 `src/cli.js`：
   - 动态导入并分发 telemetry 子命令。
   - 更新 help 文本。
4. 更新 `src/lib/update-check.js`：
   - 真实 npm metadata 请求与普通 `version_check` 上报并行。
   - 保持现有版本检查返回结构和错误语义。
5. 更新 `src/commands/self-check.js`：
   - 使用 `buildSelfCheck` 的 `fetchMetadata` 注入点包装真实远端检查。
   - 缓存命中时不触发上报。
   - stdout 继续只输出原有 JSON。
6. 更新 `src/commands/init.js` 与 `src/commands/update.js`：
   - 成功且非 dry-run 后分别上报 `init_completed` / `update_completed`。
   - 上报失败不影响完成页和退出码。
7. 更新 `README.md`：
   - 简短披露默认开启、采集字段与不采集内容。
   - 列出 status/enable/disable 与 `FLOWER_NO_TELEMETRY`。
8. 更新 `.trellis/spec/flower-trellis/cli/config-and-state.md`、`module-guidelines.md` 或对应 ownership spec，固化用户级遥测状态和网络降级规则。

## 5. Flower Tests

1. 新增 `test/js/telemetry.test.js`：
   - 缺失状态默认开启并生成稳定 UUID。
   - npm 重装语义对应的重复读取保持同一 `deviceId`。
   - enable/disable、环境变量关闭和损坏文件降级。
   - payload 不包含 MAC、主机名、路径、仓库和系统用户名。
   - 普通节流、强制完成事件、失败/超时静默。
2. 扩展 `test/js/update-check.test.js`：
   - 真实远端检查触发一次报告。
   - interval cache 命中不报告。
   - 关闭更新检查不修改 telemetry 配置。
3. 增加命令级测试，确认 `self-check --json` 可解析且没有额外 stdout。
4. 对 init/update 测试桩验证成功事件，dry-run 不发送完成事件。

## 6. Validation

### flower-trellis

```bash
npm test
node --check src/cli.js
node --check src/lib/telemetry.js
node --check src/commands/telemetry.js
node --check src/commands/self-check.js
node --check src/commands/init.js
node --check src/commands/update.js
flower-trellis telemetry status
flower-trellis self-check --json --target /root/project/flower-trellis
```

额外验证：

- 使用本地 mock fetch 验证 payload 和超时，不向生产接口写测试数据。
- 捕获 `self-check --json` stdout 并执行 `JSON.parse`。
- 临时目标执行 init/update dogfood，确认无新增遥测提示。

### ai-fund Worker

```bash
cd /root/project/ai-fund/worker
node --test src/flower_telemetry.test.js
node --check src/flower_telemetry.js
node --check src/index.js
npx wrangler deploy --dry-run
```

额外验证：

- 本地 D1 fixture 验证首次写入、心跳、版本变化和多开发者。
- 非管理员三个 GET 接口均为 `403`。
- 超长、未知字段、非法 UUID 和非法枚举均为 `400`。
- POST 成功为 `204`，数据库不含网络指纹字段。

### ai-fund Frontend

```bash
cd /root/project/ai-fund/frontend
npm run build
```

浏览器验证：

- 非管理员 `/trellis` 无监控 Tab，也不发送 admin 请求。
- 管理员默认进入产品信息，可切换监控 Tab。
- 桌面与移动视口无文字重叠，表格可横向滚动。
- 筛选重置分页，历史模态框可打开和关闭。
- Worker 403/500、空数据和加载态都有明确界面状态。

### Cross-Repo

```bash
git -C /root/project/flower-trellis diff --check
git -C /root/project/ai-fund diff --check
```

- 对照 design 中 payload 字段逐项检查客户端、Worker 校验和 D1 字段。
- 对照 admin API 响应逐项检查 Worker 与 Vue 消费字段。
- 检查 README、API spec、database spec 与实现一致。

## 7. Release And Rollback

上线前生成 release 操作单，至少包含：

1. D1 远端执行 `schema.sql`。
2. 部署 Worker。
3. 部署 Pages。
4. 配置 POST 接口 Cloudflare Rate Limiting。
5. 发布 flower-trellis npm 版本。

回滚点：

- D1 新表只新增不删除。
- Worker/Pages 可独立回滚，客户端会静默失败。
- Flower 侧可发布补丁关闭遥测调用，不删除用户级 `telemetry.json`。

## 8. Risk Files

- `src/lib/update-check.js`、`src/commands/self-check.js`：影响 SessionStart 与升级提示，必须保证缓存和 JSON 输出零回归。
- `src/commands/init.js`、`src/commands/update.js`：影响安装/升级主流程，遥测只能作为非阻断尾部动作。
- `/root/project/ai-fund/worker/schema.sql`：上线前必须先执行远端 D1 schema。
- `/root/project/ai-fund/worker/src/index.js`：共享路由入口，需防止路由顺序和认证回归。
- `/root/project/ai-fund/frontend/src/views/Trellis.vue`：现有公开页面，非管理员 DOM 和加载行为必须保持。
