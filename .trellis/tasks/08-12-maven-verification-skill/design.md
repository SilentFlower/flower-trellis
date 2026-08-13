# 技术设计

## 1. 架构边界

采用“薄 Skill + 确定性脚本 + 现有 workflow owner 集成”的结构：

```text
trellis-implement / 主会话
  -> trellis-maven-verify
     -> maven_verify.py plan
     -> maven_verify.py run
     -> evidence.json + command.log

trellis-check-all（audit-only）
  -> maven_verify.py check
     -> reusable / stale / partial / blocked
  -> 复用证据或报告精确重跑计划
```

- Skill 负责触发、模式选择、读取项目规则、解释计划与输出报告。
- `maven_verify.py` 负责所有需要稳定重放的 Git/POM/生命周期分析、命令执行、证据写入和失效判断。
- Check-All 继续拥有最终检查结论，Maven Skill 不产生 `CHK-*` / `FBK-*`。
- implement 继续拥有业务代码写入，Maven Skill 不修改源码、POM 或 settings。

## 2. 文件布局

Canonical source：

```text
vendor/skill-garden/.trellis/0.6/
├── .agents/skills/trellis-maven-verify/
│   ├── SKILL.md
│   └── references/
│       ├── lifecycle-policy.md
│       └── evidence-contract.md
├── .claude/skills/trellis-maven-verify/
│   └── ... 与 .agents 内容一致
├── scripts/maven_verify.py
└── overrides/
    ├── bundles/maven-verification.json
    └── patches/...                # implement/check-all 契约增量
```

同步产物位于 `enhancements/0.6/`。本仓 `.agents/`、`.claude/`、`.trellis/` 是 dogfood 部署结果，不作为首写真源。

## 3. CLI 契约

### 3.1 `plan`

```text
python3 ./.trellis/scripts/maven_verify.py plan
  --mode quick|final
  [--compile-strategy auto|conservative|source-stale]
  [--threads <count|multiplierC>]
  [--maven-root <path>]
  [--module <selector>]...
  [--consumer <selector>]...
  [--goal compile|test|package|install]
  [--test <pattern>]...
  [--offline auto|yes|no]
  [--local-repository <path>]
  [--json]
```

输出稳定 JSON：

```json
{
  "schemaVersion": 1,
  "status": "planned",
  "mode": "final",
  "mavenRoot": "srm-server",
  "changedModules": ["srm-common", "srm-api-manage"],
  "selectedModules": ["srm-common", "srm-api-manage"],
  "goal": "compile",
  "argv": ["mvn", "-o", "-pl", "srm-common,srm-api-manage", "-am", "-Dmaven.source.skip=true", "-Dmaven.compiler.useIncrementalCompilation=false", "compile"],
  "compileStrategy": {
    "requested": "auto",
    "effective": "source-stale"
  },
  "threads": null,
  "lifecycle": {
    "expensiveBindings": [],
    "skippedBindings": ["org.apache.maven.plugins:maven-source-plugin:jar@compile"]
  },
  "coverage": {
    "level": "compile",
    "modules": ["srm-common", "srm-api-manage"],
    "consumers": [],
    "tests": []
  },
  "warnings": []
}
```

`plan` 的决策顺序：

1. 定位 Maven 根和 Git 根。
2. 读取 diff，将文件映射到最近的 reactor module POM。
3. 解析 reactor modules、artifactId、父子关系和本地模块依赖；无法可靠解析时降低 confidence，要求显式 module/consumer，而不是猜测。
4. 获取根 effective POM，合并目标模块原始 POM中的 plugin execution，生成 phase -> goal 图。
5. 根据 mode/goal 判断昂贵 goal 是否会进入生命周期。
6. 识别本地仓库文件系统；高延迟挂载输出诊断，显式仓库同时作用于 effective model 和最终命令。
7. 只有插件描述或内置兼容表确认参数时添加 skip 参数。
8. quick compile 的 auto 策略仅在 effective model 确认 `maven-compiler-plugin >= 3.1` 时选择 source-stale；final auto 固定为 conservative。
9. 只有显式 `--threads` 且格式合法时生成 `-T`；调用方负责先确认项目线程安全。
10. 输出 argv、覆盖、风险和原因，不执行命令。

### 3.2 `run`

```text
python3 ./.trellis/scripts/maven_verify.py run
  --plan-json <file>|--plan-stdin
  [--evidence-dir .trellis/.runtime/maven-verification]
  [--json]
```

- 严格使用计划中的 argv 数组与 cwd，禁止 `shell=True`。
- stdout/stderr 合并后实时转发，同时写入日志。
- 结束后原子写入证据 JSON；失败也写证据。
- 证据 ID 由计划语义、worktree 指纹和开始时间组成，不依赖用户名或绝对路径。

### 3.3 `check`

```text
python3 ./.trellis/scripts/maven_verify.py check
  --evidence <file>|--latest
  [--require-plan <file>|--require-goal <goal>]
  [--require-module <selector>]...
  [--require-consumer <selector>]...
  [--require-test <pattern>]...
  [--json]
```

结果：

```json
{
  "schemaVersion": 1,
  "status": "reusable",
  "coverage": "full",
  "reasons": [],
  "evidence": ".trellis/.runtime/maven-verification/<id>.json"
}
```

`status` 只允许：

- `reusable`：全部要求被有效证据覆盖。
- `partial`：证据仍有效，但模块、消费者、测试或生命周期只覆盖一部分。
- `stale`：Git/POM/工具链或证据完整性变化。
- `failed`：原验证命令失败。
- `blocked`：无法读取 Git、POM、工具链或证据。

`check` 不运行 Maven goal，不创建文件；允许读取 Git 状态、POM、证据和 `java -version` / `mvn -version`。

## 4. 证据 Schema

证据使用 `schemaVersion: 1`：

```json
{
  "schemaVersion": 1,
  "kind": "trellis-maven-verification",
  "plan": {},
  "repository": {
    "root": ".",
    "head": "<sha>",
    "worktreeSha256": "<sha256>",
    "indexSha256": "<sha256>",
    "untrackedSha256": "<sha256>"
  },
  "maven": {
    "root": "srm-server",
    "pomSha256": "<sha256>",
    "version": "Apache Maven ...",
    "localRepository": "/normalized/path",
    "offline": true
  },
  "java": {
    "version": "1.8.0_472",
    "major": 8,
    "home": "/normalized/path"
  },
  "execution": {
    "startedAt": "<RFC3339>",
    "finishedAt": "<RFC3339>",
    "durationMs": 0,
    "exitCode": 0,
    "log": "<relative-path>",
    "tests": {"run": 0, "failures": 0, "errors": 0, "skipped": 0}
  },
  "coverage": {},
  "risks": []
}
```

指纹必须基于内容和稳定相对路径；JSON 采用稳定 key 顺序与 UTF-8。绝对路径只可作为本地诊断字段，不进入跨目录可比较指纹。

## 5. 生命周期覆盖模型

Maven默认生命周期覆盖按以下偏序判断：

```text
validate < compile < test < package < verify < install < deploy
```

但附属 goal 独立记录：

- `sources`、`javadoc`、`assembly`、`shade`、`repackage`、`copy-dependencies` 不是普通 compile/test 覆盖的自动推论。
- `-DskipTests` 不产生测试通过证据。
- `-Dmaven.test.skip=true` 还会跳过 test compilation，必须单独记录。
- `-Dmaven.source.skip=true` 不影响普通 compile 证据，但不能满足 sources artifact 验收。

昂贵绑定初始分类表：

| 插件/goal | 常见阶段 | 默认处理 |
| --- | --- | --- |
| `maven-source-plugin:jar*` | compile/package | 非 sources 验证可在确认参数后跳过 |
| `maven-dependency-plugin:copy-dependencies` | prepare-package | compile/test 不进入；package 明示成本 |
| `spring-boot:repackage` | package | 仅制品/启动验收进入 |
| shade/assembly | package | 仅制品验收进入 |
| javadoc | package/verify | 非文档制品验收可跳过或停在更早阶段 |
| frontend install/build | generate-resources 等 | 不自动跳过；报告绑定和项目风险 |

## 6. 模块范围策略

- diff 文件映射到最近的 module POM；根 POM变化视为 reactor-wide 风险。
- `quick`：选择 changed modules，并加 `-am` 覆盖必要上游，避免读取陈旧本地 SNAPSHOT。`compileStrategy=auto` 在 compile 且 compiler plugin 兼容时使用 source-stale，只编译真正过期的源文件。
- `final`：选择 changed modules + 显式消费者，并加 `-am`。消费者可来自任务材料、spec、脚本反向依赖结果或调用方参数。
- final 的 `compileStrategy=auto` 固定为 conservative。只有任务材料确认模块内部低风险变化时，调用方才可显式传入 `source-stale`；公共 API/DTO/常量、注解处理器、POM、资源契约或跨模块协议变化继续使用 conservative。
- 自动反向依赖结果只在所有相关坐标可解析时作为建议；解析不完整时不得声称消费者闭合。
- 根 POM、dependencyManagement、公共 DTO/API 或跨模块协议变化默认要求更高覆盖，由调用方/Check-All决定是否扩大消费者。
- 并行不自动启用。项目规则、插件线程安全证据或用户授权确认后，调用方可显式传入 `--threads`；参数和结果必须进入计划指纹与 evidence。

## 7. Trellis 集成方式

### Implement

在 implement owner/agent 契约中增加：

- 发现 Maven 根时读取 `trellis-maven-verify`。
- 迭代中可运行 quick；交付前运行 final 或解释为何无 Maven 验证。
- 报告证据路径、覆盖和剩余风险，避免只写“编译通过”。

### Check-All

在 light/full profile 的项目验证部分增加：

- 先查找当前 diff 对应的 Maven evidence。
- 调用 `check` 验证新鲜度与覆盖。
- reusable 时直接纳入验证证据。
- partial/stale/failed 时形成精确验证缺口；audit-only subagent 不运行 Maven。
- 主会话有写缓存权限且当前请求允许继续验证时，可调用 Skill 执行重跑；否则报告阻塞或部分验证。

## 8. 分发与选择性安装

- 新增 Bundle `maven-verification`，别名包含 `maven-verify`、`java-maven`、`trellis-maven-verify`。
- `SCRIPT_ALIASES.maven_verify` 至少覆盖新 Skill 与 Check-All 选择入口，保证 partial install 闭包。
- 全量安装沿用现有目录扫描自动投影新 Skill。
- Patch 只修改 owner 契约，不在 workflow Hub 复制 Maven 过程。

## 9. 失败关闭与回滚

- effective POM 获取失败：输出 `blocked` 或低置信计划，禁止宣称已识别全部生命周期绑定。
- POM解析不完整：要求显式 modules/consumers，禁止猜测。
- 证据 JSON 损坏：`blocked`，不自动删除。
- Maven 执行中断：记录非零/信号与日志，证据不可复用。
- 回滚按 source -> sync snapshot -> dogfood 的反向范围恢复；不得只删除 dogfood 副本留下 source/快照漂移。
