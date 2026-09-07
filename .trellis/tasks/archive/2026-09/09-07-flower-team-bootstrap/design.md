# 技术设计

## 边界与入口

保持一个实现单元：共享项目版本是成员安装引导的输入，旧记录退出保证输入不被历史版本污染。验收连接升级与团队克隆，不拆成独立发布的子任务。

复用 `projectSkillGardenContent`、`createInstallPlan` 和 `TransactionWriter`，将新增元数据变更放入现有 preflight、dry-run、失败回滚与上游升级补偿链。只在实际投影内置 Skill-Garden 时迁移，覆盖 full、enhance-only 和 selected 安装的元数据；`--no-enhance` 冻结分支不迁移。

## 共享记录

- 根 `.gitignore` 存在且为普通文件时，用固定标记管理末尾块，每次替换原块，不重复追加；保留块外字节和换行风格。不完整或歧义标记在 preflight 报错，避免吞掉用户规则。
- 根块采用如下语义，解除父目录忽略并只共享三个标准文件：

  ```gitignore
  !/.flower/
  /.flower/*
  !/.flower/.gitignore
  !/.flower/plugins.json
  !/.flower/plugin-lock.json
  ```

- 局部 `.flower/.gitignore` 继续补齐 `REQUIRED_IGNORE_RULES`，增加 `settings.json`，末尾保证标准共享文件不被局部通配规则排除。采用可复用的纯规则规划函数，不用简单字符串包含判断有效性。
- 根文件缺失则跳过根块，局部规则仍保护标准本地数据。更高层 Git 排除整个目标目录不是修改目标根规则能解决的问题，不伪称所有环境都会追踪文件。
- 根规则作为有精确前后摘要的内容 mutation，不加入插件独占 ownership，避免用户后续编辑或插件移除被判定为可覆盖/可删除整份文件。个人 settings、缓存也不成为独占内容。
- `ProjectStore.ensureLayout()` 会在事务目标备份之前写局部规则，写项目 JSON 时还会再调用。必须在首次 ensureLayout 前保存局部文件原始状态用于回滚，规则规划与 ensureLayout 合并逻辑保持一致；不能备份已经修改的字节来声称恢复成功。

## 旧记录迁移

- 在 `src/lib/manifest.js` 增加纯迁移规划能力，复用现有结构解析和归一化，返回固定目标及必要写入字节；不在 preflight 调用会写盘的 `writeUpdateCheck`。
- 在内置适配器中保留旧 ownership、路径和漂移校验，之后合并 settings/cache 写入与 `.trellis/.flower-manifest.json` 精确删除 mutation。
- 策略：有效现代 settings 优先，缺失时迁入旧 manifest 策略。无需迁移时保留现代原字节及其他字段；现代 settings 损坏时拒绝覆盖。
- 缓存：沿用现代 tmp、旧 `.trellis/.flower-update-check.tmp`、旧 manifest 缓存的读取优先级，需要迁移时写现代 tmp。缓存迁移不能代替策略迁移。
- 旧 manifest 损坏时不盲删，报告修复入口；不存在则无删除。新安装不生成旧文件，migration 标记继续描述来源而不要求源文件仍在。
- 新配置与旧文件删除在同一事务中；最终现代 state 写入成功才代表迁移完成。底层目标按既有顺序执行，失败恢复原字节，不新增成功返回后无备份删除，不承诺原系统未提供的断电恢复。
- InstallPlan 目标随 `onPreflight` 进入正常 update 的快照扩展，enhance-only 由插件事务覆盖。特别验证默认快照不含根 `.gitignore` 时新目标仍进入补偿。
- 删除无生产调用的旧 manifest 写入 API，旧测试数据改用夹具构造；保留未升级项目的兼容读取。调整 `update-check get`：旧文件缺失不能再显示为默认策略，不常规打印已退出的旧记录路径。

## CLI 安装引导

### 检测

- 修改源资产 `src/assets/flower_update_hook.py` 并通过内容投影分发，不直改已部署副本。
- 区分可执行文件缺失、不可执行、解释器错误及真正可运行。无效 cwd 或缺少解释器触发的 `FileNotFoundError` 不能直接当成未安装。self-check 超时、非零和非法 JSON 不自动触发安装。
- 缺失分支用 Python 标准库读取锁，要求对象、已知 schema、唯一 `flower/skill-garden` 条目、内置来源及严格完整 SemVer；不接受范围、标签、URL、命令片段或歧义记录。项目锁只证明声明版本，不证明内容已验证。
- 对有效版本生成固定包名命令 `npm install -g flower-trellis@<version>`；缺少 Node/npm 或有效版本时说明原因，不猜 latest。
- 新增脚本 `--bootstrap-only --target <target>` 只读模式供手动 skill 复用，不读 stdin、不联网、不运行完整 self-check；CLI 可用时无安装提示。

### 对话协议

- 输出独立 `<flower-cli-bootstrap>` 块，复用标准 SessionStart JSON。缺失 CLI 不伪装成可更新或已是最新。
- 上下文只包含状态、项目版本、安装命令及确认/验证指令；详细流程只有这一来源，手动入口引用其结果。
- 助手展示版本和命令，征得当前成员确认；当前对话已明确授权这次安装时不重复问。hook 本身不运行 npm。
- 全局安装会触发已有 postinstall 和全局 Trellis 同步，确认文案应说明本机命令环境变化。安装后用 `flower-trellis -v` 与只读 `self-check --json --target ...` 验证，再继续原请求；不隐式 update/init 项目。
- 拒绝、安装失败、PATH 未刷新或验证失败均如实说明，不自动提权、不循环安装，本次对话不重复追问；不增加持久化提醒状态机。

### 平台分发

- 自动入口沿用 Codex/Claude 现有 `startup` hook，不更改 Trellis state/rules/stages 注册及额度。
- 修改 vendor 两份 canonical `trellis-flower-update/SKILL.md`：缺 CLI 且脚本存在时运行 bootstrap-only，处理确认与安装后恢复人工检查；无脚本则说明项目尚未具备该检测入口。
- `npm run sync` 同步 enhancements；不直改根项目 skill，不为其他平台新增自动事件。其他平台可以通过手动升级入口触发，不能承诺自动首轮提醒。

## 验证与边界

- 用真实 Git 临时仓库验证根/局部忽略优先级、重复升级和克隆文件集合。
- 用事务失败注入覆盖目标、lock/state、回滚失败，特别验证 ensureLayout 前后的局部规则恢复。
- 迁移覆盖 legacy-only、现代与旧记录并存、损坏配置、仅增强及 dry-run；新旧 hook 分支、严格版本解析、环境异常和平台实际安装都有验证。
- 自动引导依赖维护者提交升级文件、宿主执行 hook 和 Python 可用。锁定版本不可从 npm 安装时报告失败，不选替代版本。
- 不继承其他成员的本机 state；克隆测试验证版本证据和安装引导，不伪造内容完整性。
