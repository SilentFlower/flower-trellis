# Research: 全局安装型 ESM npm CLI 的「启动时版本检测 + 引导升级」惯例

- **Query**: 一个 ESM、Node ≥18.17 的全局安装型 npm CLI(flower-trellis)如何在 init/update 启动时检测自身是否有新版本并提示/引导升级
- **Scope**: mixed(外部惯例 + 本仓内部代码/spec)
- **Date**: 2026-06-08

## 摘要(给主 agent 的速读)

- **方案选型**:推荐**自写轻量 registry fetch**(零运行时依赖,契合本项目「零网络依赖 / 尽力而为」基调),而非引入 `update-notifier`。update-notifier 仍维护、是 ESM、但会拖入 ~10 个传递依赖,且默认只打通知框、**不做交互确认**,满足不了「询问是否升级」的核心需求。
- **取版本**:`fetch('https://registry.npmjs.org/flower-trellis/latest')` 取 `.version` 最简;或对完整文档加 `Accept: application/vnd.npm.install-v1+json` 取 `dist-tags.latest`(payload 小很多)。两者都已在本机实测可用,本包当前 `latest = 0.1.0`。
- **版本比较**:对比 `latest` dist-tag **天然规避预发布**(latest 永远是稳定版),因此比较函数可以做得很简单——数值化拆分 `major.minor.patch` 三段比大小即可,无需 semver 库。
- **超时容错**:`AbortController` + `setTimeout(2500)` 给 fetch 加超时;catch 一切(离线/超时/非 200/JSON 损坏)→ 静默 `return null`,绝不阻断主流程。
- **npx 识别**:**最可靠是检查执行路径里含 `_npx`**(npx 缓存目录 `~/.npm/_npx/<hash>/...`,本机已确认该目录存在);`npm_config_user_agent` 单独**不足以**区分 npx(它在 `npm run` / npx / 全局直跑下表现不一,且 `is-npm` 那套逻辑根本不检测 npx)。
- **自升级模式**:推荐 **(c) 交互确认 → `spawnSync('npm i -g pkg@latest')` → 升级成功后退出并提示用户重跑**。(b) re-exec 坑太多(全局安装可能 EACCES/需 sudo、Windows 兼容、当前进程已加载旧代码),复杂度收益不成正比;(a) 仅打印是最保守的兜底。
- **非交互(`-y`)/ npx / 非 TTY**:统一降级为「仅打印一行通知 + 升级命令,不阻塞、不弹确认」,与本项目 `pick-platforms.js` 在 `!isTTY` 下直接回退默认的现有惯例一致。
- **落地**:新增 `src/lib/update-check.js`,在 `init` / `update` 命令**主流程开始之前**(banner 之后、`runTrellisPty` 之前)`await` 一次检测;复用现有 `inquirer`(交互确认)、`flowerVersion()`(取本地版本)、cli-output spec 的 `·` / `✓` 前缀风格。

---

## 1. 主流做法对比:update-notifier vs 自写轻量 fetch

### 1a. update-notifier 现状(实测 + 源码核对)

实测 `npm view update-notifier`(2026-06-08):

| 维度 | 结论 |
|---|---|
| 最新版本 | **7.3.1**,最后发布 2024-12-07(`time.modified`)。仍由 sindresorhus 维护,不算废弃,但更新节奏慢。 |
| ESM 兼容 | **纯 ESM**(`"type": "module"`),`engines.node >= 18`。与本项目 ESM / Node ≥18.17 完全兼容。 |
| 依赖体积 | `deps: 10`——`boxen`、`chalk`、`configstore`、`is-in-ci`、`is-installed-globally`、`is-npm`、`latest-version`、`pupa`、`semver`、`xdg-basedir`。自身 unpackedSize 仅 14.8 kB,但**传递依赖树很大**(semver / boxen / configstore 各自还带依赖)。 |
| 后台异步检查 + 缓存 | 是。它 fork 一个**分离子进程**(`check.js`)在后台跑 `latest-version`,结果用 `configstore` 缓存(默认 `updateCheckInterval` 1 天),**当前进程不等网络**,下次启动才读缓存打印——这是它「不阻塞」的关键设计。 |
| 默认行为 | `notifier.notify()` **只打印一个 boxen 通知框**(含 `npm i -g <pkg>` 文案),**不做任何交互确认、不自动升级**。 |

**关键限制**:update-notifier 的产品定位是「被动通知」,它**没有「询问是否升级」的交互能力**,也不执行升级。本任务的核心需求是「发现新版本 → 提示 → 询问是否立即升级」,update-notifier 只能覆盖「提示」这一半,后面的交互确认 + 执行升级仍要自己写。等于引入了一棵依赖树却只用到它的一半。

另一个副作用:它的后台-子进程 + configstore 缓存模型,与本项目「每次 init/update 当场做一次尽力而为检测」的同步、无落盘状态诉求不完全契合(本项目 spec 明确「几乎无内存态,状态落目标项目磁盘」,不希望再引入 `~/.config/configstore` 这类用户级缓存)。

来源:
- npm registry 实测 `npm view update-notifier`(deps / type / engines / time.modified,2026-06-08)
- 源码核对:`is-npm@6.1.0/index.js`(见 §4)与 update-notifier README 的 `update-notifier` 工作模型
- https://github.com/yeoman/update-notifier#readme

### 1b. 自写轻量 registry fetch(Node 18.17 内置全局 `fetch`)

两个 registry 端点都已在本机 curl 实测可用(本包已发布,`latest = 0.1.0`):

- `GET https://registry.npmjs.org/flower-trellis/latest` → 直接返回该版本的 package.json JSON,取 `.version`。最简。
- `GET https://registry.npmjs.org/flower-trellis` → 完整文档,取 `dist-tags.latest`。**强烈建议加 `Accept: application/vnd.npm.install-v1+json`**(npm 的「abbreviated metadata」),实测响应体只剩 `{ name, dist-tags, versions, modified }`,**剥掉了 readme / 各版本完整 package.json**,payload 小一个数量级——更快、更省。

最简代码骨架(纯内置,零依赖;只示意,不落码):

```js
// src/lib/update-check.js(建议新增)
const REGISTRY = "https://registry.npmjs.org";
const PKG = "flower-trellis";

/**
 * 取 npm 上 flower-trellis 的 latest 版本号;失败一律返回 null(尽力而为)。
 * @returns {Promise<string|null>}
 */
export async function fetchLatestVersion() {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 2500); // 2.5s 超时
  try {
    const res = await fetch(`${REGISTRY}/${PKG}/latest`, {
      signal: ac.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;          // 非 200 静默跳过
    const json = await res.json();
    return typeof json.version === "string" ? json.version : null;
  } catch {
    return null;                        // 离线 / 超时 / 解析失败 → 静默
  } finally {
    clearTimeout(timer);
  }
}
```

> 备选(取 dist-tags 版):请求 `${REGISTRY}/${PKG}` 加 `Accept: application/vnd.npm.install-v1+json`,读 `json["dist-tags"].latest`。两者等价,`/latest` 端点更直白。

### 1c. 权衡(依赖体积 / 零网络依赖原则 / 可控交互)

| 维度 | update-notifier | 自写 fetch |
|---|---|---|
| 运行时依赖 | +1 直接 + ~10 传递依赖(semver/boxen/configstore…) | **0**(Node 18.17 内置 `fetch` + `AbortController`) |
| 「零网络依赖」基调 | 引一棵树才用一半 | 一个文件、可全程 try/catch 静默,完全契合本项目 README「尽力而为」 |
| 交互确认(询问是否升级) | **做不到**(只打通知框) | **完全自控**,可接 inquirer 弹确认 |
| 缓存/不阻塞 | 内置后台子进程 + configstore | 需自己加 2.5s 超时控制不阻塞(本任务已要求) |
| 维护成本 | 跟随上游升级 | 自己维护一个 ~40 行小模块 |

**推荐:自写轻量 fetch。** 唯一让给 update-notifier 的是「后台缓存、零启动延迟」,但本项目用 2.5s 超时即可把延迟封顶,且 init/update 本就是低频、重操作命令,容得下一次短网络探测。

来源:
- 本机 curl 实测两个 registry 端点(`/flower-trellis/latest` 与 `/flower-trellis` + abbreviated Accept 头),2026-06-08
- npm registry abbreviated metadata 媒体类型:`application/vnd.npm.install-v1+json`(https://github.com/npm/registry/blob/main/docs/responses/package-metadata.md)
- Node fetch 自 18.0 起内置、18.17 稳定(https://nodejs.org/api/globals.html#fetch)

---

## 2. 语义化版本比较(不引 semver 大依赖)

**核心洞察:比较对象是 `latest` dist-tag,它按 npm 语义永远指向最新的稳定发布(预发布版本默认不会成为 `latest`)。** 因此「current vs latest」里 `latest` 一侧**天然不含 `-beta.x` 预发布后缀**,比较逻辑可以大幅简化——本项目自己也只在 publish 稳定版时才会移动 latest 标签。

> 注意:本地 `current`(即 `flowerVersion()` 读 package.json)在用户装了预发布版时**可能**带 `-beta.x`。处理策略:比较时**先剥掉 current 的预发布后缀**(取 `-` 之前的部分),或在「current 含预发布 且 latest 数值相等或更低」时直接判定为「无需升级 / 已是预览版」不打扰。

最简比较函数思路(纯三段数值比较,不依赖第三方库):

```js
/**
 * 比较两个版本号,返回 1 / 0 / -1(a 比 b 新 / 相同 / 旧)。
 * 仅比较 major.minor.patch 三段数值;预发布后缀(-beta.x 等)在拆分前剥除。
 * 因为比较对象是 npm latest(永远稳定版),无需处理预发布优先级排序。
 * @param {string} a
 * @param {string} b
 * @returns {-1|0|1}
 */
function compareVersions(a, b) {
  const norm = (v) =>
    String(v).split("-")[0].split(".").map((n) => parseInt(n, 10) || 0);
  const [a1, a2, a3] = norm(a);
  const [b1, b2, b3] = norm(b);
  if (a1 !== b1) return a1 > b1 ? 1 : -1;
  if (a2 !== b2) return a2 > b2 ? 1 : -1;
  if (a3 !== b3) return a3 > b3 ? 1 : -1;
  return 0;
}

// 用法:latest 比 current 新 → 提示升级
// if (compareVersions(latest, current) === 1) { ...提示... }
```

要点:
- **0.x 不需要特殊处理**:三段数值比较对 `0.1.0` vs `0.2.0` 同样正确(`0===0` 后比 minor `1<2`)。0.x 的「次版本即破坏性」是发布语义,不影响「谁更新」的判断。
- **预发布后缀靠「比较 latest dist-tag」规避**:这是最省力的正确做法。若坚持要对完整 semver 排序(含 `-beta.8` < release 的优先级规则),那才需要 semver 库;本场景不需要。
- 本仓已有先例:`src/lib/variant.js` 也是「自己拆版本号、先剥 `-beta.x` 后缀再比数值」(spec `config-and-state.md` 记载「次版本会先剥掉 `-beta.x` 后缀」),新比较函数与该惯例一致。

来源:
- npm `dist-tag` / latest 语义:预发布版默认不进 latest(https://docs.npmjs.com/cli/v10/commands/npm-dist-tag 与 https://docs.npmjs.com/about-semantic-versioning)
- 本仓 `src/lib/variant.js` + spec `.trellis/spec/cli/config-and-state.md:50-53`(已有「剥 -beta.x 再比数值」先例)

---

## 3. 超时与容错(AbortController + 静默跳过)

惯例写法已在 §1b 骨架里给出,要点拆解:

- **超时**:`const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 2500);` 把 `ac.signal` 传进 `fetch(url, { signal })`;`finally` 里 `clearTimeout(t)` 防止句柄泄漏(否则进程可能被 timer 拖住不退出)。2–3s 是社区常见区间;init/update 本就是重操作,2.5s 探测可接受。
- **「一律静默跳过」的三道防线**:
  1. `!res.ok`(非 200,如 404/5xx)→ `return null`;
  2. `catch {}` 兜住:abort 触发的 `AbortError`、DNS/离线的 `TypeError: fetch failed`、`res.json()` 解析异常;
  3. 字段缺失/类型不对(`typeof json.version !== "string"`)→ `return null`。
- **不抛错到主流程**:整个检测函数对外永远 resolve(`string|null`),命令层 `const latest = await fetchLatestVersion(); if (!latest) return;`——拿不到就当没这回事,继续 init/update。这与本项目 spec「版本/装饰类读取失败一律降级,不影响主输出」「figlet/git 读取失败必须 try/catch 降级」的既有约定完全一致(cli-output.md / config-and-state.md)。
- **可选**:给 fetch 也可设 `keepalive` 无意义(短命进程),不必加。`User-Agent` 头可省略,registry 不强制。

来源:
- AbortController + fetch 超时是 Node/Web 标准模式(https://developer.mozilla.org/en-US/docs/Web/API/AbortController + https://nodejs.org/api/globals.html#class-abortcontroller)
- 本仓 spec `.trellis/spec/cli/cli-output.md:88`(「让 figlet/git 读取失败抛到主流程 → 这类装饰性/可选信息必须 try/catch 降级」)

---

## 4. npx 场景识别(npx 跑的永远是最新版,应跳过检测)

实测与源码核对得到的可靠性排序:

### 方法 A:执行路径含 `_npx`(最可靠,推荐)

npx 会把临时包装到缓存目录 **`~/.npm/_npx/<hash>/node_modules/...`**(本机已确认 `~/.npm/_npx` 目录存在),实际跑的 bin 路径里含 `_npx` 片段。ESM 下用 `import.meta.url`(本项目 `paths.js` 已是这套)拿到当前模块路径,或检查 `process.argv[1]`:

```js
import { fileURLToPath } from "node:url";
const selfPath = fileURLToPath(import.meta.url);
const viaNpx = selfPath.includes("/_npx/") || selfPath.includes("\\_npx\\")
            || String(process.argv[1] || "").includes("_npx");
```

可靠性:**高**。这是「包从哪被执行」的物理事实,跨平台一致(Windows 缓存也在 `%LocalAppData%\npm-cache\_npx` 或 `~/.npm/_npx`,均含 `_npx`)。

### 方法 B:`process.env.npm_config_user_agent`(辅助,单独不足)

实测(本机 npm 10.9.4):
- 直接 `node script.js`(全局直跑):`npm_config_user_agent` = **undefined**。
- `npm run <script>`:`= "npm/10.9.4 node/v22.21.1 linux x64 workspaces/false"`,`npm_command = "run-script"`。
- npx / `npm exec`:同样以 `npm/...` 开头,但 `npm_command = "exec"`。

可靠性:**中等,且单独不可靠**。`update-notifier` 依赖的 `is-npm@6.1.0` 源码:

```js
export const isNpm = Boolean(userAgent?.startsWith('npm')) || ...
```

——它只判断「是不是 npm 在跑」(npm script / npx 都算),**根本不区分 npx**,而全局安装后直跑 bin 时 `npm_config_user_agent` 是 undefined。所以 UA 能告诉你「不是裸跑而是经 npm/npx 启动」,但要专门识别 npx,应配合 `npm_command === "exec"` 或回到方法 A 的路径判断。

### 推荐组合

```js
/** 判断当前是否经 npx 执行(经 npx 跑的就是临时最新版,应跳过版本检测)。 */
function isRunningViaNpx() {
  const selfPath = fileURLToPath(import.meta.url);
  if (selfPath.includes("_npx")) return true;                  // 最强信号
  if (process.env.npm_command === "exec") return true;          // npm exec / npx
  return false;
}
```

> 全局安装直跑(`flower-trellis`/`ftl`/新短命令)时两者都为否 → 正常做检测;npx 时命中 `_npx` → 跳过。spec `prd.md` 的 Assumptions 已明确「npx 运行本身就是最新版,检测无意义,应跳过」。

来源:
- 本机实测 `npm_config_user_agent` / `npm_command`(node 22, npm 10.9.4)+ 确认 `~/.npm/_npx` 目录存在,2026-06-08
- `is-npm@6.1.0/index.js` 源码(实测 `npm pack` 解包,证明它不检测 npx)
- npx 缓存目录 `_npx` 约定(https://docs.npmjs.com/cli/v10/commands/npx + https://github.com/npm/cli 的 exec 缓存实现)

---

## 5. 检测到新版本后的「自升级」处理模式(关键设计点)

三种业界模式对比:

### (a) 仅打印通知 + 升级命令,不自动执行

```
🌸 发现新版本 flower-trellis 0.2.0(当前 0.1.0)
   升级:npm i -g flower-trellis@latest
```

- 优点:**零风险、零权限问题、跨平台无差异、实现最简**(就是几行 console.log)。这是 update-notifier 的默认行为,也是绝大多数 CLI 的兜底。
- 缺点:用户要手动复制命令、退出、重跑,体验最被动。
- 实现复杂度:**极低**。

### (b) 交互确认 → `npm i -g pkg@latest` → re-exec 当前命令让新版本接管

- 优点:体验最丝滑(确认后无感升级并继续原命令)。
- 缺点 / 坑(**很多**):
  1. **全局安装权限**:`npm i -g` 写全局 prefix(`/usr/local/lib/node_modules` 等),非 nvm/非用户级 prefix 环境下**常 EACCES,需 sudo**。CLI 不应、也无法替用户提权;一旦失败 re-exec 链就断在中间,状态尴尬。
  2. **Windows 兼容**:`npm` 实为 `npm.cmd`,`spawnSync` 需 `shell: true` 或显式调 `npm.cmd`;`execvp`(进程替换)在 Windows 上**不存在**(Node 无 `execvp`,只能 spawn 新进程),re-exec 只能靠「spawn 新 bin + 自己退出」模拟,无法真正「替换」。
  3. **当前进程已加载旧代码**:升级只换了磁盘上的文件,**当前 Node 进程内存里仍是旧模块**,必须重新启动新进程才能用上新版本——所以「re-exec」本质是「spawn 一个全新的 node 跑新 bin」,不是热替换。
  4. **新 bin 路径定位**:升级后要找到刚装的新版本 bin 再 spawn,涉及解析全局 prefix(`npm root -g` / `npm bin -g`),又多一层易错点。
  5. **node-pty 叠加**:本项目 init/update 还要再 `runTrellisPty` 起 pty 子进程,如果外层又套一层 re-exec,进程树和 TTY 转发会更难调。
- 实现复杂度:**高**,且失败分支多。

  Node 里 re-exec 的常见手法(供参考,不推荐在本项目用):
  ```js
  import { spawnSync } from "node:child_process";
  // 1) 升级
  const up = spawnSync("npm", ["i", "-g", "flower-trellis@latest"],
    { stdio: "inherit", shell: process.platform === "win32" });
  if (up.status !== 0) { /* 失败 → 降级为模式 a 打印命令 */ }
  // 2) 用新版本重跑当前命令(Node 无 execvp,只能 spawn 新进程后自己退出)
  const re = spawnSync(process.execPath, [/* 新 bin 路径 */, ...process.argv.slice(2)],
    { stdio: "inherit" });
  process.exit(re.status ?? 0);
  ```
  > 真正的「进程替换」(`execvp`/`execve`)Node 标准库**不提供**,需 `kexec` 等原生模块,跨平台差、不建议为此引依赖。

### (c) 交互确认 → 执行升级 → 退出并提示用户重跑(**推荐**)

```
🌸 发现新版本 0.2.0(当前 0.1.0),是否现在升级?(Y/n)
  ✓ 已升级到 0.2.0,请重新运行 flower-trellis <command>
```

- 优点:拿到了「自动执行升级」的便利,又**绕开了 re-exec 的全部坑**(不用定位新 bin、不用处理进程替换、不用担心旧代码继续跑)。升级失败时干净降级为模式 (a)(打印手动命令)。
- 缺点:用户要手动重跑一次命令(但只一次,且有明确提示)。
- 实现复杂度:**中**(inquirer 确认 + `spawnSync('npm', ['i','-g', ...])` + 根据 status 决定退出/降级)。
- 权限失败处理:`npm i -g` 若 EACCES,`spawnSync` 返回非 0,此时**不要 sudo**,降级打印「请手动运行 `sudo npm i -g flower-trellis@latest` 或在用户级 prefix 下重试」。

### 推荐结论

**主路径用 (c),失败兜底用 (a),不做 (b)。** 理由:本项目强调「尽力而为、绝不阻断主流程」,(b) 的 re-exec 引入的权限/平台/进程态风险与这一基调冲突;(c) 在体验和稳健性间取得最佳平衡,且实现量小、失败分支可控。

来源:
- `npm i -g` 全局权限 / EACCES 是公认痛点(https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally)
- Node 无 `execvp`、Windows 需 `npm.cmd` / `shell:true`(https://nodejs.org/api/child_process.html#child_processspawnsynccommand-args-options)
- update-notifier 默认即「仅打印」模式 (a)(https://github.com/yeoman/update-notifier#readme)

---

## 6. 非交互(`-y`)/ 非 TTY / npx 场景的降级

惯例:**无法弹确认时,降级为「仅打印一行通知 + 升级命令,不阻塞、不弹任何 prompt」**(即模式 a),而**不是完全跳过**——用户仍应被告知有新版本可用,只是不主动打断。

判定与本项目现有惯例对齐:
- `-y` / `--yes`:`init.js` 已通过 `passthrough.includes("-y") || passthrough.includes("--yes")` 识别非交互;此时**不调 inquirer**,直接打印通知行。
- 非 TTY:`pick-platforms.js:41` 已有先例 `if (!process.stdin.isTTY) return 默认`——版本检测应同样判 `process.stdin.isTTY`,非 TTY 时只打印不弹确认。
- npx(见 §4):本身就是最新版,**完全跳过检测**(连通知都不打,避免误导)。

降级决策表(建议在 update-check 模块里实现):

| 场景 | 是否检测 | 发现新版本时的行为 |
|---|---|---|
| 全局直跑 + 交互 TTY | 是 | 模式 (c):弹确认 → 升级 → 提示重跑 |
| 全局直跑 + `-y` / 非 TTY | 是 | 模式 (a):仅打印通知 + 升级命令,不阻塞 |
| npx 运行 | **否** | 不打印(已是最新版) |
| 离线 / 超时 / 非 200 | 检测失败 | 静默,什么都不打印 |

来源:
- 本仓 spec `.trellis/spec/cli/cli-output.md:74-82`(Interactive vs Non-Interactive:非 TTY 必须有回退、`-y` 走默认并打印说明)
- 本仓 `src/lib/pick-platforms.js:41`、`src/commands/init.js:27-44`(现有 `-y`/非 TTY 降级先例)
- prd.md Assumptions:「非交互(-y)场景无法弹确认,需有降级行为(仅提示/跳过)」

---

## 对本项目的落地建议

### 在 cli.js 主流程哪个时机插入检测

- **不放在 cli.js 顶层**:`-v` / `-h` / 兜底透传不应触发网络检测(prd 明确只在 init/update 触发)。
- **放在 `init` / `update` 命令内、主操作之前**:具体位置——在 `printBanner(...)` 之后、`runTrellisPty([...])` 之前 `await checkForUpdate(ctx)`。理由:
  - banner 已打印,通知行紧随其后视觉连贯;
  - 在 pty 子进程启动前完成,避免与 node-pty 的 TTY raw 模式 / stdin 转发抢输入(inquirer 确认必须在进入 pty 之前做);
  - init/update 是重操作,2.5s 探测不显著影响体感。
- `init` 与 `update` 共用同一个检测入口(同一函数),避免两处复制。

### 推荐的自升级模式

**模式 (c)**:交互 TTY 下 inquirer 确认 → `spawnSync('npm', ['i','-g','flower-trellis@latest'], { stdio:'inherit', shell: win32 })` → 成功则**打印「请重新运行」并 `process.exit(0)`**;失败则降级为模式 (a) 打印手动升级命令。`-y` / 非 TTY 降级为模式 (a)(仅打印);npx 跳过。**不实现 re-exec**。

### 需要新增哪个 lib 文件

新增 **`src/lib/update-check.js`**(命名导出、中文 JSDoc,沿用 module-guidelines 约定),建议导出:

| 导出 | 职责 |
|---|---|
| `fetchLatestVersion()` | `fetch` registry `/flower-trellis/latest` + AbortController 2.5s 超时,失败返回 `null`(§1b/§3) |
| `compareVersions(a, b)` | 三段数值比较,先剥预发布后缀(§2) |
| `isRunningViaNpx()` | `import.meta.url` 含 `_npx` 或 `npm_command==='exec'`(§4) |
| `checkForUpdate(ctx)` | 编排:npx → 跳过;取 latest → 比 `flowerVersion()`;有新版 → 按 TTY/`-y` 走模式 (c) 或 (a)(§5/§6) |

复用现有资产:`flowerVersion()`(`src/lib/versions.js`,取本地版本)、`inquirer`(已是依赖,做确认)、`chalk`(着色通知)、cli-output spec 的 `·`/`✓`/`🌸` 前缀与中文文案风格。`init` / `update` 命令各加一行 `await checkForUpdate(ctx)`。检测涉及的常量(包名 `flower-trellis`、registry URL、超时 ms)按 config-and-state spec 倾向,可考虑收敛进 `src/constants.js` 或留在 update-check.js 局部常量(单文件使用,不跨模块共享,留局部即可)。

> 与 spec 一致性:本方案全程「尽力而为、失败静默降级」,不落用户级缓存文件(不引 configstore),不新增运行时依赖,符合 module-guidelines / config-and-state / cli-output 的现有约定。

---

## Related Specs

- `.trellis/spec/cli/module-guidelines.md` — ESM/命名导出/`node:` 前缀/`import.meta.url` 定位/JSDoc 约定(新 lib 必须遵循)
- `.trellis/spec/cli/cli-output.md` — 进度行前缀语义、错误处理、交互 vs 非交互回退(`isTTY` / `-y`)
- `.trellis/spec/cli/config-and-state.md` — 版本读取容错降级、常量收敛 `constants.js`、`variant.js` 的「剥 -beta.x 再比数值」先例
- `.trellis/tasks/06-08-short-cmd-version-check/prd.md` — 本任务 PRD,含 Assumptions / Open Questions(本文逐条给了推荐结论)

## 涉及的内部文件(实现时会触及)

| 文件 | 用途 |
|---|---|
| `src/cli.js` | 主入口;`-v`/`-h`/透传不触发检测,init/update 才触发 |
| `src/commands/init.js` | 在 banner 后、`runTrellisPty` 前插入 `await checkForUpdate(ctx)` |
| `src/commands/update.js` | 同上 |
| `src/lib/versions.js` | 已有 `flowerVersion()`(取本地版本),检测时复用 |
| `src/lib/pick-platforms.js` | 非 TTY 回退默认的现有惯例参照(`:41`) |
| `src/lib/paths.js` | `import.meta.url` 定位惯例参照(npx 路径判断同源) |
| `src/lib/update-check.js` | **建议新增**,见上表 |

## Caveats / Not Found

- 本机一次「真实 npx 跑本地 tarball」的探针未产生输出(沙箱里 npx 对 tarball 路径形式未执行 bin),但 `~/.npm/_npx` 缓存目录存在已确认 `_npx` 路径标记这一物理事实;`npm_config_user_agent` / `npm_command` 在 `npm run` 下的格式已实测确认。实现后建议在真实全局安装 + 真实 npx 两种环境各跑一次验证 `isRunningViaNpx()`。
- Windows 下 `npm i -g` 的具体路径与 `_npx` 缓存位置(`%LocalAppData%\npm-cache\_npx`)未在本机验证(本环境为 Linux/WSL),仅依据 npm 文档约定;`spawnSync('npm', ...)` 在 Windows 必须 `shell:true` 或调 `npm.cmd`,实现时需平台分支。
- update-notifier 的传递依赖精确数量(整棵树)未逐层展开;给出的是直接依赖 10 个 + 已知重型项(semver/boxen/configstore)。
- 未实测「本包在 EACCES 全局 prefix 下 `npm i -g` 的失败码」,§5 的降级建议基于 npm 公认行为与文档。
