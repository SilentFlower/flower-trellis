# 同步全局 Trellis 到 flower-trellis 捆绑版本 - 设计

## Background

flower-trellis 当前把 `@mindfoldhq/trellis` 作为普通依赖安装,并通过 `resolveTrellisBin()` 调用捆绑依赖中的 Trellis bin。这个设计保证 `flower-trellis init/update` 自身不依赖用户全局 `trellis` 版本。

问题在于 npm 不会把依赖包的 bin 自动暴露成全局命令。用户直接运行 `trellis mem search ...` 时,命中的仍可能是旧的全局 `@mindfoldhq/trellis`,从而出现项目版本已是 `0.6.0`、CLI 仍是 `0.6.0-beta.8` 的不一致。

## Approach

新增一个可复用同步模块,负责把全局 `@mindfoldhq/trellis` 安装到 flower-trellis 捆绑版本:

- 读取捆绑 Trellis 版本:复用 `trellisVersion()` 或直接解析 `@mindfoldhq/trellis/package.json`。
- 同步命令:`npm install -g @mindfoldhq/trellis@<bundledVersion>`。
- 安装后校验:可调用 `trellis --version` 或 `npm exec` 读取全局命令版本;MVP 至少保证安装命令退出码为 0。
- 失败处理:抛出中文错误,包含手动修复命令。

## Entry Points

### npm 安装期

在 `package.json` 增加 `postinstall`:

```json
"postinstall": "node scripts/sync-global-trellis.mjs"
```

脚本只安装 `@mindfoldhq/trellis@<bundledVersion>`,避免重新安装 flower-trellis 导致生命周期递归。

`npx flower-trellis ...` 会把包临时下载到 npm exec 缓存,不属于用户明确安装 flower-trellis;脚本检测到 `_npx` 路径或 `npm_command=exec` 时跳过同步,保留 README 的免安装语义。

仓库内开发者执行 `npm install` 或其他项目把 flower-trellis 当普通依赖安装时,`postinstall` 不应修改全局环境。脚本只在 `npm_config_global=true` 的全局安装语义下强同步;运行时的 `flower-trellis update` 仍直接强同步。

### flower-trellis update

在 `src/commands/update.js` 的主流程前增加强同步:

1. 打印 flower banner 和 flower 自身版本检测后;
2. 执行全局 Trellis 同步;
3. 同步成功后再运行 `trellis update`;
4. 同步失败则抛错,由顶层统一输出 `❌ ...` 并退出 1。

把同步放在项目 update 前,是为了避免项目已经升级、全局 Trellis 仍旧失败的半同步状态。

## Module Shape

建议新增:

- `src/lib/global-trellis-sync.js`:运行时复用逻辑,供 `update` 调用。
- `scripts/sync-global-trellis.mjs`:npm 生命周期入口,调用同一套核心逻辑或保持最薄封装。

如果 ESM 路径和发布包内引用允许,脚本可直接 import `src/lib/global-trellis-sync.js`;否则在脚本内保留小包装,但版本读取仍必须来自已安装的 `@mindfoldhq/trellis/package.json`。

## Failure Policy

同步全局 Trellis 是本任务定义的一致性要求,不是“尽力而为”的联网探测:

- `postinstall` 阶段同步失败:脚本应以非 0 退出,让安装失败暴露出来。
- `flower-trellis update` 阶段同步失败:中止 update,提示手动命令。
- 不自动使用 `sudo`,不修改 npm prefix,不猜测用户的 Node 版本管理器。

## Compatibility

- Windows 上 `npm` 需要 `shell: process.platform === "win32"` 或等价处理,沿用 `update-check.js` 里的 spawn 习惯。
- CI / npm publish: `postinstall` 不在本包发布时触发,但消费者安装包时会触发。需要在验证里覆盖 `npm pack` 后本地全局安装的路径。
- `--no-update-check` 只控制 flower-trellis 自身网络版本检测,不应跳过本任务的全局 Trellis 同步;两者语义不同。

## Rollback

回滚时删除 `postinstall`、新增同步模块 / 脚本,并移除 `update.js` 调用点。项目 update 会回到只使用捆绑 Trellis、不保证全局 Trellis 一致的旧行为。
