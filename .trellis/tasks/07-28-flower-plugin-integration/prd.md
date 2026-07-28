# Flower Plugin 跨模块集成、打包与端到端验收

## 目标

将 P1-P6 的契约、Runtime、GitLab、Capability、skill-garden 迁移和作者工具收敛为一致、可发布的 Flower Plugin 产品面，并通过真实 CLI 进程、临时项目、GitLab mock 和 npm pack 验证父任务全部验收标准。

本任务是父任务 P7，依赖 P3、P4、P5、P6 完成；只负责集成、文档、打包与跨模块缺口修复。

## 需求

### R1. CLI 产品面

- 统一顶层 help、Plugin 子命令 help、退出码、交互提示和错误格式。
- 命令面完整覆盖 source、auth、search、list、add、update、remove、verify、init、validate。
- `--dry-run`、`--json`、`--platform`、`--source` 等公共参数行为一致，不因子命令产生近似但不同的格式。
- 未知 Plugin 子命令返回 Flower 用法错误；非 Plugin 未知顶层命令继续透传 Trellis。
- JSON stdout 只包含一个稳定 JSON 文档；人类提示、进度和浏览器说明进入 stderr 或交互通道。

### R2. README 与使用文档

- README 说明 Flower Plugin 是自有格式，不以 Codex Plugin 兼容为目标。
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
