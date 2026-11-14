# 旧确认配置迁移设计

## Evidence and boundaries

- 历史提交 `e0aebc1^` 的 `src/lib/confirmation-harnesses.js` 和 `src/constants.js` 给出旧 MCP 的 `flower_confirmation_<8 位十六进制>`、`confirmation-mcp.js`、`FLOWER_CONFIRMATION_SESSION` 及配套权限形态。用这些签名组合确认归属；若存在不认识的子字段或互相矛盾的引用，保留候选。配套引用只随同文件中已验证的目标移除，独立引用保留。
- Claude 历史清理样本包含 45 对 `flower-confirmation@flower-trellis-confirm-<24 位十六进制>` 与同标识的 directory marketplace。备份均指向 `native-confirmation/claude` 目录形态。验证成对关系、布尔注册值和精确来源形态。单独的 `flower-probe-market` 实验记录不纳入自动迁移。
- 前台原生确认方案（`e0aebc1`）用 Claude `.claude/settings.json` 中的 `ftl confirm hook`，精确历史事件为 UserPromptSubmit、PreToolUse、PostToolUseFailure、SessionEnd。按历史 Patch 的事件、matcher、命令和参数核对；工具事件还核对 `if: Bash(ftl confirm *)`。混合组只移除匹配的 Hook，保留用户 Hook 和自定义分组条件。
- `5517830`、`e0aebc1` 投影了已退役的 `.trellis/scripts/confirmation.py`。比较历史分发内容，涵盖有证据的物化差异；缺少所有权且内容不匹配时保留。
- 共享服务后台方案（`9fbd2f8`）分发的 `flower_confirmation_hook.py` 曾调用旧 CLI `confirm hook`。`d98888f` 沿用 Hook 路径，`016cde7` 将其转发到项目内 Python。沿用路径由现有受管升级替换；用历史夹具确认配置能收敛到现行 Hook 集合。若现有事务已覆盖，沿用既有规则；仅为已证实残留补精确迁移。
- 项目配置白名单为 `.codex/config.toml`、`.mcp.json`、`.claude/settings.json`、`.claude/settings.local.json`。另检查 `.trellis/scripts/confirmation.py` 的旧资产归属。每份文件只匹配其实际合法的目标字段；不扫描全盘，不解析描述符或输出其值，不读取市场指向的目录。项目配置候选须是根内的普通文件。

## Integration

- 在可信内置 Skill-Garden 0.6 的全量升级/重放计划中按内容识别并生成一次性迁移。首次安装、部分技能操作和后续卸载不把这些项目配置转为 Flower 专属文件。优先复用结构化 Patch/adapter 和既有事务；对共用的 TOML/JSON 目标与当前平台 Patch 按同一目标计划合成，避免另写一遍覆盖用户配置。
- 先验证配置结构，再编辑精确的旧条目。保留 TOML 注释、其余字段和正常格式。对无法安全编辑的结构保持原样，可用项目相对路径给出跳过原因。
- 预览与正式路径用同一识别器。正式执行复核原内容哈希，由现有事务处理备份与回滚。保留清理后为空的现存配置文件；无需新增完成标记。无匹配时零迁移写入。
