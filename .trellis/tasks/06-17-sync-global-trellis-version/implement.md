# 同步全局 Trellis 到 flower-trellis 捆绑版本 - 实施计划

## Checklist

- [x] 读取相关规范:`.trellis/spec/flower-trellis/cli/index.md`、`config-and-state.md`、`cli-output.md`、`module-guidelines.md`。
- [x] 新增全局 Trellis 同步逻辑,从捆绑依赖读取目标版本,执行 `npm install -g @mindfoldhq/trellis@<version>`。
- [x] 抽取 npx / npm exec 判定到共享 `runtime-env` 模块,避免版本检测和全局同步逻辑漂移。
- [x] 新增 `scripts/sync-global-trellis.mjs`,作为 npm `postinstall` 入口。
- [x] 更新 `package.json`,增加 `postinstall` 脚本。
- [x] 在 `src/commands/update.js` 执行项目 update 前调用同步逻辑;失败时中止。
- [x] 更新 README 安装 / 更新说明,明确全局 Trellis 会跟随同步。
- [x] 如需新增环境变量或 flag,同步更新 `src/constants.js` / `src/cli.js` / 帮助文本;本次未新增 flag。

## Validation

- [x] `node --check src/cli.js`
- [x] `for f in src/lib/*.js src/commands/*.js scripts/*.mjs; do node --check "$f"; done`
- [x] `npm pack --dry-run`
- [x] 在临时 prefix 中执行安装验证,避免污染主环境:
  ```bash
  TMP_PREFIX=$(mktemp -d)
  npm pack
  npm install -g --prefix "$TMP_PREFIX" ./flower-trellis-*.tgz
  "$TMP_PREFIX/bin/trellis" --version
  "$TMP_PREFIX/bin/flower-trellis" -v
  ```
- [x] 模拟失败场景:临时让 npm global prefix 不可写或 PATH 中 npm 不存在,确认输出包含手动命令。
- [x] 对临时项目跑 `flower-trellis update --target <dir> -y --dry-run`,确认同步步骤在项目 update 前发生。
- [x] 运行 `npm run postinstall --silent`,确认普通本地安装语义会跳过全局同步。

## Risk Points

- npm 生命周期脚本内再次执行 `npm install -g` 会修改用户全局环境;错误文案必须明确,失败不能静默。
- 多 Node 版本管理器环境中,安装位置和 PATH 命中的 `trellis` 可能不一致;MVP 不猜测修复,只输出清晰诊断。
- 不要把 `@mindfoldhq/trellis` 版本硬编码到脚本里,否则下次升级 flower-trellis 依赖时容易漂移。

## Review Gate

实现前需要用户确认 PRD / Design 的强策略:

- 安装 flower-trellis 时强制同步全局 Trellis。
- 同步失败时安装或 update 失败,不降级继续。
