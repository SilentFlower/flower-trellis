# CLI 短命令 `ft` + init/update 版本自动检测

## Goal

为 flower-trellis 提升日常使用体验,新增两个独立功能:
1. **命令简化**:在 `flower-trellis` / `ftl` 之外再注册 2 字符短命令 `ft`,降低高频输入成本。
2. **版本自动检测**:运行 `init` / `update` 时联网比对 npm 上 flower-trellis 自身的 `latest` 版本,发现新版本时提示并询问是否立即升级;全程尽力而为,绝不阻断主流程。

## Background / Known Context

- 包名 `flower-trellis`,全局安装使用,也支持 `npx`。`package.json#bin` 现有 `flower-trellis` 与 `ftl`,均指向 `bin/flower-trellis.js`。
- 入口:`bin/flower-trellis.js` → `src/cli.js`(手写 argv 解析,init/update/uninstall + 兜底透传)。
- `src/lib/versions.js#flowerVersion()` 可本地读取自身版本;`inquirer` / `chalk` 已是依赖。
- `init` / `update` 经 `runTrellisPty`(node-pty)驱动 trellis;`init` 在交互模式才打印 banner、再弹平台多选菜单。
- README 主打强化包安装「零网络依赖」;版本检测的网络请求必须超时/离线/失败一律静默跳过。
- 现有降级先例:`pick-platforms.js:41` 非 TTY 回退默认;`init.js` 用 `-y`/`--yes` 判非交互。

## Requirements

### 命令简化
- R1. `package.json#bin` 新增 `ft` → `./bin/flower-trellis.js`,与 `flower-trellis` / `ftl` 完全等价。
- R2. README 安装/用法/命令表与 `printHelp` 提及新别名 `ft`。

### 版本自动检测
- R3. 仅检测 flower-trellis 自身:`fetch` npm registry `flower-trellis/latest` 取 `version`,对比本地 `flowerVersion()`。
- R4. 触发时机:`init` 与 `update`(共用同一检测入口);`-v` / `-h` / 兜底透传**不触发**。
- R5. 网络容错:`AbortController` 2.5s 超时;离线/超时/非 200/解析失败 → 静默跳过,主流程照常完成。
- R6. 版本比较不引 semver:三段数值比较,比较前剥除预发布后缀(对比 `latest` 天然规避预发布)。
- R7. 发现新版本(交互 TTY):提示 + `inquirer` 询问是否升级。
  - 同意 → 执行 `npm i -g flower-trellis@latest`;成功则打印「已升级,请重新运行;升级后再跑一次 update 重新叠加强化包」并退出(**不做 re-exec 自动重跑**);失败则降级为打印手动升级命令,并继续当前主流程。
  - 拒绝 → 打印跳过提示,继续主流程。
- R8. 非交互降级:`-y` / `--yes` 或非 TTY → 仅打印一行通知 + 升级命令(含「升级后重跑 update」说明),不弹确认、不阻塞。
- R9. npx 场景:经 npx 运行(路径含 `_npx` 或 `npm_command==='exec'`)→ 完全跳过检测(本就是最新版)。
- R10. 关闭开关:`--no-update-check`(flower 自有 flag,不透传 trellis)或环境变量 `FLOWER_NO_UPDATE_CHECK`(非空)→ 跳过检测。

## Acceptance Criteria

- [ ] `ft init` / `ft update` / `ft -v` 与 `flower-trellis` 等价可用。
- [ ] 本地版本低于 npm `latest` 时,`init`/`update` 在主操作前提示并询问升级。
- [ ] 同意升级且成功 → 升级到 latest,打印重跑提示(含 update 重新叠加说明)后退出。
- [ ] 升级失败 → 打印手动命令,init/update 仍以当前版本继续完成。
- [ ] 离线/超时/请求失败 → 无任何报错,init/update 正常完成。
- [ ] `-y` 或非 TTY → 仅打印通知,不卡住、不弹 prompt。
- [ ] npx 运行 / `--no-update-check` / `FLOWER_NO_UPDATE_CHECK=1` → 不进行检测。
- [ ] 不破坏现有 `-v` / `-h` / 透传 / 平台菜单 / banner 行为。

## Definition of Done

- `compareVersions` / `fetchLatestVersion`(超时)有可测覆盖(至少手测脚本)。
- README 命令表、安装说明、`printHelp` 同步更新。
- 中文 JSDoc;遵循 module-guidelines(ESM / 命名导出 / `node:` 前缀 / `import.meta.url` 定位)。

## Out of Scope

- 检测/升级捆绑的 `@mindfoldhq/trellis`(本次仅 flower-trellis 自身)。
- 检测结果落盘缓存(configstore 之类);本次每次尽力而为现查。
- 升级后自动 re-exec 重跑(明确不做)。
- 强化包快照的在线增量更新。

## Decision (ADR-lite)

- **命令名**:`ft`(2 字符,冲突风险低)。
- **检测实现**:自写轻量 `fetch`(零新依赖),不引 `update-notifier`(拖 ~10 传递依赖且无交互确认能力)。
- **自升级模式**:模式 (c) 确认→升级→退出提示重跑;失败兜底模式 (a) 仅打印;不做模式 (b) re-exec。
- **依据**:见 Research References,契合本项目「零网络依赖 / 尽力而为 / 绝不阻断」基调。

## Research References

- [`research/version-check-conventions.md`](research/version-check-conventions.md) — update-notifier vs 自写 fetch、版本比较、超时容错、npx 识别、自升级三模式、非交互降级,逐条给出推荐结论与落地建议。
