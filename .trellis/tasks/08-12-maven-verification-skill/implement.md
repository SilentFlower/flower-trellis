# 实施计划

## 1. Authoring Source 与 Skill 骨架

1. 使用 `skill-creator` 的初始化/校验工具创建 `trellis-maven-verify` 骨架，目标为 `vendor/skill-garden/.trellis/0.6/.agents/skills/`。
2. 编写精简 `SKILL.md`，将生命周期规则和证据 schema 拆入 `references/`。
3. 生成或校验 `agents/openai.yaml`；若 Skill-Garden 当前工作流 Skill 不投影 UI metadata，则记录兼容原因并遵循现有目录惯例。
4. 同步 `.claude/skills/trellis-maven-verify`，断言两份内容逐字一致。

## 2. 确定性脚本

1. 新增 `vendor/skill-garden/.trellis/0.6/scripts/maven_verify.py`。
2. 实现 Maven/Git 根定位、diff 指纹、untracked 内容指纹和稳定 JSON 工具。
3. 实现 Maven 本地仓库文件系统诊断和 `--local-repository` 显式覆盖，贯穿 effective POM、执行 argv、POM 指纹和 evidence 新鲜度。
4. 实现 reactor/POM 模块扫描、坐标解析、本地依赖与反向依赖图；不可靠时输出 confidence/warning。
5. 实现根 effective POM 获取与 plugin execution phase/goal 分析，覆盖外部父 POM继承。
6. 实现昂贵 goal 分类和受支持 skip 参数判定。
7. 实现 `plan` 的 quick/final 命令生成：quick 默认 `-am` 并在 compiler plugin 兼容时使用 source-stale；final 默认 conservative，显式低风险场景才允许 source-stale。
8. 实现 `--threads` 显式并行参数校验；默认不启用并行，不猜测线程数。
9. 实现 `run` 的 argv 执行、实时日志、测试统计解析和原子证据写入。
10. 实现 `check` 的只读证据校验、生命周期/模块/测试覆盖判断和明确失效原因。

## 3. Trellis Owner 集成

1. 在 Skill-Garden Patch 中扩展 implement owner/agent 指令：Maven 项目调用新 Skill并报告 evidence。
2. 扩展 Check-All light/full profile：优先校验/复用 evidence，禁止 audit-only subagent 直接运行写缓存 Maven goal。
3. 必要时扩展 Check-All agent body，让 subagent 明确只调用 `maven_verify.py check`。
4. 保持 `trellis-check` workspace-write reviewer 与 Check-All audit-only 边界不变。
5. 更新 `enhancements-model.md`，新增 Maven Verification Evidence scenario 或在 Check-All scenario 中引用独立 owner，避免流程语义只存在于 Skill 文本。

## 4. Bundle、选择性安装与投影

1. 新增 `overrides/bundles/maven-verification.json`，声明别名、Skill、script 和相关 Patch。
2. 更新 `SCRIPT_ALIASES`，使选择 `trellis-maven-verify` 或 `trellis-check-all` 时安装 `maven_verify.py`。
3. 更新 Skill catalog 的中文短描述（如现有菜单需要稳定展示）。
4. 增加 full/selective/plugin replay 测试，断言新 Skill 与脚本在已启用平台正确投影且不创建未启用平台目录。

## 5. 自动化测试

1. 新增 `test/python/test_maven_verify.py`，用临时 Git/Maven fixtures 覆盖：
   - 单模块与多模块变更映射；
   - 本地上游/消费者图；
   - 根 POM变化；
   - compile 阶段 source jar；
   - prepare-package copy-dependencies；
   - quick/final argv、compile strategy 与显式 threads；
   - exact argv 执行与日志；
   - 成功、失败、中断证据；
   - 源码/POM/范围/生命周期/JDK变化后的失效；
   - compile/test/package 与附属制品覆盖矩阵；
   - 含空格路径和损坏证据。
2. 使用伪 Maven 可执行文件覆盖确定性单测，避免测试依赖网络或真实依赖下载。
3. 增加至少一个本机已安装 Maven 的隔离 smoke fixture，验证 effective POM 分析；无 Maven 时明确 skip。
4. 更新 Node 侧分发、Bundle alias、skill catalog、snapshot/compiled-target 契约测试。
5. 运行 Skill `quick_validate.py`，修复 frontmatter、命名或描述问题。

## 6. 同步与 Dogfood

1. 运行 `npm run sync`，刷新 `enhancements/0.6/` 和 manifest。
2. 运行 compiled-target 生成/检查，确保 Patch 适配当前 Trellis 0.6.14 模板。
3. 按 Flower Plugin 生命周期更新当前仓 dogfood，检查 `.flower/state.json` ownership，而不是手工覆盖受管副本。
4. 比较 canonical source、snapshot 与 dogfood 的关键文件，确认无漂移。

## 7. Forward Test

1. 在隔离临时 Maven fixture 使用 Skill 完成 quick/final/reuse 三个场景。
2. 对 `/root/project/srm-dingtalk-notification-governance/srm-server` 运行只读 `plan`：
   - 识别 Java 8 目标；
   - 识别外部父 POM在 compile 阶段绑定 source jar；
   - 识别应用模块 prepare-package 的 copy-dependencies；
   - 为当前 changed modules 生成不进入 package 的计划；
   - 不执行真实 Maven reactor，不修改业务仓文件。
3. 在 `/root/project/srm/srm-server` 使用 Linux Java 8、Linux Maven、ext4 本地仓库验证 quick source-stale：无变化构建、单个 class 过期构建与 conservative final 对照；只允许写 `target/` 和临时 evidence，不修改业务源码或 POM。
4. 根据 forward-test 输出修正 Skill 文案或脚本，避免把 SRM 特例硬编码成通用规则。

## 8. 验证命令

```bash
python3 test/python/test_maven_verify.py
node --test test/js/maven-verification.test.js
node --test test/js/platform-skill-distribution.test.js
node --test test/js/apply-enhancements.test.js
python3 /root/.codex/skills/.system/skill-creator/scripts/quick_validate.py vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-maven-verify
npm run sync
npm run patch:targets
npm run patch:targets:check
npm test
npm pack --dry-run --json
git diff --check
```

具体新增 Node 测试文件后，将对应定向命令补入本节；最终 `npm test` 不得省略。

## 9. 风险与回滚点

- POM解析若声称高置信但遗漏外部父绑定，会让 Skill错误跳过必要阶段；effective POM失败必须失败关闭。
- evidence 指纹过窄会错误复用，过宽会失去性能收益；先覆盖源码、测试、POM、命令、模块和工具链，再通过 fixture 校准。
- Check-All 是只读角色；任何让它执行 Maven goal 的改动都属于边界回归，必须由测试阻断。
- `npm run sync` 会机械刷新整个 `enhancements/`；同步前后都检查 git diff，避免夹带无关 vendor 漂移。
- dogfood 更新通过 Plugin 生命周期完成；出现 ownership 冲突时停止，不直接覆盖 `.agents/`、`.claude/` 或 `.trellis/` 受管文件。
