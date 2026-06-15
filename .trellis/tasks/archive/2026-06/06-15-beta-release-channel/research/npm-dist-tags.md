# npm dist-tag 调研

## 来源

- npm CLI `npm-dist-tag` 文档：https://docs.npmjs.com/cli/v11/commands/npm-dist-tag/
- npm “Adding dist-tags to packages” 文档：https://docs.npmjs.com/adding-dist-tags-to-packages/
- npm CLI `npm-publish` 文档：https://docs.npmjs.com/cli/v9/commands/npm-publish/

## 结论

- npm dist-tag 是给版本的人类可读别名，可用于维护 `latest`、`beta`、`dev`、`canary` 等发布流。
- `npm publish` 默认把发布版本标记为 `latest`；发布 beta / prerelease 必须显式使用 `npm publish --tag beta`，否则 prerelease 可能污染稳定通道。
- `npm install <pkg>@<tag>` 可以按 tag 安装，例如 `npm i -g flower-trellis@beta`。
- npm 的 `latest` 对安装有默认语义：不指定 tag 时安装 `latest`。
- tag 名和 semver 共享命名空间，应避免以数字或 `v` 开头；`beta` 是合适的 tag 名。

## 对本仓的映射

- 稳定版继续走 `latest`。
- beta 版使用 semver prerelease，例如 `0.3.0-beta.1`，并通过 `npm publish --tag beta` 发布。
- 升级检测不能只查 `/latest`，需要读取 package metadata 的 `dist-tags.latest` 和 `dist-tags.beta`。
- 当当前本地版本是 beta，既要比较 `beta` tag，也要比较 `latest` tag；如果 `latest` 高于当前 beta，应该提示用户升级/切回 `latest`。
