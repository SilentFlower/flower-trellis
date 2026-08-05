# 实施计划：统一阿里云运维 Skill

## 1. 建立统一 Skill 骨架

- [x] 使用 `skill-creator` 提供的 `init_skill.py` 在 `vendor/skill-garden/.common/.codex/skills/aliyun-ops` 初始化 `scripts,references,assets` 结构，并生成 `agents/openai.yaml`。
- [x] 将生成树同步为 Claude 副本，确保除允许的平台元数据外内容一致；本任务选择两侧保留相同 `agents/openai.yaml`。
- [x] 编写精简 `SKILL.md`，包含公共安全规则、配置入口、产品路由表和 reference 加载条件。
- [x] 将现有 DMS/SLS 详细知识拆入 `references/dms.md`、`references/sls.md`，新增 `references/mse.md`。

## 2. 提取公共 Python 基础设施

- [x] 新增 `scripts/aliyun_common.py`，实现 ENV 解析、统一/兼容路径加载、凭证获取和结果渲染。
- [x] 新增 `scripts/aliyun_rpc_v1.py`，实现可配置 endpoint/version/action/method 的 RPC v1 HMAC-SHA1 调用。
- [x] 为公共函数补齐中文 Docstring，并保持错误消息不回显 AK/SK 或签名 URL。
- [x] 增加公共模块测试，覆盖路径优先级、显式缺失 fail-fast、环境变量优先和 RPC 请求参数。
- [x] 增加凭证文件不变性测试，确认加载、安装与升级不会创建、合并、改写、改权限或删除真实 ENV 文件。

## 3. 迁移 DMS 与 SLS

- [x] 将现有 `dms.py` 移入统一 Skill，改用公共 ENV、凭证、渲染和 RPC 模块。
- [x] 保持 DMS 命令名、参数顺序、只读白名单、DML 拦截、工单 `--yes` 确认和输出行为。
- [x] 将现有 `sls_get_logs.py` 移入统一 Skill，只替换公共 ENV/凭证加载，保留独立 LOG V1 签名实现。
- [x] 更新脚本内默认配置说明为 `~/.config/aliyun-ops/env`，同时保留旧路径兼容。
- [x] 在 `assets/env.example` 和 references 中明确新文件需由用户主动创建，旧文件无需迁移且继续可用。
- [x] 运行现有 DMS/SLS 契约测试，先确认迁移没有行为回归。

## 4. 实现 MSE/Nacos 只读 CLI

- [x] 基于 `/tmp/aliyun_mse.py` 的实跑逻辑实现正式 `scripts/mse.py`，改用 `argparse`、公共 RPC 客户端和统一配置加载。
- [x] 实现 `clusters`、`namespaces`、`configs`、`config`、`history`、`history-config` 六个命令。
- [x] 所有请求显式传 `RegionId`，默认 endpoint 由 region 生成，允许 `ALIYUN_MSE_ENDPOINT` 覆盖。
- [x] 为配置列表实现受控分页；为当前/历史配置实现默认摘要与 `--grep` 命中行输出。
- [x] 对照官方响应结构兼容 `Data`、`Configurations`、`HistoryItems` 等实际字段，并在业务 `Success=false` 时返回非零退出码。
- [x] 使用 mock HTTP 测试签名参数、区域、分页与敏感内容默认不输出。

## 5. 建立通用 Skill 迁移清单

- [x] 新增 `vendor/skill-garden/.common/skill-migrations.json`，登记两个旧名称到 `aliyun-ops` 的映射。
- [x] 在 skill-garden 独立安装器中使用结构化解析加载清单，校验安全名称和目标存在性。
- [x] 让旧名称作为 `aliyun-ops` 的安装别名；新 Skill 成功安装后再删除旧精确目录。
- [x] 增加独立安装器迁移测试，覆盖全量安装、显式旧名称和不相关 Skill 安装。

## 6. 接入 Flower 快照与 Plugin 更新

- [x] 修改 `scripts/sync-enhancements.mjs`，校验迁移清单并写入 `MANIFEST.json.common.skillMigrations`。
- [x] 修改 `src/lib/skill-catalog.js`，读取迁移映射，生成“先刷新新目标、再删除旧目标”的去重同步描述。
- [x] 让 `syncInstalledCommonSkills()` 复用同一同步描述，避免普通同步与 builtin Plugin 路径产生两套迁移算法。
- [x] 迁移声明存在但校验失败时 fail closed，禁止 tombstone 删除旧 Skill；未声明迁移的旧 manifest 继续保持原有清理语义。
- [x] 确认 `src/builtin-plugins/skill-garden/content-adapter.js` 无需复制迁移规则，仅消费增强后的同步描述；必要时只更新契约注释或类型说明。
- [x] 在 `SKILL_DESCRIPTION_OVERRIDES` 增加 `aliyun-ops` 中文短说明。

## 7. 删除旧源并更新文档

- [x] 从 Claude/Codex common 源删除 `aliyun-dms-query` 与 `aliyun-sls-query` 目录，只保留 `aliyun-ops`。
- [x] 更新 `vendor/skill-garden/README.md` 的 Skill 清单、能力说明和安装示例。
- [x] 更新或合并 `test/js/aliyun-dms-skill.test.js`、`test/js/common-skill-catalog.test.js` 为统一 Skill 测试，保留所有已有重要断言。
- [x] 扩展 `test/js/plugin-skill-garden.test.js`，验证 builtin Plugin 自动迁移与 shared ownership。

## 8. 生成快照

- [x] 运行 `node scripts/sync-enhancements.mjs`。
- [x] 核对 `enhancements/MANIFEST.json`：只列 `aliyun-ops`，两个旧名称进入 `removedSkills`，迁移映射完整。
- [x] 核对 `enhancements/common/.common` 与 skill-garden 源一致，且没有缓存、凭证或临时文件。

## 9. 验证

- [x] 对 Claude/Codex 两侧运行 Skill 基础校验：

```bash
python3 /root/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  vendor/skill-garden/.common/.codex/skills/aliyun-ops
python3 /root/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  vendor/skill-garden/.common/.claude/skills/aliyun-ops
```

- [x] 运行脚本帮助和无网络安全分支，禁止在受管树生成 `__pycache__`：

```bash
PYTHONDONTWRITEBYTECODE=1 python3 vendor/skill-garden/.common/.codex/skills/aliyun-ops/scripts/dms.py --help
PYTHONDONTWRITEBYTECODE=1 python3 vendor/skill-garden/.common/.codex/skills/aliyun-ops/scripts/sls_get_logs.py --help
PYTHONDONTWRITEBYTECODE=1 python3 vendor/skill-garden/.common/.codex/skills/aliyun-ops/scripts/mse.py --help
```

- [x] 运行聚焦测试：

```bash
node --test test/js/aliyun-ops-skill.test.js test/js/plugin-skill-garden.test.js
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s test/python -p 'test_aliyun_ops.py'
```

- [x] 运行完整质量门：

```bash
npm test
git diff --check
```

- [x] 检查主仓库与 `vendor/skill-garden` 子仓库的 diff，确认真实源、快照、manifest、测试和子模块引用同步完整。

## 10. 回滚点

- [x] 在删除旧 Skill 源前，先完成统一 Skill 的 DMS/SLS 契约测试。
- [x] 在启用迁移删除前，先完成目的目录存在性与安装成功断言。
- [ ] 若迁移逻辑验证失败，保留新 `aliyun-ops` 但暂不发布 tombstone/迁移映射，避免升级时丢失旧能力。
