# Release Operations

## Conclusion

Release operations exist.

[flower-team-bootstrap] 后续发布包含本任务的 Flower 版本后，项目维护者需要升级目标项目并提交共享记录与 hook，团队成员才能获得安装引导。本次仅记录后续操作，未执行 npm 发版、目标项目升级或成员全局安装。

## Evidence Checked

- `task.json`、`prd.md`、`design.md`、`implement.md`、`implement.jsonl`、`check.jsonl`、`check-report.md`。
- 主仓业务提交 `e86217c` 的文件清单、README 与元数据迁移实现；Skill-Garden 源提交 `fdfb5f1`。
- 任务记录提交 `cc789c0`；当前任务已完成、目录 clean，开始归档时本地与 `origin/main` 同步。
- 现有工作区存在其他窗口的修改，仅以本任务已提交内容核对上线范围。

## Drift Check

Missing release.md.

阶段报告中的“尚未提交”描述属于当时进度；最终完成状态以 `task.json` 和上述 Git 提交为准。首次补充项目升级、共享、成员安装及回滚事项。

## SQL Changes

None。本任务不涉及数据库迁移。

## Configuration Changes

- [flower-team-bootstrap] 目标项目增强升级会幂等更新已有根 `.gitignore` 和 `.flower/.gitignore`，开放 `.flower/plugins.json`、`.flower/plugin-lock.json` 与局部忽略文件。维护者审阅并提交共享文件及受管 hook/skill 更新；个人 settings、state、缓存和事务证据继续留在本机。
- [flower-team-bootstrap] 旧 `.trellis/.flower-manifest.json` 的必要策略与缓存由升级事务迁入现代位置后删除，现代有效配置优先。损坏配置需先按诊断处理；显式 `--no-enhance` 不执行这次迁移。

## Batch / Deployment Scripts / Data Repair

- [flower-team-bootstrap] 项目维护者使用包含本变更的 Flower CLI 执行正常增强升级，配置迁移随既有事务完成；没有额外的一次性数据修复脚本。

## External Systems / Dependent Platforms

- [flower-team-bootstrap] 自动引导依赖目标项目已有 Python、Codex/Claude 启用 SessionStart hooks；其他平台使用手动升级 skill 的 bootstrap-only 入口。
- [flower-team-bootstrap] 成员安装依赖可用的 Node/npm、包源访问和项目锁定版本已发布。助手取得该成员确认后才运行锁定版本的全局安装；全局 postinstall 会同步该成员本机 Trellis 命令。

## Release Order

1. [flower-team-bootstrap] 发布维护者按项目发版 SOP 发布包含本任务的 Flower 版本；本任务未指定新版本号，也未执行发布。
2. [flower-team-bootstrap] 项目维护者升级目标项目，核对迁移结果，再提交共享声明、锁、忽略规则及相关 hook/skill 文件。
3. [flower-team-bootstrap] 新成员克隆已更新项目，在对话中确认安装项目锁定版本；验证 CLI 后继续原请求，不隐式初始化或升级项目内容。

## Rollback Notes

- [flower-team-bootstrap] 升级事务失败时恢复受影响文件的原始字节；补偿失败时保留事务证据，按错误提示处理，不能当作成功。
- [flower-team-bootstrap] 如需撤回已经成功的项目升级，维护者需核对升级前版本和可用备份，恢复受影响的受管内容、忽略规则及本机配置/状态；只回退源码不能证明配置迁移已撤回。
- [flower-team-bootstrap] 成员的全局 CLI 安装属于本机操作，项目文件回滚不替代该成员的环境恢复。

## Post-release Verification

- [flower-team-bootstrap] 在隔离目标验证重复升级无重复规则、旧配置保留且 manifest 删除，Git 可发现共享三文件而本机数据仍被忽略。
- [flower-team-bootstrap] 从已提交升级文件的项目克隆，在无 Flower CLI/state 的环境验证锁定版本引导、成员确认和安装后版本/self-check；无效锁应输出诊断，不生成安装命令。
- [flower-team-bootstrap] 维护者或使用相应平台的成员补充 Windows 原生环境及真实全局安装验证。本次 WSL 验证跳过 Windows 原生专项，安装测试使用隔离环境；已有回归证据见 `check-report.md`。
