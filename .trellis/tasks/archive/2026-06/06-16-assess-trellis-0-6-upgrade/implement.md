# 升级 flower-trellis 到 Trellis 0.6.0 - 实施计划

## Implementation Checklist

- [x] 读取相关 spec 与本地实现入口。
- [x] 升级 npm 依赖到 `@mindfoldhq/trellis@0.6.0`。
- [x] 调整 Codex 后处理为 hook 合并逻辑。
- [x] 跑 Trellis 0.6.0 本地 update，并手动合并冲突文件。
- [x] 重新叠加 flower 增强，确认 `.trellis/config.yaml` 与 `.codex/hooks.json` 不丢本仓定制。
- [x] 运行质量检查。
- [x] 回答 `last_push_snapshot` dirty 保护的设计原因。

## Validation

- `node bin/flower-trellis.js -v`
- `node bin/flower-trellis.js update --dry-run --no-update-check` 或等价检查
- `npm run sync` / `node scripts/check-snapshot.mjs`（按可用性执行）
- `git diff` 人工检查关键文件

## Review Gates

- 开始实现前：确认 PRD/design/implement 已覆盖升级范围。
- 完成后：报告新增/修改文件、保留的本仓定制、未执行或失败的检查。
