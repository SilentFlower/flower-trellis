# CI And Review

rd-guide CI 对完整 Marketplace 运行：

```bash
flower-trellis plugin validate .flower-marketplace/marketplace.json --subject marketplace --checkout-map .flower-marketplace/checkouts.json --ci --json
```

checkout map 的 key 使用 `<source>/<plugin>@<version>`，value 使用
`{"path":"checkouts/...","commit":"<40-sha>"}`，同时绑定 CI 工作区路径和实际固定 commit。
CI 必须拒绝可变 ref、占位或不匹配 commit、摘要或版本不一致、依赖不闭合、兼容范围无效和 capability 越权。

`review.required=true` 时，CI 必须运行随模板分发的 `verify-integration-review.mjs`。该脚本要求 `.flower-marketplace/integration-review.json` 使用以下结构并绑定本次 Marketplace digest：

```json
{
  "schemaVersion": 1,
  "profile": "integration",
  "marketplaceDigest": "sha256:<64-hex>"
}
```

该 companion 文件由 CODEOWNERS 保护；Marketplace digest 改变后必须同步修改它，GitLab protected approval rule 才能强制 integration owner 审核。普通作者不能通过只修改 entry 自行取得 system 或扩大 Runtime hard limit。
