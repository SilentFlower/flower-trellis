# 实施计划

## 1. 建立可测试基础模块

- [x] 在 `.common/.claude/skills/craft-rpa/recorder/` 新增网络采集模块，定义请求状态、终态 finalize、正文分类/截断、multipart 限制和自身流量过滤。
- [x] 新增 browser controller 模块，迁移现有 tab/navigation 方法并实现 observe 与基础 action。
- [x] 为公共函数、controller 方法和导出契约补齐中文 JSDoc。
- [x] 在 recorder 下增加 Node `node:test` 测试目录和 `npm test` 脚本，不增加第三方测试依赖。

## 2. 接入启动与事件传输

- [x] 调整 `logger.js`，以兼容方式公开 `appendEvents`，增加结构化 control 错误和按路由区分的 Origin/CORS 处理。
- [x] 调整 `launch.js` 为编排层：启动 logger、创建 controller、安装 Playwright binding、安装网络采集器、注入脚本并打开起始 URL。
- [x] 调整 `inject.js`，删除页面 Fetch/XHR Hook，优先通过 Playwright binding 批量提交交互事件，保留有界 HTTP 回退。
- [x] 从单一配置派生 logger URL/port，消除 logger、inject、Dashboard 和 client 的手工三处同步要求。

## 3. 实现 AI 感知与操作接口

- [x] 实现 observe：page/frame 元数据、文本摘要、ARIA snapshot、交互元素摘要、截图和可选 DOM artifacts。
- [x] 实现统一 target resolver，覆盖 selector、role/name、text、label、placeholder、testId、frame 和 nth。
- [x] 实现 click、fill、type、press、select、check/uncheck，并返回实际命中目标和操作前后状态。
- [x] 保持现有 pages/open/close/focus/reload/back/forward/navigate 行为，更新 Dashboard 调用以适配结构化错误。
- [x] 新增 `scripts/control-client.js` 和 `run.sh control <action> [JSON]`，作为 AI 的稳定调用入口。

## 4. 升级网络与 Trace 契约

- [x] 记录成功、HTTP 错误、redirect 和 transport failure 的单事件最终结果。
- [x] 使用完整 headers、准确 UTF-8 字节截断、文本/二进制分类和 multipart 元数据策略。
- [x] 扩展 `jsonl-to-trace.js`，渲染新增 headers/body/size/truncated/failure/context 字段并保持旧 JSONL 兼容。
- [x] 为 trace body 设置独立展示上限和 `jsonlLine` 反查说明。

## 5. 文档与双平台同步

- [x] 更新 `SKILL.md` 的能力定位、AI 行为约定、控制命令、目标级连续执行、敏感数据、本地接口边界和故障排查。
- [x] 移除“AI 不操作浏览器 GUI”和“端口必须三处同步”等已失效说明。
- [x] 将 `.common/.claude/skills/craft-rpa` 机械同步到 `.common/.codex/skills/craft-rpa`，校验文件清单和内容逐字节一致。

## 6. 验证

- [x] 运行 changed JS `node --check`。
- [x] 运行 recorder `npm test`，覆盖网络 finalize、失败请求、redirect、UTF-8 截断、二进制、multipart、自身请求过滤、target 歧义和 trace 兼容。
- [x] 使用本地 HTTP server + 可用 Chrome/Chromium 运行 Playwright smoke test：跨 frame Fetch/XHR、observe、截图和多步 action。
- [x] 验证 `run.sh start/status/control/stop/craft` 基础流程。
- [x] 比较 `.claude` 与 `.codex` 两份 skill 的文件清单和哈希。

## 7. Flower 快照与跨仓检查

- [ ] skill-garden 实现通过后，按多仓提交顺序先形成 skill-garden 提交。
- [ ] Flower 根仓库更新 `vendor/skill-garden` pin，运行 `npm run sync` 生成 `enhancements/common` 与 MANIFEST。
- [x] 验证快照中的 craft-rpa 与 submodule 真实源一致。
- [x] 运行 Flower 根仓库与 common skill 分发相关的针对性测试；全量检查由 Check-All 决定。

## 8. Plugin 重放回归修复

- [x] 将 Craft RPA profile、session 文件和依赖安装目录迁到 `.craft-rpa/`，删除新版软链创建逻辑。
- [x] 首次启动精确清理旧软链和 recorder `node_modules`，保留真实 profile 与历史 session 数据。
- [x] builtin common skill 重放扫描跳过已登记运行时路径且不跟随软链，全局 canonical tree 安全规则保持不变。
- [x] 增加“安装 -> 模拟旧版运行时产物 -> 重放”以及 run.sh 运行时目录测试。
- [x] 完成双副本、Flower 快照、针对性测试与完整发布验证。

## 风险与回滚点

- 网络 response body 读取可能失败或增加内存占用：单请求强制限额，捕获失败只降级字段，不丢事件。
- 页面 observe 可能产生大输出：JSON、ARIA、元素数、DOM 和 screenshot 均设置独立边界，文件型产物不内联 base64。
- 无鉴权控制接口依赖可信本地环境：保持 Origin 路由隔离并在文档中明确部署边界。
- `.claude/.codex/enhancements` 容易漂移：每轮验证同时检查文件清单、内容哈希和 MANIFEST sourceCommit。
- 回滚时删除新增模块并恢复 6 个既有入口文件；不修改 profile 和历史 session。
