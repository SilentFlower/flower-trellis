# Beta 发布通道与升级检测

## Goal

为 `flower-trellis` 增加 beta 发布通道规划：稳定用户默认跟随 `latest`，愿意试用的用户可通过 `@beta` 安装/升级；升级检测能够理解当前安装通道，并在 `latest` 已经高于 beta 线时提醒 beta 用户升级/切回稳定版。

## Background / Known Context

- 当前 `package.json` 版本为 `0.2.4`，发布流程以 `npm run release` 生成版本和 tag，再由 `.github/workflows/release.yml` 在 `v*` tag 上执行 `npm publish`。
- 当前发布 workflow 固定 `npm publish`，未区分 `latest` / `beta` dist-tag。
- 当前 `src/lib/update-check.js` 只请求 `https://registry.npmjs.org/flower-trellis/latest`，只比较 `latest` 和本地版本。
- 当前升级命令固定提示 / 执行 `npm i -g flower-trellis@latest`。
- npm dist-tag 支持 `latest` / `beta` 等通道；`npm publish --tag beta` 可把 prerelease 发布到 beta 通道，`npm i -g flower-trellis@beta` 可安装 beta。
- 用户明确要求：尤其是 `latest` 分支版本大于 `beta` 版本后，beta 用户也应该被提示更新到 `latest`。

## Requirements

- 支持 beta 分支/版本维护策略，文档中明确 beta 版本号、npm dist-tag 和安装命令。
- 稳定通道继续使用 `latest`，默认安装 / 默认升级不应误入 beta。
- beta 通道使用 npm `beta` dist-tag，用户可通过 `npm i -g flower-trellis@beta` 安装或更新。
- 自动升级检测需要理解通道：
  - 当前版本是稳定版时，默认检测 `latest`。
  - 当前版本是 beta/prerelease 时，同时检测 `beta` 和 `latest`。
  - 如果 `beta` tag 高于当前 beta，提示升级到 `@beta`。
  - 如果 `latest` 高于当前 beta，提示升级到 `@latest`，用于 beta 线被稳定版追上或超过后的回归稳定。
- 非交互场景仍只打印升级命令，不阻塞主流程。
- 网络检测继续保持尽力而为：超时、离线、registry 异常时静默跳过，不影响 `init` / `update`。
- README / release 文档需要说明 beta 发布和升级策略。
- 新增 beta 发布自动化：beta tag 推送后自动执行 npm `beta` dist-tag 发布，避免手动 `npm publish --tag beta`。
- beta 发布自动化必须继续使用 OIDC Trusted Publishing，不引入长期 npm token。
- 稳定版 release workflow 不应把 beta prerelease 发布到 `latest`。
- MVP 不新增 `--channel beta/latest` CLI flag；升级检测根据当前安装版本自动选择推荐通道。

## Decisions

- beta 发布自动化采用独立 GitHub Actions workflow，beta tag 自动执行 `npm publish --tag beta`。
- CLI 升级检测采用自动通道判断：稳定版只看 `latest`，beta 版同时看 `latest` 和 `beta`。
- 暂不新增 `--channel` flag，避免增加用户心智和自有 flag 维护成本。

## Acceptance Criteria

- [ ] 文档说明稳定版 `@latest` 与 beta 版 `@beta` 的安装 / 更新命令。
- [ ] 文档说明 beta 版本号使用 semver prerelease，例如 `0.3.0-beta.1`。
- [ ] 发布流程不会把 beta prerelease 默认发布到 `latest`。
- [ ] 推送 beta tag 后，GitHub Actions 使用 `npm publish --tag beta` 发布到 npm beta dist-tag。
- [ ] beta 发布 workflow 继续使用 npm OIDC Trusted Publishing，不依赖 `NPM_TOKEN`。
- [ ] 稳定版当前安装检测到新稳定版时，提示 `npm i -g flower-trellis@latest`。
- [ ] beta 当前安装检测到新 beta 时，提示 `npm i -g flower-trellis@beta`。
- [ ] beta 当前安装检测到 `latest` 高于当前 beta 时，提示 `npm i -g flower-trellis@latest`。
- [ ] `latest` 与 `beta` 都不存在、网络失败、超时时，检测静默跳过。
- [ ] 非交互模式只打印升级命令和说明，不弹确认。
- [ ] 自动升级成功后仍提示用户重新运行当前命令。

## Definition of Done

- 更新 PRD / design / implement 并经用户确认后进入实现。
- 更新 `update-check` 的通道检测设计与相关 CLI 文案。
- 更新 README / release 文档。
- 完成 ESM 语法校验和相关轻量手测。

## Out of Scope

- 不改变 Trellis 本体版本选择逻辑。
- 不引入长期 npm token。
- 不实现复杂 release dashboard。
- 不在本任务里实现 npm package 回滚或自动 dist-tag 回退。
- 不强制所有用户使用 beta；beta 必须是显式 opt-in。

## Research References

- [`research/npm-dist-tags.md`](research/npm-dist-tags.md) — npm dist-tag 支持 `latest` / `beta` 通道，beta 发布应使用 `npm publish --tag beta`。
