# Brief — 新增 Maven 分层验证与证据复用 Skill

## Goal

- 新增通用 `trellis-maven-verify` Skill，为 Trellis implement 和 Check-All 提供 Maven 多模块项目的分层验证、生命周期裁剪与可审计证据复用，减少大型 reactor 在实现、修复和重检阶段的重复构建，同时不降低最终验证覆盖。

## Scope

- 在 `vendor/skill-garden/.trellis/0.6/` 新增 `.agents` / `.claude` 双副本 `trellis-maven-verify` Skill，并通过现有平台投影机制分发。
- 新增标准库 Python 助手 `.trellis/scripts/maven_verify.py`，实现 `plan`、`run`、`check` 三个子命令。
- `plan` 根据 Git diff、reactor/POM、目标生命周期和显式消费者生成 quick/final 计划，并识别外部父 POM继承的昂贵 lifecycle goal。
- quick 默认保留 `-am` 并在确认 `maven-compiler-plugin >= 3.1` 时使用 source-stale，避免陈旧 SNAPSHOT 与无变化整模块重编；final 默认 conservative，只有任务材料确认低风险时才显式选择 source-stale。
- Skill 允许模型结合 reactor 范围与依赖拓扑、插件线程安全、测试共享资源和机器资源自行决定是否传入 `--threads`，但不得为选择并行度额外重复构建。
- Maven 默认复用项目 wrapper 或当前构建侧已安装的可执行文件，不固定安装或升级 Maven 3.9+；显式 `--maven-executable` 仍可覆盖自动选择。
- 构建侧由 Maven 根目录所在的原生文件系统决定：WSL 的 drvfs/9p Windows 盘项目使用 Windows Maven/JDK/本地仓库，不依赖 automount root 是否为 `/mnt`；WSL ext4 项目使用 Linux Maven/JDK/本地仓库；原生 Windows/Linux 分别使用本侧工具链，禁止 Maven、JDK、仓库跨侧混搭。
- `run` 使用精确 argv 执行计划、实时输出日志，并在 `.trellis/.runtime/maven-verification/` 原子写入 schema 化证据。
- `check` 只读校验证据的新鲜度和覆盖，区分 reusable、partial、stale、failed、blocked。
- 把 Maven Skill 接入 implement 自检和 Check-All 项目验证：implement 产生 final evidence，Check-All 优先复用，失效时报告精确重跑缺口。
- 增加 Bundle、脚本选择别名、平台投影、partial install、Python fixture、Node 分发以及 compiled-target/dogfood 验证。
- 使用 SRM Maven 子仓进行只读 forward-test，验证 Java 8、compile 阶段 sources jar 与 prepare-package 依赖复制的识别能力。

## Non-Goals

- 不修改 SRM 或其它业务项目的 POM、父 POM、Maven settings、本地仓库、JDK 安装或业务源码。
- 不支持 Gradle、Bazel、Ant 等其它构建系统。
- 不替代 PRD/spec 决定业务测试、消费者或发布验收范围。
- 不自动运行 deploy、上传制品、清理 target/本地仓库或迁移缓存；不把并行度选择扩展成额外 Maven 对比执行。
- 不建设 Maven daemon、远程缓存或分布式构建平台。
- 不自动复制或迁移 Maven 本地仓库；只诊断高延迟文件系统，并允许调用方用 `--local-repository` 选择已准备好的仓库。
- 不下载、安装或强制升级 Maven；Maven 3.9+ 特性只在当前已选 Maven 实际支持时使用。

## Key Decisions

- Skill 名称固定为 `trellis-maven-verify`，采用自动路由 Skill，而不是手动 Maven 命令说明。
- 首版模式固定为 `quick`、`final`、`reuse`：分别服务迭代反馈、implement 收口和 Check-All 复用。
- 使用一个确定性 `maven_verify.py` 脚本承载 `plan/run/check`，避免多个脚本重复 Git/POM/证据逻辑。
- 普通验证默认停在 `compile`；只有测试验收进入 `test`，只有制品验收进入 `package` 或更后阶段。
- 不默认使用 `clean`、`package`、`install`、`deploy` 或 `-amd`；并行参数由模型按当前项目判断，任何升级生命周期或 source-stale final 都必须说明覆盖收益和剩余风险。
- 自动工具链选择优先项目同侧 wrapper，其次同侧 `PATH` 中的 Maven；计划、effective POM、run 和 evidence 必须冻结同一个构建侧及执行包装。
- skip 参数必须由当前插件/effective model 证明确实支持；SRM 已确认 `maven-source-plugin` 支持 `-Dmaven.source.skip=true`，但不硬编码 SRM 特例。
- evidence 按 Git/POM/命令/模块/生命周期/工具链指纹失效；compile/test/package 和 sources 等附属制品采用严格覆盖关系，低等级结果不能冒充高等级验收。
- Check-All 保持 audit-only：只允许调用 `maven_verify.py check`，不在只读 subagent 中运行会写 target、本地仓库或缓存的 Maven goal。
- canonical source 先修改 `vendor/skill-garden/.trellis/0.6/`，再同步 `enhancements/0.6/`，最后通过 Flower Plugin 生命周期更新 dogfood。

## Key Context

- SRM 根 POM有 17 个顶层模块，历史 `-am` 定向构建常拉起 19～29 个 reactor 模块，并在 implement、修复和 Check-All 之间重复执行。
- SRM 外部父 POM把 `maven-source-plugin:jar` 绑定在 `compile`；普通 compile 也会逐模块生成 sources jar。
- SRM 多个应用模块把 `maven-dependency-plugin:copy-dependencies` 绑定在 `prepare-package`；现有三个应用 `target/lib` 合计约 641 MiB、1338 个 JAR。
- SRM 默认运行时 JDK 为 21，但项目目标为 Java 8；Maven 本地仓库位于 WSL `/mnt/d`，会放大大量小文件访问成本。
- SRM 实测确认本地仓库文件系统是首要瓶颈：无改动单模块 compile 从 `/mnt/d` 9p 的 111.89 秒降到 ext4 的 3.94 秒；27 模块 final 增量构建从 8:10.23 降到 1:35.14。
- 在全 WSL/Linux Java 8、Maven、项目和 ext4 仓库条件下，SRM 验证确认 source-stale 在保留 27 项 reactor 上游时不会因 classpath 时间戳变化整模块重编，并会在单个 class 过期时确实重编对应源文件。
- Check-All 的 owner 契约要求 audit-only、light/full 覆盖实际变更范围；Maven evidence 只能补充项目验证，不能代替三件套、实现假设和规范审查。
- Skill-Garden 平台投影由 `ENHANCEMENT_SKILL_TARGETS` 和 Plugin state ownership 统一管理；选择性安装必须携带脚本依赖闭包。

## Risks / Deferred

- effective POM解析失败时若仍宣称完整，会遗漏外部父插件绑定；实现必须失败关闭或降低置信度并要求显式输入。
- evidence 指纹过窄会错误复用，过宽会抵消性能收益；自动化测试需覆盖源码、测试、POM、模块、生命周期和 JDK变化。
- quick source-stale 不能替代公共 API/DTO/常量、注解处理器、POM、资源契约或跨模块协议变化后的 conservative final；final 风险口径仍由任务材料和调用方确认，脚本不从文件名猜测业务语义。
- `npm run sync` 会机械刷新快照，dogfood 又受 Flower ownership 管理；实施时需防止 source/snapshot/deployed 三层漂移或覆盖用户内容。
- Gradle 等其它构建系统和 Maven 远程缓存优化延后，不纳入首版。

## Acceptance

- `trellis-maven-verify` 双 canonical 副本通过 Skill quick validation，并能在所有已启用平台正确投影。
- `maven_verify.py plan` 在隔离单/多模块 fixture 中稳定定位变更模块，识别 compile sources jar、prepare-package copy-dependencies，并生成 quick/final 计划。
- Windows、WSL 和 Linux 的工具链选择、路径转换与混搭阻断有自动化测试；WSL Windows 盘 fixture 能通过 Windows Maven/JDK 完成 plan/run，WSL ext4 fixture 继续使用 Linux 工具链。
- `run` 精确执行 argv、实时记录日志，成功和失败均生成 schema 化证据；`check` 能正确判定复用、部分覆盖、失效、失败和阻塞。
- compile/test/package、测试跳过和 sources 等附属制品覆盖矩阵有自动化测试，禁止错误升级证据等级。
- implement 产出的 final Maven evidence 在 worktree 未变化时能被 Check-All 复用；变化或覆盖不足时只报告精确重跑计划，不无条件全仓构建。
- Check-All light/full 与专用 audit-only subagent 都遵守只读证据检查边界，不执行写构建缓存的 Maven goal。
- 选择性安装 Maven Skill 或 Check-All 均获得 `maven_verify.py`；full/partial install、平台投影和 Plugin replay 测试通过。
- `npm run sync`、compiled targets、dogfood ownership、Python/Node 定向测试、`npm test`、`npm pack --dry-run --json` 和 `git diff --check` 全部通过。
- SRM 只读 forward-test 能识别 Java 8、外部父 POM sources 绑定和应用模块依赖复制，且不修改业务仓文件或执行完整 reactor。

## Next Step

- 确认本 Brief 后运行 `task.py start`，再通过 `trellis-route(target=implement)` 进入实现，首先加载 `trellis-before-dev` 并建立 Skill/脚本 fixture 骨架。
