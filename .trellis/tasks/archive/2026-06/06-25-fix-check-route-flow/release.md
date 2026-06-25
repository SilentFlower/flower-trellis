# Release Operations

## Conclusion
Release operations exist.

## SQL Changes
None

## Configuration Changes
None

## Batch / Deployment Scripts / Data Repair
None

## External Systems / Dependent Platforms
- npm beta 已发布 `flower-trellis@0.3.1-beta.0`。
- `0.3.0-beta.4` 是错误发布版本，已由 `0.3.1-beta.0` 接替。

## Release Order
已完成：先推送 `v0.3.1-beta.0` tag，再由 GitHub Actions 发布到 npm beta。

## Rollback Notes
代码回滚或发布更高 beta 版本；如需处理错误版本，可在 npm 侧 deprecate `flower-trellis@0.3.0-beta.4`。

## Post-release Verification
确认 npm `beta` dist-tag 指向 `0.3.1-beta.0`，`latest` 仍指向 `0.3.0`。
