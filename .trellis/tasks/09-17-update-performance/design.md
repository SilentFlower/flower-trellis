# Design — 升级链路性能诊断与优化

## Architecture And Boundaries

本次是一条可统一验收的升级链路优化任务，不拆为独立产品子任务。命令层编排，lib 负责计时、版本检查和上游启动；Plugin 事务层保持现有契约。

| 范围 | 主要文件 | 职责 |
| --- | --- | --- |
| 阶段诊断 | 拟新增 `src/lib/operation-timing.js`；self-update/update/init 的必要调用点 | 显式本地计时和简短阶段进度 |
| 检查与缓存 | `src/lib/update-check.js`、`src/lib/self-check.js`；按需提取 cache helper | 共享有效性规则，轻量 tags 与按需 notes |
| 上游隔离 | `src/lib/trellis-runner.js`；拟新增 ESM 子进程引导模块 | 仅 Flower 管理的 update 禁用独立上游版本提示网络请求 |
| 全局识别 | `src/lib/global-trellis-sync.js`、`scripts/sync-global-trellis.mjs` | 本地版本快路径、兼容回退和诊断 |
| 证据与文档 | `test/js`、性能基线脚本、README、CLI specs、专用 Actions workflow | 行为回归、基线、用户诊断方法和跨平台验证 |

本设计已通过用户 Brief 评审确认，任务已进入 in_progress；当前实现与本地证据见 research/results.md。

## Timing Contract

拟用 `FLOWER_TIMING=1` 启用，不增加透传给上游的 flag。只有精确启用值开启，普通帮助仍在任何计时/工作之前返回。

- 使用单调时钟 `performance.now()`；支持同步与异步阶段，finally 记录成功/失败，抛回原异常。
- stderr 输出固定阶段 ID、中文动作、elapsed 毫秒和结果，不记录 target/argv/URL/环境值；不写入项目状态或遥测。
- 调用前打印开始，避免 spawnSync 期间完全无反馈；调用后打印耗时。关闭时不输出计时，既有长步骤用正常中文进度行。
- self-update 总耗时包含预检（现有遥测起点较晚）；installFlowerVersion 包裹全局安装，包括 postinstall。后续子 update 自己打印子阶段，父 project-update 是包含关系，不能把父子相加。
- 完成菜单前冻结执行耗时；人工确认单独标为交互阶段或清楚标注其包含关系，不能把等待用户退出当执行变慢。
- 禁止为计时增加读盘、联网、Git 扫描或引用计时器拖延进程退出。已有遥测字段和分母不修改。

## Remote Check Flow

提取/复用 self-check 的有效缓存条件，避免两个入口复制规则或形成 self-check/update-check 循环 import。缓存仍使用原 `.flower/update-check.tmp` 与配置；不新增 schema。

1. 先处理禁用、policy=off、npx 边界和本地版本事实。
2. 非 forceRemote 且缓存有效，复用 lastRemote；本地一致性照常读取，prompt suppression 与远程缓存独立。
3. 无可用缓存时，只读取公开 dist-tags endpoint 并校验 latest/beta。失败按原离线/静默规则降级，不把错误状态续期。
4. 只有新版本或项目追平需要摘要时，先校验 notes 缓存的 from/to/channel，再按需读取完整 metadata。保留项目追平时缺 notes 的补拉及其只写 notes 的约束。
5. 远程 tags 成功和 notes 失败分开处理：有效 tags 仍可推荐更新；摘要标 unavailable，不能覆盖旧的可用 notes，也不能因摘要失败伪造版本证据。
6. 一轮实际网络工作共享绝对 deadline 5000ms，包括响应体读取；补拉使用剩余预算，避免新增串行请求后最坏时间翻倍。有效缓存但仅 notes 补拉的独立分支从补拉起计算原预算。
7. `--force-remote` 与 self-update 的现有强制检查继续绕过 interval；manual 只绕过 prompt suppression，不绕过 policy/npx/安全检查。

保留 `fetchPackageUpdateMetadata()` 的公开返回结构；`fetchPackageDistTags()` 才真正走轻量 endpoint。现有注入 fetchMetadata 的测试替身应明确迁移/兼容，不能通过只改 mock 绕开真实请求路径验证。网络查询触发的原遥测事件沿用原语义，不因缓存命中虚构一次远程查询。

## Flower-Managed Upstream Update

当前 pinned 0.6.14 没有关闭 npm latest 提示的 flag。不能向它传不存在的参数，也不改 node_modules。

拟在两个 runner（普通 spawn 和 PTY）中加入显式内部启动选项，只有 update 编排与跨版本 sandbox 启用。为此执行随 Flower 打包的 ESM 引导模块：

1. 接收已由 resolveTrellisBin() 确认的捆绑 bin 与原参数，恢复上游期望 argv 后动态加载原 bin。
2. 仅在当前子进程的 Flower update 模式下，对 GET/默认 GET 且 URL 精确为 pinned 上游 `https://registry.npmjs.org/@mindfoldhq/trellis/latest` 的 fetch 走已有“版本不可查询”的降级路径，不发送网络。
3. 不伪造远端版本。将这一已知上下文的“Latest on npm unavailable”提示显示为中文“捆绑 Trellis 版本由 Flower 管理，跳过独立版本查询”。未启用该选项时不得改写该提示。
4. 其它 URL、方法、Request 对象及其它命令保持原 fetch 行为；不触碰 proxy dispatcher、模板/registry下载、降级保护和迁移逻辑。
5. 保留 stdio/PTY、退出码、SIGINT、Windows 终端恢复与参数转义；不使用 node -e（Commander 会按 eval 模式重解释 argv）。

研究 A/B 已证明可行且产生约 896ms 的该阶段中位收益。真实集成需验证普通/PTY 两条启动路径以及打包后入口存在。未来升级 pinned Trellis 时必须通过合同回归检测 URL/实现漂移；若上游新增受支持的原生开关，优先使用原生开关。

## Global Version Fast Path

npmGlobalPrefix() 继续优先使用 npm 生命周期提供的 prefix。识别实际安装版时，结合该 prefix 的候选 package.json、合法 package name/version/bin 和入口真实指向证明是同一全局安装；不从当前捆绑依赖或 PATH 上任意同名文件推断。

- 证据完整时只读本地 metadata，避免启动 Trellis 全量 CLI。
- 证据缺失、损坏、软链指向自定义位置或 Windows launcher 无法证明归属时，回退现有 globalTrellisVersion()。
- 不做跨进程持久缓存；安装成功后不得继续使用安装前的版本证据。
- 不省掉全局同步、不新增 npm install 次数、不移除 prefer-online 与 ETARGET 一次重试。真实安装日志输出与错误码要保持。

如果无法以现有布局安全实现某平台快路径，先保留回退并报告覆盖范围；不能将未验证的平台算作快路径验收通过。

## Compatibility And Safety

- 缓存只优化可选检查；metadata 的 release notes/通道/离线语义是强约束。
- 本地快照、备份保留、配置恢复、Plugin integrity/ownership、disabled 包装和外部节点冻结均维持。
- 不加入全局 NODE_OPTIONS，不改用户代理、npm registry、凭据和用户目录配置。
- 工具下载与原生模块编译不被本任务短路；新版本安装慢仍可能由外部因素决定，诊断必须显示真实阶段。
- 单纯写 src/lib 会改变 builtin digest，最终集成须运行现有重复重放与锁状态回归。

## Validation And Rollback

以请求次数/子进程次数作确定性断言；真实时间报告样本而非硬编码跨机器秒数。相同 fixture、相同网络模拟和缓存状态下取至少五轮；网络 0/200/1000ms 与挂起响应场景覆盖完成时间边界。完整 update 用隔离 prefix 或受控 npm 替身，禁止测试改全局安装。

对 help/JSON、同/跨版本、反复更新、失败恢复、disabled、外部 Plugin 与 PTY 回归。专用 CLI Actions 至少 Ubuntu/Windows；既有 Python 3.8/3.12 矩阵保持。最终提交 SHA 的必需矩阵通过才完成跨平台验收。

无需数据迁移；可按计时、检查/缓存、runner、全局识别四块回退。回退任何优化时不得遗留环境污染、临时引导文件或不同版本锁状态。
