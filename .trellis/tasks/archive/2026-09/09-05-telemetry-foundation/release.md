# Release Operations

## Conclusion

Release operations exist.

[09-05-telemetry-foundation] 截至 2026-09-06（Asia/Shanghai），生产 D1 迁移、ai-fund Worker/Pages 部署与 Flower v0.6.5 稳定版发布均已完成。归档核对仅记录结果，不重复执行上线。后续生产验证的实际覆盖范围见本文末节。

## Evidence Checked

- `task.json`、`prd.md`、`design.md`、`implement.md`、`implement.jsonl`、`check.jsonl`、`check-report.md`、`verification/spec-update-result.json`；此前不存在 `release.md`。
- Flower 业务提交 `08598bf26638567b9183150d7c258e2f801046a4`、已推送的任务记录 `67e8b217e0eb4d1fb4183880b455be856cabcdf9`、发布提交 `33a062e2af7c0caefef27ea5caefa35ee74f95d2` 及对应文件范围。
- ai-fund 业务提交 `8315661c1648fe57e31df9fc0f82c840659d279c`、`docs/flower-telemetry-v2.md`、迁移 SQL、Worker 限流绑定与 scheduled 入口。
- 本地部署证据：`/root/project/flower-trellis/.trellis-tmp/telemetry-deploy-20260906/deployment-result.json`。
- 本地发版证据：`/root/project/flower-trellis/.trellis-tmp/flower-release-0.6.5-result.json`；[发布流水线](https://github.com/SilentFlower/flower-trellis/actions/runs/33984086473)、[v0.6.5 Release](https://github.com/SilentFlower/flower-trellis/releases/tag/v0.6.5)。本地原始证据位于 gitignored 目录，关键结果已保留在本文。
- 归档前当前任务目录 clean，`main` 与 `origin/main` 同为 `33a062e2af7c0caefef27ea5caefa35ee74f95d2`，无 ahead、暂存或冲突。

## Drift Check

Missing release.md.

[09-05-telemetry-foundation] 任务规划、检查报告与 ai-fund 发布准备文档描述的是各自产生时的本地交付状态，尚未记录随后获准执行的部署和发版。本文件补齐实际上线结果；历史验证记录和业务完成时间保持其原始含义。部署证据中的“Flower 客户端尚未发版”已由后续 v0.6.5 发布结果更新。

## SQL Changes

[09-05-telemetry-foundation] 已对生产 `ai-fund-db` 执行 `worker/migrations/20260906_flower_telemetry_v2.sql`：新增 `flower_telemetry_events`、`flower_activity_daily`、`flower_telemetry_observations` 三表及五个索引。迁移采用 `CREATE TABLE/INDEX IF NOT EXISTS`，上线时已保留恢复点并回读 schema 与本地迁移比对。不得因归档重复执行迁移或删除事实。

## Configuration Changes

[09-05-telemetry-foundation] 沿用 Worker 的 `DB`、`TELEMETRY_GLOBAL_RATE_LIMITER` 与 `TELEMETRY_DEVICE_RATE_LIMITER`；新写入口缺少限流绑定时返回 503。没有新增密钥或需要用户填写的环境变量。日清理接入现有 scheduled 路径，配置随 Worker 部署。

[09-05-telemetry-foundation] 客户端沿用用户级遥测总开关；`FLOWER_NO_TELEMETRY` 非空临时禁用且零写入，持久 disable 停止采集并清理待发。会话活动 hook 仅由 Claude Code/Codex 的 0.6 full 正常安装/升级交付。

## Batch / Deployment Scripts / Data Repair

[09-05-telemetry-foundation] 已部署 ai-fund 提交 `8315661`：Worker version `27102721-911f-4dd4-ae6c-e73a6dfb7c34`，deployment `9f2300f0-588f-451c-a527-89be5d775a76`，流量 100%；Pages production/main deployment `67d6199a-33ab-464e-8402-b52c3f520a7c`。

[09-05-telemetry-foundation] 已通过 tag `v0.6.5` 触发 Flower 发布流水线，npm `latest=0.6.5`，CI success，发布说明与 CHANGELOG 一致，npm tarball SHA512 和八个遥测模块/资产内容已校验，provenance attestations 存在。没有数据回填或一次性修复；不能从 v1 最近上报补造 v2 历史活动。

## External Systems / Dependent Platforms

[09-05-telemetry-foundation] Cloudflare D1/Workers/Pages 与 npm/GitHub 发布均已完成。管理入口为 [Flower 安装监控](https://ai.hub.flower-cli.com/trellis)。现有客户端需正常升级后才具备新采集能力；未覆盖平台不推断活动，也不解释为零使用。

## Release Order

[09-05-telemetry-foundation] 本次已按 D1 三表/索引就绪 → 向后兼容的 Worker → 管理页面 → Flower v0.6.5 的顺序完成。后续实例通过 `flower-trellis self-update` 升级并按正常项目更新流程获得 hook，不手改用户原生 handler。

## Rollback Notes

[09-05-telemetry-foundation] 出现问题时，发布执行者按各仓已有流程回退 Worker/Pages 或停用客户端遥测；`flower-trellis telemetry disable` 清待发，临时环境变量禁用不撤回在途请求。保留 v1、新表及事实证据，不 DROP 表、不重建设备 ID、不通过篡改 hook 模拟回退。旧 Worker 不接收 v2 时，由客户端有限队列与退避处理。

## Post-release Verification

- [09-05-telemetry-foundation] 已完成生产 schema 回读、匿名 analytics 401、v1 非法请求 400、v2 非法 envelope 400、v2 合法 envelope 内非法事件 200/rejected，以及生产 HTML/遥测 chunk 与构建产物一致性检查；没有写入合成事实。部署验证时三张新表均为空，该计数不是持续实时状态。
- [09-05-telemetry-foundation] 已完成 npm latest、GitHub Release、CI、发布说明、tarball 完整性及遥测文件内容验证；本次归档复用这些已落盘证据。
- [09-05-telemetry-foundation] 后续由发布执行者在实际授权的生产使用中核验管理员 200、普通用户 403、新事件入库/同 ID 幂等和有效 v1 接收。本次生产未使用已登录会话或合成事实；相关功能已通过隔离 Worker/SQLite/浏览器验证，不能替代真实生产验证。
- [09-05-telemetry-foundation] 观察每日 scheduled 清理执行情况；本次未提前触发生产作业。events/daily 超过 180 天的事实每表每次最多清理 1000 行，首次观测锚点保留到设备删除。
- [09-05-telemetry-foundation] 初期零样本与回访“观察中”符合口径；7/30 日回访须观察窗结束后再经过 72 小时补传宽限。实际收到的样本受开关、离线、强杀和平台覆盖影响。
