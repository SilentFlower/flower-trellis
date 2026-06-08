# 技术设计 — `ft` 短命令 + 版本自动检测

## 1. 命令简化(`ft`)

- 仅改 `package.json#bin`,新增一项:
  ```json
  "bin": {
    "flower-trellis": "./bin/flower-trellis.js",
    "ftl": "./bin/flower-trellis.js",
    "ft":  "./bin/flower-trellis.js"
  }
  ```
- 三个名字共用同一入口,无代码分支。全局安装(`npm i -g`)后即生成 `ft` 软链。
- 文档:README「安装/用法/命令」与 `src/cli.js#printHelp` 增补 `ft` 别名说明。

## 2. 版本自动检测

### 2.1 新增模块 `src/lib/update-check.js`(命名导出,中文 JSDoc)

| 导出 | 签名 | 职责 |
|---|---|---|
| `fetchLatestVersion()` | `(): Promise<string\|null>` | `fetch(REGISTRY/flower-trellis/latest)` + `AbortController` 2.5s 超时,取 `.version`;任何失败 → `null` |
| `compareVersions(a, b)` | `(string,string): -1\|0\|1` | 剥预发布后缀后三段数值比较 |
| `isRunningViaNpx()` | `(): boolean` | `fileURLToPath(import.meta.url)` 含 `_npx`,或 `process.env.npm_command==='exec'` |
| `checkForUpdate(ctx)` | `(ctx): Promise<void>` | 编排:关闭开关/npx 短路 → 取 latest → 比对 → 有新版按 TTY/`-y` 走模式 (c)/(a) |

局部常量(单文件使用,不跨模块共享,留模块内):
```js
const REGISTRY = "https://registry.npmjs.org";
const PKG = "flower-trellis";
const TIMEOUT_MS = 2500;
```

### 2.2 `checkForUpdate(ctx)` 控制流

```
1. 关闭开关:ctx.updateCheck === false || process.env.FLOWER_NO_UPDATE_CHECK 非空 → return
2. isRunningViaNpx() → return(npx 本就是最新)
3. latest = await fetchLatestVersion(); if (!latest) return(尽力而为,静默)
4. current = flowerVersion()
5. compareVersions(latest, current) !== 1 → return(已是最新/更新)
6. 计算 nonInteractive = ctx.passthrough 含 -y/--yes  ||  !process.stdin.isTTY
7. 打印发现新版本通知行(🌸 chalk)
8a. nonInteractive(模式 a):多打印一行「升级:npm i -g flower-trellis@latest / 升级后请重跑 ft update 重新叠加强化包」→ return(不阻塞)
8b. 交互(模式 c):
    inquirer confirm「是否现在升级?」(默认 Y)
      否 → 打印「· 已跳过升级」→ return(继续主流程)
      是 → spawnSync("npm", ["i","-g","flower-trellis@latest"],
                      { stdio:"inherit", shell: process.platform==="win32" })
            status===0 → 打印「✓ 已升级到 <latest>。请重新运行 ft <command>;
                          如需同步强化包,升级后再跑一次 ft update。」→ process.exit(0)
            status!==0 → 打印「· 自动升级失败,请手动运行:npm i -g flower-trellis@latest」
                          → return(以当前版本继续主流程)
```

> 说明文案中的「ft <command>」用实际命令(init/update)。可由 checkForUpdate 接收 `commandName` 或从 ctx 推断;简单起见 `checkForUpdate(ctx, commandLabel)` 传 "init"/"update"。

### 2.3 接入点

- `src/cli.js#parse()`:新增 `--no-update-check` 分支 → `ctx.updateCheck=false`(默认 `true`);该 flag 不进 `passthrough`。同步在 `src/constants.js#OWN_FLAGS` 登记 `"--no-update-check": false`(保持自有 flag 清单一致)。
- `src/commands/init.js`:在 `printBanner` 之后、**平台菜单(`pickPlatforms`)之前** `await checkForUpdate(ctx, "init")`。
  - 原因:若用户确认升级会立即 `process.exit(0)`,应在让用户挑平台之前完成,避免做无用功;且 inquirer 确认必须在进入 pty 之前。
  - 注意:`-y` 模式 init 不打印 banner,此时模式 (a) 通知行直接打印即可(无 banner 也可接受)。
- `src/commands/update.js`:在 `printBanner` 之后、`runTrellisPty` 之前 `await checkForUpdate(ctx, "update")`。

### 2.4 边界与容错

- 网络:`fetch` 三道防线(`!res.ok` / `catch` / 字段类型校验)→ `null`;`finally` `clearTimeout` 防句柄泄漏。
- 升级失败不抛错给主流程:`spawnSync` 非 0 → 降级打印,函数正常返回。
- Windows:`spawnSync('npm', ...)` 必须 `shell: true`(npm 实为 npm.cmd);已在设计中按 `process.platform` 分支。
- 版本相等或本地更高(装了预发布)→ 不打扰。

## Compatibility / Rollback

- `ft` 仅加 bin 映射,纯增量,无回滚风险。
- 版本检测全部包在新模块 + 两处单行调用 + 一个 parse 分支;如需禁用,删两行调用即可,或用户用 `--no-update-check` / 环境变量。

## 验证要点

- `compareVersions`:`0.1.0` vs `0.2.0` / `1.0.0` vs `0.9.9` / 含 `-beta.x` / 相等。
- `fetchLatestVersion`:正常取值、超时(模拟)、离线返回 null。
- 接入:`node bin/flower-trellis.js update --target /tmp/x`(本地版本人为改低验证提示);`-y` 路径只打印;`--no-update-check` 跳过。
