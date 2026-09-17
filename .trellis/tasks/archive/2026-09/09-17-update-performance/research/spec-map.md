# 性能任务规范加载地图

两份源规范超过单文件注入上限；本文件只指向规范，不代替规范正文。进入实现/检查前按以下章节读取最新源文，不得把注入截断视为已读完。

## Config And State

文件：`.trellis/spec/flower-trellis/cli/config-and-state.md`。

- `Network Probe`（当前 66–110 行）：联网、全局升级和通道语义。
- `Scenario: Update Command Passthrough Boundaries`（111–310）：上游参数、整体事务/沙箱和配置边界。
- `Update-Check State`（679–699）：缓存 schema 和状态。
- `Scenario: Startup Self-Update Check`（793–1085）：自检、自更新、notes、节流/强制与关闭契约。
- `Scenario: Update Backup Retention`（1086–1193）：测试时应保留的备份清理边界。

行号是规划时导航，实施前按 heading 校正。

## Plugin Runtime

文件：`.trellis/spec/flower-trellis/cli/flower-plugin-runtime.md`。

- `Platform And Install Plan`、`Transaction And Lifecycle`、`Optional Runtime Boundaries`、`Builtin Skill-Garden`：本任务不削弱路径、摘要、冻结节点、幂等及恢复边界。
- `Validation & Error Matrix`、`Tests Required`：确定集成更新/恢复测试选择。

其它核心规范已直接写入 implement/check.jsonl；JSONL 中的项目文件必须结合本地图实际读取，不能仅凭摘要执行。
