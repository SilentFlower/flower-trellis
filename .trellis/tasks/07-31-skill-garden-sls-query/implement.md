# 集成阿里云 SLS 查询 Skill 实施计划

## 1. Preparation

1. 读取本任务 `prd.md`、`design.md`、`research/source-audit.md` 和 curated JSONL 上下文。
2. 分别检查 Flower 主仓与 `vendor/skill-garden` 子仓的分支、HEAD 和 dirty worktree，不覆盖用户改动。
3. 重新读取个人 Skill 的三个允许资产，确认内容和审计记录一致；不得读取或复制用户私有 ENV 文件。

## 2. Skill Garden Source

1. 在 `.common/.codex/skills/aliyun-sls-query` 新增：
   - `SKILL.md`
   - `assets/env.example`
   - `scripts/sls_get_logs.py`
2. 在 `.common/.claude/skills/aliyun-sls-query` 写入相同文件树和字节内容。
3. 规范化权限：文档/模板 `0644`，Python 脚本 `0755`；确认没有 `__pycache__`、`.pyc` 或真实配置。
4. 更新 Skill Garden `README.md` 的通用 Skill 清单。
5. 源级验证：

```bash
diff -qr .common/.codex/skills/aliyun-sls-query .common/.claude/skills/aliyun-sls-query
python3 -c 'import ast, pathlib; ast.parse(pathlib.Path(".common/.codex/skills/aliyun-sls-query/scripts/sls_get_logs.py").read_text(encoding="utf-8"))'
PYTHONDONTWRITEBYTECODE=1 python3 .common/.codex/skills/aliyun-sls-query/scripts/sls_get_logs.py --help
bash -n scripts/install.sh
git diff --check
```

6. 使用临时 git fixture 或源提交后的仓库，分别对 `.codex`、`.claude` 和双平台临时目标运行 `install.sh --scope common ... aliyun-sls-query`，确认只安装指定 Skill。

## 3. Skill Garden Commit Boundary

1. 展示 Skill Garden 精确 diff、测试结果和待提交文件范围。
2. 经用户确认后先提交 Skill Garden 子仓。
3. 记录新的子仓 commit，回到 Flower 主仓确认 submodule pin 变化。

该步骤是生成最终可追溯快照的前置条件；不得以 dirty submodule 直接完成 snapshot gate。

## 4. Flower Snapshot

1. 在 Flower 主仓运行 `npm run sync`，从新的 Skill Garden HEAD 重建 `enhancements/`。
2. 审查只出现预期变更：
   - 两个平台的 `aliyun-sls-query` 快照资产。
   - `MANIFEST.json` 的 common 清单、`sourceCommit` 和同步时间。
   - 与本任务无关的 Trellis variant 资产不应漂移。
3. 更新 Flower `README.md` 的可选通用 Skill 清单或说明，保持“可选而非默认安装”的表达。

## 5. Flower Tests

1. 新增 `test/js/common-skill-catalog.test.js`：
   - manifest 与 catalog 在 Codex/Claude 两端发现 `aliyun-sls-query`。
   - 菜单 description 为中文且可读。
   - Codex-only 目标只写 `.codex/skills/aliyun-sls-query`。
   - Claude-only 目标只写 `.claude/skills/aliyun-sls-query`。
   - 双平台目标写入两端且内容一致。
   - 停用只删除精确 Skill 目录，不影响相邻用户 Skill。
   - 已安装旧副本可被同步刷新；未安装目标保持未安装。
   - 安装产物不含 `__pycache__`、`.pyc` 或非空凭证。
2. 如现有公共函数不能满足上述既有契约，只在 `src/lib/skill-catalog.js` 或对应公共路径做最小通用修复，并补中文 JSDoc；不得硬编码单 Skill 安装流程。

## 6. Validation

### Flower

```bash
node --test test/js/common-skill-catalog.test.js
npm test
npm run sync
git diff --check
```

额外检查：

- `enhancements/MANIFEST.json` 两个平台清单都包含 `aliyun-sls-query`。
- Flower 快照的 Codex/Claude Skill 目录递归一致。
- 临时目标中的 `flower-trellis skill` catalog 能显示中文简介和正确已安装状态；交互测试不得使用真实凭证。
- Skill Garden 源和 Flower 快照中不存在 AK/SK 格式值、私有 ENV 文件或缓存文件。

### Cross-Repo Post-Commit Gate

Skill Garden 源提交、Flower submodule pin 与快照提交完成后运行：

```bash
git -C vendor/skill-garden status --short
node scripts/check-snapshot.mjs
git -C vendor/skill-garden diff --check
git diff --check
```

`check-snapshot` 会拒绝 dirty Skill Garden 或未提交的 `enhancements/`，因此它属于两仓提交后的最终门禁，不能替代提交前的 `npm test`、快照 diff 审查和普通一致性检查。

## 7. Documentation And Specs

1. Skill Garden README 增加双平台 `aliyun-sls-query` 条目。
2. Flower README 增加可选 Skill 条目和入口说明，不重复整篇 SLS 使用文档。
3. 若实现确认了新的通用 Skill 资产约束或双副本一致性规则，更新 `.trellis/spec/flower-trellis/cli/enhancements-model.md` 或对应 ownership spec。

## 8. Risk Files

- `vendor/skill-garden/.common/**/aliyun-sls-query/**`：双副本、权限和凭证边界必须一致。
- `vendor/skill-garden/README.md`：Skill Garden 公开目录清单。
- `vendor/skill-garden` submodule pin：决定 Flower 快照的可追溯来源。
- `scripts/sync-enhancements.mjs` / `enhancements/MANIFEST.json`：生成链和 tombstone 不能漂移；原则上不改同步脚本。
- `src/lib/skill-catalog.js`：所有 common skill 共用路径，只有现有通用契约确有缺口时才修改。
- `test/js/common-skill-catalog.test.js`：承担本任务主要运行时回归覆盖。

## 9. Release Boundary

- 本任务完成源码与快照集成，不自动执行 `npm run release`、打 tag、push 或发布 npm。
- 后续发版必须遵守 Flower release SOP，先展示 dry-run CHANGELOG，再取得用户确认。
