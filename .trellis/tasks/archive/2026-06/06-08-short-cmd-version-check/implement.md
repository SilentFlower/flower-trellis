# 实施清单 — `ft` 短命令 + 版本自动检测

## Implementation Checklist

### A. 命令简化(`ft`)
- [ ] A1. `package.json#bin` 新增 `"ft": "./bin/flower-trellis.js"`。
- [ ] A2. `src/cli.js#printHelp` 增补别名说明(flower-trellis / ftl / ft 等价)。
- [ ] A3. README 安装段、用法注释、命令表补 `ft`。

### B. 版本检测模块
- [ ] B1. 新增 `src/lib/update-check.js`,导出 `fetchLatestVersion` / `compareVersions` / `isRunningViaNpx` / `checkForUpdate`(中文 JSDoc,`node:` 前缀,`import.meta.url` 定位 npx)。
- [ ] B2. `fetchLatestVersion`:`AbortController` 2.5s,失败链路全 `return null`,`finally` `clearTimeout`。
- [ ] B3. `compareVersions`:剥 `-` 后缀 + 三段 `parseInt` 比较。
- [ ] B4. `isRunningViaNpx`:路径含 `_npx` 或 `npm_command==='exec'`。
- [ ] B5. `checkForUpdate(ctx, commandLabel)`:按 design.md §2.2 控制流(关闭开关/npx 短路 → 取/比 → 模式 c/a)。复用 `flowerVersion()` / `inquirer` / `chalk`。

### C. 接入与开关
- [ ] C1. `src/cli.js#parse()` 加 `--no-update-check` 分支(`ctx.updateCheck` 默认 true,命中置 false,不进 passthrough)。
- [ ] C2. `src/constants.js#OWN_FLAGS` 登记 `"--no-update-check": false`。
- [ ] C3. `src/commands/init.js`:banner 后、`pickPlatforms` 前 `await checkForUpdate(ctx, "init")`。
- [ ] C4. `src/commands/update.js`:banner 后、`runTrellisPty` 前 `await checkForUpdate(ctx, "update")`。

### D. 文案
- [ ] D1. 通知/确认/成功/失败文案按 cli-output spec 前缀(`🌸`/`·`/`✓`),成功与 `-y` 通知均含「升级后重跑 update 重新叠加强化包」说明。

## Validation
- [ ] `node --check src/lib/update-check.js` 等语法自检;项目若有 lint 则跑。
- [ ] 手测 `compareVersions` 各分支(临时 node -e)。
- [ ] 手测接入:临时把本地 `package.json` version 改低 → `node bin/flower-trellis.js update --target /tmp/ft-test`(交互确认/拒绝)、加 `-y`(仅打印)、加 `--no-update-check`(跳过);测完还原 version。
- [ ] 离线/超时:断网或将 REGISTRY 指向不可达 → 确认静默且主流程继续。
- [ ] `ft -v` 在本地 `node bin` 方式下不适用(bin 软链仅全局安装生成),改为确认 `package.json#bin` 三项正确。

## Review Gates
- [ ] 开始前:本清单 + design.md 经用户确认。
- [ ] 结束前:trellis-check(spec 合规 / 不破坏现有行为);README 文档同步。

## 触及文件
- `package.json`(bin)
- `src/cli.js`(parse + printHelp)
- `src/constants.js`(OWN_FLAGS)
- `src/commands/init.js`、`src/commands/update.js`(接入调用)
- `src/lib/update-check.js`(**新增**)
- `README.md`(文档)
