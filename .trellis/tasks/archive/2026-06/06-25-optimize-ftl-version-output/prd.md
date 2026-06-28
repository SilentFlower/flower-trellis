# 优化 ftl 版本输出排版

## Goal

优化 `ftl -v` / `flower-trellis -v` 的版本信息排版，让全局工具版本、捆绑 Trellis 版本、当前项目版本信息更容易扫读，避免当前固定空格列对齐带来的观感不一致。

## Requirements

- `ftl -v` 与 `flower-trellis --version` 继续输出以下信息：
  - 当前 `flower-trellis` 包版本。
  - 捆绑的 `@mindfoldhq/trellis` 版本。
  - 当当前目录是 Trellis 项目时，输出项目 `.trellis/.version`。
  - 当当前项目存在 `.trellis/.flower-manifest.json` 且包含 `flowerVersion` 时，输出项目上次铺包的 `flower-trellis` 版本。
- 输出内容必须保持纯文本，适合终端复制和脚本查看。
- 输出风格希望比简单列对齐更精致，优先考虑有层次、克制的终端样式。
- 版本读取失败仍不能影响 `-v` 输出主流程。
- 不改变 `init` / `update` / `uninstall` / 透传 Trellis 子命令等其它 CLI 行为。

## Acceptance Criteria

- [ ] 在本仓库运行 `node bin/flower-trellis.js -v` 时，按以下顺序输出版本信息，且四项现有版本信息仍完整出现：

  ```text
  flower-trellis  0.3.1-beta.0

  project
    flower        0.3.1-beta.0
    .trellis      0.6.2

  bundled
    trellis       0.6.2
  ```

- [ ] 在非 Trellis 项目目录运行 `node /path/to/bin/flower-trellis.js -v` 时，只输出工具自身与捆绑 Trellis 版本，不报错。
- [ ] `-v` / `--version` 的行为一致。
- [ ] 现有 README 中对 `-v` 的说明无需因语义变化而重写；如新增示例，则与实际输出一致。

## Notes

- 当前实现位于 `src/cli.js` 的 `printVersion(cwd)`，使用多行 `console.log` 和固定空格对齐标签和值。
- 项目已有 `chalk` 依赖，可在终端中使用克制的颜色、加粗和灰色辅助文字，不需要新增依赖。
- 当前仓库没有独立测试目录；可用直接 CLI 命令验证输出。
- 已确认采用方案 A 的“品牌头 + 分组”方向，最终字段顺序为：工具自身 → 项目状态 → 捆绑依赖。
- 最终排版目标：

  ```text
  flower-trellis  0.3.1-beta.0

  project
    flower        0.3.1-beta.0
    .trellis      0.6.2

  bundled
    trellis       0.6.2
  ```
