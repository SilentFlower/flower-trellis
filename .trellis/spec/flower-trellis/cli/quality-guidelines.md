# Quality Guidelines

> 必守模式、禁用模式、测试现状与评审清单。

---

## Overview

flower-trellis 是装在别人项目上、会动其文件的工具,因此质量底线集中在三点:
**幂等**(可重复执行)、**不误伤**(只动自己铺的文件)、**容错降级**(装饰/可选环节失败
不拖垮主流程)。同时严格对齐上游 skill-garden / Trellis。

---

## Required Patterns

- **幂等**:所有写盘/叠加操作可重复执行而结果一致(覆盖式拷贝、内容相同不写盘、
  备份只建一次)。详见 [enhancements-model](./enhancements-model.md)。
- **精确清理**:删除目标文件只依据 manifest 记录的精确 `paths`、强化清单里**名字精确
  匹配**的条目，或已登记场景中带类型与真实路径复核的严格名称契约；升级备份清理见
  [Update Backup Retention](./config-and-state.md#scenario-update-backup-retention)。
- **容错降级**:非致命读取(figlet 字体、git user.name、version、manifest、目录列举)
  失败时 try/catch 返回中性值(`null` / `[]` / 占位串),不抛到主流程。
- **集中错误处理**:逻辑层 `throw new Error("中文原因")`,由 `cli.js` 顶层统一捕获并定退出码
  (见 [cli-output](./cli-output.md))。
- **忠实移植 + 溯源注释**:移植上游逻辑要保留出处注释并保持语义一致。
- **中文 JSDoc**:每个导出函数/模块都有中文文档注释。

---

## Forbidden Patterns

| 禁用 | 原因 |
|------|------|
| 凭猜测删除目标文件 | 只能按 manifest、强化清单或已登记的严格路径契约删除,绝不误伤用户文件 |
| 非幂等的写盘逻辑 | 升级/重装会产生残留或重复注入 |
| 让装饰性环节(banner / git 读取)抛错中断主流程 | 必须 try/catch 降级 |
| `require` / `__dirname` / default export | 纯 ESM,见 [module-guidelines](./module-guidelines.md) |
| 为小功能引入重依赖(如 commander) | 保持 KISS:argv 在 `src/lib/cli-args.js` 里手解析,依赖维持精简 |
| 用经典 `inquirer` 做交互 prompt | WSL/ConPTY 下整屏重绘闪屏,改用 `@inquirer/prompts`,见 [module-guidelines](./module-guidelines.md) |
| 把 flower 自有 flag 透传给 trellis | 必须在 `OWN_FLAGS` 登记并由 `parseCliArgs()` 消费 |
| 改移植逻辑而不核对上游 install.sh | 会导致升级行为与 skill-garden 漂移 |

---

## Testing

- 本项目使用零第三方测试基础设施：JavaScript 用 Node 内置 `node:test`，Python 用
  `unittest`，统一入口为 `npm test`。不要引入 Jest/Vitest/Pytest 等重依赖，除非另有明确决策。
- **跨平台 CI 验收门禁**：新增或修改 Python/Node/Shell 脚本、CLI 指令、Hook、模板中的可执行命令，
  或影响其运行的解释器、路径、编码、换行、原生依赖与安装/生成配置时，必须为受影响行为提供
  GitHub Actions 回归并验证通过。至少覆盖原生 `ubuntu-latest` 与 `windows-latest`；Python 沿用
  `python-compatibility.yml` 的 3.8/3.12 矩阵，SessionStart 改动同时验证 `session-start.yml`。
  涉及其它声明支持的平台或运行时版本时补充相应覆盖；不能从未执行的平台推断兼容。
  新增入口须核对 workflow 的 `paths` 触发条件和实际测试清单，缺少覆盖时随实现补齐。
  提交前完成本地验证，推送后等待对应变更提交的必需 job 全部 `success`，才可标记任务完成、合并或发布；
  CI 未触发、排队、运行中、失败或取消均不得报告兼容验收通过。保留 run 链接、`headSha`、矩阵结果
  和 skip 原因；后续修改代码或运行配置须重新验证新提交，旧提交绿灯与本地模拟不能替代。
  目标行为的回归用例必须实际执行，不能靠 skip、删除矩阵或 `continue-on-error` 获得表面绿灯；
  平台专属场景的合理跳过须明确理由，受权限限制的必需场景须补齐可执行 runner 后再验收。
  例如 Windows 命令修复应在原生 Windows runner 实际启动命令并断言输出；仅 Linux 测试通过不满足门禁。
- `npm test` 同时运行 Flower 全平台双 catalog Patch 冲突门禁、Skill-Garden canonical compiled targets 零漂移检查和默认 AI context budget checker；冲突 warning/大小超限只告警，结构错误、compiled 漂移与 conflict error 失败。
- 提交前执行**自动测试 + 语法校验 + dogfood 手测**:

  ```bash
  npm test
  node --check src/cli.js            # ESM 语法
  node --check scripts/extract-changelog.mjs
  node --check scripts/write-release-notes-metadata.mjs
  python3 -m py_compile src/assets/flower_update_hook.py
  python3 -m py_compile .trellis/scripts/flower_update_hook.py
  flower-trellis init   --target ./test-target -y
  flower-trellis update --target ./test-target -y --dry-run
  flower-trellis uninstall --target ./test-target --dry-run
  ```

  `test-target/`、`.trellis-tmp/` 已在 `.gitignore` 中,可作本地目标。
- 改动叠加逻辑后,记得 `npm run sync` 重建 `enhancements/` 快照再验证。
- 改动 Skill-Garden Patch catalog、顺序、policy 或 pinned Trellis 结果后，运行 `npm run patch:targets` 刷新子仓 canonical target 层，再用 `npm run patch:targets:check` 验证零漂移。Flower adapter/平台 catalog 改动由全平台冲突门禁覆盖，不生成可提交 matrix。
- 改动 Flower 命令帮助时，用真实 CLI 在不存在的 `--target` 和隔离用户配置目录运行帮助矩阵，
  断言退出码 `0`、stderr 为空且零写入；同时检查帮助分支先于联网、写盘、prompt 和子进程入口。
- 改动 Trellis Python 查询/helper 契约时，分别覆盖正常空状态、唯一/歧义任务引用、越界路径、
  自动机械字段与显式非法字段，不能只断言成功路径。
- 发布审计需要严格预算时显式运行 `node scripts/check-ai-context-budget.mjs --strict`；
  strict 不属于默认大小门禁。

---

## Code Review Checklist

- [ ] 写盘/叠加操作幂等?重复跑一次结果一致、无重复注入?
- [ ] 删除逻辑只动 manifest / 强化清单 / 已登记严格契约允许的精确路径?
- [ ] 装饰性 / 可选读取都有 try/catch 降级?
- [ ] 错误是 `throw new Error("中文")` 交顶层处理,而非深层 `process.exit`?
- [ ] 新增自有 flag 同步更新了 `OWN_FLAGS` 与 `cli-args.js parseCliArgs()`?
- [ ] 移植自上游的逻辑保留了溯源注释、与 install.sh 一致?
- [ ] 导出函数有中文 JSDoc(`@param` / `@returns`)?
- [ ] 纯 ESM(`node:` 前缀、命名导出、相对 import 带 `.js`)?
- [ ] 输出前缀符号沿用既有语义(`✓` / `·` / `❌` / `🌸`)?
- [ ] `-h/--help` 是否在目标校验、联网、写盘、prompt 和子进程之前返回 0?
- [ ] 查询型空状态是否返回 0 并用结构化字段表达，写入型错误仍保持非零?
- [ ] `npm test` 通过，context budget warning 已审阅且没有通过调高阈值掩盖重复内容?
- [ ] 跨平台脚本/指令改动已有对应 GitHub Actions 覆盖，匹配变更提交的必需矩阵全部成功，目标行为未被 skip 掩盖?
- [ ] `check-patch-conflicts` 覆盖全部声明 target，旧互斥协议未复现，vendor/snapshot overrides 一致?

---

## Scenario: Python Cross-Platform Runtime And Verification

### 1. Scope / Trigger

修改 Python 运行脚本、Hook、Node 到 Python 的启动入口、测试夹具或 compiled targets 生成器时适用。
支持基线为 Python 3.8+；本地回归至少区分原生 Windows 3.8 与 Linux 3.12。
安装到目标项目的命令文本继续遵守 [Target Python Command Materialization](./trellis-patch-engine.md#scenario-target-python-command-materialization)，不能用开发机探测结果改写 canonical 文本。

### 2. Signatures

```text
scripts/python-runtime.mjs:
  resolvePythonExecutable({ env = process.env, platform = process.platform, probe = spawnSync } = {}) -> string
  execPythonSync(args, options = {}) -> string | Buffer
  spawnPythonSync(args, options = {}) -> subprocess result
node scripts/run-python-tests.mjs [test/python/test_<name>.py ...]
common._configure_stream(stream: object) -> object
```

### 3. Contracts

- Python 内部调用 Python 使用 `sys.executable` 的 argv；明确为 UTF-8 的子进程协议同时设置
  子进程 `-X utf8` 与父进程 `encoding="utf-8"`。不能依赖 PATH 中存在 `python3`，也不能只改父进程解码。
- Node 开发入口先取 `FLOWER_TEST_PYTHON || PYTHON`；未覆盖时 Windows 按 `python`、`py -3`、
  `python3` 探测，其它平台按 `python3`、`python` 探测。候选须实际运行、满足 3.8+ 并返回
  `sys.executable`；显式覆盖无效时失败，不偷偷回退。现存可执行文件路径整体传入，保留空格；
  命令形式交给 `trellisPythonInvocation()` 拆分。两个执行 wrapper 在进程内缓存解释器并添加 `-X utf8`。
- 测试入口用 argv 传递 `unittest discover -s test/python -p test_*.py`，不经过 shell 引号或 glob；
  显式测试路径转模块名，并将绝对 `test/python` 加入 `PYTHONPATH`，避免 Windows 自带 `test` 包遮蔽。
  入口固定 `FLOWER_NO_TELEMETRY=1`；专项仅使用隔离目录和本地替身。
- CI 用 `npm ci --ignore-scripts` 安装依赖后，真实 Flower CLI 测试前必须执行 `npm rebuild node-pty`；
  否则 Linux 干净环境可能缺少 `pty.node`。只构建该依赖，保持项目全局同步 postinstall 不执行。
- GitHub Actions 中只要测试或生成步骤读取 `vendor/skill-garden/**`，`actions/checkout` 就必须设置
  `submodules: recursive`。开发机已有子模块不能证明干净 Runner 可读取 compiled targets 或作者源。
- 兼容矩阵的 `FLOWER_TEST_PYTHON` 固定为 `setup-python` 的 `python-path` 输出；上游 init 不读取它，
  另在 job env 设置 `TRELLIS_PYTHON_CMD: ${{ matrix.os == 'windows-latest' && 'python' || 'python3' }}`。
  后者使用上游支持的显式命令覆盖，实际测试仍运行矩阵版本；不修改上游默认要求 3.9+ 的探测策略。
- Flower 与 Skill-Garden 两仓 `.gitattributes` 均使用 `* text=auto eol=lf`，保证 Windows
  `core.autocrlf=true` 检出时 selector、baseline、快照与 compiled 文本仍为 LF，二进制字节不变。
  不放宽 Patch 精确匹配来补偿检出差异；子仓现有 diff sidecar `-whitespace` 规则继续保留。
- Python 3.8 不使用 `str.removeprefix`、`Path.is_relative_to` 或括号式多 context manager。
  完整前缀用 `startswith` 后切片；路径包含关系用 `relative_to` 捕获 `ValueError`，仍保留调用处的
  `resolve`、软链拒绝和会话绑定校验。不能用字符串前缀近似路径包含关系。
- 跨平台测试模拟 Windows 缺失的 `os` 属性时，`mock.patch.object` 必须使用 `create=True`；否则测试
  会在进入被测逻辑前因属性不存在而报错。产品代码仍通过 `getattr(..., None)` 与 `callable` 判断能力。
- Windows 共享流和 subagent Hook 只对可调用的 `reconfigure` 尝试 UTF-8，容忍 `OSError` /
  `ValueError`；内存流原样保留，不 `detach`、不关闭、不替换调用方持有的流。
- 遥测 `.cmd` / `.bat` 使用绝对 `COMSPEC` 或 `SystemRoot/System32/cmd.exe`，参数为
  `/d /v:off /s /c`；入口和 target 分别通过带引号的 `%FLOWER_ACTIVITY_HOOK_CLI%`、
  `%FLOWER_ACTIVITY_HOOK_TARGET%` 环境占位符传递。保留 `%`、`!`、`&`、`^`、中文和空格，
  不把实际路径直接拼入 shell 命令。非 CMD/BAT 保持 argv；失败静默，超时仍为 3 秒。
- Git 子仓路径使用 `git rev-parse --show-toplevel`，不使用 MSYS `pwd` 的 `/c/...` 或 `/tmp/...`
  作为原生 Windows pathlib 路径。测试中比较 Windows 短名与长名目录使用 `fs.realpathSync.native`。
- legacy manifest 夹具中，`targetRoot` 与 `links[].target` 必须使用同一父目录规范化结果：
  `str(linked.resolve() / relative)`。`target.absolute()` 可能保留 Windows 8.3 短名，
  `target.resolve()` 又会跟随最终受管软链，两者都不能替代该写法；产品严格 manifest 校验不因此放宽。
- Skill-Garden compiled targets 生成时固定 `TRELLIS_PYTHON_CMD=python3`，文本明确写 LF；
  Windows/Linux 生成物须逐字节一致。作者源 → Patch/compiled targets → 快照 → Plugin 投影保持原分发链。

### 4. Validation & Error Matrix

| 条件 | 预期行为 |
| --- | --- |
| WindowsApps 占位别名返回 9009 | 不选中；无显式覆盖时继续探测下一候选 |
| 显式解释器无效、低于 3.8 或全部候选失败 | 抛出找不到 Python 3.8+ 的错误，测试入口非零退出 |
| PATH 无 Python，但当前 Python 正在运行 | 内部 route/auto-loop 调用仍成功，中文 JSON 不损坏 |
| StringIO、已关闭流或不可重配置流 | 不 detach、不丢正文、不因初始化破坏宿主流 |
| CMD 处理器缺失或非绝对路径 | 遥测 Hook 静默退出；不得用不可信相对处理器代替 |
| 路径越界、软链绕过、损坏会话 | 保持原拒绝/诊断语义，不能为兼容而放宽 |
| Windows 创建软链报 WinError 1314 | 仅跳过该能力依赖的子场景；其它错误继续失败 |
| compiled targets 受平台命令或换行影响 | 零漂移门禁失败，不更新基线掩盖平台差异 |
| Python 3.8 矩阵只设置 FLOWER_TEST_PYTHON | 上游 init 仍可能按默认 3.9+ 探测拒绝；须补矩阵命令覆盖 |
| core.autocrlf=true 的真实 Git 检出 | 文本保持 LF，二进制原字节不变，Patch 预检仍按精确原文执行 |
| workflow 读取子模块文件但 checkout 未启用 submodules | 干净 Runner 缺少目标文件并失败；递归检出后再运行测试 |
| Windows 测试直接 patch 不存在的 `os` 属性 | mock 初始化失败；使用 `create=True` 后验证产品降级分支 |

### 5. Scenarios and Examples

- Normal：Windows 仅有有效 `python.exe`，Node 探测后启动其绝对路径；route/auto-loop 子调用继续使用
  同一解释器，中文任务和会话标识完整往返。
- Base：宿主用 StringIO 捕获 Hook 输出；初始化返回原对象，已有内容仍可读，流仍打开。
- Incorrect use：`subprocess.run(["python3", helper], text=True)` 在 Windows 可能命中失效别名且按本地代码页解码。
  对输出 UTF-8 的 Python helper 应使用：

  ```python
  subprocess.run([sys.executable, "-X", "utf8", helper], text=True, encoding="utf-8")
  ```

- Incorrect use：`name.lstrip("DEC-")` 会删除字符集合，破坏日志编号；改为
  `name[len("DEC-"):] if name.startswith("DEC-") else name`，只删除完整前缀。
- Incorrect use：只在父仓设置 LF，或把上游初始化版本拒绝视为 Python 套件失败；应分别约束两仓检出，
  并区分初始化命令覆盖、实际测试解释器和 canonical 产物命令这三个边界。
- Incorrect use：本地子模块已初始化便省略 CI checkout 配置，或直接 patch Windows 不存在的
  `os.fchmod`。应让 workflow 递归检出子模块，并用 `mock.patch.object(..., create=True)` 构造缺失能力。
- 边界证据：受控 CP936 测试只能证明指定编解码边界；不能冒充本机默认代码页或真实 Codex/Claude 会话加载。
  语法扫描也不能替代实际运行，括号式 `with` 在 3.8 可能解析成功却在运行时报错。

### 6. Tests Required

- `test/js/python-runtime.test.js`：断言候选顺序、失效别名排除、显式覆盖与 argv 边界。
- `test/js/checkout-line-endings.test.js`：读取两仓实际 attributes，用临时 Git 仓库在
  `core.autocrlf=true` 下真实 add/checkout，逐字节比较 selector、baseline、Patch/compiled 样本及二进制。
  同时运行 `trellis-0614-upstream.test.js`，验证矩阵初始化和增强预检，不以只检查 attributes 字符串代替。
- `test/python/test_python_compatibility.py`：无 PATH 别名仍能启动 helper，中文 JSON 在受控 CP936 下
  往返，路径包含正反例，真实流/StringIO/关闭流所有权与 subagent 标题生成。
- `test_flower_telemetry_hook.py`：原生 Windows CMD 特殊路径与完整 argv、禁用零调用和缺失 home 降级；
  `test_git_evidence.py`：真实中文空格子仓路径；`test_task_start_brief_gate.py`：两平台真实生命周期 Hook。
- 顺序回归同时运行 auto-loop 与 task-intent，确保临时模块缓存和 `sys.path` 恢复，不指向已删除夹具目录。
- 原生依赖安装问题须用干净依赖目录复现并复验真实 CLI；不能只使用维护者已经构建的 node_modules。
  短名路径问题须以原生 Windows 路径校验为证据；权限隔离探针不能冒充真实软链迁移回归。
- `.github/workflows/python-compatibility.yml` 运行 Ubuntu/Windows × Python 3.8/3.12，包含受影响 Python、
  Node 启动入口、compiled targets 与 strict budget。明确区分 CI 配置、实际 job、实机、模拟与条件 skip；
  Linux skip 不作 Windows 通过证据，局部复验不声称完整套件重跑全绿。
- 读取 `vendor/skill-garden` 的专项 workflow 必须在干净 Runner 检出子模块；平台能力缺失测试应断言
  被测逻辑实际执行完成，不能让 mock 自身的属性错误替代产品行为验证。
