# Plugin Manifest

把 `.flower-plugin/` 作为可发布包根，`plugin.json` 必须位于该目录顶层。使用 canonical ID `<source>/<plugin>` 调用 CLI，但 manifest `id` 只写本地 `<plugin>`。

先运行：

```bash
flower-trellis plugin init --id rd-guide/example --name "示例规范" --version 1.0.0 --profile standard --non-interactive
flower-trellis plugin validate .flower-plugin --subject plugin --json
```

manifest 的 schema、SemVer、兼容范围、安全路径和 canonical tree digest 由 CLI 真源校验。依赖键写完整 canonical ID；发布前必须让依赖闭包在同一 Marketplace 或 checkout map 中可解析。

`content.skills/specs/assets/scripts/tests` 都是被动文件投影。不要声明 lifecycle hook、JavaScript adapter、绝对路径、软链或特殊文件。
