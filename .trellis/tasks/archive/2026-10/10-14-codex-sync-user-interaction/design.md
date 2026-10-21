# Codex 同步用户交互设计

## 目标与边界

以“项目默认开启同步工具 + 一份 Codex 通用交互规则”实现用户诉求。配置属于平台集成 Patch，规则属于 Flower SessionStart wrapper；不复制到每个 skill，不添加持久交互状态或等待轮询器。

## 配置分发

1. 在 `src/patches/platforms/codex/` 新增同步交互配置 Patch，加入既有 full-only 平台 Bundle。
2. 目标固定 `.codex/config.toml`，声明 `kind=toml`、`requires=[.codex]`、`missing=create`。只有已存在 Codex 平台时才允许创建配置。
3. 在 `platform-patch-adapters.js` 增加受控 TOML 默认布尔键 adapter；复用既有 section 识别和 Patch preflight/事务，不把通用 Patch 逻辑复制进 adapter。
   `smol-toml@1.9.1` 只负责变换前后完整语法校验及引号键解码，开启大整数解析；不序列化整份用户配置。源码语句扫描只负责位置识别。解析错误只显示行列，不回显配置原文。
4. 缺失 `features.default_mode_request_user_input` 时写入 `true`；已有明确布尔值保留。保留其它 feature、agents、model、用户注释和内部行尾；文件末尾继续沿用既有 Patch Engine 的单 LF 规范化，不扩大核心协议改动。不生成重复 `[features]` 或键。
5. 覆盖普通 `[features]`、根级 dotted key 与可安全识别的 inline table；重复定义、非法目标值或无法无歧义更新的形状必须报错，禁止重写成空配置。已有其它字符串、多行值中的伪 section/key 不能误识别。
6. 对已知上游过时 feature 说明进行原文精确修正；说明缺失时跳过，未知用户文字不覆盖。说明仍保留“信任项目、实际宿主支持、旧版本差异”的边界。
7. Patch 输出、首次备份与最终 hash 继续交给 Plugin Runtime；不修改用户级配置与信任表。
8. 默认值 Patch 显式排在旧 `features.multi_agent_v2` 清理之前：配置缺失时先创建内存目标，确保两项操作在首次和重复更新都进入相同 provenance。

## 交互规则注入

- 新增独立 `CODEX_USER_INTERACTION_HINT` 常量，英文继承宿主注入内容风格；与现有三个模型 hint 分离。
- `render_part` 仅在 Codex / state / `startup|clear|compact` 且原生注入成功时追加一次。所有模型包括缺失 model 的场景一致，rules/stages 与 Claude 零追加。
- 不增加新的 hook handler、配置开关或跨轮状态；沿用禁用 Hook、非交互模式和原生跳过条件。
- 覆盖以下行为：在当前工具指令允许且能够表达问题时使用同步 `request_user_input`；否则把问题展示在 final 回复并结束本轮。禁用两种异步交互及同义异步入口；进度用 commentary，结果用 final。原有确认条件仍归各 workflow owner，不为了调用工具切换模式，不从沉默推定同意。
- 新规则只约束模型选择，不宣称卸载/禁用宿主工具或改变正在运行会话的 schema。新配置在 Codex 重新加载项目后生效。

## 预算与能力守恒

- 完整新块（含标记）上限 512 UTF-8 bytes；实际 state 拼接还增加一个换行，预算应如实计入。
- 预算脚本在现有十八场景中验证新增块：每个 Codex state 恰好一份，其它输出零份，跨模型/来源原文一致。
- 现有 Astra/Sol/Sol 6.1 原文及 2048 bytes 上限、原有总量公式与阈值保持；不靠删审阅条件或提高阈值抵消增长。
- 记录实际注入前后 bytes 和本地 `o200k_base` token 差分；本地 token 是文本度量，不冒充宿主实收或计费 token。

## 兼容与回滚

- 仅修改 Flower 0.6 平台分发；旧版本 Codex若不识别开关，交互规则仍可回退到主对话，宿主实际可用性应单独验证。
- 明确设置 `false` 的用户保留其设置，因此该项目可能继续走主对话等待；默认值不强制覆盖用户选择。
- 若 TOML 安全识别无法满足既有配置，应修正 adapter 或报告具体不支持形状，不放宽错误为静默覆写。
- 回滚源码后通过同一 Flower Plugin 生命周期重放/卸载，不手写 `.flower` ownership，也不把撤回配置误当作可以删除用户后来设置的键。

## 影响文件

- `src/assets/flower_session_start.py`
- `src/lib/platform-patch-adapters.js`
- `src/lib/toml-default-adapter.js`：同一份语句扫描供补默认值和既有 section 清理复用，避免多行字符串误匹配。
- `src/patches/platforms/codex/sync-user-interaction/` 新 Patch 与载荷
- `src/patches/bundles/flower-platform-integration.json`
- `scripts/check-ai-context-budget.mjs`
- 平台 Patch、SessionStart 与预算相关测试
- 必要 Spec 与当前项目的受管生成配置、wrapper、Plugin manifest/lock/state

没有 Skill-Garden canonical 变更，不需要为本任务修改 submodule 或重新生成其 compiled targets。
