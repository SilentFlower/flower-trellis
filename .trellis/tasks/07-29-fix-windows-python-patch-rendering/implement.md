# 修复 Windows Python 命令导致的 Patch 漂移 - 实施计划

## 1. Implementation

- [x] 新增共享 Trellis Python 命令解析与文本物化 helper，覆盖项目证据、环境显式值和平台回退。
- [x] 扩展 JS Patch catalog runtime descriptor，使受信 catalog 可声明受控
      `trellisPythonCommand` 文本物化；保持 Patch / Bundle schema 不变。
- [x] 在 catalog load 后同步物化 selector、content 和 baselines，保持 canonical catalog hash 不变。
- [x] 同步物化 `conflicts.json` 的 assertion literal，保持 compatibility 与 policy 源文件哈希不变。
- [x] 在 `SkillGardenBuiltinProvider` 中每个目标项目只解析一次命令，并同时传给 catalog、内容投影与
      结构化 Hook adapter。
- [x] 调整 `projectSkillGardenContent()`，只物化 0.6 Skill / Command 等明确文本载荷，保持二进制、
      common skill 和 Python 源 argv 字符串原字节。
- [x] 在 Python Patch runner 实现等价解析、operation 与 policy 文本物化，维持 JS / Python plan parity。
- [x] 如测试证明源资产无需改动，不制造 Windows 专用 selector/baseline；如必须调整 Skill-Garden 源，
      先改 `vendor/skill-garden` 再执行 `npm run sync`。
- [x] 新增 full-only Session Context Patch，删除升级同步重新引入的旧 Trellis 更新 helper、依赖、
      常量与 `output_text()` 调用，并加入最终产物冲突断言。
- [x] 通过正式强化流程刷新当前仓库 dogfood 副本，确保受管 marker、Plugin state 与 catalog hash 一致。

## 2. Tests

- [x] Patch Engine unit：`python3` no-op、`python`、`py -3`、shebang 保留、未知漂移失败。
- [x] Apply Enhancements integration：用未强化 0.6.5 fixture 把 Trellis 生成文本渲染为 `python`，
      证明用户报告的 9 项错误消失并验证最终命令。
- [x] Apply Enhancements integration：`py -3` target 可安装且二次运行幂等。
- [x] Plugin Runtime：内容投影与 Patch overlap 在非 `python3` 场景最终 hash 一致。
- [x] Capability boundary：外部 Plugin descriptor / manifest 不能注入 materialization 字段。
- [x] Python runner：共享 fixture 与命令物化 fixture 保持 JS / Python plan、policy 与 provenance 语义一致。
- [x] Atomicity：命令物化之外的 selector 漂移仍保证 Patch、内容、lock、state 零写入。
- [x] Compiled targets：canonical `python3` 审阅产物不发生无关漂移。
- [x] Session Context regression：完整 init 与 dogfood 测试证明旧 helper、`trellis --version` 和
      `update-check-*.marker` 不再出现。

## 3. Validation Commands

```bash
node --test test/js/patch-engine.test.js
node --test test/js/apply-enhancements.test.js
node --test test/js/plugin-skill-garden.test.js
node --test test/js/plugin-patch-planner.test.js
python3 -m unittest discover -s test/python -p 'test_skill_garden_patches.py'
npm run sync
npm run patch:targets:check
npm test
git diff --check
```

## 4. Risky Files And Review Points

- `src/lib/patch-engine.js`：不得把 materialization 变成全局宽松 normalization。
- `src/builtin-plugins/skill-garden/provider.js`：命令解析必须在 catalog 和内容投影之间共享。
- `src/builtin-plugins/skill-garden/content-adapter.js`：二进制与 common skill 不能被误改。
- `src/plugin/install/patch-planner.js`：外部 Plugin descriptor 继续保持字段白名单。
- `vendor/skill-garden/scripts/apply-trellis-patches.py`：JS / Python 输出字段、hash 与错误语义保持一致。
- `enhancements/0.6/`：只能由同步流程更新，不能作为唯一源修改。

## 5. Check Evidence

- 定向 JS：53 项通过；Python Patch runner：19 项通过。
- 真实 CLI：`TRELLIS_PYTHON_CMD=python` 与 `py -3` 的完整 `init` 均通过。
- `npm run patch:targets:check`、Patch conflicts、AI context budget、`npm pack --dry-run --json`
  与 `git diff --check` 通过。
- Session Context full-only Patch 已进入 Skill-Garden 源、发布快照、compiled targets 和当前
  dogfood；二次强化重放为 `目标变化 0 项`。
- 完整 `npm test` 通过：JS 295 项、Python 147 项，以及 Patch conflicts、compiled targets 和
  AI context budget 全部通过。
