# Flower Plugin 跨模块集成、打包与端到端验收

## 目标

将 P1-P6 的契约、Runtime、GitLab、Capability、skill-garden 迁移和作者工具收敛为一致、可发布的 Flower Plugin 产品面，并通过真实 CLI 进程、临时项目、GitLab mock 和 npm pack 验证父任务全部验收标准。

本任务是父任务 P7，依赖 P3、P4、P5、P6 完成；只负责集成、文档、打包与跨模块缺口修复。

## 需求

### R1. CLI 产品面

- 统一顶层 help、Plugin 子命令 help、退出码、交互提示和错误格式。
- 命令面完整覆盖 source、auth、search、list、add、update、remove、verify、init、validate。
- 顶层 help 只展示一个 `flower-trellis plugin` 产品入口，不展开 lifecycle、authoring、source/auth/search 三组子命令；这些显式子命令保留为交互管理器内部复用、CI 和高级自动化接口，只在 `plugin --help` 与高级文档中说明。
- 交互 TTY 中裸执行 `flower-trellis plugin` 必须进入持续存在的 Plugin 管理器，而不是直接打印 `plugin list`。管理器采用借鉴 Claude Code `/plugin` 信息架构的 `发现 / 已安装 / 来源 / 问题` 四页签，不再使用六项平铺首页菜单；只借鉴交互模型，不兼容 Claude Plugin 格式。
- 页签切换、详情页返回和操作完成后必须保留当前搜索词、筛选条件与选中位置，避免每次操作都退回初始首页。
- 非 TTY 中裸执行 `flower-trellis plugin` 保持现有只读 `plugin list` 行为，不得等待输入；显式子命令、`--json` 和自动化调用始终保持确定性的命令模式，不显示横幅或 prompt。
- `发现` 页合并展示所有已启用 Marketplace 的 Plugin，并以来源标签区分；只有一个来源时不要求用户先理解或选择来源。进入页面时刷新 Marketplace，新增 Plugin 或版本自动出现在列表中，刷新失败必须明确显示旧缓存状态。
- 浏览安装流程至少串联搜索、详情、版本与目标平台选择、dry-run 变更摘要、capability 摘要与最终确认；远程来源需要认证时默认直接启动 Device Flow，立即展示授权地址与授权码，授权成功后自动返回原详情或搜索位置。PKCE 只保留为高级认证入口。首版保持单 Plugin 事务边界，不提供可能产生部分成功的批量安装。
- `已安装` 页集中提供详情、verify、update、remove，并把错误、待处理项和可更新项置顶；`来源` 页管理 Marketplace、登录状态与刷新；`问题` 页集中展示认证、依赖、完整性、目标漂移和加载错误诊断。
- 已安装管理必须从项目 `plugins/lock/state` 展示直接声明、解析版本、来源和应用平台，并提供 verify、update、remove；危险操作先展示预览并二次确认。
- 来源与认证管理必须展示 source 启停状态和 GitLab 登录状态，并复用现有 source/auth 命令契约完成新增、修改、启停、登录和退出，不复制 OAuth、Keyring 或 source schema。
- `--dry-run`、`--json`、`--platform`、`--source` 等公共参数行为一致，不因子命令产生近似但不同的格式。
- 未知 Plugin 子命令返回 Flower 用法错误；非 Plugin 未知顶层命令继续透传 Trellis。
- JSON stdout 只包含一个稳定 JSON 文档；人类提示、进度和浏览器说明进入 stderr 或交互通道。

### R2. README 与使用文档

- README 说明 Flower Plugin 是自有格式，不以 Codex Plugin 兼容为目标。
- README 以交互式 `flower-trellis plugin` 为首要使用路径，不要求普通用户记忆 lifecycle、authoring 或 GitLab 管理子命令；显式命令集中放在高级/自动化章节。
- 说明完整 init 默认安装 `skill-garden`，独立 plugin add 不隐式安装，普通项目可只使用 Plugin Runtime。
- 覆盖 `.flower/` 可提交/本机边界、Marketplace/source/auth、生命周期、capability、作者流程和迁移行为。
- 不在 README 写入 OAuth secret、真实 token、device code 或内部 GitLab 凭据。
- 示例命令必须由测试或 help snapshot 覆盖，避免文档与 CLI 漂移。

### R3. npm 打包

- `package.json#files` 显式包含 `src/plugin/**`、builtin plugins、builtin marketplaces、author Skill 和必要模板/fixture，排除测试密钥、缓存和开发临时文件。
- `ajv`、`semver` 为直接依赖；`@napi-rs/keyring` 为 optional dependency，缺失时包仍可安装和运行。
- `npm pack --dry-run --json` 校验必需文件存在、禁止文件缺失，并检查 tarball 中无绝对路径、token 或运行态状态。
- 保持现有 enhancement snapshot、scripts 和发布流程可用。

### R4. 端到端场景矩阵

- 使用真实 `bin/flower-trellis.js` 子进程和临时目录，不只调用内部函数。
- 至少覆盖：
  - 无 Trellis + local standard Plugin。
  - 无 Trellis + 显式依赖 skill-garden 的 Plugin 被正确阻断或引导。
  - 新完整 Trellis init 默认 skill-garden。
  - 已有 `.flower/` lock 的重复重放。
  - 旧 `.trellis/.flower-manifest.json` 迁移。
  - 多平台与共享 `.agents/skills`。
  - 多 Plugin 共享依赖、冲突和 orphan remove。
  - integration 首次确认、frozen 复用和摘要漂移。
  - GitLab mock search/add/update、PKCE 与 Device Flow。
  - author scaffold/validate/Marketplace CI fixture。
- 每个场景记录命令、预期退出码、目标树、plugins/lock/state、网络请求和敏感输出断言。

### R5. GitLab 与敏感信息

- 本地 HTTP mock 覆盖 GitLab REST、OAuth 和 archive；自动测试不依赖真实 GitLab 或 keyring。
- 未使用/已禁用 `rd-guide` 的场景断言网络请求为 0。
- token、refresh token、Authorization、device code、authorization code 和 Application Secret 在 stdout、stderr、JSON、fixture、snapshot、state、lock、cache metadata 中均不可出现。
- 真实 GitLab 只作为最终人工 smoke test，不影响自动测试通过条件。

### R6. 原子性与恢复

- 依赖冲突、schema/digest 错误、capability 越权、selector 漂移、路径冲突和 before-hash 漂移均验证为零写入。
- 注入 writer 故障后验证目标、plugins、lock 和 state 恢复；恢复失败保留事务证据并返回 blocker。
- 连续执行同一 add/replay 两次，第二次目标树、lock、state 和 mtime 满足各模块幂等契约。
- uninstall/remove 只删除可验证 ownership，保留用户修改和共享内容。

### R7. 回归与父任务审查

- 运行完整 JS/Python、Patch conflict、compiled targets、context budget、snapshot 和 npm pack 门禁。
- 父任务 PRD 每条验收标准映射到自动化测试或明确人工步骤。
- 检查 P1-P6 共享 DTO、错误码、JSON 输出、Plugin ID、profile 和状态 schema 没有重复定义或漂移。
- 集成发现归属模块缺陷时优先回到对应子任务修复；不得通过放宽 digest、capability、preflight 或 required 语义让测试通过。

## 验收标准

- [ ] 所有 Plugin 子命令 help、退出码、dry-run 和 JSON 输出一致并有 snapshot/contract 测试。
- [ ] 顶层 help 只保留单一 Plugin 管理入口，不再枚举三组底层子命令；`plugin --help` 仍能为 CI 和高级用户提供完整参数参考。
- [ ] 交互 TTY 裸执行 `flower-trellis plugin` 打开 `发现 / 已安装 / 来源 / 问题` 四页签管理器，可完成 Marketplace 浏览安装、已安装管理、更新和来源认证；未授权来源自动进入 Device Flow，授权完成继续原安装流程；页签、搜索和选中状态可恢复，退出不写项目。
- [ ] 非 TTY 裸命令不阻塞并保持 list 兼容；显式子命令和 `--json` 不进入交互模式，stdout 契约不漂移。
- [ ] 交互安装和卸载在确认前展示 dry-run、依赖、capability 与目标变化；取消确认满足零写入。
- [ ] README 示例与实际 CLI 同步，清楚表达完整 init 与独立 Plugin 模式。
- [ ] npm tarball 包含全部运行资产和作者 Skill，不包含测试秘密、缓存、runtime 或不应发布文件。
- [ ] 场景矩阵覆盖无 Trellis、新 Trellis、旧迁移、多平台、多 Plugin、GitLab、capability、作者工具和 uninstall。
- [ ] 未使用 rd-guide 零网络，OAuth 两种 flow 通过，所有敏感字段扫描为零。
- [ ] 所有 preflight 失败和 writer 故障满足零写入/可恢复契约。
- [ ] 两次连续应用第二次无目标、lock 和 state 变化。
- [ ] 父任务每条验收都有证据映射，P1-P6 共享契约无漂移。
- [ ] `npm test`、`npm run sync`、snapshot、Patch、context budget 和 `npm pack --dry-run --json` 全部通过。
- [ ] 真实 GitLab smoke test 验证 search/tree/archive/add 路径，并确认项目 diff 无凭据。

## 非目标

- 不发布 npm、不 push、不 merge、不 release、不部署。
- 不修改真实 rd-guide 仓库或 GitLab 管理配置。
- 不新增父任务未定义的 Plugin 协议、权限档位或来源类型。
- 不通过集成层重写 P1-P6 核心实现。
- 不引入 Ink、React、Blessed 等常驻全屏 TUI 框架，不新增跨多个 Plugin 的批量事务。
