# 集成阿里云 SLS 查询 Skill 技术设计

## 1. Scope

本任务跨两个版本边界：

- `vendor/skill-garden`：新增 `aliyun-sls-query` common skill 的 Codex/Claude 源资产和 README 目录说明。
- `flower-trellis`：更新 submodule pin，通过现有同步脚本生成随 npm 发布的 common 快照，并补充 catalog/安装/更新测试和 README 清单。

不新增 Flower 安装协议、非交互 common skill 子命令、SLS 服务端、凭证管理或第三方 Python 依赖。

## 2. Ownership And Source Of Truth

集成完成后的来源链固定为：

```text
Skill Garden .common source
        |
        | npm run sync
        v
Flower enhancements/common snapshot
        |
        | npm package / Skill Garden manager
        v
Target project .codex/skills or .claude/skills
```

- `/root/.codex/skills/aliyun-sls-query` 仅作为本次迁移输入，不进入运行时依赖，也不作为后续自动同步源。
- Skill Garden 的 Codex 与 Claude 目录均纳入版本控制；本 Skill 没有平台特有资产，因此两个目录必须递归一致。
- Flower 的 `enhancements/common` 是生成快照，必须由 `scripts/sync-enhancements.mjs` 重建，禁止手工复制或修改。
- `enhancements/MANIFEST.json.sourceCommit` 必须等于已提交的 Skill Garden HEAD，不能从 dirty submodule 生成最终发布状态。

## 3. Skill Garden Layout

新增以下两棵相同文件树：

```text
.common/.codex/skills/aliyun-sls-query/
├── SKILL.md
├── assets/env.example
└── scripts/sls_get_logs.py

.common/.claude/skills/aliyun-sls-query/
├── SKILL.md
├── assets/env.example
└── scripts/sls_get_logs.py
```

文件规则：

- `SKILL.md` 与 `assets/env.example` 使用 `0644`。
- `scripts/sls_get_logs.py` 保留 shebang 并使用 `0755`。
- 不复制 `__pycache__`、`.pyc`、私有 ENV 文件或其它个人目录内容。
- 两个平台使用相同 frontmatter `name: aliyun-sls-query` 和相同中文 description，使 Flower 无需描述 override 即可生成菜单简介。
- Skill 正文保留现有 SLS 签名、日志库、metricstore 经验和故障排查内容；本任务只修正分发所需的路径/权限问题，不扩展功能。

Skill Garden README 的“当前技能 / 通用”表增加 `aliyun-sls-query`，平台标记为 `codex / claude`，说明其使用 AK/SK 直连 SLS 查询日志与指标。

## 4. Flower Integration

### 4.1 Snapshot

Skill Garden 源提交并更新 submodule pin 后运行：

```bash
npm run sync
```

预期生成：

- `enhancements/common/.common/.codex/skills/aliyun-sls-query/**`
- `enhancements/common/.common/.claude/skills/aliyun-sls-query/**`
- `enhancements/MANIFEST.json.common.codexSkills` 包含 `aliyun-sls-query`
- `enhancements/MANIFEST.json.common.claudeSkills` 包含 `aliyun-sls-query`
- `sourceCommit` 指向新的 Skill Garden 提交

### 4.2 Selection And Lifecycle

不修改 `src/lib/skill-catalog.js` 的公开契约：

- `listSkillCatalog()` 从两端快照目录自动发现 `aliyun-sls-query`，并通过 `SKILL.md` frontmatter 生成中文菜单说明。
- Plugin 管理器的 `flower/skill-garden` 入口和 `flower-trellis skill` 继续复用同一交互选择器。
- `installCommonSkills()` 根据目标项目已有 `.codex` / `.claude` 平台目录复制对应资产；两个平台都存在时同时铺设。
- `removeCommonSkills()` 只删除固定 common root 下名称完全匹配的 Skill 目录。
- `describeInstalledCommonSkillSync()` 和 Plugin Runtime 只刷新已经安装的目录；新快照出现时不会给未选择的项目自动安装。

若实现时现有 catalog 无法正确显示或安装该 Skill，才允许在上述公共边界内做最小修复；不得为单个 Skill 添加专用安装分支。

## 5. Credential And Privacy Boundary

- 发布资产只包含空值 `env.example`，不包含真实凭证或业务项目名。
- 安装器只复制 Skill 目录，不读取 `~/.config/aliyun-sls-query/env`，也不创建该文件。
- Skill 文档继续要求用户自行创建权限为 `600` 的私有 ENV 文件。
- 测试不得调用真实 SLS，不读取维护者环境中的 AK/SK；脚本验证使用 `--help`、纯函数或缺少凭证的 fail-fast 路径。
- 测试输出不得打印环境变量内容。

## 6. Validation Design

### Skill Garden Source

- 递归比较 Codex 与 Claude 两棵 Skill 目录，确保字节内容一致。
- 检查只存在三项允许资产，没有缓存或凭证文件。
- 使用 AST 解析做无落盘 Python 语法检查，并以 `PYTHONDONTWRITEBYTECODE=1` 运行 `sls_get_logs.py --help`。
- 用临时 git fixture 或已提交 Skill Garden HEAD 执行 `scripts/install.sh --scope common ... aliyun-sls-query`，分别验证 Codex-only、Claude-only 和双平台目标。

### Flower Snapshot And Runtime

- 新增 `test/js/common-skill-catalog.test.js`，覆盖 catalog 发现、中文描述、Codex/Claude/双平台安装、精确停用和已安装刷新。
- 测试未安装目标在刷新路径中保持未安装。
- 断言快照两端资产一致，且 `MANIFEST.json` 两个平台都列出名称。
- 运行 `npm test`、`npm run sync` 后的 diff 审查和两仓 `git diff --check`。
- Skill Garden 源、submodule pin 和快照提交完成后，运行 `node scripts/check-snapshot.mjs` 做最终可追溯性门禁。

## 7. Commit And Release Ordering

该任务不能把两个仓库作为一个原子提交，顺序固定为：

1. 在 Skill Garden 子仓完成源资产、README 和源级验证。
2. 经用户确认后先提交 Skill Garden，使新资产获得稳定 commit。
3. 回到 Flower 更新 submodule pin，运行 `npm run sync`，审核生成快照并完成普通测试。
4. 经用户确认后提交 Flower 的 pin、快照、测试和文档改动。
5. 两仓提交完成后运行 `node scripts/check-snapshot.mjs`，验证 Skill Garden HEAD、`sourceCommit` 和已提交快照一致。
6. 后续 Flower npm 发版按现有 release SOP 单独执行，本任务不自动发布。

在第 2 步前可以用 dirty source 做开发期快照和测试，但该状态不能作为最终检查通过或发布依据。

## 8. Rollback

- 尚未发布时：撤销 Skill Garden 新目录和 README 变更，恢复旧 submodule pin，再重新同步 Flower 快照。
- 已发布后如需移除：必须在 Skill Garden 删除两端 Skill、提交并同步 Flower；`removedSkills` tombstone 会使后续更新清理已安装副本，因此属于用户可见行为，需要单独变更评审。
- 回滚和测试都不得删除用户私有 `~/.config/aliyun-sls-query/env`。
