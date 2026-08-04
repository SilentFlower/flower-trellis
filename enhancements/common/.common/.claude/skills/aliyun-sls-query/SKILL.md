---
name: aliyun-sls-query
description: "用 AK/SK 直连阿里云 SLS（日志服务）查日志和指标的实战经验。当需要拉 SLS logstore 日志、查 metricstore 指标、写 SLS API 签名器、排查 SLS 调用报错（401/403/signature not match）、或在无 SDK 环境临时取数时触发。"
---

# 阿里云 SLS：AK/SK 直连取数实战

沉淀自真实排障与取数场景（FC 容器日志拉取、ARMS 指标底层 metricstore 取数、日志生命周期治理），所有姿势都在生产环境实跑验证过。

## 路线选型（先选对路，再动手）

| 路线 | 适用 | 依赖 |
|---|---|---|
| A. stdlib 签名器 | 临时排查、CI/受限环境、只需 GetLogs | 零依赖，`scripts/sls_get_logs.py` 开箱即用 |
| B. 官方 SDK `aliyun-log-python-sdk` | 长期脚本、大量翻页、写操作 | pip 可装 |

不推荐 aliyun CLI 走 SLS：它对 SLS 的封装弱，签名器/SDK 两条路都比它顺。

## 配置文件（Codex / Claude 共用）

默认从 `~/.config/aliyun-sls-query/env` 读取配置。进程环境变量优先，配置文件只补齐缺失项，因此临时 `export` 可以安全覆盖默认配置。

首次使用时复制 `assets/env.example` 到该路径并设置仅当前用户可读：

```bash
mkdir -p ~/.config/aliyun-sls-query
install -m 600 assets/env.example ~/.config/aliyun-sls-query/env
```

支持的配置项：

```dotenv
ALIYUN_ACCESS_KEY_ID=
ALIYUN_ACCESS_KEY_SECRET=
ALIYUN_SLS_PROJECT=
ALIYUN_SLS_LOGSTORE=
ALIYUN_SLS_REGION=cn-hangzhou
```

- 临时指定其它文件：`--env-file /path/to/env`。
- 为 Codex / Claude 统一指定其它文件：设置 `ALIYUN_SLS_ENV_FILE=/path/to/env`。
- `--project`、`--logstore`、`--region` 参数优先于配置文件中的同类值。
- 不把真实凭证写进 skill 目录、仓库、命令行参数或对话；私有 ENV 文件权限保持 `600`。

## 凭证纪律（不分路线，先立规矩）

1. **AK/SK 只走进程环境变量或权限为 `600` 的私有 ENV 文件**，不写入 skill、仓库、命令行参数或代码。脚本加载配置后统一从 `os.environ` 取，取不到就 fail-fast。
2. **AK 永远不出现在 stdout**。任何可能回显凭证的命令结尾兜底脱敏：
   ```bash
   ... | sed -E 's/LTAI[0-9A-Za-z]+/<AK>/g'
   ```
3. RAM 授权按最小面给：只读取数场景 `log:GetLogStoreLogs`（可精确到 `acs:log:<region>:<account>:project/<proj>/logstore/<store>`）。同一台机器多把 AK 时，用途分开命名（如 CI 用一对、个人只读一对），脚本里用参数指定环境变量名而不是写死。

## 路线 A：stdlib 签名器

`scripts/sls_get_logs.py` 是可直接分发的完整实现。核心协议要点（自己写签名器时照此核对）：

- SLS 用**自有 V1 签名**：`Authorization: LOG <AK>:<base64(HMAC-SHA1(StringToSign, SK))>`。
  它与阿里云 RPC/ROA 的 ACS3-HMAC-SHA256 是**两套协议**，FC/ECS 等 OpenAPI 的签名器不能复用。
- StringToSign 六行，`\n` 连接：
  ```
  METHOD
  Content-MD5（无 body 为空串）
  Content-Type（无 body 为空串）
  Date（GMT RFC1123，如 Mon, 01 Jan 2026 00:00:00 GMT）
  CanonicalizedLOGHeaders（只收 x-log-*/x-acs-*，key 小写、按字典序、k:v 一行一个）
  CanonicalizedResource（path + query 按 key 升序 k=v&k=v 拼接）
  ```
- **签名串里的 query 用原值，实际 URL 里才 urlencode**。两边不一致是 `signature not match` 的头号来源。
- 必带 headers：`Host`、`Date`、`x-log-apiversion: 0.6.0`、`x-log-signaturemethod: hmac-sha1`、`x-log-bodyrawsize: 0`（GET 也要带）。
- Host 形态：`<project>.<region>.log.aliyuncs.com`（project 在域名里，不在 path 里）。
- GetLogs 端点：`GET /logstores/<logstore>?type=log&from=<秒>&to=<秒>&line=&offset=&reverse=&query=&topic=`。
- 响应可能是 gzip（看 `Content-Encoding` 头），要解压再 parse。
- 响应头 `x-log-progress` 为 `Incomplete` 时结果不完整（大时间窗常见），要缩窗或重试，别当成"就这么多"。

用法：

```bash
python scripts/sls_get_logs.py --minutes 30 --reverse
# 临时覆盖默认 project / logstore：
python scripts/sls_get_logs.py --project <proj> --logstore <store> --minutes 30 --reverse
# AK 在别的环境变量里时：
python scripts/sls_get_logs.py --project <proj> --logstore <store> \
    --ak-env MY_AK_ENV --sk-env MY_SK_ENV --query ERROR
```

## 路线 B：官方 SDK

```bash
pip install aliyun-log-python-sdk
# Python 3.7 装完必须钉住 urllib3，否则 import 就崩：
pip install "urllib3<2.0.7"
```

```python
from aliyun.log import LogClient, GetLogsRequest
import os

# 注意：endpoint 是 region 级域名，不带 project；project 在每个 Request 里传
cli = LogClient("cn-hangzhou.log.aliyuncs.com",
                os.environ["ALIYUN_ACCESS_KEY_ID"], os.environ["ALIYUN_ACCESS_KEY_SECRET"])

# 标准翻页姿势：offset 累加，页不满即最后一页；设 max_pages 防失控
offset, page_size = 0, 500
for _ in range(300):
    page = cli.get_logs(GetLogsRequest(project, logstore, from_ts, to_ts,
                                       query="*", line=page_size, offset=offset)).get_logs()
    if not page:
        break
    for entry in page:
        contents = entry.get_contents()   # dict
        ...
    offset += len(page)
    if len(page) < page_size:
        break
```

## 日志库（logstore）查询经验

- `from`/`to` 是 unix **秒**（不是毫秒）。
- `query` 是全文/索引查询串（如 `ERROR`、`status>=500 and method:POST`）；`topic` 按 `__topic__` 精确过滤，两者可叠加。
- `reverse=true` 最新在前，排障看最新日志必开。
- **project/logstore 选择纪律**：不能只凭 project 名称“看起来像生产”或业务词相似就先查。先用用户给出的系统线索、服务名、应用名或已知前缀锚定 project（例如 SRM/supplier/API 应优先核对 `xhgj-zysys` 这类系统 project，而不是把 `xhxhgjmall` 仅因看起来像线上业务就当主入口）；再列该 project 的 logstore，并用 logstore 名、service/app 标记、已知 traceid 或 Request URL 反查确认。多个 K8s/业务 project 并存时，把未验证项目列为候选，不要直接下结论。
- **Java Forest/HTTP trace 配对纪律**：不能用“某条 trace 链路里出现 404”反推“目标接口本身 404”。同一 trace 里可能有多个外部请求，状态码各不相同；必须按时间回查完整链路，把 `[Forest] Request`、`Response: Status = ...`、`调用接口异常` 配对后，再判断具体哪个 Request URL 失败。
- 典型场景——**FC custom-container 排障**：FC 控制面只给 `operation not permitted` / `CAExited` 这类兜底信息，**真因（Java 堆栈等）在容器 stdout/stderr，落在 SLS**。FC 日志的 topic 形态是 `FCLogs:<函数名>`，用 `--topic` 精确过滤比全文查询准。
- 多行日志（Java 堆栈）是否合并成一条，取决于采集端配置（如 K8s 采集 CRD 的 Multiline 配置），查询侧改不了；散成 N 条时按 `__time__` + 实例 id 拼回去。

## 指标库（metricstore）经验（坑最集中）

metricstore 也走 GetLogs 接口读，但行为和日志库差异很大：

1. **query 不支持按 metric 名/label 过滤**——只能 `query='*'` 全量翻页 + 客户端过滤。别浪费时间调查询语法。
2. 样本字段：`__name__`（指标名）、`__labels__`、`__value__`、`__time_nano__`。
   `__labels__` 是 `k#$#v|k#$#v` 格式的扁平串，高频解析时按子串定位取值比全量 split 省：
   ```python
   def label_of(labels: str, key: str) -> str:
       tag = key + "#$#"
       i = labels.find(tag)
       if i < 0:
           return ""
       start = i + len(tag)
       end = labels.find("|", start)
       return labels[start:] if end < 0 else labels[start:end]
   ```
3. **`__value__` 语义要先确认是周期增量还是瞬时值**（同一 store 里两类都有，counter 类通常是周期增量）：增量型窗口内 Σ 即总量，QPS = Σ/窗口秒；gauge 型取均值。搞反了结果差几个数量级。
4. **窗口要小**（2~3 分钟）：全量翻页有页数上限，大窗口样本超限被**静默截断→低估**。要算长周期就多时点小窗采样外推，不要拉大窗口。
5. **同一指标常有多个聚合变体**（不同 `_ign_*` 后缀 = 不同预聚合粒度），必须固定取一个变体，混着 Σ 会重复计数。
6. **入站/出站按 label 区分再聚合**（如 ARMS 的 `callType`：`http` 是入站请求，`mysql/redis/mq/http_client` 是出站调用）。不区分全 Σ 会把 DB 查询算进请求量，QPS 虚高、RT 被稀释。
7. **配置 TTL ≠ 有效保留**：见过配 `ttl=90` 实际只有 4~5 天滚动数据的 metricstore（上游写入策略决定）。取历史数据前先小窗探一下边界日期，别按 TTL 做承诺；长历史考虑上游有没有别的存储（如 ARMS 原生 Prometheus 实例保 ~90 天）。
8. **零值不产 series**：error_count 之类指标零错误时整条 series 不存在，查空 ≠ 取不到，别据此判定"没接入"。

## 排错速查

| 现象 | 判读 |
|---|---|
| 401 Unauthorized | AK 无效/已禁用 |
| 403 + `Unauthorized`/`denied by ram` | RAM 缺 action 或 resource 不匹配（先核对 project/logstore 拼写） |
| `signature not match` | StringToSign 拼装错。依次查：query 是否按 key 升序、签名用原值 URL 用 encode、Date 是否 GMT 格式、x-log-* 头是否全进了 CanonicalizedHeaders |
| 返回 200 但行数可疑地少 | 看 `x-log-progress` 是否 Incomplete；metricstore 看是否翻页触顶截断 |
| SDK import 报 urllib3 错 | `pip install "urllib3<2.0.7"`（老 Python 通病） |

## Windows / Git Bash 环境防呆

- 用 `python` 不要用 `python3`：Windows 的 `python3` 常是 WindowsApps 空桩（静默 exit）。
- 脚本输出中文前 `sys.stdout.reconfigure(encoding="utf-8")`，防 GBK 控制台乱码。
- 临时文件用绝对 Windows 路径（`D:/tmp/...`），别用 `/tmp`——各工具链对 `/tmp` 的解析不互通。
