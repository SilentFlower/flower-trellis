# Config & State

> 常量、路径定位、版本读取与安装清单(状态)的约定。

---

## Overview

flower-trellis 自身几乎无内存态:配置是一组**集中常量**,运行所需的「状态」落在
**目标项目磁盘**上(`.trellis/.version`、`.trellis/.flower-manifest.json`)。
所有跨模块名单收敛到 `src/constants.js`,所有包内路径从 `src/lib/paths.js` 派生。

---

## Constants (`src/constants.js`)

集中三类名单,改动时**必须与上游同步**(注释已标注来源):

- `VARIANTS = ["old", "0.5", "0.6"]` —— 强化包支持的三个变体目录名。
- `PLATFORM_FLAGS` —— Trellis init 支持的全部平台 flag;用户未指定平台时据此判断是否补默认。
  来源为 Trellis `cli/index.ts` 的 init 注册,上游新增平台时此名单可滞后(最坏只是误补
  `--claude`,不致命)。
- `OWN_FLAGS` —— flower 自有、**不能透传给 trellis** 的 flag;值 `false`=布尔 flag,
  `true`=带取值 flag(剔除时要连带跳过其后一个 token)。

> 新增 flower 自有 flag 时,务必同时更新 `OWN_FLAGS` 与 `cli.js` 的 `parse()`,
> 否则会被错误透传给 trellis。

---

## Path Resolution (`src/lib/paths.js`)

- 唯一的路径锚点:`PKG_ROOT`(包根)与 `ENHANCEMENTS_ROOT`(`<PKG_ROOT>/enhancements`),
  均由 `import.meta.url` 派生。其它模块需要包内路径时**从这里 import**,不要各自
  `fileURLToPath` 重算。

---

## Version Reading (`src/lib/versions.js`)

- `flowerVersion()` 读包根 `package.json` 的 `version`。
- `trellisVersion()` 解析捆绑依赖 `@mindfoldhq/trellis/package.json`;**容错**:依赖缺失时
  返回占位串 `"(未安装)"` 而非抛错 —— `-v` 在任何环境都应能打印。
- 模式约定:版本/装饰类读取失败一律降级,不影响主输出。
- `-v`(`printVersion`)按可得性逐行打印,均在 `try` 内容错:
  `flower-trellis`(工具版本)/ `trellis (bundled)`(捆绑依赖)/ `project .trellis`(项目
  `.trellis/.version`)/ `project flower`(项目 `.flower-manifest.json` 的 `flowerVersion`,
  即「上次哪个 flower 铺的」;旧 manifest 无此字段时该行自动省略)。后两行仅在项目内可读时出现。

---

## Network Probe (尽力而为联网探测)

> flower 自身几乎零网络依赖;**唯一**的对外探测是 `init` / `update` 启动时查 npm 上
> flower-trellis 自身的最新版(`src/lib/update-check.js`)。任何联网探测都必须「尽力而为」:
> 带超时、失败静默、**绝不阻断主流程**。这是「Version Reading」降级约定在网络场景的延伸。

- **签名 / 契约**:`fetchLatestVersion(): Promise<string|null>` —— 成功返回版本串,
  **任何失败一律 `null`**(调用方据此「拿不到就当没这回事」继续)。请求
  `GET https://registry.npmjs.org/flower-trellis/latest`,读 `.version`。
- **超时**:用 `AbortController` + `setTimeout(ac.abort, 2500)`,`signal` 传入内置 `fetch`;
  `finally` 里 `clearTimeout` 防句柄泄漏(否则 timer 可能拖住进程不退出)。
- **三道防线 → `null`**:① `!res.ok`(非 200);② `catch`(AbortError 超时 / `fetch failed`
  离线 / JSON 解析失败);③ 字段类型不符(`typeof json.version !== "string"`)。
- **编排短路**:`checkForUpdate(ctx, label)` 顺序短路——关闭开关
  (`ctx.updateCheck===false` 或 `process.env.FLOWER_NO_UPDATE_CHECK` 非空)→ npx
  (`isRunningViaNpx()`,路径含 `_npx`)→ 探测失败 → 已最新,任一命中即静默返回。
- **不引重依赖**:不引 `update-notifier` / `semver`;版本比较自己拆三段数值(比较对象是
  `latest` dist-tag,天然规避预发布),与 `variant.js`「剥 `-beta.x` 再比数值」一致。

| 失败条件 | 行为 |
|---|---|
| 离线 / DNS 失败 / 超时(>2.5s) | `catch` → `null` → 不打印,主流程继续 |
| 非 200(404/5xx) | `null` → 静默 |
| 响应无 `version` 字段 | `null` → 静默 |
| 关闭开关 / npx | 不发请求,直接返回 |

**Wrong**:`const v = (await fetch(url)).json(); return v.version;` —— 无超时(离线时挂起)、
无 try/catch(失败抛进 init/update 主流程)、无字段校验。
**Correct**:见 `src/lib/update-check.js#fetchLatestVersion`(AbortController + 三道防线 + `finally` 清 timer)。

---

## Variant Selection (`src/lib/variant.js`)

- `selectVariant(target)` 读目标 `.trellis/.version` → 返回 `{ variant, version }`。
- 规则(逐字符移植 skill-garden `install.sh` 263-274):主版本 ≥1 或次版本 ≥6 → `0.6`;
  次版本 ≥5 → `0.5`;文件缺失/解析失败/更低 → `old`。次版本会先剥掉 `-beta.x` 后缀。
- 改这条规则前先确认上游 install.sh 的对应逻辑,保持一致。

---

## Install Manifest (`src/lib/manifest.js` + `.flower-manifest.json`)

flower 自己的安装清单,是「精确升级清理」的依据:

- 位置:目标项目 `.trellis/.flower-manifest.json`,随 Trellis 生命周期存在
  (`uninstall` 删 `.trellis/` 时一并消失)。
- 内容:`{ flowerVersion, variant, version, skills[], paths[] }` —— 记录**上一次全装铺过的精确路径**,
  升级(如 `0.5`/`old` → `0.6`)时据此删除「上次有、本次变体不含」的过期项,
  **只删自己铺过的路径**,绝不误删用户或 Trellis 本体的文件。
  - `flowerVersion` = 铺包时的 **flower-trellis 工具版本**(`flowerVersion()` 读包根 `package.json`);
    `version` = 目标项目的 **Trellis 版本**(`selectVariant` 从 `.trellis/.version` 拷来)。二者勿混淆 ——
    前者答「上次哪个 flower 铺的」,后者答「项目当时是哪个 trellis」,均服务后续升级判断。
  - 仅全装(无 `--skills`)时写 manifest;`--skills` 精细操作不动 manifest,故 `flowerVersion`
    只在全装时刷新。
- `readManifest` 读不到 / 损坏时返回 `null`(调用方需判空);`writeManifest` 写
  `JSON.stringify(data, null, 2) + "\n"`(两空格缩进 + 结尾换行)。

---

## Common Mistakes

- 在多个模块各自重算包根路径 —— 应统一用 `paths.js` 的 `PKG_ROOT` / `ENHANCEMENTS_ROOT`。
- 新增自有 flag 只改了 `parse()` 没更 `OWN_FLAGS`(或反之)—— 两处必须同步。
- 把版本/manifest 读取失败当致命错误抛出 —— 这类应容错降级。
- 联网探测(版本检测)漏写超时或 try/catch —— 离线时会挂起或把错误抛进主流程,见
  [Network Probe](#network-probe-尽力而为联网探测)。
- 凭 manifest 之外的猜测去删除目标文件 —— 清理只认 manifest 里的精确 `paths`。
