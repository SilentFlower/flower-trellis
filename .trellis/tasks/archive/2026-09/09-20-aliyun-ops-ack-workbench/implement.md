# 实施计划：ACK Workbench 只读运维

## 实现步骤

- [x] 在 Skill-Garden Codex 作者源吸收并修正现有 ACK ROA V3、直连查询与安全输出实现。
- [x] 为 `aliyun_common.py` 增加 ACK 产品级 ENV，更新 `SKILL.md`、`agents/openai.yaml` 和 `references/ack.md`。
- [x] 在 `ack.py` 增加节点查询、短期 KubeConfig 校验、Workbench 上传/执行/清理编排和只读资源输出。
- [x] 将 Codex 作者源完整同步到 Claude 作者源，确保文件集合、内容和权限一致。
- [x] 扩展 Python 单元测试，覆盖签名、节点筛选、KubeConfig、直连、Workbench 成功/失败清理和 Secret 脱敏。
- [x] 更新 JS 的预期文件树、Skill 文案与 catalog 断言；更新 `src/lib/skill-catalog.js`、Flower README 和 Skill-Garden README。
- [x] 运行 `npm run sync` 生成 Flower 快照，核对本任务文件与作者源逐字节一致。
- [x] 运行定向测试、Skill 校验和 Python 语法检查；在当前授权环境执行只读 ACK/Workbench 冒烟。
- [x] 将验证通过的两份作者源同步到全局 Codex/Claude Skill，清除复制产生或遗留的 Python 缓存，再核对文件树。

## 验证命令

```bash
PYTHONDONTWRITEBYTECODE=1 python3 test/python/test_aliyun_ops.py
FLOWER_NO_TELEMETRY=1 node --test test/js/aliyun-ops-skill.test.js
python3 /root/.codex/skills/.system/skill-creator/scripts/quick_validate.py vendor/skill-garden/.common/.codex/skills/aliyun-ops
python3 /root/.codex/skills/.system/skill-creator/scripts/quick_validate.py vendor/skill-garden/.common/.claude/skills/aliyun-ops
python3 -m py_compile vendor/skill-garden/.common/.codex/skills/aliyun-ops/scripts/*.py
git -C vendor/skill-garden diff --check
git diff --check
```

在线冒烟只执行 `clusters`、`nodes` 和 Workbench `get configmaps --format summary`，不读取 ConfigMap 数据正文。

## 风险与回滚点

- `npm run sync` 会全量重建 `enhancements/` 并刷新时间戳；运行前后都要核对已存在的 Auto-Loop 快照改动未被覆盖或丢失。
- `vendor/skill-garden` 已有 `.trellis/0.6/scripts/auto_loop.py` 未提交修改；所有作者源编辑限定在 `.common` 与 README。
- 全局 Claude 现有 ACK 文件属于未回源改动；以最终作者源替换前先通过 diff 确认功能已完整吸收。
- 远端 KubeConfig 清理是安全门禁；在线冒烟结束后再次以 Workbench 检查精确临时路径不存在。
