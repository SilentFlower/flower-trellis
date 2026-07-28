# Flower Plugin Runtime、依赖解析与生命周期 CLI

## 目标

在 P1 冻结的 schema、DTO、完整性和 Project Store 之上，实现可在普通项目中独立运行的 Flower Plugin Runtime：解析直接与传递依赖、生成稳定锁定图、规划多平台内容投影，并通过统一事务完成 `plugin list/add/update/remove/verify` 生命周期。

本任务是父任务 P2，依赖 `07-28-flower-plugin-contract-state`。GitLab/OAuth、外部 Patch capability 和 `skill-garden` 迁移分别由 P3、P4、P5 负责。

## 已确认事实

- `src/cli.js` 当前只显式接管固定一级命令，未知命令会透传 Trellis；`plugin` 必须在透传前接管。
- `src/lib/cli-args.js#parseCliArgs()` 只解析一层子命令，不适合继续堆叠全部 Plugin 子命令语义。
- `ENHANCEMENT_SKILL_TARGETS` 已集中记录平台原生 Skill root，Codex、Gemini、ZCode 共用 `.agents/skills`。
- `copySkills()` 当前无平台时回退 `.claude/skills`；普通 Plugin 模式不能沿用该行为。
- `copyPath()` 会删除并整体覆盖目标；Plugin 安装必须先统一 preflight，再通过事务写入。
- P1 提供 Plugin/Marketplace/project schema、canonical ID、stable JSON、tree hash 和 Project Store。

## 需求

### R1. Runtime 应用层

- 实现单一 Plugin application service，负责协调 Project Store、Source Registry、Resolver、Platform Detector、Install Planner 和 Transaction Writer。
- application service 只依赖抽象 Source Provider；P2 实现 builtin/local provider，P3 注入 GitLab provider。
- 所有生命周期先完成解析、摘要、目标和冲突 preflight，再修改声明、lock、state 或目标文件。
- `--dry-run` 返回与真实执行相同的解析与计划结果，但不写任何文件。
- `--json` 输出稳定结构，不混入交互文本、绝对缓存路径或凭据。

### R2. 依赖解析与锁定

- `plugins.json` 只记录直接 Plugin 约束；resolver 自动解析完整传递依赖图。
- canonical Plugin ID 是唯一节点键；拒绝未知依赖、来源歧义、自依赖和循环。
- 使用 SemVer 求解全部约束交集；同一 Plugin 在项目中只允许一个锁定版本。
- 已有 lock 与直接约束未变化时优先保持现有锁定版本，避免无关升级。
- `plugin add` 解析目标和传递依赖；`plugin update` 才允许重新选择更高兼容版本；普通 lock 重放不升级。
- 输出稳定拓扑顺序、完整依赖边和 orphan 集合；排序不能依赖对象插入、文件系统或网络返回顺序。
- 版本冲突和循环必须提供涉及节点、约束来源和稳定错误码。

### R3. Source Registry 最小接口

- 定义 Provider 查询候选、读取固定包和验证来源身份所需的接口，返回 P1 DTO。
- builtin provider 从 npm 包内置目录读取 Plugin；local provider 从显式本地路径读取。
- local provider 只用于开发和测试，仍执行 schema、路径和 canonical tree hash 校验。
- P2 不实现用户级远端来源持久化和网络访问；Source Registry 必须允许 P3 后续注册 GitLab provider。

### R4. 多平台内容投影

- 复用并泛化现有平台 descriptor registry，不复制多份平台名单。
- 默认检测项目中已存在的受支持平台根；多个平台共享同一物理 Skill root 时只生成一个 mutation。
- 用户可通过 `--platform` 限制目标平台；平台选择只影响本机 `state.json` 和目标 mutation，不改变 Plugin lock/digest。
- 普通 Plugin 在完全没有检测到平台且未指定 `--platform` 时返回需要选择平台的诊断，不能隐式创建 Claude root。
- canonical Skill 内容默认投影到每个选中平台；显式 platform override 只覆盖声明的差异。
- 两个 Plugin 计划写入同一路径且所有权或内容不同，统一 preflight 失败，不采用后安装覆盖。

### R5. 普通内容 InstallPlan

- 将 Plugin 内容转换为 P1 `ContentMutation` 和 `InstallPlan`，目标路径必须经过安全边界校验。
- 安装计划合并全部 Plugin 后一次检查目标重复、文件/目录前缀冲突、现有用户文件冲突和 ownership 冲突。
- 本任务只处理 standard 内容 mutation；P4 将 Patch mutation 合并进同一 InstallPlan。
- 所有计划都携带 before hash、after hash、owner、来源和操作类型，供写前复核与 dry-run 展示。

### R6. 事务写入与恢复

- Transaction Writer 在 `.flower/transactions/` 创建本机事务记录和 staging/backup，状态文件保持 gitignored。
- 写入前复核所有 before hash；任一漂移时零写入。
- 目标 mutation 全部成功后才写 lock、plugins 和最终 state；state 最后写入作为成功证据。
- 中途失败必须恢复已修改目标和项目文件；恢复失败返回明确的 repair blocker，不伪造成功 state。
- changed-only：内容相同不写；重复应用同一 lock 和平台选择必须零目标变化。
- 删除只允许 state 中归属当前 Plugin 且目标 hash 仍匹配的路径；用户修改过的文件报告冲突，不直接删除。

### R7. 生命周期命令

- 接管以下命令：
  - `plugin list`
  - `plugin add <plugin> [--source] [--version] [--platform] [--dry-run] [--json]`
  - `plugin update [plugin] [--platform] [--dry-run] [--json]`
  - `plugin remove <plugin> [--dry-run] [--json]`
  - `plugin verify [plugin] [--json]`
- `plugin add` 在无 `.flower/` 项目中建立最小 Runtime，不生成 `.trellis/`，也不隐式安装 `skill-garden`。
- `plugin remove` 在 dry-run 展示孤立传递依赖，只清理不再被任何节点引用的依赖。
- `plugin verify` 校验声明、lock、包摘要、state ownership 和目标 hash，不自动修复。
- 多级 Plugin 参数由独立 parser 处理；不得破坏现有 init/update 等参数解析和未知 Trellis 命令透传。

## 验收标准

- [ ] builtin/local provider 可解析相同标准包模型，并拒绝摘要、schema 和路径错误。
- [ ] resolver 覆盖直接/传递依赖、共享依赖、锁定保持、更新、缺失、循环和约束冲突。
- [ ] 解析结果在候选输入顺序变化时仍生成相同拓扑和 lock 字节。
- [ ] 无 Trellis 项目执行 `plugin add` 只创建 `.flower/` 与目标平台内容，不创建 `.trellis/` 或 `skill-garden`。
- [ ] 无平台且无 `--platform` 时明确失败且零写入；共享物理 Skill root 不重复 mutation。
- [ ] 路径重复、文件/目录前缀、用户文件和跨 Plugin ownership 冲突在写盘前失败。
- [ ] transaction writer 的 before-hash 漂移、中途写入失败和恢复失败均有测试，成功 state 始终最后写。
- [ ] add/update/remove/verify 的 dry-run 与 JSON 输出有命令级测试，dry-run 零写入。
- [ ] remove 只清理真正孤立且仍匹配 state hash 的路径，保留共享依赖和用户修改文件。
- [ ] 连续应用同一 lock 两次，第二次目标、plugins、lock 和 state 无变化。
- [ ] 现有 CLI、init/update 和 `npm test` 回归通过。

## 非目标

- 不实现 GitLab、OAuth、keyring、远端 search/source/auth 命令。
- 不实现 Patch capability 或调用 Patch Engine。
- 不迁移 `skill-garden`、旧 manifest、init/update/uninstall。
- 不执行第三方 scripts 或 lifecycle hook。
