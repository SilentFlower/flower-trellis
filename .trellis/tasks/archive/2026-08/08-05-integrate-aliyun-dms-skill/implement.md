# 实施计划：集成阿里云 DMS Skill

## Steps

1. 在 `vendor/skill-garden/.common/.claude/skills/aliyun-dms-query/` 创建会话产物的三项核心资产，
   将 `SKILL.md` 的脚本调用改为相对路径，并保持 `scripts/dms.py` 为可执行文件。
2. 将同一核心资产同步到 `.common/.codex/skills/aliyun-dms-query/`，逐文件校验一致性。
3. 更新 `vendor/skill-garden/README.md` 的通用 Skill 表格，说明只读查询与 DML 审批工单能力。
4. 在父仓新增 DMS 聚焦测试，覆盖源/快照一致性、权限、凭证空模板、本地安全分支、catalog 发现与双平台安装。
5. 更新父仓 `README.md` 的可选通用 Skill 说明。
6. 运行 `quick_validate.py`、Python 语法检查和不联网 CLI 测试，确认 Skill 本体可用且无真实副作用。
7. 运行 `npm run sync` 生成 `enhancements/common` 快照和 manifest，再运行聚焦测试与 `npm test`。
8. 检查父仓和子仓 diff、文件模式及敏感信息，确认无 ENV 私有文件、AK/SK、缓存和字节码。
9. 提交时先提交 `vendor/skill-garden`，随后重新运行 `npm run sync` 更新 `sourceCommit`，
   再提交父仓 submodule pin、快照、README、测试和任务记录。

## Validation Commands

```bash
python3 /root/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  vendor/skill-garden/.common/.claude/skills/aliyun-dms-query
python3 /root/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  vendor/skill-garden/.common/.codex/skills/aliyun-dms-query
PYTHONPYCACHEPREFIX=/tmp/aliyun-dms-query-pycache \
  python3 -m py_compile vendor/skill-garden/.common/.codex/skills/aliyun-dms-query/scripts/dms.py
node --test test/js/aliyun-dms-skill.test.js
npm test
git -C vendor/skill-garden diff --check
git diff --check
```

## Risks And Controls

- 风险：误运行 `order --yes` 创建真实工单。控制：自动测试和手测命令一律不带 `--yes`，并使用假凭证与显式 Tid 走本地分支。
- 风险：Codex 文档残留 Claude 路径。控制：两平台核心文件逐字节比较，并断言不存在 `~/.claude`。
- 风险：先同步后提交子仓导致 manifest `sourceCommit` 过期。控制：父仓最终提交前先提交子仓并重跑 `npm run sync`。
- 风险：凭证或本机配置进入快照。控制：只分发空 `env.example`，测试扫描 AK 模式、私有 ENV、缓存和字节码。
