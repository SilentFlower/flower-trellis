# Maven Lifecycle Policy

## 目录

1. 生命周期覆盖
2. 昂贵绑定
3. 模块范围
4. 编译策略与并行
5. 计划升级条件

## 生命周期覆盖

按以下偏序判断普通 Maven lifecycle 覆盖：

```text
validate < compile < test < package < verify < install < deploy
```

附属 goal 独立判断，不能从普通 lifecycle 自动推出：

- `sources`、`javadoc`、`assembly`、`shade`、`repackage`、`copy-dependencies` 分别记录。
- `-DskipTests` 不产生测试通过证据。
- `-Dmaven.test.skip=true` 同时跳过 test compilation，不能满足测试编译或测试运行要求。
- `-Dmaven.source.skip=true` 不影响普通 compile 证据，但不能满足 sources 制品验收。
- `-Dmaven.compiler.useIncrementalCompilation=false` 在已确认兼容的 compiler plugin 上按源文件/class stale 判断；它只用于 compile 局部反馈，不能自动满足 conservative final。

## 昂贵绑定

| 插件/goal | 常见阶段 | 默认处理 |
| --- | --- | --- |
| `maven-source-plugin:jar*` | compile/package | 非 sources 验证可在确认参数后跳过 |
| `maven-dependency-plugin:copy-dependencies` | prepare-package | compile/test 不进入；package 明示复制成本 |
| `spring-boot:repackage` | package | 只在可运行制品验收时进入 |
| `maven-shade-plugin:shade` | package | 只在 shaded artifact 验收时进入 |
| `maven-assembly-plugin:*` | package | 只在 assembly 验收时进入 |
| `maven-javadoc-plugin:*` | package/verify | 非文档制品验收优先停在更早阶段 |
| frontend install/build goal | generate-resources 等 | 不自动跳过；报告绑定、阶段和项目风险 |

插件绑定来自 effective POM；只扫描仓库原始 POM不能排除外部父 POM继承。

- execution 没有显式 `<phase>` 时，只能使用脚本内已确认的 plugin goal 默认阶段兼容表。
- 已识别为昂贵 goal、但默认阶段仍未知时，计划必须降低 `confidence` 并报告 `binding-phase-unknown`；不得当成“当前 lifecycle 不会执行”。
- 只有全部命中的 `maven-source-plugin` 版本都在兼容表覆盖范围内时，才可自动添加 `-Dmaven.source.skip=true`；版本缺失或过旧时报告 `sources-skip-unsupported`。
- 只有全部命中的主源码 `maven-compiler-plugin:compile` 版本都为 3.1 或更高时，quick auto 才可添加 `-Dmaven.compiler.useIncrementalCompilation=false`。无法确认时降级 conservative；显式 source-stale 失败关闭。

## 模块范围

- 把变更文件映射到最近的 reactor module POM。
- 根 POM以及 `.mvn/maven.config`、`jvm.config`、extensions、wrapper 配置变化按全 reactor 风险处理。
- `MAVEN_ARGS` 只在 Maven 3.9+ 计入有效参数；旧版本保留诊断信息，但不能据此判断测试、制品或本地仓库覆盖。
- Maven 本地仓库位于 `9p`、`drvfs`、CIFS/NFS 等高延迟小文件文件系统时，计划必须报告 `local-repository-high-latency-filesystem`。只有调用方已准备完整仓库时，才通过 `--local-repository` 显式切换；不得自动复制仓库、修改 `settings.xml` 或把不完整仓库用于离线验证。
- `quick` 选择变更模块并默认加 `-am`，覆盖必要上游而不读取陈旧本地 SNAPSHOT。source-stale 的 `fallbackArgv` 保持相同 reactor 范围，但恢复 conservative 编译。
- `final` 选择变更模块和显式消费者，并使用 `-am` 覆盖必要上游。
- 消费者必须来自任务材料、项目 spec、可靠的反向依赖结果或显式输入。依赖坐标含未展开属性时不得按同名 artifactId 猜测关系；降低置信度并要求显式 module/consumer。不要默认使用 `-amd`。
- 公共 DTO/API、跨模块协议和父 POM变化通常需要提高消费者覆盖，由任务 owner 决定范围。

## 编译策略与并行

- `auto`：quick compile 且兼容时选择 source-stale；其它 quick lifecycle 和所有 final 默认 conservative。
- `conservative`：保留 Maven compiler plugin 默认语义，适合公共 API/ABI、常量内联、注解处理器、POM、资源契约或跨模块协议变化。
- `source-stale`：只允许 compile。quick 可自动选择；final 必须由任务材料明确确认模块内部低风险变化后显式选择。
- `--threads` 只接受正整数或正数 CPU 倍数。只有项目规则、插件线程安全证据或用户授权确认后才传入；默认不启用并行。

## 计划升级条件

只有满足对应验收时升级：

| 当前目标 | 最低 goal |
| --- | --- |
| 语法、注解处理、主源码编译 | `compile` |
| 单元测试或测试契约 | `test` |
| JAR/WAR、资源布局、repackage、依赖复制 | `package` |
| 集成检查或质量插件 | `verify` |
| 下游必须消费本地安装制品 | `install`，需明确理由 |
| 发布远端仓库 | 不由本 Skill 自动执行 |

计划进入 `package`、`install` 或 `deploy` 时，必须在报告中列出触发原因和命中的昂贵绑定。
