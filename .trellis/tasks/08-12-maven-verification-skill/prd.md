# 新增 Maven 分层验证与证据复用 Skill

## Goal

新增通用 `trellis-maven-verify` Skill，为 Trellis implement 与 Check-All 提供 Maven 多模块项目的分层验证、生命周期裁剪和可审计证据复用能力，减少 Java 8 等大型 reactor 项目在实现、修复重跑和检查阶段重复执行昂贵构建的等待时间，同时不降低最终验证覆盖。

## Background

- `trellis-implement` 当前要求在交付前运行变更范围内的 lint/typecheck；Java/Maven 项目通常会把它解释为 Maven 编译或测试。
- Check-All 要求验证命令覆盖实际变更范围，但缺少统一的验证证据格式和失效判定，容易再次运行相同 Maven reactor。
- SRM 案例中，目标模块的 `-am` 会带起 19～29 个 reactor 模块；实现、修复和重检可能重复运行同一链路。
- Maven 生命周期可能包含超出验证目标的昂贵绑定。SRM 的外部父 POM把 `maven-source-plugin:jar` 绑定到 `compile`，普通 `mvn compile` 也会为各模块生成 sources jar；多个应用模块还在 `prepare-package` 绑定 `dependency:copy-dependencies`，一次 `package` 可复制数百 MiB 依赖。
- SRM 的 Maven 本地仓库位于 WSL 挂载盘 `/mnt/d`，大量小文件访问会进一步放大插件扫描、压缩和依赖复制成本；该环境事实只能用于诊断和提示，通用 Skill 不得硬编码本机路径。
- SRM 实测中，同一无改动单模块 compile 使用 `/mnt/d` 的 `9p` 本地仓库耗时 111.89 秒，使用内容一致的 ext4 临时仓库耗时 3.94 秒；27 模块 final 增量构建从 8:10.23 降至 1:35.14。Skill 必须把高延迟本地仓库提升为一等诊断，并允许调用方显式选择已准备好的替代仓库。

## Requirements

### R1. Skill 入口与职责边界

- 新增自动路由 Skill `trellis-maven-verify`，覆盖 Maven 多模块编译慢、reactor 过大、生命周期插件额外开销、验证证据复用等场景。
- Skill 只负责 Maven 验证计划、执行和证据，不负责修改业务代码、决定业务测试口径、发布制品或替代 Check-All 审计。
- 首版只支持 Maven；Gradle、Bazel 等构建系统不在本次范围内。
- Skill 必须区分 `quick`、`final`、`reuse` 三种使用意图：
  - `quick`：编码过程中的快速反馈，保留必要上游 reactor，并优先使用可证明兼容的源文件 stale 编译语义，避免本地旧 SNAPSHOT 和无变化整模块重编。
  - `final`：implement 收口验证，覆盖目标模块、必要上游和显式消费者；默认保持 Maven 保守编译语义，只有任务材料确认低风险内部变化时才允许显式选择源文件 stale 编译。
  - `reuse`：Check-All 校验证据是否仍覆盖当前 diff 和要求，只有失效或覆盖不足时才要求重跑。

### R2. 确定性 Maven 助手

- 提供项目运行时脚本 `.trellis/scripts/maven_verify.py`，至少包含 `plan`、`run`、`check` 子命令。
- `plan` 必须基于真实 Git diff、Maven reactor/POM、目标阶段和用户或任务给出的消费者范围生成计划，不得猜测模块名、测试类或 JDK 路径。
- `plan` 必须识别 Maven 本地仓库所在文件系统；命中 WSL `9p` / `drvfs`、CIFS/NFS 等高延迟小文件文件系统时输出明确性能警告，并支持 `--local-repository` 把同一路径冻结进 effective POM、执行 argv 与 evidence。
- `plan` 必须识别生命周期中的额外 goal，至少覆盖：
  - `maven-source-plugin` 的 `jar` / `jar-no-fork`；
  - `maven-dependency-plugin:copy-dependencies`；
  - Spring Boot repackage、shade、assembly、javadoc、frontend 等常见制品型或生成型 goal。
- 对外部父 POM继承的插件，必须通过 Maven effective model 或等价真实证据识别；只扫描当前仓库原始 POM 不足以宣称未绑定。
- 只有确认当前插件支持对应参数时才能建议 skip 参数。SRM 中 `maven-source-plugin` 已确认支持 `-Dmaven.source.skip=true`，但通用脚本不得把未经识别的 skip 参数套给其它插件。
- `run` 必须执行计划中的精确 argv，保留 Maven 实时输出，记录退出码、耗时、环境和结构化结果；不得默认加入 `clean`、`package`、`install`、`deploy` 或并行参数。
- `plan` 必须支持 `--compile-strategy auto|conservative|source-stale`：`auto` 在 quick compile 且确认 `maven-compiler-plugin` 兼容时选择 `source-stale`，在 final 中选择 `conservative`；显式 `source-stale` 不得用于 compile 之外的 lifecycle。
- `source-stale` 只能在 effective model 确认 `maven-compiler-plugin >= 3.1` 时添加 `-Dmaven.compiler.useIncrementalCompilation=false`。兼容性未知时，quick auto 降级为 conservative 并报告原因；显式请求必须失败关闭。
- `plan` 可以接受显式 `--threads <count|multiplierC>` 并生成 Maven `-T` 参数，但不得自动猜测线程数或默认开启并行；调用方必须已经从项目规则、插件线程安全证据或用户授权确认可并行。
- `check` 必须只读校验证据，不触发 Maven 构建、不修改源码或构建缓存。

### R3. 生命周期裁剪规则

- 普通编译验证默认停在 `compile`；只有测试验收需要时进入 `test`，只有制品验收需要时进入 `package` 或更后阶段。
- `quick` 默认不运行 `clean`，不生成 sources/javadoc/assembly 等与当前验证目标无关的附属制品，并使用 `-am` 保留当前 reactor 上游，避免读取陈旧本地 SNAPSHOT。
- `final` 可以使用 `-am` 覆盖上游，但消费者范围必须来自任务材料、项目 spec、反向依赖分析或调用方显式输入；不得用全仓 `-amd` 代替影响分析。
- quick 的 `source-stale` 结果只用于迭代反馈，不自动覆盖 final。它按源文件与 class 时间戳编译，不能替代跨模块 API/ABI、常量内联、注解处理器或 POM变化后的保守 final。
- final 默认使用 conservative；调用方只有在任务材料明确确认“模块内部低风险变化、无公共 API/DTO/常量/注解处理器/POM/资源契约变化”时，才可显式选择 `source-stale`。
- `package`、`install`、`deploy` 以及会复制依赖或生成发布制品的 goal 必须在计划中显式说明原因和额外成本。
- 构建阶段和跳过项必须进入证据，Check-All 能区分“编译通过”“测试通过”“制品通过”，不得相互冒充。

### R4. 验证证据与失效规则

- 验证证据保存在 gitignored 的 `.trellis/.runtime/maven-verification/`，不得写入任务规格、业务源码或版本库。
- 证据必须使用带 `schemaVersion` 的 JSON，至少记录：
  - Git 仓库、HEAD、staged/unstaged/untracked 内容指纹；
  - Maven 根目录、reactor/POM 指纹、目标模块和覆盖模块；
  - 完整 argv、工作目录、目标生命周期、skip 项和 offline 状态；
  - Java/Maven 版本与可确认的本地仓库位置；
  - 开始/结束时间、耗时、退出码、测试统计和日志路径；
  - 证据覆盖等级与未覆盖风险。
- 证据复用至少要求代码指纹、POM 指纹、命令语义、目标模块、生命周期覆盖和工具链约束仍匹配。
- 以下任一变化必须使相关证据失效或降级为部分覆盖：源码/测试/POM变化、目标模块或消费者扩大、所需生命周期提高、JDK 主版本不匹配、之前命令失败、日志/证据损坏。
- `compile` 证据不得满足 `test` 或 `package` 要求；跳过测试的结果不得宣称测试通过；跳过 sources 的结果不得满足 sources 制品验收。
- Check-All 报告必须说明证据是“复用”“重跑”“部分覆盖”还是“阻塞”，并展示失效原因或剩余风险。

### R5. Trellis 集成

- `trellis-implement` 的通用职责仍是实现与自检；遇到 Maven 项目时应调用 `trellis-maven-verify` 生成 quick/final 计划并产出证据，而不是自行拼接宽泛生命周期。
- `trellis-check-all` 保持 audit-only。它只能调用 `maven_verify.py check` 读取证据；证据有效时复用，无效时报告所需精确重跑计划，由具备写构建缓存权限的主会话或 implement 路径执行。
- 不得让只读 Check-All subagent 运行会写 `target/`、本地仓库或其它缓存的 Maven goal。
- 既有非 Maven 项目验证流程保持不变；没有 `pom.xml` 时 Skill 明确 N/A，不改变 Check-All 结论规则。

### R6. Skill-Garden 分发与所有权

- canonical authoring source 位于 `vendor/skill-garden/.trellis/0.6/`；同步生成 `enhancements/0.6/`，不得只修改本仓 dogfood 或已部署项目副本。
- `.agents` 与 `.claude` Skill 副本必须内容一致，并通过现有 `ENHANCEMENT_SKILL_TARGETS` 投影到支持的平台根。
- 选择性安装 `trellis-maven-verify` 时必须同时投影 `maven_verify.py`；只选择 Check-All 且其契约依赖证据检查时也必须具备该脚本。
- 更新必要的 Skill 元数据、选择别名、Bundle/Patch 契约和平台分发测试，保持 full 与 selective 安装一致。

### R7. 安全与兼容

- 不修改用户 Maven `settings.xml`、POM、JDK 配置或本地仓库位置；性能建议只作为计划诊断输出。
- 不自动删除 `target/`、本地 Maven 仓库或历史证据。
- 不自动复制、迁移或同步 Maven 本地仓库，不修改 `settings.xml`；离线模式使用显式仓库时，目录必须已经存在。
- 不擅自启用 Maven 并行构建；只有项目明确支持线程安全且用户或项目配置允许时，调用方才可显式传入 `--threads`。
- 脚本使用 Python 标准库实现，不新增运行时第三方依赖。
- 路径、命令和 JSON 输出必须支持包含空格的工作目录，不通过 shell 字符串拼接执行 Maven。

## Acceptance Criteria

- [ ] `trellis-maven-verify` 在 `.agents` 与 `.claude` canonical 源中存在，frontmatter 可被 Skill 校验器识别，description 能覆盖“Java/Maven 构建慢、reactor、生命周期裁剪、验证复用”等触发词并排除发布流程。
- [ ] `maven_verify.py plan` 能在隔离的单模块与多模块 Maven fixture 上定位变更模块，区分 quick/final，并输出稳定 JSON 计划。
- [ ] fixture 中父 POM把 `maven-source-plugin:jar` 绑定到 `compile` 时，计划能识别该额外 goal，并在确认插件参数后为非 sources 验证建议 `-Dmaven.source.skip=true`。
- [ ] fixture 中 `maven-compiler-plugin >= 3.1` 时，quick compile 的 auto 策略生成 `-am` 与 `-Dmaven.compiler.useIncrementalCompilation=false`；插件版本缺失或过旧时自动降级并报告，显式 source-stale 失败关闭。
- [ ] final 默认不添加 source-stale 参数；任务材料确认低风险后显式选择时进入计划、argv、指纹和 evidence，并与 conservative final 严格区分。
- [ ] `--threads` 只在显式请求且格式合法时生成 Maven `-T`，非法值失败关闭，默认计划不启用并行。
- [ ] fixture 中应用模块把 `copy-dependencies` 绑定到 `prepare-package` 时，`compile` 计划不进入该阶段，`package` 计划明确报告该额外成本。
- [ ] `run` 使用 argv 数组执行伪 Maven 或隔离 fixture，实时输出且生成 schema 化证据；失败命令也生成失败证据且返回非零。
- [ ] `check` 在完全相同的 Git/POM/命令/模块/工具链要求下返回可复用；修改源码、POM、消费者范围或提高生命周期后返回明确失效原因。
- [ ] compile、test、package 与 sources 制品覆盖关系有自动化测试，禁止低等级证据错误满足高等级要求。
- [ ] Check-All 的 light/full profile 都包含验证证据复用契约，audit-only subagent 不运行写缓存 Maven 命令。
- [ ] implement 与 Check-All 集成后，同一 worktree 未变化时，final Maven 证据能够在 Check-All 被复用；变化时生成精确重跑计划而不是无条件全仓构建。
- [ ] 选择性安装 `trellis-maven-verify` 和 `trellis-check-all` 均能获得所需脚本；全平台 Skill 投影测试通过。
- [ ] `npm run sync` 后 `vendor/skill-garden/.trellis/0.6/` 与 `enhancements/0.6/` 对应内容同步，compiled targets 与 dogfood 更新按本仓所有权流程完成。
- [ ] Python 单元测试、相关 Node 分发/投影测试、Skill quick validation、`npm test`、`npm pack --dry-run --json`、`git diff --check` 全部通过。
- [ ] 使用 `srm-dingtalk-notification-governance/srm-server` 做只读 forward-test，计划能识别 Java 8、外部父 POM的 compile 阶段 sources jar 和应用模块 prepare-package 的依赖复制；forward-test 不修改该项目业务文件或 POM。

## Out Of Scope

- 修改 SRM 或其它业务项目的 POM、父 POM、Maven settings、本地仓库和 JDK 安装。
- 为 Gradle、Bazel、Ant 或前端构建系统提供同等计划器。
- 代替任务 PRD/spec 决定需要哪些业务测试、消费者或发布验收。
- 自动执行 `deploy`、发布制品、上传仓库、清理本地缓存或写外部系统。
- 构建通用远程缓存、Maven daemon 或分布式构建系统。
