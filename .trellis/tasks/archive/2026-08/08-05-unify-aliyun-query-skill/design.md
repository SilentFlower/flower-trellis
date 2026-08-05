# 技术设计：统一阿里云运维 Skill

## 1. 设计目标

在不削弱现有 DMS/SLS 行为的前提下，将它们与 MSE/Nacos 查询能力收敛到一个 `aliyun-ops` Skill。统一的是入口、凭证、安全纪律、RPC 公共实现和扩展结构；不统一不同云产品的业务命令、响应解析和协议特例。

## 2. 真实源与发布链

Skill-Garden 是通用 Skill 的真实源，Flower 只保存发布快照：

```text
vendor/skill-garden/.common
        │
        ├── 独立 install.sh 直接消费
        │
        └── scripts/sync-enhancements.mjs
                    │
                    ▼
            enhancements/common/.common
                    │
                    └── Flower Skill Catalog / builtin Plugin 更新
```

实现顺序必须先修改 `vendor/skill-garden`，再运行同步脚本生成 `enhancements/`。禁止手工维护两套内容。

## 3. Skill 资产布局

Claude 与 Codex 各维护一份相同的完整树：

```text
.common/.codex/skills/aliyun-ops/
.common/.claude/skills/aliyun-ops/
├── SKILL.md
├── agents/
│   └── openai.yaml
├── assets/
│   └── env.example
├── references/
│   ├── dms.md
│   ├── sls.md
│   └── mse.md
└── scripts/
    ├── aliyun_common.py
    ├── aliyun_rpc_v1.py
    ├── dms.py
    ├── sls_get_logs.py
    └── mse.py
```

`SKILL.md` 只包含能力选择表、公共安全规则、配置入口和按需读取指引。DMS、SLS、MSE 的详细协议、命令示例、业务经验和排错表分别放入 `references/`，避免每次触发加载全部内容。

`agents/openai.yaml` 只提供 UI 元数据，不声明外部 MCP 依赖。为保持双平台树一致，该文件在 Claude/Codex 两侧都保留；不支持该元数据的平台会忽略它。

## 4. Python 模块边界

### 4.1 `aliyun_common.py`

负责所有产品共享且已经重复出现的基础行为：

- 解析不执行 shell 展开的 `KEY=VALUE` 文件。
- 按明确优先级加载统一配置与旧配置文件，已有进程环境变量始终优先。
- 显式配置文件不存在时 fail-fast。
- 获取 AK/SK，不回显凭证内容。
- 提供 table/json/csv 等通用结果渲染能力。

所有可复用函数带中文 Docstring；内部实现使用私有函数名，避免扩大公共契约。

### 4.2 `aliyun_rpc_v1.py`

只实现阿里云 RPC v1 HMAC-SHA1 的公共签名与 HTTP 调用：

- endpoint、API version、action、HTTP method、业务参数和 timeout 由调用方传入。
- 自动填充公共 RPC 参数并过滤值为 `None` 的业务参数。
- 支持 DMS 的 POST 调用和 MSE 的 GET 调用。
- 返回统一的 `(http_status, body_dict)`，产品脚本负责解释业务成功字段和错误码。

该模块不得承载 DMS Tid、Nacos namespace、工单或配置内容等产品语义。

### 4.3 产品脚本

- `dms.py`：保留现有命令名、参数顺序、只读白名单、DML 拦截、`--yes` 工单确认和输出格式。
- `sls_get_logs.py`：保留现有命令名与参数；仅复用公共配置/凭证加载。SLS LOG V1 签名继续留在本脚本中，绝不进入 RPC 公共模块。
- `mse.py`：新增只读 CLI，使用 RPC 公共模块；所有命令使用 `argparse` 和具名参数，避免临时脚本的位置参数越界。

## 5. 配置与凭证

### 5.1 统一配置

主配置路径：

```text
~/.config/aliyun-ops/env
```

统一变量：

```dotenv
ALIYUN_ACCESS_KEY_ID=
ALIYUN_ACCESS_KEY_SECRET=
ALIYUN_DMS_TID=
ALIYUN_SLS_PROJECT=
ALIYUN_SLS_LOGSTORE=
ALIYUN_SLS_REGION=cn-hangzhou
ALIYUN_MSE_REGION=cn-hangzhou
ALIYUN_MSE_ENDPOINT=
```

`ALIYUN_MSE_ENDPOINT` 仅作为特殊网络环境的覆盖项；默认根据 region 生成 `mse.<region>.aliyuncs.com`。

### 5.2 加载优先级

每个脚本按以下顺序处理：

1. 已存在的进程环境变量。
2. 命令行 `--env-file` 指定的唯一文件。
3. 产品旧环境变量指定的文件，如 `ALIYUN_DMS_ENV_FILE` / `ALIYUN_SLS_ENV_FILE` / `ALIYUN_MSE_ENV_FILE`。
4. `ALIYUN_OPS_ENV_FILE` 指定的统一文件。
5. `~/.config/aliyun-ops/env`。
6. 产品自己的旧默认路径；必要时再读取另一个旧路径作为凭证兜底。

显式指定第 2 至第 4 类路径时，文件不存在必须报错，且不静默改读其它文件。默认路径不存在时允许继续尝试兼容回退。所有文件只补齐尚未存在的环境变量。

安装器和产品脚本只读取这些路径，不执行任何凭证文件迁移。具体约束：

- 不自动创建 `~/.config/aliyun-ops/env`；仅在文档中提供 `install -m 600` 的初始化命令。
- 不把两个旧文件合并成新文件，避免不同账号或不同权限范围的 AK/SK 被错误混用。
- 不修改旧文件权限、内容或路径，也不在卸载旧 Skill 时删除旧配置目录。
- 新默认文件存在时先读取它；旧文件只补充缺失变量，因此冲突值以新文件为准。
- 上述兼容回退不设置自动失效版本，后续若要移除必须作为独立兼容性变更重新确认。

产品默认回退顺序：

| 产品 | 旧路径顺序 |
| --- | --- |
| DMS | `aliyun-dms-query/env` → `aliyun-sls-query/env` |
| SLS | `aliyun-sls-query/env` → `aliyun-dms-query/env` |
| MSE | `aliyun-sls-query/env` → `aliyun-dms-query/env` |

## 6. MSE/Nacos CLI

MSE 使用 `2019-05-31` API，并为每个请求显式传递 `RegionId`。

| 命令 | OpenAPI | 输出边界 |
| --- | --- | --- |
| `clusters` | `ListClusters` | 集群 ID、别名、类型、版本、地域等摘要 |
| `namespaces` | `ListEngineNamespaces` | namespace ID、显示名、配置数 |
| `configs` | `ListNacosConfigs` | 自动分页，输出 DataId、Group、Type |
| `config` | `GetNacosConfig` | 无 `--grep` 时只输出行数/元数据；有 `--grep` 时只输出命中行 |
| `history` | `ListNacosHistoryConfigs` | 输出版本 ID、修改时间、操作类型、操作人 |
| `history-config` | `GetNacosHistoryConfig` | 无 `--grep` 时只输出安全摘要；有 `--grep` 时只输出命中行 |

本期不提供 `CreateNacosConfig`、`UpdateNacosConfig`、`DeleteNacosConfig`、导入、回滚等写入命令。历史记录保留期由 MSE 服务端决定，CLI 不承诺完整长期历史。

## 7. Skill 自动迁移

### 7.1 单一迁移清单

在真实源新增：

```text
vendor/skill-garden/.common/skill-migrations.json
```

建议结构：

```json
{
  "version": 1,
  "skills": [
    { "from": "aliyun-dms-query", "to": "aliyun-ops" },
    { "from": "aliyun-sls-query", "to": "aliyun-ops" }
  ]
}
```

读取方必须校验 `from` / `to` 为安全的单一路径段、目标 Skill 在当前源或快照中真实存在、同一来源不重复映射，并拒绝环形或自映射。

### 7.2 Flower 快照与更新

`scripts/sync-enhancements.mjs` 读取迁移清单并写入 `MANIFEST.json.common.skillMigrations`。现有累计 `removedSkills` 机制继续把两个旧名称记录为 tombstone。

`src/lib/skill-catalog.js` 将迁移纳入 common Skill 同步描述：

1. 检查每个平台的旧 Skill 精确目录是否存在。
2. 若存在且新 Skill 快照可用，为同平台加入 `aliyun-ops` 刷新/安装目标。
3. 去重多个旧来源指向同一新目标的写入。
4. 仅在新目标已加入计划后，将旧目录加入删除目标。

普通同步先复制新 Skill 后删除旧目录；builtin Plugin 继续复用 `describeInstalledCommonSkillSync()`，把新增树与删除树放入同一事务。迁移后的新 Skill 采用 `shared` ownership，卸载 Flower 时保持现有 common Skill 语义。

### 7.3 skill-garden 独立安装器

`install.sh` 读取同一迁移清单：

- 显式传旧名称时，将其作为目标 `aliyun-ops` 的安装别名。
- 全量 common 安装或显式命中新旧名称时，先安装新 Skill，再检查目标平台的 `SKILL.md` 已存在，最后删除两个旧精确目录。
- 安装其它不相关 Skill 时，不主动迁移或删除旧阿里云 Skill。
- 不扫描固定 Skill 根以外的路径。

## 8. 失败与安全行为

- 迁移清单非法、目标 Skill 缺失或新 Skill 未成功写入时，不删除旧目录。
- 双旧 Skill 同时存在时只写一份新 Skill，并删除两个旧目录。
- 新旧 Skill 同时存在时刷新新 Skill，再删除旧目录。
- 无旧 Skill 的项目普通更新不自动启用 `aliyun-ops`，保持“只刷新已启用 common Skill”的现有原则。
- MSE 配置内容默认不完整输出；错误响应只显示服务端错误码与截断后的消息，不打印签名 URL。
- DMS 真实工单仍需 `--yes`；本次不新增其它写操作。

## 9. 测试设计

### Skill 与脚本

- Claude/Codex 源树及 Flower 快照树一致，无凭证、`__pycache__` 或 `.pyc`。
- `SKILL.md` frontmatter 能触发 DMS/SLS/MSE/Nacos 场景，正文能按产品路由 reference。
- DMS DML 拦截、工单默认预览、全局 `--format` 顺序保持不变。
- SLS 签名与查询参数行为保持现有契约。
- MSE 通过 mock HTTP 验证 action、RegionId、endpoint、分页、当前配置和历史配置安全输出。
- 公共配置加载覆盖统一路径、旧路径、显式缺失 fail-fast 和进程环境变量优先级。
- 安装、更新和脚本默认执行均不会创建、改写或删除真实 ENV 文件。

### 迁移

- 仅 DMS 旧 Skill、仅 SLS 旧 Skill、两个旧 Skill、已同时存在新旧 Skill、完全无旧 Skill。
- Codex、Claude、legacy `.agents/skills` 三种目标根。
- Flower 普通同步与 builtin Plugin 事务路径结果一致。
- 独立安装器接受旧名称并只留下 `aliyun-ops`。
- 用户自有 Skill 和旧目录之外的文件不受影响。

## 10. 未采用方案

- 不保留两个旧别名 Skill：会继续显示三个入口，并造成触发和内容维护冲突。
- 不直接硬删除旧 Skill：现有项目更新后会失去能力，违反已确认的自动迁移要求。
- 不把三个产品塞进单一巨型 CLI：会让参数、权限和失败语义互相污染。
- 不复用 SLS 签名器：SLS LOG V1 与阿里云 RPC v1 的规范不同。
- 不在多个安装路径分别硬编码迁移关系：迁移清单必须是单一真实源。
