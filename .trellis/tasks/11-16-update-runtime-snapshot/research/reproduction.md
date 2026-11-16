# 复现与范围

## 输入通知

其它窗口通知：vibecoding-bench 在 `self-update --yes --project-only` 从 beta.14 升 beta.15 时，因 `.trellis/.runtime/criu-image-sharing-research/criu-4.2/CLAUDE.md` 的同目录软链失败。该窗口报告原有 397 个改动文件哈希一致。本会话只将此信息作为通知证据。

## 本会话独立复现

使用系统临时目录创建 `.trellis/.runtime/research/criu/GEMINI.md` 与指向它的 `CLAUDE.md`，调用真实的 `shouldExcludeFromBackup` 和 Flower `createUpdateSnapshot`。输出：

```json
{"runtimeExcluded":false}
{"snapshot":"failed","reason":"Update 受管范围包含软链:.trellis/.runtime/research/criu/CLAUDE.md"}
```

实验清理自身临时目录。实际业务项目保持研究范围。

## 现有精确补偿契约

`extendUpdateSnapshot` 的 forcedScopes 允许覆盖默认排除的 spec 目标，现有测试断言旧内容、mode 和新建子树清理。运行时边界应沿用这种精确写入语义，并保留仅用于到达目标的既有父目录；回归需要覆盖默认排除与显式目标交叠。
