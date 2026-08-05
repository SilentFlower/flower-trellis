# 阿里云 DMS：AK/SK 直连查线上库

沉淀自真实生产排障（SRM 银行回单积压单据分类统计），所有姿势都在 `product` 环境实跑验证过。

## 为什么用它

线上库通常不允许从开发机直连，但 DMS 已经纳管了实例并做了审计与管控。走 DMS OpenAPI 既能拿到真实生产数据，又天然落在审计里。**注意区分测试库**：库名可能有极强迷惑性（见过线上 schema 叫 `srm`、测试库反而叫 `srm_prod` 的情况），务必用 `EnvType=product` 和 `InstanceId` 确认，而不是看库名。

## 核心安全模型（先理解，再动手）

DMS 对只读和写入是**两条完全不同的通道**，这是本 skill 的核心：

| 操作 | 通道 | 行为 |
|---|---|---|
| SELECT/SHOW/DESC/EXPLAIN/WITH | `ExecuteScript` | 直连执行，立即返回结果集，**不经审批** |
| UPDATE/DELETE/INSERT/DDL | `CreateDataCorrectOrder` | 创建数据变更工单，**走审批流** |

在 `COMMON`(安全协作) 管控模式的实例上，DML 走 `ExecuteScript` 会被安全规则直接拦截，返回类似：

```
匹配到的安全规则: 数字化自研管控规则(ID:2354483)
根据安全规则,需要提交SQL变更工单执行该命令类型:UPDATE
具体规则ID=114801843( 规则名：禁止所有DML在SQL控制台直接执行，必须以工单方式执行 )
```

所以脚本在本地就拦掉 DML 并提示改用 `order` 子命令 —— 不是多余的保护，而是匹配服务端的真实行为。先用 `instances` 看实例的 `Mode` 列确认管控模式：`NONE_CONTROL`(自由操作) / `STABLE`(稳定变更) / `COMMON`(安全协作)。

## 凭证纪律

1. **AK/SK 只走进程环境变量或权限为 `600` 的私有 ENV 文件**，不写入 skill、仓库、命令行参数或代码。脚本只从 `os.environ` 取，取不到就 fail-fast。
2. **AK 永远不出现在 stdout**。任何可能回显凭证的命令结尾兜底脱敏：
   ```bash
   ... | sed -E 's/LTAI[0-9A-Za-z]+/<AK>/g'
   ```
3. RAM 授权按最小面给。只读取数场景给 `dms:ExecuteScript` + `dms:ListInstances` + `dms:ListDatabases`；需要提工单再加 `dms:CreateDataCorrectOrder`。同机多把 AK 时用 `--ak-env` / `--sk-env` 指定变量名，不要写死。

新用户首次使用：

```bash
mkdir -p ~/.config/aliyun-ops
install -m 600 assets/env.example ~/.config/aliyun-ops/env
```

默认配置查找顺序：进程环境变量 → `~/.config/aliyun-ops/env` → `~/.config/aliyun-dms-query/env` → `~/.config/aliyun-sls-query/env`。旧文件只读且继续有效，无需迁移。用 `--env-file`、`ALIYUN_DMS_ENV_FILE` 或 `ALIYUN_OPS_ENV_FILE` 显式指定时**文件必须存在**，且不会再回退其它文件，避免"以为读了配置、实际用了别处凭证"。

## 用法

以下命令均在本 Skill 目录中执行：

```bash
# 1) 找实例 —— 先看 Env 和 Mode，确认是不是生产、什么管控模式
python3 scripts/dms.py instances --search SRM

# 2) 拿 DbId —— 查询必须用 DbId，不是库名
python3 scripts/dms.py databases --instance 2873479

# 3) 只读查询
python3 scripts/dms.py query --db 78407446 --sql "SELECT COUNT(*) FROM t_xxx"
python3 scripts/dms.py --format csv query --db 78407446 --file ./stat.sql > out.csv

# 4) 变更走工单：不加 --yes 只预览，加了才真正创建
python3 scripts/dms.py order --db 78407446 \
    --sql "UPDATE t_xxx SET c_a='1' WHERE id='...'" \
    --rows 1 --comment "【生产库】xxx
【原因】yyy" --yes

# 5) 看工单
python3 scripts/dms.py orders --limit 10
```

输出格式 `--format table|json|csv`，默认 table。它是全局参数，必须写在 `query` 等子命令之前。

## 工单描述规范

`--comment` 会展示给审批人，团队既有格式（从历史工单观察）：

```
【生产库】修改订单开票状态
【原因】将指定外部订单号的订单，且当前处于启用状态的记录...
```

即**第一行说改什么，第二行起说为什么**。`--rows`(预估影响行数) 是 DMS 强制必填，提交前应先用 `query` 跑一遍等价的 `SELECT COUNT(*)` 拿到真实行数，别拍脑袋填 —— 与实际差距过大会被审批人打回。有条件时用 `--rollback` 附上回滚 SQL。

## 查询经验

- **DbId ≠ InstanceId**。`query` 用 `DatabaseId`(如 78407446)，`databases` 用 `InstanceId`(如 2873479)。
- 默认 `QueryTimeout=60` 秒（实例级配置，`instances` 可见）。大表聚合先加时间/索引条件，别裸跑全表。
- `Logic=false` 是物理库；逻辑库(分库分表)才加 `--logic`。
- 多语句会返回多个结果集，脚本按 `--- 结果集 N ---` 分段输出。
- 结果集大时优先 `--format csv` 重定向到文件，别刷屏。
- 统计口径要**以代码为准**：先从 Repository/Mapper 里把真实的 WHERE 条件抄出来，再翻译成 SQL。凭字段名猜口径极易算错（如枚举存的是中文名"银行转账"而非 code）。

## 排错速查

| 现象 | 判读 |
|---|---|
| `MissingHost` | `GetInstance` 需要 Host 参数；只想看实例配置用 `ListInstances` 更省事 |
| `403 InvalidParameterValid`(ListOrders) | `OrderResultType` 需要额外权限。去掉该参数即可正常返回 |
| `需要提交SQL变更工单执行该命令类型` | 命中 COMMON 管控规则，改走 `order` 子命令 |
| `MissingComment` / `MissingParam` / `MissingEstimateAffectRows` | 工单三个必填项：`--comment` / `Param(自动组装)` / `--rows` |
| `SignatureDoesNotMatch` | RPC v1.0 签名拼装错。注意 DMS 用 **HMAC-SHA1 + `SK&` 作为密钥**，与 SLS 的自有 V1 签名是两套协议，签名器不能复用 |
| 查出来的数量和线上感知差很多 | 先确认连的是不是生产：看 `EnvType` 和 `InstanceId`，**不要信库名** |
