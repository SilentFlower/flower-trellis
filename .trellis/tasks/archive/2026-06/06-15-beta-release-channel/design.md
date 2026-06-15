# Beta 发布通道与升级检测设计

## Technical Design

本任务分为两个面向：发布通道维护和 CLI 升级检测。

## Release Channel Model

### Channel

- `latest`：稳定通道，默认安装和默认发布目标。
- `beta`：预发布通道，必须显式 opt-in。

### Version

- 稳定版：`x.y.z`
- beta 版：`x.y.z-beta.n`

### npm dist-tag

- 稳定版发布到 `latest`。
- beta 版发布到 `beta`，避免 prerelease 污染默认安装通道。

## Update Check Model

现有实现只请求 `/flower-trellis/latest`。新模型建议改为读取 package metadata：

```text
GET https://registry.npmjs.org/flower-trellis
```

读取：

- `dist-tags.latest`
- `dist-tags.beta`
- `versions[version]` 是否存在可选，不作为 MVP 必需

## Channel Detection

本地当前版本来自 `flowerVersion()`。

```text
current = 0.3.0          -> current channel = latest
current = 0.3.0-beta.1   -> current channel = beta
```

判断方式：版本号包含 prerelease 标记（如 `-beta.`）即认为当前在 beta 通道。

## Recommendation Rules

### 当前为稳定版

只比较 `latest`：

- `latest > current`：提示升级 `npm i -g flower-trellis@latest`
- 否则不提示

不主动提示 beta，避免稳定用户被引导到预发布版本。

### 当前为 beta 版

同时比较 `beta` 和 `latest`：

- 如果 `latest > current`：优先提示 `npm i -g flower-trellis@latest`
- 否则如果 `beta > current`：提示 `npm i -g flower-trellis@beta`
- 否则不提示

这样满足用户提出的关键场景：当稳定版已经超过当前 beta 线时，beta 用户应被提醒回到稳定版。

## Semver Comparison

当前 `compareVersions` 会剥离 prerelease 后缀，只比较三段数字。这对 `latest` 稳定版本比较基本够用，但对 beta 之间的比较不够：

```text
0.3.0-beta.2 > 0.3.0-beta.1
```

MVP 需要支持 prerelease 序号比较，否则 beta 用户无法正确检测 beta 小版本更新。

建议实现轻量 semver parser，不引入 `semver` 依赖：

- 解析 `major.minor.patch`
- 解析可选 prerelease：`beta.<number>` 或保守支持任意 `<label>.<number>`
- 稳定版高于同 base 的 prerelease：`0.3.0 > 0.3.0-beta.9`
- 不认识的 prerelease label 只做保守比较，避免误提示

## CLI / UX

延续现有行为：

- 交互 TTY：打印发现新版本，询问是否立即升级。
- 非交互：只打印升级命令，不弹确认。
- 自动升级成功后退出，要求用户重跑当前命令。

新文案需要显示目标通道：

```text
发现 flower-trellis 新版本 0.3.0（当前 0.3.0-beta.2，通道 latest）
  · 升级：npm i -g flower-trellis@latest
```

## Release Automation

### Stable Workflow

现有 `.github/workflows/release.yml` 继续服务稳定版：

- 触发：`vX.Y.Z`
- 发布：`npm publish`
- dist-tag：默认 `latest`

为避免稳定 workflow 误发 beta，需要加保护：

- 只允许不含 prerelease 的 tag 进入稳定发布。
- 如果 tag 含 `-beta.`，稳定 workflow 应跳过或由 tag pattern 分流。

### Beta Workflow

新增独立 workflow，例如 `.github/workflows/release-beta.yml`：

- 触发：`v*-beta.*`
- 发布：`npm publish --tag beta`
- dist-tag：`beta`
- 权限：继续使用 `contents: write` + `id-token: write`
- Node/npm：继续使用 Node 22 + `npm install -g npm@latest`
- checkout：不拉 submodule，发布只依赖已提交的 `enhancements/` 快照
- GitHub Release：可继续创建 prerelease GitHub Release，使用 `gh release create --prerelease`

### Local Beta Version Flow

本地仍由维护者决定版本号和 tag，可用：

```bash
npm run release -- --prerelease beta
git push --follow-tags origin main
```

如果 `commit-and-tag-version` 对 0.x prerelease 不符合预期，文档中补充手动 `--release-as <version>` 方式作为兜底。

## Feasible Approaches

### Approach A：自动通道检测 + 手动 beta 发布

优点：实现小。
缺点：beta 发布依赖人工 `npm publish --tag beta`，容易漏 provenance / 操作不一致。

### Approach B：自动通道检测 + 显式 `--channel` flag

优点：CLI 更灵活。
缺点：新增自有 flag 和用户心智；当前需求可以靠自动检测覆盖。

### Approach C：自动通道检测 + 独立 beta workflow（已选）

优点：beta 发布自动化完整，dist-tag 明确，沿用 OIDC。
缺点：需要维护额外 workflow 和 tag 规则。

## Decision (ADR-lite)

**Context**: 需要同时支持 beta 试用通道和稳定通道，并且避免 beta prerelease 污染 `latest`。

**Decision**: 采用 Approach C。新增 beta release workflow，beta tag 自动 `npm publish --tag beta`；CLI 升级检测自动识别当前版本，beta 用户同时比较 `latest` 和 `beta`，且 `latest` 更高时优先提示升级 `@latest`。

**Consequences**:

- 发布维护更清晰：稳定版和 beta 版用不同 workflow / dist-tag。
- 用户体验更安全：稳定用户不会默认进入 beta，beta 用户可及时回到 latest。
- CI 配置增加一份，需要在文档中说明 tag 规则和 Trusted Publishing 约束。

## Rollout / Rollback

- Rollout：发布 beta 版时推送 `vX.Y.Z-beta.N` tag，由 beta workflow 使用 `npm publish --tag beta`；稳定版仍使用现有 `latest` workflow。
- Rollback：如 beta 检测误提示，可回退 `update-check.js` 到只检测 `latest`；文档改动无数据迁移。
