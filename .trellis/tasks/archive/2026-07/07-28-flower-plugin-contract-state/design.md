# Flower Plugin 契约与 Project Store 技术设计

## 1. 设计边界

P1 只建立后续模块共同依赖的“数据平面”：schema、身份、稳定序列化、完整性摘要和 Project Store。它不建立 Runtime 编排层，不提前实现 Provider、Resolver、Capability Policy 或 Installer。

依赖方向固定为：

```text
schemas + contracts + errors
          ^
          |
canonical-json + canonical-tree-hash
          ^
          |
project-store
```

后续 P2/P3/P4 可以依赖 P1；P1 不反向导入后续模块。

## 2. 建议文件布局

```text
src/plugin/
├── errors.js
├── contracts.js
├── schemas/
│   ├── shared.js
│   ├── plugin-manifest.js
│   ├── marketplace-manifest.js
│   ├── project-files.js
│   └── validator.js
├── integrity/
│   ├── canonical-json.js
│   └── canonical-tree.js
└── state/
    └── project-store.js

test/js/
├── plugin-manifest-schema.test.js
├── plugin-marketplace-schema.test.js
├── plugin-project-files-schema.test.js
├── plugin-integrity.test.js
└── plugin-project-store.test.js
```

`contracts.js` 保存跨模块 JSDoc typedef，不承担运行时业务；运行时对象必须在进入持久化、Provider 输出或安装计划边界时通过对应 validator。

## 3. Schema 实现

采用 JSON Schema + Ajv 作为结构校验器，并把 `ajv` 声明为直接运行时依赖。SemVer 和 range 使用直接依赖 `semver` 校验，不使用手写正则近似实现。

Schema 规则：

- 使用显式 `schemaVersion` 常量和 `additionalProperties: false`。
- 共用 ID、canonical ID、POSIX 相对路径、SHA-256、commit SHA 等定义，避免多个 schema 漂移。
- Ajv 错误统一映射为 `PluginSchemaError`，调用方不依赖 Ajv 原始错误结构。
- 自定义语义校验在结构校验之后执行，例如 Marketplace ID/版本唯一性、Plugin local ID 与 candidate 组合、依赖键的 canonical ID。
- validator 返回已验证的原对象或冻结的浅副本，不在校验阶段注入运行时默认值，避免摘要和锁文件内容因环境变化。

稳定错误结构：

```text
PluginError
├── code
├── message
├── path
├── issues[]
└── cause（仅内部保留，不进入 JSON 输出）
```

`issues[]` 每项固定包含 `code`、`path`、`message`。CLI 的 JSON 输出可消费该结构，但本任务不实现 CLI formatter。

## 4. 身份与版本

### 4.1 ID

- source ID 与 local Plugin ID：`^[a-z0-9]+(?:-[a-z0-9]+)*$`。
- canonical Plugin ID：`<source-id>/<plugin-id>`，只允许一个 `/`。
- canonical ID 的组合和拆分由公共 helper 完成；持久化层不接受短 ID。
- Marketplace 共仓 path、GitLab subdir 和 content path 都经过同一个 POSIX 相对路径 validator。

### 4.2 版本

- `version` 使用严格 SemVer。
- `compatibility` 与 `dependencies` 使用有效 SemVer range。
- Marketplace version entry 的 `commit` 首期接受 40 位十六进制 Git commit SHA。
- lockfile 只保存解析后的规范版本、commit 和 digest，不把 tag 作为唯一锁定身份。

## 5. Stable JSON

`stringifyCanonicalJson(value)` 的契约：

1. 深度遍历 JSON 值。
2. 对普通对象按 UTF-16 code unit 的确定性比较递归排序键。
3. 数组保持原顺序。
4. 拒绝 `undefined`、函数、symbol、bigint、循环引用和非有限数字。
5. 使用两个空格缩进，并保证末尾只有一个换行。

Project Store 的 changed-only 判断直接比较目标文件现有字节与 canonical 输出，不依赖解析后对象等价判断。

## 6. Canonical Tree Hash

`hashCanonicalTree(root)` 只遍历 root 下普通文件：

1. `lstat` 每个目录项；遇到软链、socket、FIFO 或 device 立即失败。
2. 将相对路径转为 POSIX 形式并经过安全路径校验。
3. 按 UTF-8 路径字节进行无区域设置排序。
4. 每个文件向 SHA-256 输入写入：路径字节长度、路径字节、内容字节长度、内容字节。
5. 返回 `sha256:<hex>`。

长度字段使用固定宽度无符号大端编码，确保边界不依赖分隔符。摘要覆盖 Plugin 根目录全部普通文件，不维护隐式排除清单；若发布方不希望某文件参与摘要，应将其移出 Plugin package root。

## 7. Project Store

### 7.1 固定路径

```text
.flower/
├── .gitignore
├── plugins.json
├── plugin-lock.json
├── state.json
├── cache/
└── transactions/
```

Store 只接受项目根路径，并通过真实路径检查确保 `.flower/` 的最近存在父目录与最终目录都位于项目根内。现有 `.flower` 若为逃逸软链则拒绝使用。

### 7.2 公共入口

采用一个 `ProjectStore` 类集中固定路径和 I/O 依赖，便于测试故障注入。公共方法至少覆盖：

- `ensureLayout()`
- `readPlugins()` / `writePlugins(value)`
- `readLock()` / `writeLock(value)`
- `readState()` / `writeState(value)`

所有 public method 必须有中文 JSDoc。读取只把 `ENOENT` 解释为缺失；语法错误、schema 错误和权限错误必须保留类别并向上抛出。

### 7.3 原子单文件写

单文件写入流程：

1. 在内存完成 schema 校验与 canonical 序列化。
2. 比较现有字节；完全一致则返回 `unchanged`。
3. 在目标文件同目录创建独占临时文件。
4. 写入完整字节并关闭文件。
5. 通过 rename 替换目标文件。
6. 异常时删除本次临时文件，不触碰原文件。

同目录临时文件确保 rename 不跨文件系统。P1 不实现 plugins、lock、state 的多文件事务；P2 的 transaction writer 将在更高层编排多个已验证 mutation，并把 state 最后写入。

### 7.4 损坏状态

- 缺失 `plugins.json`：返回带 schema version 的空直接声明模型。
- 缺失 lock/state：返回 `null`，由上层决定首次解析或应用。
- JSON 损坏、未知 schema version、schema 无效：抛出结构化错误并保留原文件。
- `.gitignore` 已存在时只确保 Flower 必需规则存在，保留用户额外规则；第二次运行不得重复追加。

## 8. 与现有代码的关系

- `src/lib/manifest.js` 保持不变，P5 再通过只读迁移适配到新 store。
- `src/lib/fs-utils.js#copyPath()` 保持原有增强链语义，Project Store 不调用它。
- Patch Engine 的路径安全逻辑可在不改变错误语义和测试的前提下提炼为通用 helper；若提取会扩大 P1 风险，则 P1 先在 Plugin 命名空间实现窄 helper，P4 再统一评估复用。
- `package.json` 增加 `ajv` 与 `semver` 直接依赖；P7 复核 npm pack 和最终 dependency surface。

## 9. 回滚与风险

- 新模块在 P2 接入 CLI 前没有用户可见入口，P1 可整体回滚而不影响现有 init/update。
- schema 一旦被 P2/P3/P4 消费就成为跨任务契约；P1 启动后首先冻结 fixture 和错误码，再并行后续任务。
- canonical tree hash 是 `rd-guide` CI 与 Runtime 的共同依据，算法变更必须提升协议或明确迁移，不能静默替换。
- Project Store 写入失败不能删除或重建损坏文件；恢复由用户修复或未来显式 repair 命令处理。
