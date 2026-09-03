# Release Operations

## Conclusion

Release operations exist.

## Evidence Checked

- `task.json`
- `prd.md`
- `design.md`
- `implement.md`
- `implement.jsonl`
- `check.jsonl`
- Git commits `6199ab8` and `b7a39db`

## Drift Check

原任务缺少 `release.md`；任务材料明确要求记录 CLI 退出码兼容性变化。

## SQL Changes

None

## Configuration Changes

None

## Batch / Deployment Scripts / Data Repair

None

## External Systems / Dependent Platforms

- 发布 Flower/Trellis 时，在 release notes 中明确：`task.py current` 在没有活动任务时的退出码
  从 `1` 改为 `0`；外部脚本应读取文本或 JSON 状态，而不是用非零退出码判断“没有任务”。

## Release Order

1. 先更新 release notes，说明上述兼容性变化。
2. 再发布包含 Skill-Garden `6199ab8` 与 Flower `b7a39db` 的版本。

## Rollback Notes

按 canonical Skill-Garden 变更回滚，重新运行 `npm run sync` 生成快照，再回滚 Flower 主仓变更；
不能只回滚派生副本。

## Post-release Verification

- 在无活动任务的安装目标中验证 `task.py current` 返回 `0`，且 `--json` 输出
  `current_task: null`。
- 验证 Flower 一级命令帮助仍在联网、写盘、prompt 和子进程之前返回 `0`。
