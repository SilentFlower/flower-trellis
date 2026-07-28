# Flower Plugin 体系改造

## 目标

将 flower-trellis 当前以 `enhancements/`、`skill-garden` 和 Patch Engine 为核心的单一内置增强机制，演进为 Flower 自有的 Plugin 体系，使内置能力与来自私有 GitLab 仓库的扩展可以通过统一契约完成发现、认证、安装、升级、校验、应用和卸载。

本任务是整体改造的父任务，负责统一需求、架构边界、子任务映射、跨模块验收和最终集成审查。进入实现前，应按可独立验证的交付物拆分子任务。

## 背景与已确认决策

- Flower Plugin 是 Flower/Trellis 原生扩展格式，不以兼容 Codex Plugin 为核心目标。
- Flower Plugin Runtime 是不可缺少的核心，负责来源解析、生命周期、状态、能力校验和内容分发。
- `skill-garden` 是随 flower-trellis 包分发、默认启用的内置基础 Plugin，不是所有其他 Plugin 的强制依赖，也不依赖网络或外部认证。
- `flower-trellis init` 表达完整 Trellis 工作流初始化，默认安装 `skill-garden`。
- `flower-trellis plugin add <plugin>` 可以独立引导最小 Plugin Runtime，只安装目标 Plugin 及其显式依赖，不隐式安装 `skill-garden`。
- 仅分发模式支持完全没有 Trellis 的普通项目；Plugin Runtime 的项目状态从 `.trellis/` 中解耦并迁移到独立的 `.flower/` 边界。
- `.flower/` 区分可提交的期望配置与版本锁、本机应用状态和缓存，保证团队安装可复现且不提交平台相关运行结果。
- `rd-guide` 一类仓库通过 Marketplace 接入；一个 Marketplace 可以发布多个 Plugin。
- `rd-guide` 作为随 flower-trellis 预注册、按需连接的默认 Marketplace；预注册不代表启动时访问远端。
- 首个外部来源为自建 GitLab：`http://gitlab.xhgjdev.com`，当前版本为 GitLab 18.10.1。
- 当前环境按安全传输等价环境处理，不为 HTTP 单独设计降级分支、交互警告或额外兼容逻辑。
- GitLab 认证采用实例级 OAuth Application；CLI 作为公共客户端，不使用或保存 OAuth Application Secret。
- 浏览器环境优先采用 Authorization Code + PKCE，无浏览器环境采用 Device Authorization Grant。
- OAuth token 必须与项目配置、Plugin 清单和仓库内容隔离，持久化时使用操作系统凭据存储。
- 外部 Plugin 只能使用声明式、分级授权的 Patch 能力，不允许携带可任意执行的 JavaScript adapter。
- 需要提供一个内置的 Plugin 作者 Skill，指导 `rd-guide` 等仓库按 Flower Plugin 契约开发和发布。

## 需求

### R1. Flower Plugin 契约

- 定义带版本号的 `.flower-plugin/plugin.json` 清单格式。
- Plugin 包至少允许包含 `skills/`、`patches/`、`assets/`、`scripts/` 和 `tests/` 等标准目录；具体目录是否可用由能力配置约束。
- Skill 以单一规范内容维护，Runtime 默认投影到当前项目检测到的全部受支持 AI 平台目录。
- 用户可以通过项目配置或命令行 `--platform` 限定目标平台；平台选择不改变 Plugin 内容锁定结果。
- Plugin 只有在平台确有差异时才提供显式 platform override，不能默认复制多份近似内容。
- 外部 Plugin 的 `scripts/` 只作为 Skill 资源被动分发，Flower 不在安装、更新或卸载阶段自动执行。
- 清单必须声明 Plugin 标识、版本、兼容的 Flower/Trellis 版本、入口内容、所需能力和来源元数据。
- manifest 与能力协议必须支持版本协商，为未来增加受控 lifecycle hook 保留扩展空间；旧 Runtime 遇到未知 required capability 必须拒绝安装，不能静默忽略。
- Plugin、catalog 和 patch operation 标识必须支持命名空间，避免不同 Marketplace 之间冲突。
- 契约应保留未来导出到其他宿主格式的可能性，但本期不实现 Codex Plugin 兼容层。

### R2. 核心 Runtime 与内置 `skill-garden`

- Flower Plugin Runtime 必须能够在未安装 `skill-garden` 时独立运行，并完成 Plugin 的解析、安装、校验、更新和卸载。
- Flower Plugin Runtime 必须能够在未安装 Trellis 的普通项目中运行；Trellis 与 `skill-garden` 都通过 Plugin 的显式依赖和能力需求接入。
- 将现有 `enhancements/` 中由 `skill-garden` 提供的能力建模为随包分发的内置基础 Plugin。
- `skill-garden` 随 npm 包发布，在完整 Trellis 工作流场景中默认安装或重新应用。
- 支持仅分发目标 Plugin 内容的轻量场景，不隐式安装 `skill-garden`。
- Plugin 必须显式声明依赖；只有声明依赖 `skill-garden` 的 Plugin 才要求先安装或同步安装它。
- `skill-garden` 的默认安装策略由初始化模式或明确配置决定，不能由外部 Plugin 隐式提升为全局强制依赖。
- `flower-trellis init` 采用完整 Trellis 模式；`flower-trellis plugin add <plugin>` 在必要时自动建立最小 Plugin Runtime，不额外引入 `--plugin-only` 初始化模式。
- `skill-garden` 与 Flower 内置 catalog 保留现有本地 operation ID 兼容语义，外部 catalog 使用限定 ID。

### R3. Marketplace 与来源管理

- 支持注册、列出、更新和移除 Marketplace 来源。
- Marketplace 可以由 GitLab 仓库提供，并能索引一个或多个 Flower Plugin。
- Marketplace 采用“索引为主、允许内容共仓”的混合模型，统一清单位于 `.flower-marketplace/marketplace.json`。
- Marketplace 条目既可以引用当前仓库内的 Plugin 目录，也可以引用其他 GitLab 仓库的固定 tag/commit 及可选子目录。
- 外部仓库 Plugin 由对应团队独立维护；Marketplace 负责可发现元数据、来源定位、兼容范围和可授予能力上限，不复制其实现内容。
- 共仓 Plugin 与外部仓库 Plugin 使用相同的 Flower Plugin 清单和校验流程，不能形成两套发布协议。
- 外部团队发布不可变 tag 后，通过向 `rd-guide` 的 Marketplace 索引提交 GitLab Merge Request 完成注册。
- Marketplace CI 必须校验 Plugin manifest、固定版本引用、完整性摘要、依赖闭包、兼容范围和申请能力是否超过条目上限。
- 申请 `integration` 能力的 Marketplace 变更必须经过指定 CODEOWNERS 审核；普通提交者不能通过修改索引自行授予高权限。
- 只有 Marketplace Merge Request 合并后的版本才能进入默认来源的搜索与安装结果。
- flower-trellis 随包内置 `rd-guide` 来源描述和对应 GitLab OAuth Application ID，但不包含或依赖 Application Secret。
- 默认来源采用惰性访问：普通 CLI 启动、完整 Trellis 初始化和本地 Plugin 操作不得主动连接 GitLab。
- 首次搜索、查看详情或安装 `rd-guide` 中的 Plugin 时才访问远端，并在缺少有效凭据时触发 OAuth。
- 用户可以禁用预注册来源；禁用状态属于用户级来源配置，不修改项目 Plugin 声明或内置包文件。
- 首期至少支持按固定版本或不可变 Git 引用解析 Plugin，生成可复现的锁定结果。
- 安装前展示来源、版本、将写入的目标路径和请求的能力。
- Marketplace 元数据与已下载 Plugin 必须具备完整性校验；具体签名或校验和机制在技术设计中确定。

### R4. GitLab OAuth 认证

- 支持为 GitLab 实例注册 OAuth provider 配置，其中 Application ID 可以作为非敏感配置随 Flower 分发或由管理员配置。
- 有浏览器环境时使用 PKCE 登录；无浏览器环境时使用 GitLab Device Flow。
- OAuth 默认申请 `read_repository read_api`：前者用于私有仓库 Git-over-HTTP 与 Repository Files API，后者用于 `repository/tree`、archive 等只读 REST API；不申请具备写权限的 `api`。
- access token 和 refresh token 不得写入 `.trellis/`、项目仓库、Plugin lock/manifest 或命令日志。
- token 过期时支持刷新；凭据缺失或失效时允许重新发起 GitLab 授权流程。
- 不依赖 OAuth Application Secret，历史上暴露的 secret 不进入任何代码、配置、任务文档或测试夹具。

### R5. Plugin 生命周期与状态

- 提供来源与 Plugin 生命周期命令，目标命令面包括：
  - `flower-trellis plugin source add|list|remove|update`
  - `flower-trellis plugin search|list|add|update|remove|verify`
- `plugin add` 负责解析并锁定版本；`plugin update` 负责重新解析可用的新版本。
- `plugins.json` 只保存用户直接安装的 Plugin；`plugin-lock.json` 保存完整、可复现的直接与传递依赖图。
- `plugin add` 自动解析并安装兼容的传递依赖，共享依赖在同一项目中只维护一个满足约束的锁定实例。
- `plugin remove` 在 dry-run 展示后清理不再被任何直接或传递依赖引用的孤立依赖，不删除仍被共享的 Plugin。
- 依赖缺失、循环或版本约束冲突必须在统一 preflight 阶段失败，目标文件、声明、锁文件和状态全部零写入。
- 在尚未执行完整 `flower-trellis init` 的项目中，`plugin add` 必须能够引导运行所需的最小状态，并根据目标 Plugin 的显式依赖决定是否需要 Trellis 或 `skill-garden`。
- 普通 `flower-trellis update` 只重新应用已锁定的 Plugin 版本，不隐式升级外部 Plugin。
- 新 Plugin Runtime 使用独立的 `.flower/` 项目边界保存声明、锁定结果和本地应用状态，不要求项目存在 `.trellis/`。
- `.flower/plugins.json` 作为项目可提交的期望配置，声明所需 Plugin、来源别名和直接依赖约束。
- `.flower/plugin-lock.json` 作为项目可提交的锁文件，记录解析后的不可变版本、来源引用、依赖图和完整性摘要。
- `.flower/state.json` 作为不提交的本机应用状态，记录实际生成路径、目标平台、patch provenance 和清理所需所有权信息。
- lockfile 不记录本机检测到的平台；不同开发者的实际平台和生成路径仅进入本机 `state.json`。
- `.flower/cache/` 作为不提交、可安全清理的下载与解析缓存；删除缓存不得破坏已安装状态或锁文件。
- Plugin 状态必须带 schema version，并记录每个 Plugin 的来源、锁定版本、variant、生成路径和 patch provenance。
- 旧 `.trellis/.flower-manifest.json` 在内存中迁移为新模型，并提供可验证、可回滚的持久化迁移路径。
- 卸载或移除时只能删除该 Plugin 明确拥有且仍可验证的路径，不能根据当前包快照猜测所有权。

### R6. 受限 Patch Engine

- 定义至少三档能力配置：
  - `standard`：仅安装 skills、spec 和 assets，不修改 Trellis 核心文件。
  - `integration`：允许对明确白名单目标执行受管的 insert patch，面向受信任的 `rd-guide` 类 Plugin。
  - `system`：允许完整 insert/replace/remove、hook 和 migration，仅供 Flower 与内置 `skill-garden` 使用。
- 外部 Plugin 不能通过清单自行提升到 `system`。
- Plugin manifest 只能声明请求的能力；Marketplace 信任策略为每个 Plugin 限定可授予能力上限，Runtime 取两者交集并执行自身硬限制。
- `integration` Plugin 首次安装时必须展示目标文件、Patch 类型和能力范围，由项目用户确认后才能应用。
- 已确认的能力集合及其摘要写入 `plugin-lock.json`；Plugin 版本、Patch 内容或请求能力变化时必须重新确认。
- `system` 能力只能由 Flower 内置信任根授予，任何 Marketplace 配置、项目配置或命令参数都不能为外部 Plugin 提权。
- v1 禁止外部 Plugin 声明或执行 install/update/remove lifecycle hook；受 Flower 控制的 hook 和 migration 仅供内置 `system` Plugin 使用。
- 未来 hook 能力必须通过新的协议版本、独立 capability 和明确授权引入，不能复用 `scripts/` 目录形成隐式执行入口。
- 多 Plugin 应用前执行统一 preflight；任一 required operation 失败时必须保持零写入。
- patch 冲突、selector 不匹配、重复应用和卸载恢复必须具有确定性结果及可诊断输出。
- Patch Engine 的具体 schema 与执行语义应复用并扩展现有规范，避免形成第二套 patch 协议。

### R7. Plugin 作者工具与 Skill

- 内置 `flower-plugin-author` Skill，指导维护者创建、校验、测试和发布 Flower Plugin/Marketplace。
- Skill 应覆盖 manifest、能力档位、Patch 契约、Marketplace 索引、GitLab 发布和兼容性约束。
- 作者 Skill 应指导维护者发布不可变版本、生成注册条目、运行本地校验并向 `rd-guide` 提交 Merge Request。
- CLI 提供确定性工具承载机器可验证逻辑，目标能力包括 `plugin init`、`plugin validate` 和 dry-run/preflight。
- 作者 Skill 只编排工作流和解释约束，不在提示词中复制 CLI 的 schema 校验实现。

### R8. 兼容性与演进

- 保持现有 `flower-trellis init`、`update`、`skill`、`uninstall` 和自检流程在迁移期可用。
- 现有 `skill-garden` 安装结果应能被新 manifest 正确识别，不能重复写入或错误删除。
- Plugin 体系的配置、状态和缓存边界必须区分：项目可提交配置、项目本地状态、用户级来源配置、用户级凭据和可清理缓存。
- 无 Trellis 项目不得因为安装普通 Plugin 而生成 `.trellis/`；只有显式依赖 Trellis 的 Plugin 才能触发相应依赖检查或安装引导。
- 失败恢复必须优先使用 manifest provenance 和事务性写入，不依赖不受控的目录覆盖。

## 验收标准

- [ ] 存在版本化的 Flower Plugin 与 Marketplace 契约，并有 schema 校验和兼容性测试。
- [ ] Marketplace 能从当前仓库目录和外部 GitLab 仓库固定引用解析 Plugin，两种来源产出相同的标准安装包模型。
- [ ] 示例 Plugin 可通过 GitLab Merge Request 注册到 `rd-guide`；CI 会拒绝可变引用、摘要不匹配、依赖不闭合和越权能力申请。
- [ ] `integration` 注册变更需要 CODEOWNERS 审核，合并前不会出现在默认 Marketplace 的发现结果中。
- [ ] Flower Plugin Runtime 可在无 `skill-garden` 环境中安装和管理不依赖它的 Plugin。
- [ ] Flower Plugin Runtime 可在完全没有 Trellis 的普通项目中安装和管理 Plugin，且不会生成 `.trellis/`。
- [ ] `skill-garden` 作为默认基础 Plugin 运行，完整 Trellis 初始化与更新行为完成兼容迁移。
- [ ] 仅分发模式不会隐式安装 `skill-garden`，但能正确处理目标 Plugin 显式声明的依赖。
- [ ] 可以注册 GitLab Marketplace、完成 OAuth 登录，并从私有仓库发现和安装 Plugin。
- [ ] 未使用 `rd-guide` 时不会产生 GitLab 网络请求；首次使用时按需授权，禁用后不再参与发现和解析。
- [ ] 在有浏览器和无浏览器环境中分别验证 PKCE 与 Device Flow；任何 token 均不出现在项目文件或日志中。
- [ ] 使用 `read_repository read_api` token 验证 Git-over-HTTP、`repository/tree` 和 archive 读取成功，同时验证写 API 仍无授权。
- [ ] Plugin 的 add、list、search、update、remove、verify 和 source 管理流程具备命令级测试。
- [ ] 传递依赖可自动安装，共享依赖不会重复铺设，移除直接 Plugin 后仅清理真正孤立的依赖。
- [ ] 依赖循环与版本冲突在写盘前失败，声明、lockfile、状态和目标文件保持不变。
- [ ] 普通 Flower 更新能重放锁定版本，只有显式 Plugin 更新才改变外部 Plugin 版本。
- [ ] 多 Plugin patch 在统一 preflight 后原子应用；required 失败场景验证为零写入。
- [ ] `standard`、`integration`、`system` 三档能力边界有正向和越权拒绝测试。
- [ ] `integration` 首次安装需要项目确认，未变化的锁定能力可复用；版本、内容或权限变化会强制重新确认。
- [ ] Marketplace 无法把外部 Plugin 提升为 `system`，伪造 lockfile 或命令参数也会被 Runtime 拒绝。
- [ ] 外部 Plugin 的脚本在生命周期命令中不会执行；未知 required capability 会被旧 Runtime 明确拒绝。
- [ ] 旧 manifest 可迁移到新 schema，安装路径所有权和 patch provenance 保持正确。
- [ ] 新项目提交 `plugins.json` 和 `plugin-lock.json` 后，另一台机器能解析出相同 Plugin 与依赖版本；本机 `state.json` 和缓存不产生仓库 diff。
- [ ] 同一锁文件可在不同 AI 平台组合的机器上安装相同 Plugin 内容，并只在各自本机状态中记录实际投影路径。
- [ ] `flower-plugin-author` Skill 与 CLI 初始化、校验、dry-run 流程可以指导一个示例 `rd-guide` Plugin 通过验证。
- [ ] 现有 CLI 回归测试通过，并覆盖初始化、更新、自检和卸载的迁移行为。
- [ ] 完成按独立交付物划分的子任务，并通过父任务的跨模块集成审查。

## 非目标

- 本期不实现 Codex Plugin 或其他平台 Plugin 格式兼容。
- 本期不建设公共互联网 Marketplace、计费、评分或审核运营系统。
- 本期 Flower Runtime 不在安装、更新、卸载等生命周期阶段执行第三方任意 Node.js/JavaScript 代码；作为 Skill 资源分发的脚本仍由用户或 Agent 按宿主原有权限显式调用。
- 本期不开放第三方 lifecycle hook；只保留可版本化演进的协议边界。
- 本期不负责 GitLab 实例的 HTTPS、证书或网络基础设施改造。

## 已确认决策

- [x] 使用命令意图区分两种入口：`init` 默认安装完整 Trellis 与 `skill-garden`；`plugin add` 只引导最小 Runtime 并安装目标 Plugin 及其显式依赖。
- [x] 仅分发模式支持完全没有 Trellis 的普通项目，Plugin Runtime 状态迁移到独立的 `.flower/` 边界。
- [x] `.flower/plugins.json` 与 `.flower/plugin-lock.json` 提交到仓库；`.flower/state.json` 与 `.flower/cache/` 仅保留在本机并默认忽略。
- [x] `rd-guide` 随 flower-trellis 预注册为按需连接的默认 Marketplace，首次使用时才访问 GitLab/OAuth，并允许用户禁用。
- [x] `integration` 采用 Plugin 请求、Marketplace 能力上限和项目首次确认三层授权；权限摘要进入 lockfile，发生变化时重新确认。
- [x] Plugin 显式依赖自动安装；`plugins.json` 只记录直接项，lockfile 保存完整依赖图，孤立传递依赖经 dry-run 展示后自动清理。
- [x] `rd-guide` 采用索引为主、允许内容共仓的混合 Marketplace，可引用其他 GitLab 仓库的固定版本及子目录。
- [x] Plugin 中的 Skill 只维护一份规范内容，默认分发到所有检测到的平台；用户可显式限定，实际平台仅记录于本机状态。
- [x] 外部 Plugin 的 `scripts/` 只作为 Skill 资源被动分发，生命周期阶段禁止自动执行；未来 hook 通过新协议版本和独立能力开放。
- [x] 外部团队发布固定版本后，通过向 `rd-guide` 提交 Merge Request 注册；CI 校验清单、引用、摘要、依赖和能力，`integration` 需要 CODEOWNERS 审核。

## 规划说明

- 这是复杂任务，进入 `task.py start` 前必须补齐 `design.md` 和 `implement.md`。
- 建议在需求边界确认后，按 Plugin 契约与状态、GitLab Marketplace/OAuth、Patch Engine 权限化、CLI 生命周期、内置 Plugin 迁移、作者 Skill 六类可独立验收交付物拆分子任务。
