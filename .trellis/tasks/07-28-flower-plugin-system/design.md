# Flower Plugin 体系技术设计

## 1. 设计目标

本设计把 flower-trellis 从“固定安装一份 `enhancements/` 快照”演进为可解析、可授权、可锁定、可重放的 Plugin Runtime，同时保持现有 Trellis 0.6 Patch Engine、`skill-garden` 安装结果和 CLI 使用习惯可迁移。

核心原则：

1. Flower Plugin Runtime 才是核心，`skill-garden` 是默认内置 Plugin，不是所有 Plugin 的隐式依赖。
2. Plugin 安装不要求项目存在 Trellis；Trellis、`skill-garden` 和高权限 Patch 都通过显式依赖或 capability 接入。
3. 外部 Plugin 只贡献声明式内容和 Patch catalog，不加载第三方 JavaScript adapter，不执行生命周期脚本。
4. 解析、授权、目标计算和冲突检查全部先完成，再由统一安装事务写盘。
5. 项目声明和 lockfile 可提交，本机实际安装状态、缓存和 OAuth 凭据不提交。

## 2. 总体架构

```text
CLI: flower-trellis plugin ...
                |
                v
        Plugin Application Service
                |
    +-----------+------------+----------------+
    |                        |                |
    v                        v                v
Source Registry       Credential Store   Project Store
Marketplace Client    OAuth Provider     plugins/lock/state
    |                        |                |
    +------------+-----------+----------------+
                 v
         Dependency Resolver
                 |
                 v
      Package Loader + Validator
                 |
                 v
      Capability Policy Engine
                 |
                 v
          Unified Preflight
      +----------+-----------+
      |                      |
      v                      v
Content Projection      Existing Patch Engine
      |                      |
      +----------+-----------+
                 v
        Transactional Writer
                 |
                 v
      state.json + target files
```

### 2.1 分层职责

| 层 | 职责 | 不负责 |
| --- | --- | --- |
| CLI | 参数解析、交互确认、结构化输出 | 依赖解析和文件变换 |
| Source Registry | 管理内置/用户 Marketplace 描述 | 保存 OAuth token |
| Provider | 访问 GitLab、本地目录或内置包 | 决定 Plugin 能力 |
| Resolver | 解析版本、依赖闭包和唯一锁定结果 | 写目标项目文件 |
| Validator | 校验 Plugin/Marketplace schema、路径和摘要 | 执行脚本 |
| Capability Policy | 计算请求能力、来源上限、项目批准的交集 | 修改 Patch 内容 |
| Install Planner | 合并内容投影和 Patch 计划，检查冲突 | 直接写盘 |
| Patch Engine | 复用现有声明式 Patch 解析和 target preflight | Plugin 发现、OAuth、依赖解析 |
| Transactional Writer | 复核 before hash、应用与失败恢复 | 重新计算业务计划 |
| Project Store | 读写 `.flower/` 声明、lock、本机状态 | 保存用户凭据 |

## 3. 代码与发布布局

建议新增以下边界，文件名可在实现时按职责微调，但模块所有权不可重新混入 `apply-enhancements.js`：

```text
src/
├── commands/
│   └── plugin.js
├── plugin/
│   ├── application-service.js
│   ├── schemas/
│   │   ├── plugin-manifest.js
│   │   ├── marketplace-manifest.js
│   │   └── project-files.js
│   ├── sources/
│   │   ├── source-registry.js
│   │   ├── builtin-provider.js
│   │   ├── local-provider.js
│   │   └── gitlab-provider.js
│   ├── auth/
│   │   ├── gitlab-oauth.js
│   │   └── credential-store.js
│   ├── resolver/
│   │   ├── dependency-resolver.js
│   │   └── lock-builder.js
│   ├── capabilities/
│   │   └── policy-engine.js
│   ├── install/
│   │   ├── platform-detector.js
│   │   ├── content-projector.js
│   │   ├── install-planner.js
│   │   └── transaction-writer.js
│   └── state/
│       ├── project-store.js
│       └── legacy-migration.js
├── builtin-plugins/
│   ├── skill-garden/
│   │   └── plugin.json
│   └── flower-plugin-author/
│       ├── plugin.json
│       └── skills/flower-plugin-author/
└── builtin-marketplaces/
    └── rd-guide.json
```

`package.json#files` 必须显式包含新增的内置 Plugin、Marketplace 描述和作者 Skill。OAuth keyring 的原生实现作为 optional dependency；Runtime 通过接口加载，缺少可用系统 keyring 时允许当前命令使用内存 token，但不得回退到明文文件持久化。

## 4. 身份与版本模型

### 4.1 Canonical ID

- Marketplace/source ID、Plugin local ID 采用小写连字符。
- Plugin 全局身份固定为 `<source-id>/<plugin-id>`，例如 `rd-guide/code-review`、`flower/skill-garden`。
- CLI 在名称唯一时可以接受短 ID，项目声明、lockfile、依赖和日志中的权威身份始终使用 canonical ID。
- Patch catalog、Bundle 和 operation 继续沿用现有 `<catalog-id>/<local-id>` 规则；外部 Plugin 的 catalog ID 由 Runtime 规范化为 Plugin canonical ID 的安全映射，不能伪装成 `skill-garden` 或 `flower`。

### 4.2 版本与不可变引用

- Plugin 版本使用 SemVer。
- Marketplace 每个可安装版本必须同时记录版本号、不可变 Git commit、来源路径和内容完整性摘要。
- tag 只用于人类发布语义；解析后必须落到 commit SHA，lockfile 不以可移动 tag 作为唯一依据。
- `plugin add` 根据约束解析一次并写 lockfile；普通 `flower-trellis update` 只重放 lockfile，只有 `plugin update` 重新解析版本。

## 5. Flower Plugin Manifest v1

`.flower-plugin/plugin.json` 使用显式 schema version。示意结构：

```json
{
  "schemaVersion": 1,
  "id": "code-review",
  "name": "研发规范代码审查",
  "version": "1.2.0",
  "compatibility": {
    "flower": ">=0.6.0 <1.0.0",
    "trellis": ">=0.6.0 <0.7.0"
  },
  "dependencies": {
    "flower/skill-garden": "^1.0.0"
  },
  "capabilities": {
    "profile": "integration",
    "required": ["content.skills", "patch.insert"]
  },
  "content": {
    "skills": ["skills/code-review"],
    "assets": ["assets"],
    "scripts": ["scripts"]
  },
  "patches": {
    "catalog": "patches",
    "bundles": "patches/bundles"
  }
}
```

约束：

- `compatibility.trellis` 仅在 Plugin 需要 Trellis 时出现；普通 Skill Plugin 不声明它。
- `dependencies` 使用 canonical Plugin ID，不允许隐式依赖 `skill-garden`。
- `scripts` 只作为被动资源分发，v1 schema 不提供 install/update/remove hook 字段。
- 未知 optional capability 可忽略并报告；未知 required capability 必须拒绝安装。
- 所有相对路径必须使用 POSIX 形式，拒绝绝对路径、`..`、空片段和软链逃逸。
- 外部清单不能声明 `system`，也不能声明自定义 selector adapter。

## 6. Marketplace Manifest v1

`rd-guide/.flower-marketplace/marketplace.json` 采用索引型结构，同时允许共仓 Plugin：

```json
{
  "schemaVersion": 1,
  "id": "rd-guide",
  "name": "研发规范 Plugin 市场",
  "plugins": [
    {
      "id": "code-review",
      "description": "研发规范代码审查能力",
      "source": {
        "type": "gitlab",
        "project": "digital-rd-governance/code-review-plugin",
        "subdir": "."
      },
      "trust": {
        "maxProfile": "integration"
      },
      "versions": [
        {
          "version": "1.2.0",
          "ref": "v1.2.0",
          "commit": "<immutable-commit>",
          "integrity": "sha256:<canonical-tree-hash>"
        }
      ]
    }
  ]
}
```

- 共仓条目使用 `source.type=path` 和仓库内安全相对路径。
- 外部仓库条目使用 GitLab project path、可选 subdir 和不可变 commit。
- Marketplace 只授予 capability 上限，不替代项目首次授权。
- 首期完整性以“规范化相对路径 + 文件字节”的 canonical tree hash 为准，不依赖 tar 包字节稳定性。
- 首期不引入独立密码学签名；GitLab 保护分支、MR、CI 和 CODEOWNERS 构成发布信任链。lockfile 仍必须保存 index commit 和 Plugin commit/hash。

## 7. 来源注册与 GitLab Provider

### 7.1 来源层级

来源配置按以下优先级合并：

1. Flower 随包内置来源描述，例如 `rd-guide`。
2. 用户级来源配置，建议位于 XDG config 对应的 `flower-trellis/sources.json`。
3. 命令行临时覆盖，仅作用于当前命令，不写项目文件。

项目 `plugins.json` 只引用 source ID，不保存 GitLab Application ID、token 或用户身份。用户可以禁用内置来源，但不能修改包内描述；覆盖写入用户级配置。

### 7.2 GitLab 访问

- Marketplace 索引和 Plugin 包通过 GitLab REST API 读取，Authorization 使用 Bearer token，不把 token 拼入 URL、Git remote 或命令行参数。
- project path 在 API 路径中进行 URL 编码；下载后在隔离缓存目录解包并执行路径、软链和摘要校验。
- `rd-guide` 使用惰性访问，普通 CLI 启动、`init` 和本地 lock 重放不请求 GitLab。
- `plugin search`、远端详情、首次 add 和显式 update 才允许访问来源。

### 7.3 OAuth

- 内置 provider 描述包含 GitLab base URL、Application ID、scope=`read_repository read_api`，不包含 Application Secret。
- `read_repository` 用于 Git-over-HTTP 与 Repository Files API；`read_api` 用于 Marketplace 所需的 `repository/tree`、archive 和其它只读 REST API。Runtime 不申请具备写权限的 `api`。
- 有浏览器环境时启动 loopback callback，并使用 Authorization Code + PKCE S256、随机 state 和一次性 code verifier。
- 无浏览器、loopback 不可用或显式 `--device` 时，使用 `/oauth/authorize_device` 与 `/oauth/token` 的 Device Authorization Grant。
- token 到期前刷新；刷新失败或凭据缺失时重新授权。
- token 响应整体作为一个 credential payload 存入系统 keyring；service key 使用 Flower 固定命名空间和 GitLab host/source ID。
- 初始实现采用可替换 `CredentialStore` 接口，优先加载 `@napi-rs/keyring` 预编译绑定。无可用 keyring 时只允许当前进程内使用，不提供明文文件 fallback。

官方协议依据：

- GitLab OAuth 2.0 API：<https://docs.gitlab.com/api/oauth2/>
- GitLab REST API OAuth token：<https://docs.gitlab.com/api/rest/authentication/>

## 8. 项目声明、锁与本机状态

```text
.flower/
├── .gitignore
├── plugins.json
├── plugin-lock.json
├── settings.json              # 可选，项目级 Flower 策略
├── state.json                 # gitignored
├── update-check.tmp           # gitignored
├── transactions/              # gitignored，失败恢复后清理
└── cache/                     # gitignored
```

### 8.1 `plugins.json`

- 可提交，只记录直接 Plugin 约束、来源 ID 和显式平台限制。
- 不记录传递依赖、已检测平台、token、绝对路径或当前机器状态。

### 8.2 `plugin-lock.json`

- 可提交，记录完整依赖图、Marketplace index commit、Plugin commit、canonical digest、兼容性结论和批准 capability 摘要。
- capability 摘要绑定 Plugin 版本、内容 digest、请求能力和来源授予上限；任一变化都使批准失效。
- lockfile 序列化顺序稳定，重复解析同一输入不产生 diff。

### 8.3 `state.json`

- 本机文件，记录每个 Plugin 实际投影平台、目标路径、内容 hash、Patch provenance、事务版本和迁移来源。
- 卸载与 stale 清理只认 state 中的所有权及目标当前 hash；文件被用户修改时默认报告冲突，不直接删除。

### 8.4 `.flower/.gitignore`

Runtime 首次初始化 `.flower/` 时创建最小局部忽略规则，至少覆盖 `state.json`、`cache/`、`transactions/` 和 `*.tmp`，不改写项目根 `.gitignore`。

## 9. 依赖解析

1. 读取 `plugins.json` 的直接约束。
2. 从允许的 Marketplace 读取候选版本元数据。
3. 使用 SemVer 解析完整依赖闭包，canonical ID 作为唯一节点键。
4. 拒绝未知依赖、循环、来源歧义和无法满足的版本交集。
5. 对已存在 lock 且约束未变化的节点优先保持锁定版本，减少无关升级。
6. 输出稳定拓扑顺序和完整 lock；不写盘。

`plugin remove` 从直接声明中移除目标后重新解析；没有直接或传递引用的节点成为 orphan，在 dry-run 中展示后随事务清理。共享依赖保留。

## 10. Capability 与 Patch 集成

### 10.1 三档能力

| Profile | 允许能力 | 典型来源 |
| --- | --- | --- |
| `standard` | skills/spec/assets/scripts 被动分发 | 普通外部 Plugin |
| `integration` | `standard` + 白名单目标上的声明式 insert Patch | 经审核的 `rd-guide` Plugin |
| `system` | 完整 Patch、hook、migration、内部 adapter | Flower 内置 Plugin |

有效授权：

```text
requested capabilities
  ∩ marketplace max profile
  ∩ runtime hard limits
  ∩ project approval
```

- `system` 只由内置 provider 的不可伪造 descriptor 授予。
- `integration` 只允许 `insert`、Core selector 和目标 allowlist；禁止 `replace/remove`、`missing=create`、hook target、自定义 cleanup 和 adapter。
- 首次授权在 CLI 展示 Plugin、版本、目标文件、operation 和能力；批准摘要写 lockfile。
- CI 使用 frozen lockfile 时可复用未变化的批准摘要；摘要不匹配必须失败，不能自动接受。

### 10.2 复用 Patch Engine

现有 `preparePatchPlan(target, catalogs, options)` 已具备多 catalog、qualified ID、稳定排序、路径安全和零写入 preflight。新 Runtime 在调用前：

1. 根据 capability 对外部 catalog 做 schema 子集校验。
2. 为每个 Plugin 构造不可伪造的 catalog descriptor 和 qualified marker identity。
3. 合并全部已选 Plugin catalog，一次调用 `preparePatchPlan()`。
4. 将 Patch 文件计划与普通内容投影计划合并，检查跨 Plugin 路径冲突。
5. 执行 compatibility/conflict policy，再进入统一写盘事务。

不得在 Plugin Runtime 中复制 selector 或 Patch 变换实现。

## 11. 多平台内容投影

- 复用并泛化 `ENHANCEMENT_SKILL_TARGETS`，形成平台 descriptor registry。
- 默认只向当前项目已存在的平台根投影；完全未检测到平台时，普通 Plugin 不再隐式回退 Claude，而是要求交互选择或 `--platform`。完整 `flower-trellis init` 仍由现有平台选择流程创建目标根。
- Codex、Gemini、ZCode 共享 `.agents/skills` 时只生成一个物理目标。
- platform override 必须显式声明并只覆盖必要文件；未声明时使用 canonical 内容。
- 两个 Plugin 计划写同一路径且内容/所有权不同，统一 preflight 失败；不采用后安装覆盖前安装。

## 12. 统一安装事务

统一计划包含：

- `before`：目标存在性与 hash。
- `after`：最终字节、mode 和所有者 Plugin。
- `remove`：仅来自 state 中已拥有且仍匹配的 stale/orphan 路径。
- Patch operation provenance、普通内容 digest、lock/state 最终值。

执行顺序：

1. 完成依赖、schema、capability、平台、路径、Patch 和冲突全量 preflight。
2. 在 `.flower/transactions/<id>/` 保存恢复所需原始内容和事务清单。
3. 应用目标文件，单文件使用同目录临时文件 + rename；写前复核 before hash。
4. 所有目标成功后写 `plugins.json`、lockfile 和 `state.json`，state 最后写。
5. 失败时按事务清单逆序恢复；恢复不完整时保留事务目录并输出明确恢复命令。
6. 成功后删除事务目录，保留现有 Patch Engine 的首次备份兼容语义。

preflight 失败必须零写入。普通文件系统无法承诺断电级跨文件事务，因此设计目标是“进程内失败可恢复、成功 state 最后写、崩溃后有事务清单可继续恢复”。

## 13. CLI 设计

```text
flower-trellis plugin source add|list|remove|update|enable|disable
flower-trellis plugin auth login|logout|status [source]
flower-trellis plugin search [query]
flower-trellis plugin list
flower-trellis plugin add <plugin>[@constraint] [--platform ...] [--dry-run]
flower-trellis plugin update [plugin] [--dry-run]
flower-trellis plugin remove <plugin> [--dry-run]
flower-trellis plugin verify [plugin]
flower-trellis plugin init [path]
flower-trellis plugin validate [path]
```

- `src/cli.js` 必须显式接管 `plugin`，避免透传给 Trellis。
- 子命令解析应从当前全局 `parseCliArgs()` 中拆出 Plugin 专用 parser，保持已有命令兼容。
- 所有变更命令支持 `--dry-run`；机器消费场景提供 `--json`，JSON 输出不得混入 banner、进度或 token。
- `plugin add` 在无 `.flower/` 项目中创建最小 Runtime 状态，不执行 `trellis init`。
- `flower-trellis init` 完成 Trellis 初始化后，通过内部 application service 确保 `flower/skill-garden` 直接声明存在并按 lock 应用。

## 14. 内置 Plugin 迁移

### 14.1 `skill-garden`

首期不移动 `enhancements/<variant>` 大量快照文件。`builtin-provider` 将它们适配为规范化的 `flower/skill-garden` 包：

- Plugin manifest 和版本元数据放在 `src/builtin-plugins/skill-garden/`。
- payload 继续来自现有 `enhancements/`，variant 选择继续复用 `resolveEnhancementSnapshot()`。
- 安装计划组合 `skill-garden` 与 `flower` 两个现有 catalog；`flower` catalog 是 Runtime 支撑 catalog，不作为外部可发现 Plugin。
- `applyEnhancements()` 迁移为兼容 facade，最终调用 Plugin application service，不再独立维护第二条安装状态链。

### 14.2 旧 manifest

首次读取到 `.trellis/.flower-manifest.json` 且不存在新 state 时：

1. 在内存映射为 `flower/skill-garden` 的旧安装记录。
2. 将旧 `paths`、variant、Trellis version 和 Patch provenance 写入新 state 草案。
3. 通过新 planner 做一次重放和所有权校验。
4. 成功后写 `.flower/` 配置、lock 和 state，并记录旧 manifest hash。
5. 不删除或改写旧 manifest；新 Runtime 优先读取新 state，旧文件保留为回滚证据，后续大版本再清理。

现有 update-check 策略迁移到 `.flower/settings.json`，运行缓存迁移到 gitignored `.flower/update-check.tmp`；兼容读取旧 manifest，直到新设置首次成功写入。

### 14.3 Uninstall

- `plugin remove flower/skill-garden` 只在显式安装模式允许；完整 Trellis 模式下先提示其是默认基础 Plugin，但不把它视为 Runtime 核心。
- `flower-trellis uninstall` 先根据新 state 精确清理 Flower 拥有的目标，再调用/配合 Trellis uninstall；不再从当前快照猜测文件名。
- 无 Trellis 项目只删除目标 Plugin，不触碰不存在的 `.trellis/`。

## 15. `flower-plugin-author` Skill 与作者工具

`flower-plugin-author` 作为 `flower/flower-plugin-author` 内置 `standard` Plugin 随 npm 包发布，但不依赖 `skill-garden`。

- `plugin init` 创建标准目录、manifest、示例测试和 Marketplace 注册片段，并确保作者 Skill 可投影到检测平台。
- `plugin validate` 使用 Runtime 的真实 schema、resolver 和 capability validator，不在 Skill 文本中复制校验规则。
- Skill 入口保持简短，长说明拆分到 references：manifest、Marketplace、Patch capability、GitLab MR、CI 和发布检查。
- 作者发布固定 tag 后生成 Marketplace entry，提交到 `rd-guide`；CI 运行同一 `plugin validate` 与 lock/digest 校验。

## 16. 发布与审核流水线

```text
Plugin repository
  -> plugin validate
  -> immutable tag
  -> generate marketplace entry + digest
  -> rd-guide Merge Request
  -> schema/dependency/integrity/capability CI
  -> CODEOWNERS review when integration
  -> merge
  -> discoverable by Flower
```

Marketplace CI 不执行 Plugin 的 `scripts/`。可以读取文本、计算摘要、构建临时安装计划和运行声明式 Patch fixture。

## 17. 测试策略

### 17.1 Schema 与解析

- Plugin/Marketplace/project/lock/state schema 正反例。
- 路径逃逸、软链、重复 canonical ID、未知 required capability。
- SemVer 选择、锁定保持、共享依赖、循环、冲突和 orphan 清理。

### 17.2 Provider 与 OAuth

- GitLab API mock 覆盖 Marketplace、外部仓库、共仓 subdir、401、刷新和网络失败。
- PKCE state/verifier/challenge、loopback callback、Device Flow pending/slow_down/expired/denied。
- keyring 写入、读取、删除和不可用时的内存降级；日志与 JSON 输出做 token 泄漏断言。

### 17.3 安装与 Patch

- 无 Trellis 普通项目安装 `standard` Plugin。
- 多平台检测与共享 `.agents/skills` 去重。
- 内容路径冲突、Patch 冲突、required 失败零写入。
- `integration` 越权 operation/target/adapter 拒绝，`system` 伪造拒绝。
- 事务中途失败恢复、崩溃事务恢复、重复应用幂等。

### 17.4 迁移与回归

- 旧 manifest 到新 state 的首次迁移、重复迁移和回滚证据。
- `init/update/uninstall/self-check/update-check/skill` 现有行为回归。
- `skill-garden` 新旧最终目标字节与 Patch provenance 对比。
- `npm pack --dry-run --json` 验证内置 Plugin、Marketplace、作者 Skill和 keyring 平台包发布完整。

## 18. 风险与控制

| 风险 | 控制 |
| --- | --- |
| Runtime 与旧增强链形成双状态 | `applyEnhancements()` 只保留兼容 facade，状态写入统一 Project Store |
| 外部 Plugin 越权 Patch | manifest 请求、Marketplace 上限、Runtime 硬限制、项目批准四层约束 |
| 多 Plugin 覆盖同一路径 | unified preflight 直接失败，不采用覆盖顺序 |
| OAuth token 泄漏 | Bearer header、keyring、日志脱敏、JSON 泄漏测试、无明文 fallback |
| 原生 keyring 包安装失败 | optional dependency + 进程内 token；不降低为明文持久化 |
| 事务中途失败 | before hash、事务恢复目录、state 最后写、恢复命令 |
| 旧项目误清理用户文件 | 迁移旧 provenance，删除前验证所有权和当前 hash |
| Plugin schema 未来扩展 | schemaVersion + capability negotiation；未知 required 明确失败 |

## 19. 子任务边界

父任务不直接承担大段实现，后续按以下交付物建立子任务：

1. Plugin/Marketplace 契约与 `.flower/` Project Store。
2. 依赖解析、lockfile 与生命周期 CLI。
3. GitLab Marketplace Provider、OAuth 与 keyring。
4. Capability Policy、统一 preflight 与 Patch Engine 集成。
5. 内置 `skill-garden` 迁移及现有 CLI 兼容。
6. `flower-plugin-author`、scaffold/validate 与 `rd-guide` MR/CI 契约。
7. 跨模块集成、迁移矩阵、打包和端到端验收。

依赖顺序与每个子任务的文件所有权在 `implement.md` 中定义。
