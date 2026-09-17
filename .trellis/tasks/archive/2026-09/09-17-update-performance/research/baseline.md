# 升级性能诊断证据

## 环境与边界

- 日期：2026-09-17；源码 HEAD：`b1c574af356fa3269b24fa799f6cbeabe59bc613`。
- Linux x64，Node v22.21.1；Flower 0.6.9-beta.0，捆绑/目标 Trellis 0.6.14。
- 原项目只读；用 `createUpdateSandbox(process.cwd())` 复制受管状态至系统临时目录，最终 `disposeUpdateSandbox()` 清理。
- 没有运行真实全局 npm 安装，没有对原项目执行 update，没有修改产品源码或 node_modules。
- 这是开发容器基线，不是用户机器的复现。未测 Windows、WSL 挂载盘、杀毒软件、原生模块编译、用户网络及全局安装总时长。
- 原先未提交的 `.trellis/tasks/09-05-telemetry-roadmap/` 不属于本任务。

## 已确认的调用链

| 入口/阶段 | 源码证据 | 事实与影响 |
| --- | --- | --- |
| self-update | `src/commands/self-update.js:155`、`:210`、`:219` | 预检、全局安装、项目 update 串行执行；子 update 已传 `--no-update-check` |
| npm 安装 | `src/lib/update-check.js:167` | 精确版本 + prefer-online；ETARGET 仅重试一次，这是既有修复契约，不随意撤销 |
| postinstall | `scripts/sync-global-trellis.mjs:11` | 全局安装时执行 Trellis 同步；非全局安装跳过 |
| 普通 update | `src/commands/update.js:292`、`:295`、`:299`、`:305`、`:313` | Flower 检查、全局同步、快照、上游更新、插件重放串行 |
| Flower 远程检查 | `src/lib/update-check.js:94`、`:124`、`:456` | 拉完整 npm 根文档；dist-tags helper 也转调完整 metadata；checkForUpdate 尚未复用新鲜远程缓存 |
| self-check 缓存 | `src/lib/self-check.js:41`、`:652` | 已实现 interval、离线失效与 forceRemote；可作为统一缓存语义依据 |
| 上游版本提示 | `node_modules/@mindfoldhq/trellis/dist/commands/update.js:932`、`:1598` | 更新一开始 await npm latest，无显式 AbortSignal/业务超时，也没有可用跳过选项；只用于提示，不决定捆绑模板来源 |
| 上游提示改写 | `src/lib/trellis-runner.js:97` | Flower 目前只在收到输出后改写“升级 Trellis”提示，等待已发生 |
| 全局版本探测 | `src/lib/global-trellis-sync.js:59`、`:95`、`:132` | npm prefix 子进程 + trellis --version 子进程；相同版本会跳过安装，不是每次都重装 |
| 本地安全探测 | `src/lib/self-check.js:175`、`:225` | Git 与 Flower 命令可用性有 1500ms 单次超时；保留安全语义，列入诊断范围 |
| 相邻入口 | `src/commands/init.js:84` | init 共用 checkForUpdate，缓存与轻量查询优化可以复用 |

## 原始计时

单位 ms，三次样本；使用 `performance.now()`，子进程用 `spawnSync` 测量，全部记录退出码。

| 项目 | 第一次 | 第二次 | 第三次 | 说明 |
| --- | ---: | ---: | ---: | --- |
| Flower --version | 234 | 193 | 189 | 独立 CLI 进程，均退出 0 |
| Flower --help | 123 | 116 | 123 | 独立 CLI 进程，均退出 0 |
| 捆绑 Trellis --version | 563 | 347 | 380 | 独立 CLI 进程，均退出 0 |
| Provider 构建 | 209 | 32 | 31 | 同一进程，首次包含冷态开销 |
| Plugin replay dry-run | 353 | 209 | 207 | 同一进程、同一项目外副本；无目标写入 |
| npm prefix -g | 136 | 139 | 119 | 与第一轮上游探测并发，仅作线索 |
| 全局 Trellis --version | 875 | 523 | 466 | 与第一轮上游探测并发，仅作线索；实际版本 0.6.14 |
| 上游 update --dry-run --force | 1639 | 1801 | 1669 | 首轮与版本探测并发；均退出 0，作为初筛 |

快照创建 + 沙箱物化单次 456ms，471 个 manifest 条目；不将一次测量称为稳定中位数。

通过临时包裹 fs 同步方法计数（仅当前研究进程，结束即恢复）：

| 阶段 | readFileSync | lstatSync | statSync | readdirSync | copyFileSync |
| --- | ---: | ---: | ---: | ---: | ---: |
| Provider 构建 | 589 | 764 | 1 | 180 | 0 |
| Plugin replay dry-run | 1749 | 2309 | 317 | 423 | 0 |
| 快照 + 沙箱物化 | 1 | 1957 | 0 | 123 | 696 |

这些计数包含必须的 integrity/ownership 检查，不等于可以删除的冗余工作。当前没有足够收益证据支持重构本地事务/摘要算法。

## 网络读取实验

顺序轮转读取三个公开 npm endpoint，Node fetch、Accept application/json、外部研究计时上限 5000ms。bodyBytes 为解码后的响应体字节数，**不是压缩后的网络传输量**。

| Endpoint | 三次耗时 ms | bodyBytes | 状态 |
| --- | --- | ---: | --- |
| /flower-trellis | 1804 / 649 / 234 | 314127 | 均 200 |
| /-/package/flower-trellis/dist-tags | 353 / 268 / 262 | 40 | 均 200 |
| /@mindfoldhq/trellis/latest | 1057 / 293 / 264 | 3532 | 均 200 |

连接复用、CDN 与先后顺序会影响耗时，不能据此声称轻量 endpoint 在所有环境都更快；减少数据量和新鲜缓存内零请求是确定性收益。self-check 的 release notes 仍需保留必要 metadata 补拉。

## 上游查询隔离 A/B

在同一沙箱，使用临时 `.mjs` 引导脚本加载原捆绑 bin，不修改依赖。每轮交替 baseline / skip：两者都包裹 fetch；只有 skip 在 URL **精确等于** `https://registry.npmjs.org/@mindfoldhq/trellis/latest` 时拒绝，利用上游已有失败降级，其它 fetch 原样转发。真实调用 `update --dry-run --force`，子进程外部上限 15s。

| 轮次 | baseline ms | skip ms | 结果 |
| --- | ---: | ---: | --- |
| 1 | 1395 | 523 | 两者退出 0 且有 dry-run 完成标记 |
| 2 | 1337 | 461 | 同上 |
| 3 | 1360 | 464 | 同上 |

中位数 1360ms → 464ms，差值 896ms，约减少 66%。**这只是跳过上游独立版本提示的研究实验，尚未实现产品优化，更不是全局安装或完整 ftl update 的加速比例。** 两组都观测到一次查询调用；skip 在真实 fetch 前截断，实际发送零次该请求。

复现核心（外层负责临时目录、限时与清理）：

```js
import { pathToFileURL } from 'node:url';
const [bin, mode] = process.argv.slice(2);
process.argv = [process.execPath, bin, 'update', '--dry-run', '--force'];
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = String(input?.url || input);
  if (mode === 'skip' && url === 'https://registry.npmjs.org/@mindfoldhq/trellis/latest') {
    return Promise.reject(new Error('研究：跳过独立版本提示'));
  }
  return originalFetch(input, options);
};
await import(pathToFileURL(bin).href);
```

必须以真实 `.mjs` 文件运行，不使用 `node -e` 冒充 CLI 进程。早期 `-e` 试验触发 Commander 的 eval argv 规则并报 unknown command，所有那批 status=1 样本均已剔除。

## 新版本安装与其它待定位成本

- node-pty 1.1.0 的安装脚本是 `node scripts/prebuild.js || node-gyp rebuild`。存在编译回退可能，但未获得用户安装日志，不能断言其正在发生。
- 包含可选 keyring 原生平台包；本轮不移除依赖或改全局 npm 配置。
- 新版本下载、解包、原生依赖构建、全局 postinstall 必须由阶段计时进一步区分。当前未运行全局安装，安装总耗时未知。
- `.trellis` / Plugin 重放在高延迟小文件文件系统上可能更贵；待用户计时或 Windows CI 证据再决定缓存/遍历优化，不能按 Linux tmpfs/本地盘结果外推。
- 现有遥测是操作总耗时，且 self-update 的 beginTelemetryOperation 在预检之后；不能替代本地阶段诊断，也不在本任务扩张遥测采集。

## 本地发布载荷观测

`npm pack --dry-run --ignore-scripts --json`：727 个条目，压缩估计 1186388 字节，展开 4443061 字节；未生成 tarball、未执行 lifecycle、未安装或发布。这只计当前 Flower 自身载荷，不含传递依赖，也不能当作用户下载速度或安装耗时。
