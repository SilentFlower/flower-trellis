# 保护 config.yaml 本地配置 - Implement Plan

## Checklist

- [x] 新增 `src/lib/config-preserver.js`：
  - [x] 导出 `captureConfigPreserveSnapshot(target)`，读取 `.trellis/config.yaml` 并捕获白名单顶层块。
  - [x] 导出 `restoreConfigPreserveSnapshot(target, snapshot)`，把快照块替换或追加回更新后的配置文件。
  - [x] 所有导出函数写中文 JSDoc。
- [x] 修改 `src/commands/update.js`：
  - [x] 在上游 `trellis update` 前捕获快照。
  - [x] 上游 `trellis update` 失败时保持现有中止行为，不恢复。
  - [x] `applyEnhancements()` 后恢复快照并打印简短结果。
- [x] 验证幂等：
  - [x] 更新后已有 `packages` / `default_package` 时替换，不重复追加。
  - [x] 更新后缺失字段时追加。
  - [x] 更新前无字段时不新增。
- [x] 如实现过程中发现需要沉淀项目规范，再使用 `trellis-update-spec`。

## Validation

语法校验：

```bash
node --check src/commands/update.js
node --check src/lib/config-preserver.js
```

手工单元式验证（用临时目录和 Node 脚本调用导出函数）：

```bash
node --input-type=module <临时验证脚本>
```

全量语法校验：

```bash
node --check src/cli.js && for f in src/lib/*.js src/commands/*.js; do node --check "$f"; done
```

可选 dogfood：

```bash
flower-trellis update --target ./test-target -y --dry-run
```

## Risky Files

- `src/commands/update.js`：更新主流程，必须保持上游失败即中止。
- `src/lib/config-preserver.js`：新增写盘逻辑，必须幂等且只处理白名单 key。
- `.trellis/config.yaml`：本仓 dogfood 配置可能被本地测试影响，验证时优先使用临时目标目录。
