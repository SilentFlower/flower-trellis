# 阿里云 MSE/Nacos 只读查询

`scripts/mse.py` 使用 MSE `2019-05-31` RPC OpenAPI 查询托管 Nacos。它只提供资源发现、当前配置核对与历史版本查询，不提供创建、修改、删除、导入或回滚配置。

## 安全边界

- 所有请求显式携带 `RegionId`，默认地域为 `ALIYUN_MSE_REGION` 或 `cn-hangzhou`。
- endpoint 默认由地域生成：`mse.<region>.aliyuncs.com`。特殊网络环境可设置 `ALIYUN_MSE_ENDPOINT`，值只写主机名，不带协议和路径。
- `config` 与 `history-config` 默认只输出 DataId、Group、类型、行数、字符数和修改元数据，绝不输出完整正文。
- 只有显式提供非空 `--grep` 时才逐行输出关键字命中内容。不要用宽泛关键字变相导出整份配置。
- MSE 历史记录由服务端按自身策略保留，本 Skill 不承诺长期历史完整性。

## 配置

统一配置示例：

```dotenv
ALIYUN_ACCESS_KEY_ID=
ALIYUN_ACCESS_KEY_SECRET=
ALIYUN_MSE_REGION=cn-hangzhou
ALIYUN_MSE_ENDPOINT=
```

默认查找顺序：进程环境变量 → `~/.config/aliyun-ops/env` → `~/.config/aliyun-sls-query/env` → `~/.config/aliyun-dms-query/env`。旧文件只用于补齐缺失变量，不会被改写。`--env-file`、`ALIYUN_MSE_ENV_FILE` 或 `ALIYUN_OPS_ENV_FILE` 属于显式唯一来源，文件缺失时立即失败。

RAM 权限优先按只读 Action 最小授权：`mse:ListClusters`、`mse:ListEngineNamespaces`、`mse:ListNacosConfigs`、`mse:GetNacosConfig`、`mse:ListNacosHistoryConfigs`、`mse:GetNacosHistoryConfig`。

## 命令

全局参数必须写在子命令之前，例如 `--region`、`--endpoint`、`--format`、`--env-file`。

```bash
# 1) 列集群，拿 InstanceId
python3 scripts/mse.py --region cn-hangzhou clusters

# 2) 列命名空间
python3 scripts/mse.py namespaces --instance mse-cn-xxx

# 3) 自动分页列配置元数据
python3 scripts/mse.py configs --instance mse-cn-xxx --namespace public

# 4) 当前配置：默认只看摘要
python3 scripts/mse.py config --instance mse-cn-xxx --namespace public \
  --data-id application-prod.yml --group DEFAULT_GROUP

# 5) 当前配置：只看命中行
python3 scripts/mse.py config --instance mse-cn-xxx --namespace public \
  --data-id application-prod.yml --grep datasource

# 6) 列历史版本
python3 scripts/mse.py history --instance mse-cn-xxx --namespace public \
  --data-id application-prod.yml

# 7) 查看指定历史版本摘要或命中行
python3 scripts/mse.py history-config --instance mse-cn-xxx --namespace public \
  --data-id application-prod.yml --nid 123456 --grep endpoint
```

## 排错

| 现象 | 判读 |
| --- | --- |
| `SignatureDoesNotMatch` | 核对 RPC v1 HMAC-SHA1、endpoint 地域和系统时间；不要套用 SLS LOG V1 签名 |
| 403 / denied by RAM | 核对对应只读 Action 与资源范围，不要直接扩大为全权限 |
| 集群列表为空 | 先确认 `--region` 是否为实例实际地域，`ListClusters` 需要显式 `RegionId` |
| 历史版本数量少 | 保留期由 MSE 服务端决定，不能据此承诺完整长期审计 |

官方 API 目录：<https://help.aliyun.com/zh/mse/developer-reference/api-mse-2019-05-31-dir-nacos-configuration/>
