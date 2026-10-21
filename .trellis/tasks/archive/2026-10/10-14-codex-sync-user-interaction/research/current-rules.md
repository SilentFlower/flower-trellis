# 当前实现与配置验证

## 用户已决定的行为

- 默认避免 `request_user_input_async` 和 `send_user_message_async`。
- 询问使用同步 `request_user_input`；当前工具不允许时改为主对话提问并结束本轮。
- Flower 默认修改项目配置，使 Default 模式支持同步询问。

## 真实 Codex 验证

- 本机 `/root/.local/bin/codex --version` 返回 `codex-cli 0.162.1`。
- `codex features list` 登记 `default_mode_request_user_input`，成熟度为 `under development`，默认有效值为 `false`。
- 临时 CLI override `-c features.default_mode_request_user_input=true` 被识别为 `true`，未修改实际配置。
- 根据本机生成的 `ConfigReadParams.json`，`config/read` 的 `cwd` 会解析当前目录与项目根之间的项目层。
- 在当前已信任仓库内创建临时子目录，其 `.codex/config.toml` 写入 `[features] default_mode_request_user_input = true`；真实 app-server `config/read` 返回有效值 `true`，project layer 的 `disabledReason=null`。
- 命令行显式 `-c features.default_mode_request_user_input=false` 覆盖同一项目配置，返回 `false`。
- 未信任的 `/tmp` 临时仓库对应 project layer 被禁用；通过 CLI override 伪设 trust 不能代替用户级信任记录，因此未把该夹具误算作已信任项目验证。
- 当前项目在用户配置的 `projects` 中已登记 `trusted`；当前 `.codex/config.toml` 没有该功能键。
- 测试只调用配置读取接口，未启动模型推理、真实提问或更改用户配置。所有临时目录已经清理，业务工作区在规划前干净。

## 官方文档

- [Config basics](https://developers.openai.com/codex/config-basic)：项目 `.codex/config.toml` 支持覆盖，可信项目才加载，CLI override 优先于项目层，项目层优先于用户层。
- [Feature flags](https://developers.openai.com/codex/config-basic#feature-flags)：布尔开关写在 `[features]`，常见旗标列表并不穷举内部开发中开关。
- [App-server](https://developers.openai.com/codex/app-server)：工具请求与界面由宿主管理；规则注入不能修改当前工具 schema 或保证模型行为。

## 源码所有权与修改位置

- `src/assets/flower_session_start.py:269` 的 `render_part` 所有 Flower 分段注入，state 复用原生 Hook；可在已成功获取的 Codex state 增加与模型无关的短交互规则。
- `src/assets/flower_session_start.py:26` 的模型提示当前只覆盖三个模型，且最终文本有稳定 hash 守卫，不将通用交互规则塞进模型提示。
- `src/lib/platform-patch-adapters.js:377` 已有 `parseTomlSectionHeader`；`:422` 的 `applyTomlSection` 仅支持删除 section；`:457` 是 Flower adapter 注册入口。目前没有可补默认 TOML 键的 adapter。
- `src/patches/bundles/flower-platform-integration.json` 是 full-only 平台配置 Bundle；Codex TOML Patch 跟随该 Bundle，不为 skill-only 安装修改项目默认。
- `src/patches/platforms/codex/remove-multi-agent-v2/patch.json` 表明 `.codex/config.toml` 已参与 Flower Patch / Plugin provenance，不能绕过生命周期手写部署文件。
- 当前 `.codex/config.toml:15` 保留上游旧说明“project config cannot set feature flags”；应对已知原文作窄范围修正，不删除用户自有注释或谎称旧版本也支持新开关。
- 不改共享 `.agents/skills`、Skill-Garden workflow、route helper 或 native Codex binary。本轮权威修改位于 Flower 根仓。

## 既有验证入口

- `test/js/platform-patches.test.js` 覆盖配置保留、幂等、缺失平台、损坏配置零写入、SessionStart 额度保留。
- `test/python/test_flower_session_start.py` 覆盖各平台/分段、启动来源、模型提示原文与降级；新增交互规则必须保留现有模型 hint hash。
- `scripts/check-ai-context-budget.mjs` 实际运行十八个 SessionStart 场景，每场景三份输出；保留既有阈值和总量公式，只增加通用交互块数量与体量断言。
- `test/js/ai-context-budget.test.js` 覆盖预算与模型差分。通用规则在 Codex 基线与模型场景都出现，模型差分仍应只等于原模型 hint 加一个换行。
