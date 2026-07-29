# Marketplace Entry

entry 必须包含本地 Plugin ID、描述、source、`trust.maxProfile` 和版本列表。GitLab source 使用 project/subdir，GitHub source 使用公开 `owner/repository` 和可选 subdir；每个版本固定严格 SemVer、不可变 tag 或完整 commit、40 位 commit 和 `sha256:<64 hex>` digest。

推荐生成草稿：

```bash
flower-trellis plugin init --id rd-guide/example --name "示例规范" --marketplace --project group/example --commit <40-sha> --non-interactive
```

更新 Plugin 内容后 digest 会变化，必须重新生成或更新 entry。entry 的版本、manifest 版本、ID 和 digest 必须一致；`maxProfile` 不能是 system。GitHub 外部来源首版只授予 standard，即使 Marketplace 声明更高上限也不能提升信任。
