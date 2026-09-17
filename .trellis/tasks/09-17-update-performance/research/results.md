# 最终性能对照与验证证据

## 环境与复现

- 日期：2026-09-17；Linux x64 / Node v22.21.1 / Flower 0.6.9-beta.0 / Trellis 0.6.14。
- 优化前基线：`b1c574af356fa3269b24fa799f6cbeabe59bc613`；优化后实现已提交为 `94788f4023b2af047e71b4689bc3716bed32fd21`。
- 复现：`node scripts/benchmark-update.mjs b1c574a`。每组五轮，完整原始数据在 `benchmark.json`。
- 最终采样在全套测试结束后顺序运行；之前与测试并行的试跑不计入本表。
- 隔离临时项目、npm prefix 与 baseline checkout；不联网、不执行全局安装。版本查询的延迟与 metadata 大小是受控夹具，不代表真实网络下载。

## 完整更新预演

执行真实 `flower-trellis update --dry-run --force`，Flower 自身版本检查关闭，上游提示请求模拟 200ms 延迟，prefix 固定为相同捆绑版本。包含 CLI 启动、全局识别、真实 PTY 上游与 Plugin 预演。所有轮次退出 0 且有 Plugin 完成输出。

| 版本 | 中位数 ms | 范围 ms | 全部样本 ms | 提示请求/轮 | 版本探测子进程/轮 |
| --- | ---: | --- | --- | ---: | ---: |
| before | 2144 | 2074–2354 | [2354, 2074, 2178, 2144, 2115] | 1 | 1 |
| after | 1524 | 1428–1681 | [1475, 1681, 1605, 1428, 1524] | 0 | 0 |

本环境预演中位数减少 620ms（28.9%）。这是固定场景的完整预演，不是全局安装或真实项目写入的提速承诺。

优化后阶段样本（第三轮）：

```text
  · [耗时 update/总计（包含子阶段）] 开始
  · [耗时 update/版本检查（含确认等待）] 开始
  · [耗时 update/版本检查（含确认等待）] 完成 0 ms
  · [耗时 update/同步全局Trellis] 开始
  · [耗时 全局Trellis/定位安装] 开始
  · [耗时 全局Trellis/定位安装] 完成 0 ms
  · [耗时 全局Trellis/读取版本] 开始
  · [耗时 全局Trellis/读取版本] 完成 1 ms
  · [耗时 update/同步全局Trellis] 完成 3 ms
  · [耗时 update/上游更新（含交互等待）] 开始
  · [耗时 update/上游更新（含交互等待）] 完成 557 ms
  · [耗时 update/插件重放] 开始
  · [耗时 update/插件重放] 完成 471 ms
  · [耗时 update/清理旧备份] 开始
  · [耗时 update/清理旧备份] 完成 0 ms
  · [耗时 update/总计（包含子阶段）] 完成 1050 ms
```

阶段总计从命令实现入口开始；外层总时间还包含 Node/模块加载。父阶段包含子阶段，不能累加。

## 版本检查场景

下表均为五轮中位数；字节数仅是 JSON 夹具体积。完整每轮请求数与字节数见原始 JSON。

| 请求延迟 ms | 场景 | before ms | after ms | before 请求 | after 请求 |
| ---: | --- | ---: | ---: | ---: | ---: |
| 0 | cold-current | 16 | 7 | 1 | 1 |
| 0 | warm-current | 9 | 0 | 1 | 0 |
| 0 | new-version | 13 | 11 | 1 | 2 |
| 0 | project-out-of-sync | 250 | 203 | 1 | 2 |
| 200 | cold-current | 214 | 208 | 1 | 1 |
| 200 | warm-current | 214 | 0 | 1 | 0 |
| 200 | new-version | 214 | 414 | 1 | 2 |
| 200 | project-out-of-sync | 424 | 617 | 1 | 2 |
| 1000 | cold-current | 1016 | 1009 | 1 | 1 |
| 1000 | warm-current | 1010 | 0 | 1 | 0 |
| 1000 | new-version | 1014 | 2020 | 1 | 2 |
| 1000 | project-out-of-sync | 1200 | 2202 | 1 | 2 |

无更新的冷缓存仍要一次网络往返，但只读标签；热缓存零请求。发现新版或项目追平且需要摘要时，新流程会先读标签再读 metadata，比旧流程多一次往返；固定 1000ms 延迟下多约 1 秒。这是已规划的按需摘要取舍，不宣称每个场景都提速。标签与摘要共享 5 秒预算，响应体挂起和耗尽预算不再请求由行为测试覆盖。

## Plugin 本地阶段

另用 `createUpdateSandbox(process.cwd())` 构建同一副本，加载 baseline/current 的 `replayPlugins(..., true)`，先各预热一次，再交替五轮，禁用网络与遥测。未修改原项目，结束后清理副本。
- before：[326, 292, 293, 302, 299]ms；中位数 299ms。
- after：[288, 264, 284, 258, 276]ms；中位数 276ms。

本次未见 Plugin 阶段成本增加；不把这一小样本差异归因于优化或外推为插件加速。首次测量因临时归档输出超过 spawnSync 默认缓冲而失败，尚未运行阶段，已剔除；显式 10MiB 缓冲后的五轮全部成功。

## 验证与边界

- `npm test`：退出 0；598 个 JS 测试中 596 通过、2 个 Windows 原生场景在 Linux 合理跳过；382 个 Python 测试完成、2 个跳过。Patch 52 / operation 163 / ready target 1008 零冲突；891 个 compiled 文件零漂移；输出模板通过。
- context budget 的既有 `states-total` 为 13217B，超过建议目标 12288B、低于 review 14336B；本任务未修改该上下文源或上调阈值。
- 最后追加的全局真实路径边界与恢复失败计时断言：定向 6/6 通过；实际新 CLI 也用于最终五轮基准。
- 新真实 CLI 集成测试包含临时 init、重复真实 update、同/跨版本预演、中文/空格/& 路径、配置保留、独立上游查询对照、降级拒绝、help/JSON/version 和卸载预演。
- 19 个改动/新增 JS 文件语法通过，benchmark 与 JSDoc 后续变动补查通过；`git diff --check` 通过。
- `npm pack --dry-run --ignore-scripts --json`：731 项；四个新增运行模块全部进入发布载荷，没有执行发布/安装。
- 新 workflow YAML 与 13 个测试入口存在性通过；Windows/Ubuntu 原生 CI 必须验证最终 headSha；首轮远端结果见下方，任务尚不能标记 completed。
- npm 真实下载、解包、原生构建、用户机器文件系统及安装总耗时未测；仅新增本地阶段诊断供继续定位。

## 最终补修与重检证据

- 在已确认 R1 范围内补齐交互升级的 `process.exit(0)` 分支：退出前结束全局安装、版本检查与父总计；安装失败记录失败并继续旧版主流程。网络空结果也标记该阶段失败。
- 补修后按新 workflow 的完整 13 套列表重跑：135 项中 134 通过，Windows hook 原生场景在 Linux 跳过 1 项；额外计时补测 3/3 通过。全量 npm test 的未受影响证据继续复用，不把新增子用例计入之前的 598 项。
- 本文最终 JSON 在补修完成后重新采样；全部五轮退出 0。源码及新增测试语法与 diff 复查通过。
- 用临时 npm exec Node 18.17.0 验证新 ESM 引导的真实 argv、fetch 隔离、计时与全局模块，以及捆绑 Trellis `--version`，均通过；完整行为测试环境仍为 Node 22，不能据此声称完整 CLI 的 Node 18 兼容矩阵通过。


## 首轮原生 CI 与补修

业务提交：`94788f4023b2af047e71b4689bc3716bed32fd21`。

- [更新链路跨平台回归](https://github.com/SilentFlower/flower-trellis/actions/runs/35175234045)：Ubuntu 成功；Windows 失败。
- [SessionStart 跨平台回归](https://github.com/SilentFlower/flower-trellis/actions/runs/35175234070)：Ubuntu、Windows 均成功。
- [Python 跨平台兼容回归](https://github.com/SilentFlower/flower-trellis/actions/runs/35175234068)：Ubuntu/Windows × Python 3.8/3.12 四个 job 均成功，headSha 与业务提交一致。

Windows 更新回归发现两个根因：

1. 真实 `init --yes` 已输出安装成功，但主进程未退出，60 秒后测试超时。现有显式退出仅覆盖交互完成菜单，非交互返回后 ConPTY worker/socket 仍可持有事件循环。补修放在 Windows 顶层 init/update 命令 Promise 返回后，排空 stdout/stderr，再复用终端退出 helper，保留退出码；嵌套更新函数不强制退出宿主。
2. 四个补偿恢复测试把 POSIX `0640` 作为 Windows 预期，而实际初始权限为 `0666`。改为在创建后读取实际 mode，恢复后比较相同值；内容、目录、备份和失败退出断言保留，不跳过 Windows 用例。

补修当前仅在本地；37 项定向测试通过，包括真实 init/重复 update/沙箱预演、补偿恢复、终端及完成菜单。新增断言覆盖非 TTY 零控制序列、延后退出和原退出码保留。四个 JS 文件语法与 diff 检查通过。补修须单独确认提交范围，并以新代码 SHA 的原生 CI 重新验收；首轮失败不能按本地模拟结果改写为成功。

补修本地全量 `npm test` 退出 0：601 个 JS 测试中 599 通过、2 个平台场景跳过；Python 382 项完成、2 项跳过；Patch 52 / operation 163 / ready target 1008 零冲突，compiled 891 文件零漂移，输出模板通过。既有 states-total 13217B 告警不变。首轮原生 CI 最终 7/8 job 成功，Windows 更新回归失败；不标记任务完成。
