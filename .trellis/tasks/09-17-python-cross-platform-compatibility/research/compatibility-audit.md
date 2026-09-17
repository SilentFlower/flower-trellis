# Python 跨平台兼容审计

## 基线与方法

- Flower HEAD：0ea9f4d；源码 /root/project/flower-trellis。
- 原生 Windows：C:\Users\SilentFlower\AppData\Local\Programs\Python\Python38\python.exe，3.8.10。
- 77 个生产资产/runtime/Hook/tests/route Python 文件以 Windows 3.8 compile() 检查，不写 pyc。
- 部署路径补查 E:\tt；实验仅在 tempfile 隔离目录写入，遥测使用本地 CMD/Node argv 记录替身。

## 已复现

| ID | 位置 | 条件与证据 | 责任源 |
| --- | --- | --- | --- |
| CP-01 | .trellis/scripts/auto_loop.py:295,3886 | 3.8 路由 helper 抛 WindowsPath 无 is_relative_to；后续 containment 同 API | Skill-Garden scripts |
| CP-02 | auto_loop.py:309,1352；.agents/skills/trellis-route/scripts/route_state.py:128 | python3 --version 退出 9009，会话 key helper 无覆盖时返回 None；E:\tt 仍含硬编码 | Skill-Garden scripts/两平台 route |
| CP-03 | src/assets/flower_telemetry_hook.py:90 | 目录 project-%FLOWER_AUDIT_SEG%，变量值 expanded，CMD 接收 project-expanded | Flower 资产 |
| CP-04 | .trellis/scripts/common/__init__.py:20 | _configure_stream(StringIO()) 抛 UnsupportedOperation: detach；仅内存捕获流触发，不等于所有独立 Hook 失败 | 原生目标对应 Skill-Garden Patch |
| CP-05 | test/python/test_task_current_query.py:24 | Linux 2/2 通过，Windows 2/2 失败（9009）；9 个测试文件含同类 python3 调用 | Flower tests |
| CP-06 | .trellis/scripts/decision_log.py:322,324 | 临时任务首次追加 DEC-0001，第二次抛 str 无 removeprefix | Skill-Garden scripts |
| CP-07 | .trellis/scripts/pre_check_state.py:118 | session-corrupt 分支在 3.8 抛 removeprefix AttributeError | Skill-Garden scripts |
| CP-08 | test/python/test_flower_update_hook.py:129；test_session_context_update_markers.py:43 | 77 个文件仅这两项有 3.8 SyntaxError，括号式多 context manager 不兼容 | Flower tests |

## 扩大扫描待验证

- auto_loop.py:737/738/746 另有 removeprefix；替换须删除完整前缀，不能用 lstrip 字符集近似。
- npm test 固定 python3，unittest pattern 使用单引号；Windows CMD 不具备 Bash 的单引号语义。
- scripts/check-ai-context-budget.mjs、run-skill-garden-compiled-targets.mjs 与若干 JS tests 直接启动 python3。不能混淆执行 argv 与 canonical 模板文本。
- worktree_setup/task_intent/route_state/auto_loop 的部分 subprocess(text=True) 未显式编码；仅对明确 UTF-8 的子进程协议固定编码，Maven 等工具需按实际协议处理。
- 当前 Windows preferred encoding 为 cp65001，中文 Git 分支读回通过。编码疑点不是本机已复现故障，需受控 CP936 与 UTF-8 bytes 对照。
- 临时文件/替换/软链/UNC 继续审计，区分 Windows 权限能力前提与代码缺陷。

## 作者源与分发

.flower/state.json 记录共享脚本与 Flower 资产 ownership；.trellis/.template-hashes.json 记录 common/__init__.py 原生模板归属。Skill-Garden 源为 vendor/skill-garden/.trellis/0.6，enhancements/0.6 是快照，项目隐藏目录是部署产物。修改原生目标须经 Patch，不只改 dogfood 或 E:\tt。

## 实施中扩展发现

| ID | 实证与处理 |
| --- | --- |
| CP-09 | 原生 inject-subagent-context.py 的角色标题同样使用 removeprefix；通过 windows-streams Patch 修复，覆盖 Codex/Claude 及存在同一原生 Hook 的平台。 |
| CP-10 | Skill-Garden Python Patch consumer 的 skill alias 使用 removeprefix；修为完整前缀切片。 |
| CP-11 | git_evidence 的 submodule foreach pwd 在 Windows 返回 /tmp/...，Path.is_dir 为 False；git rev-parse --show-toplevel 返回 C:/... 且存在。改用 Git 原生路径输出，真实中文/空格子仓回归通过。 |
| CP-12 | compiled targets 生成器在 Windows 生成 python 文本而 policy 仍按 canonical python3 校验，实测冲突失败；固定 canonical 初始化覆盖，并显式写 LF，Windows 3.8 逐字节零漂移检查已通过。 |
| CP-13 | pre_check_state 测试的括号式 with 能被 3.8 parse，却在运行时产生 tuple.__enter__ 错误；改为兼容续行形式，不能只靠语法扫描认定兼容。 |
| CP-14 | Python 3.8 Windows 自带 test 包遮蔽仓库无 __init__ 的 test/python，显式测试路径导入失败；Node 测试入口加定向 PYTHONPATH 并转换模块名。 |
| CP-15 | Windows TEMP 返回 SILENT~1，Python resolve 输出 SilentFlower；Node realpathSync 仍保留短名，改用 realpathSync.native 验证同一目录，原生测试通过。 |
| CP-16 | Aliyun 测试清空环境后只保留 HOME，Windows Path.expanduser 需要 USERPROFILE；修测试夹具，不修改产品读取策略。 |
| CP-17 | 按特定顺序运行 auto-loop 与 task-intent 测试时，common 缓存指向已删除临时目录，报 No module named common.io；测试加载器恢复 sys.path 与依赖缓存，顺序回归通过。 |
| CP-18 | task start 门禁测试的生命周期 Hook 固定使用 POSIX touch，Windows CMD 找不到该命令；改用两边 shell 均支持的 echo 重定向标记，仍验证 Hook 真实执行。 |
| CP-19 | 首轮 CI 两个 Ubuntu job 均在真实 CLI 用例缺失 pty.node；npm ci --ignore-scripts 跳过原生依赖构建。隔离新目录复现同一失败，npm rebuild node-pty 后同一用例及全部 34 个 worktree 测试通过；CI 增加指定依赖构建步骤，不执行项目全局同步 postinstall。 |
| CP-20 | 首轮 CI 两个 Windows job 的 legacy 迁移用例失败；夹具 targetRoot 使用 resolve 后长名，links.target 使用 absolute 保留短名，与严格 manifest 合同不一致。原生 Windows 3.8、真实 SILENT~1 路径上复现 manifest invalid；只改夹具为已解析父目录加相对入口后为 ok，不跟随最终软链、不放宽产品校验。 |

## 审计边界

- 作者 scripts、两平台 route helper、Flower assets、项目 common/Hook、维护期 Python consumer/generator、全部 Python tests 与真实启动 Python 的 Node/npm 入口均已搜索。
- 当前 90 个完整 Python 文件用原生 3.8 AST 检查通过；Patch selector/content 是片段，不能当成独立程序编译。
- `mkstemp` 使用 fdopen 关闭后 os.replace，同目录原子替换保留；既有替换失败保持旧字节测试继续执行。未引入 NamedTemporaryFile 跨进程打开或替换仍打开句柄的写法。
- Windows 本机创建软链返回 WinError 1314（权限缺失）。测试只对该错误跳过相关软链子场景，普通路径/越界场景继续验证，Linux 保留真实软链拒绝回归；未启用开发者模式、未提升权限。
- Maven 原有主测试组使用 /bin/sh、POSIX Java 与 /tmp 路径，仅在 POSIX 执行；现有 WSL→Windows CMD 场景扩为原生 Windows 也执行，已实测 plan→run 成功。不是将 Windows Maven 功能整体跳过。
- UTF-8 JSON 适配器增加受控 CP936 默认解码测试，使用中文及非 CP936 字符往返；本机实际默认仍为 cp65001，二者证据分开记录。
- 原生 Windows 可通过 UNC 加载代码，但大量小文件回归较慢；另在 C: 隔离副本运行完整回归。没有将本轮未提交版本发布或覆盖全局 CLI。

## 验证结果（2026-09-17）

| 证据 | 结果 |
| --- | --- |
| Linux `npm test` | 退出 0；JS 579 项（577 通过、2 条件跳过），Python 379 项（1 条件跳过），Patch 冲突、compiled targets、预算、输出模板全部通过。 |
| 后续 Linux 定向复验 | auto-loop + task-intent 84 项通过；Patch consumer 24 项通过；兼容/遥测/pre-check/route/brief 44 项通过（1 Windows-only 跳过）。覆盖完整 npm test 后的测试隔离和平台前提修订。 |
| Windows 3.8 全套试跑 | 379 项，初次出现 13 个 WinError 1314 软链前提错误及 2 个 touch 夹具失败；没有把这一轮记录为全绿。全部失败根因已修复或精确标注前提，并由下面定向复验闭环。 |
| Windows 修复后定向复验 | auto-loop 边界 + pre-check/route/update/telemetry 43 项（4 软链条件跳过）；task-intent/worktree 46 项（6 软链条件跳过）；Patch consumer 24 项（3 软链条件跳过）；brief 12 项全过；导入顺序回归 13 项（1 软链条件跳过）。这些组有重叠，不相加冒充独立用例总数。 |
| Windows Maven | 55 项中原生 CMD plan→run 通过；53 个 POSIX shell 专项和 1 个 WSL 专属边界按平台跳过。Linux 全套继续执行 POSIX 和当前 WSL 可运行的场景。 |
| Windows Node | Python 启动器 3 项、Trellis 全平台/历史适配 2 项、Windows 物化安装幂等 1 项通过；原生遥测队列/断流/CMD/15 秒硬截止专项 1 项通过，发送仅用本地替身。 |
| 生成与安装 | Linux/Windows compiled targets 同为 891 文件、445 changed targets，逐字节无漂移；作者脚本、两平台 helper、快照与 dogfood 字节一致；Plugin 重复更新内容变更 0。 |
| 静态与预算 | 原生 Python 3.8 AST 90 文件通过；JS 语法和两个仓库 diff whitespace 检查通过；Linux/Windows strict context budget 通过。 |
| 首轮 CI | SessionStart run 35163638778 两系统通过；Python run 35163638789 四组合失败，每组运行 312 项，Ubuntu 每组 1 个原生依赖失败（skip 3），Windows 每组 2 个 legacy 夹具失败（skip 54）。详见 CP-19/20；追加补丁已推送，复验结果另列如下。 |

首轮 CI：[SessionStart](https://github.com/SilentFlower/flower-trellis/actions/runs/35163638778)、[Python 跨平台](https://github.com/SilentFlower/flower-trellis/actions/runs/35163638789)。

追加修复证据：Linux 干净源码/依赖目录 `/tmp/flower-ci-native-9WX5Jh`，只有 `npm ci --ignore-scripts` 时真实 CLI 用例失败；执行 `npm rebuild node-pty` 后同一用例通过（3.011 秒），完整 worktree 34 项通过（20.063 秒）。原生 Windows 同一 rebuild 命令退出 0。Windows 短名 manifest 探针仅以普通目录代替软链创建来隔离权限前提，执行真实 Path 规范化和生产 `_legacy_manifest` 校验，前后结果分别为 invalid/ok；它不冒充真实软链迁移全链路。YAML 步骤顺序和 diff whitespace 校验通过。

Windows 3.8 追加 worktree 回归：34 项，148.593 秒，OK（5 项受软链权限前提限制而跳过）；未将跳过的迁移用例计为原生软链迁移通过。追加补丁 Light Check-All 本地三维通过，复用原实现 Full 证据，并以依赖安装/夹具的定向证据覆盖本次差异；后续远端 CI 仍失败，不能以本地检查通过代替最终验收。

追加 Update-Spec 已将干净依赖目录的 `npm rebuild node-pty` 前提及 legacy manifest 父目录规范化写入 `quality-guidelines.md`。追加补丁已按确认范围提交推送；本段后续验证记录纳入同次批准的独立任务记录提交，任务保持 in_progress。

用户要求模拟剩余风险后，进一步在原生 Windows Python 3.8.10 与实际 8.3 短名 TEMP 下完成 5 项迁移场景，19.319 秒，全部通过且零跳过：正常迁移/幂等、不读取来源分支配置、目标 HEAD 缺入口拒绝、链接漂移拒绝、第二个入口移动失败后恢复原链接/manifest/来源正文。权限替代层只在隔离目录内将目录软链创建、识别和删除映射为真实 NTFS junction；Git、路径解析、迁移、os.replace、文件搬移和回滚执行原生代码。该结果是明确边界的模拟，不冒充原生符号链接或完整 CI；未修改产品代码、系统权限或全局配置。临时 harness：`C:\Users\SilentFlower\AppData\Local\Temp\flower-junction-simulation-c16GVf`。

## 追加补丁 CI 复验（2026-09-17）

复验对应已推送追加补丁，两个 workflow 的 headSha 均核对一致。[SessionStart run 35165807141](https://github.com/SilentFlower/flower-trellis/actions/runs/35165807141) 两系统通过；[Python run 35165807236](https://github.com/SilentFlower/flower-trellis/actions/runs/35165807236) 四组合全部结束，1 通过、3 失败。

| 组合 | Python 套件 | 后续步骤与结论 |
| --- | --- | --- |
| Ubuntu / 3.12 | 312 项通过，3 项条件跳过 | Node 入口、编译产物、上下文预算均通过，job 成功。 |
| Ubuntu / 3.8 | 312 项通过，3 项条件跳过 | Node 上游初始化用例失败：仅探测到 3.8，Trellis init 要求 >= 3.9；编译产物和预算未执行。 |
| Windows / 3.8 | 312 项通过，54 项平台条件跳过 | Node 上游初始化完成后，Flower Patch 预检发生多处 selector 零匹配及 fingerprint 漂移，错误码 PLUGIN_PATCH_POLICY_INVALID；编译产物和预算未执行。 |
| Windows / 3.12 | 312 项，2 失败、54 项平台条件跳过 | 两项 legacy 迁移仍失败：预期 needs-migration，实际 blocked；预期 migration-source-unavailable，实际 migration-not-available。后续 Node/编译/预算未执行。 |

CP-19 的原生依赖缺失已由四组 Python 套件的真实 CLI 用例闭环。CP-20 仅在 Windows 3.8 闭环，不能宣称 Windows 3.12 已修复。现有日志没有输出完整迁移诊断 payload，3.12 的精确拒绝原因仍待复现；Windows 3.8 Patch 预检的实际内容差异也待定位，不将换行、解释器或软链实现差异当作已证实根因。

Ubuntu 3.8 新失败已核对 `@mindfoldhq/trellis/dist/commands/init.js`：MIN_PYTHON_MINOR 为 9；FLOWER_TEST_PYTHON 只约束 Flower 测试 helper，上游独立初始化探测不读取该变量。后续应明确初始化前提与运行期兼容验证的边界，同时保持 3.8 实际运行覆盖。先前 junction 模拟使用 3.8，不能外推为 3.12 原生符号链接验证成功。本轮请求的追加补丁推送与 CI 核验已完成，但整个兼容任务仍未完成。

本轮通过源码、隔离安装与原生进程验证，不宣称重跑了真实 Codex/Claude 对话宿主；旧 SessionStart 宿主验证属于前一任务。Windows 无软链权限的场景保留 Linux 真实软链验证，未更改系统权限。日志在 /tmp/flower-compat-*.log，仅作本地执行证据，不包含真实遥测载荷。
