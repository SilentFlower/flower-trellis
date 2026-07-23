# Trellis 升级备份保留设计

## 1. 设计目标

在 Flower 完整升级成功后清理上游 Trellis 创建的旧时间戳快照，把磁盘占用限制为默认最近 3 份，
同时保持升级失败、本轮回滚、`.backup-flower` 首次基线和项目外路径安全不变。

## 2. 所有权边界

- 上游 `@mindfoldhq/trellis` 继续负责在写入前创建 `.trellis/.backup-<timestamp>/` 完整快照。
- Flower 新增 `src/lib/update-backups.js`，只负责发现、规划和清理合法时间戳快照。
- `src/commands/update.js` 负责调用时机：上游 update、enhancements 和配置恢复流程全部结束后才清理。
- Patch Engine 的 `src/lib/backup.js` 及 `.trellis/.backup-flower/` 不改动。
- `.flower-manifest.json` 不承担磁盘保留策略，避免把单次 CLI 参数变成持久安装状态。

## 3. CLI 契约

新增 Flower 自有参数：

```text
--backup-retention <n>
```

- 默认值：`3`。
- `n > 0`：成功更新后最多保留 `n` 份；本轮新备份受保护，极端时间回拨时允许暂时超过 `n`。
- `n = 0`：关闭本次清理。
- 缺失、负数、小数和非数字：在联网检查、上游 update 和任何删除前抛出中文参数错误。
- 参数原始值写入 `ctx.backupRetention`，在 `update()` 入口完成归一化与校验，加入 `OWN_FLAGS`，
  绝不进入 `ctx.passthrough`。这样参数错误仍由现有 `main()` 的命令错误捕获逻辑统一输出。
- `self-update -- --backup-retention <n>` 沿现有 `forwarded` 链路进入项目 update，并由新的 Flower
  进程消费，不传给 Trellis。

不新增持久配置项；这是为了保持 KISS，并避免 `.flower-manifest.json` 同时承担安装状态和运行策略。

## 4. 备份识别与安全

合法名称严格匹配：

```text
^.backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$
```

发现流程：

1. 解析目标项目和 `.trellis/` 的真实路径，确认 `.trellis/` 仍位于项目真实根目录内。
2. 使用 `readdirSync(..., {withFileTypes:true})` 读取直接子项，不递归扫描。
3. 仅接受名称匹配且 `Dirent.isDirectory()` 为真的子项；软链接、文件和相似名称跳过。
4. 删除前再次 `lstat`、`realpath` 并确认候选仍位于 `.trellis/` 真实路径内。
5. 所有路径判断使用 `path.relative`，不使用未经边界校验的字符串前缀判断。

`.backup-flower` 不匹配合法名称，因此在结构上天然排除；测试仍需显式断言。

## 5. 数据流

```text
解析参数原始值
  -> update 入口校验并归一化 retention
  -> 更新前记录合法备份名称集合
  -> trellis update
  -> applyEnhancements（除非关闭或 dry-run）
  -> finally 恢复 config.yaml 本地块
  -> 主流程无异常时重新发现备份
  -> 计算本轮新增集合并设为 protected
  -> 生成保留/删除计划
  -> 非 dry-run 执行逐目录删除
  -> 打印汇总
```

`update.js` 中清理调用位于 `try/finally` 之后。JavaScript 异常传播保证上游 update、enhancements
或未来抛出的配置恢复异常都会跳过清理。当前 `restoreConfigPreserveSnapshot()` 是尽力而为并吞掉
文件 I/O 错误，本任务不扩展其错误协议；这里的成功边界是“既有配置恢复流程已经执行完毕且主流程未抛错”。

## 6. 保留算法

输入为当前合法备份、保留数量和本轮新增保护集合：

1. 按名称降序排列。固定宽度 ISO 风格名称可直接按字典序得到时间顺序。
2. 先把所有保护项加入保留集合。
3. 再从新到旧补足保留集合，直到达到 `retention`。
4. 其余候选从旧到新删除，便于日志按实际淘汰顺序展示。
5. 单项删除失败记录 warning 并继续，不抛出到主更新流程。

当保护项数量大于 retention 时全部保护，允许本轮暂时超出数量；下次成功更新会重新收敛。

## 7. Dry Run 与输出

- 上游 `trellis update --dry-run` 完成后，Flower 只生成当前备份的清理计划，不删除。
- 输出至少包含 retention、预计保留数量、预计删除数量和待删除相对路径。
- 真实清理无候选时保持简洁；发生删除或警告时打印汇总。
- `--enhance-only` 与 `retention=0` 不扫描、不清理。

## 8. 兼容与回滚

- 默认行为从“无限累计”变为“成功更新后保留 3 份”，属于预期行为变化，必须写入 README 和发布说明。
- 升级失败保留全部旧备份和本轮上游备份，用户仍可按原方式手动恢复。
- 代码回滚只需移除 update 编排调用、CLI 参数和 helper；现有备份目录无需迁移。
- 不修改上游依赖版本，也不修改 vendor/enhancements 快照。

## 9. 测试策略

- `update-backups` 单元测试覆盖排序、默认 3、覆盖数量、0、保护项、非法名称、文件、软链接、
  `.backup-flower`、项目外软链、删除失败继续和 dry-run 零写入。
- CLI 参数测试覆盖默认值、显式值、缺失值、负数、小数、非数字、`OWN_FLAGS` 和 passthrough 隔离，
  并证明非法值在 `checkForUpdate()` 和上游 Trellis 调用前失败。
- update 编排契约测试确认清理调用位于配置恢复 `finally` 之后，失败路径不会进入清理。
- self-update 参数构造测试确认 `--` 后参数原样进入 Flower 项目更新命令。
- 运行完整 `npm test`，确认现有 Patch Engine 首次备份行为不回归。

## 10. 主要风险

| 风险 | 控制措施 |
|---|---|
| 名称相似目录被误删 | 严格正则、直接子目录、Dirent/lstat/realpath 多重校验 |
| `.trellis` 或候选通过软链逃逸 | 真实路径必须位于项目根和 `.trellis` 根内，否则只警告不删除 |
| 更新失败后失去回滚点 | 清理位于完整成功路径，异常直接跳过 |
| 系统时间回拨误删本轮备份 | 更新前后集合差值形成 protected 集合 |
| 某个目录权限异常使升级失败 | 单项失败记录警告并继续，更新保持成功 |
| 默认删除让用户无法长期留档 | `--backup-retention 0` 可关闭本次清理 |
