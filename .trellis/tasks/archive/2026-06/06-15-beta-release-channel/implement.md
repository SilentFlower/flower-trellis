# Beta 发布通道与升级检测实施计划

## Implementation Checklist

- [x] 确认 MVP 范围：采用“自动通道检测 + 独立 beta workflow”，暂不新增 `--channel`。
- [x] 更新 `src/lib/update-check.js`：
  - [x] 读取 npm package metadata 的 `dist-tags.latest` / `dist-tags.beta`
  - [x] 判断当前版本是否为 beta/prerelease
  - [x] 实现 prerelease 版本比较
  - [x] 生成升级推荐：稳定用户看 latest，beta 用户优先看 latest 高于当前，其次看 beta 高于当前
  - [x] 升级命令按推荐通道使用 `@latest` 或 `@beta`
- [x] 更新 README：
  - [x] 增加 `npm i -g flower-trellis@beta`
  - [x] 说明 beta 用户在 latest 高于当前 beta 时会提示回到 latest
  - [x] 说明 beta tag / workflow 发布方式
- [x] 更新 release spec / 文档，记录 beta dist-tag 维护规则。
- [x] 新增 `.github/workflows/release-beta.yml`：
  - [x] 触发 `v*-beta.*`
  - [x] 使用 `npm publish --tag beta`
  - [x] 使用 OIDC Trusted Publishing，不使用长期 token
  - [x] 创建 GitHub prerelease
- [x] 更新稳定版 `.github/workflows/release.yml` 或 tag pattern，避免 beta tag 进入 `latest` 发布流程。
- [x] 不新增自有 flag；无需更新 `OWN_FLAGS`。
- [x] 运行语法校验。
- [x] 设计手测矩阵或用函数级临时调用覆盖：
  - [x] stable current < latest
  - [x] stable current >= latest
  - [x] beta current < beta 且 latest 不高于 current
  - [x] beta current < latest
  - [x] registry 失败 / 无 beta tag

## Validation

- `node --check src/cli.js`
- `for f in src/lib/*.js src/commands/*.js; do node --check "$f"; done`
- 如修改文档，检查 README 相关命令示例一致。

## Review Gates

- 用户确认完整规划后才能 `task.py start` 进入实现。
- 新增 workflow 前必须确认稳定 workflow 不会响应同一个 beta tag。

## Rollback Points

- `src/lib/update-check.js` 可回退到只读 `/latest` 的旧逻辑。
- README / release 文档改动可独立回滚。
- `.github/workflows/release-beta.yml` 可独立删除回滚；稳定 workflow tag pattern 改动需一并回滚。
