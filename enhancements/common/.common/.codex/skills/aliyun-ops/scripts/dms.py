#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""阿里云 DMS(数据管理) OpenAPI 客户端 —— 纯 Python 标准库，零第三方依赖。

用途：在没有 aliyun CLI / DMS SDK 的环境下，直接用 AK/SK 查询 DMS 纳管的数据库。

协议要点：
  DMS 用阿里云 **RPC v1.0 签名**(HMAC-SHA1)，与 SLS 的自有 V1 签名(LOG <AK>:<sig>)
  是两套完全不同的协议，签名器不能互相复用。

安全模型(实测自 COMMON 管控模式实例)：
  - SELECT 等只读语句：ExecuteScript 直连执行，立即返回结果集，不经审批。
  - UPDATE/DELETE/INSERT 等 DML：被安全规则拦截，报
    "禁止所有DML在SQL控制台直接执行，必须以工单方式执行"，
    必须改走 CreateDataCorrectOrder 提交数据变更工单，由审批流处理。
  本脚本据此自动分流：只读走 query，DML 走 order。

配置：先读进程环境变量，再从 ENV 文件补齐缺失项。
凭证：AK/SK 只从环境变量/私有 ENV 文件读取，绝不接受命令行传入、绝不打印。
"""
import argparse
import json
import os
import sys
from pathlib import Path

from aliyun_common import UNIFIED_ENV_FILE, get_credentials, load_product_env, render_rows
from aliyun_rpc_v1 import rpc_request

ENDPOINT = "dms-enterprise.aliyuncs.com"
API_VERSION = "2018-11-01"

# 只读语句白名单：这些直接走 ExecuteScript
READONLY_HEADS = {"SELECT", "SHOW", "DESC", "DESCRIBE", "EXPLAIN", "WITH"}
MUTATING_SQL_KEYWORDS = {
    "ALTER",
    "CALL",
    "CREATE",
    "DELETE",
    "DO",
    "DROP",
    "GRANT",
    "INSERT",
    "LOAD",
    "LOCK",
    "MERGE",
    "OPTIMIZE",
    "RENAME",
    "REPAIR",
    "REPLACE",
    "REVOKE",
    "SET",
    "TRUNCATE",
    "UNLOCK",
    "UPDATE",
    "USE",
}


# --------------------------------------------------------------------------
# 配置加载
# --------------------------------------------------------------------------
def load_env(explicit_path=None):
    """按统一入口和 DMS 旧路径加载配置。

    @param explicit_path: ``--env-file`` 显式路径。
    @return: 实际读取过的配置文件路径。
    """
    return load_product_env("dms", explicit_path)


def _scan_sql_statements(script):
    """将 SQL 拆成不含注释和字符串内容的词元列表。"""
    statements = []
    tokens = []
    token = []
    quote = None
    block_comment = False
    index = 0

    def flush_token():
        if token:
            tokens.append("".join(token).upper())
            token.clear()

    def flush_statement():
        flush_token()
        if tokens:
            statements.append(tokens.copy())
            tokens.clear()

    while index < len(script):
        char = script[index]
        next_char = script[index + 1] if index + 1 < len(script) else ""

        if quote is not None:
            if char == "\\" and next_char:
                index += 2
                continue
            if char == quote:
                if next_char == quote:
                    index += 2
                    continue
                quote = None
            index += 1
            continue

        if block_comment:
            if char == "*" and next_char == "/":
                block_comment = False
                index += 2
                continue
            index += 1
            continue

        if char in {"'", '"', "`"}:
            flush_token()
            quote = char
            index += 1
            continue
        if char == "/" and next_char == "*":
            flush_token()
            if index + 2 < len(script) and script[index + 2] == "!":
                return [], "MYSQL_EXEC_COMMENT"
            block_comment = True
            index += 2
            continue
        if char == "#":
            flush_token()
            index = script.find("\n", index)
            if index == -1:
                break
            continue
        if char == "-" and next_char == "-":
            after = script[index + 2] if index + 2 < len(script) else ""
            if not after or after.isspace():
                flush_token()
                index = script.find("\n", index)
                if index == -1:
                    break
                continue
        if char == ";":
            flush_statement()
            index += 1
            continue
        if char.isalnum() or char in {"_", "$"}:
            token.append(char)
        else:
            flush_token()
        index += 1

    if quote is not None or block_comment:
        return [], "INVALID_SQL"
    flush_statement()
    return statements, None


def _find_non_readonly_head(script):
    """返回首个非只读语句关键词，全部只读时返回 ``None``。"""
    statements, scan_error = _scan_sql_statements(script)
    if scan_error:
        return scan_error
    if not statements:
        return "EMPTY"
    for tokens in statements:
        head = tokens[0]
        if head not in READONLY_HEADS:
            return head
        if head == "WITH":
            # WITH 本身不代表只读，必须继续检查 CTE 与主语句中的写关键词。
            for keyword in tokens[1:]:
                if keyword in MUTATING_SQL_KEYWORDS:
                    return keyword
    return None


# --------------------------------------------------------------------------
# RPC v1.0 签名与调用
# --------------------------------------------------------------------------
def rpc(action, params, ak, sk, timeout=60):
    """调用 DMS RPC 接口。

    @param action: DMS OpenAPI Action。
    @param params: DMS 业务参数。
    @param ak: AccessKey ID。
    @param sk: AccessKey Secret。
    @param timeout: 网络超时秒数。
    @return: ``(http_status, body_dict)`` 元组。
    """
    return rpc_request(
        ENDPOINT,
        API_VERSION,
        action,
        params,
        ak,
        sk,
        method="POST",
        timeout=timeout,
    )


def _fail(status, body, what):
    """统一的错误输出。"""
    code = body.get("Code", "")
    msg = body.get("Message", "")
    print(f"[dms] {what} 失败: HTTP {status} {code} {msg}", file=sys.stderr)
    return 1


def resolve_tid(ak, sk, tid=None):
    """未显式指定 Tid 时自动取当前激活租户。

    @param ak: AccessKey ID。
    @param sk: AccessKey Secret。
    @param tid: 可选的 DMS 租户 ID。
    @return: 整数形式的租户 ID。
    """
    if tid:
        return int(tid)
    st, b = rpc("GetUserActiveTenant", {}, ak, sk)
    if st != 200 or not b.get("Tenant"):
        raise SystemExit(f"[dms] 无法获取租户 Tid: HTTP {st} {b.get('Message','')}")
    return int(b["Tenant"]["Tid"])


# --------------------------------------------------------------------------
# 结果渲染
# --------------------------------------------------------------------------
# --------------------------------------------------------------------------
# 子命令
# --------------------------------------------------------------------------
def cmd_instances(args, ak, sk):
    """列出 DMS 纳管的实例。

    @param args: instances 命令参数。
    @param ak: AccessKey ID。
    @param sk: AccessKey Secret。
    @return: 进程退出码。
    """
    tid = resolve_tid(ak, sk, args.tid)
    st, b = rpc("ListInstances", {
        "Tid": tid, "PageNumber": 1, "PageSize": args.limit,
        "SearchKey": args.search or None,
    }, ak, sk)
    if st != 200:
        return _fail(st, b, "ListInstances")
    items = (b.get("InstanceList") or {}).get("Instance", []) or []
    rows = [{
        "InstanceId": i.get("InstanceId"),
        "Alias": i.get("InstanceAlias"),
        "Type": i.get("InstanceType"),
        "Env": i.get("EnvType"),
        "SafeRule": (i.get("StandardGroup") or {}).get("GroupName"),
        "Mode": (i.get("StandardGroup") or {}).get("GroupMode"),
        "Host": i.get("Host"),
    } for i in items]
    render_rows(list(rows[0].keys()) if rows else [], rows, args.format)
    return 0


def cmd_databases(args, ak, sk):
    """列出某实例下的数据库。

    @param args: databases 命令参数。
    @param ak: AccessKey ID。
    @param sk: AccessKey Secret。
    @return: 进程退出码。
    """
    tid = resolve_tid(ak, sk, args.tid)
    st, b = rpc("ListDatabases", {"Tid": tid, "InstanceId": args.instance}, ak, sk)
    if st != 200:
        return _fail(st, b, "ListDatabases")
    items = (b.get("DatabaseList") or {}).get("Database", []) or []
    rows = [{
        "DbId": d.get("DatabaseId"),
        "Schema": d.get("SchemaName"),
        "Env": d.get("EnvType"),
        "State": d.get("State"),
        "Host": d.get("Host"),
    } for d in items]
    render_rows(list(rows[0].keys()) if rows else [], rows, args.format)
    return 0


def cmd_query(args, ak, sk):
    """执行只读 SQL，拒绝通过本通道执行 DML。

    @param args: query 命令参数。
    @param ak: AccessKey ID。
    @param sk: AccessKey Secret。
    @return: 进程退出码。
    """
    script = args.sql
    if args.file:
        script = Path(args.file).expanduser().read_text(encoding="utf-8")
    script = script.strip().rstrip(";")
    head = _find_non_readonly_head(script)
    if head is not None:
        print(
            f"[dms] 拒绝执行: 检测到非只读语句 ({head})。\n"
            f"      DMS 安全规则禁止 DML 在 SQL 控制台直接执行。\n"
            f"      请改用: dms.py order --db {args.db} --sql '<SQL>' "
            f"--rows <预估影响行数> --comment '<变更事由>'",
            file=sys.stderr,
        )
        return 2
    tid = resolve_tid(ak, sk, args.tid)
    st, b = rpc("ExecuteScript", {
        "Tid": tid, "DbId": args.db, "Logic": "true" if args.logic else "false",
        "Script": script,
    }, ak, sk, timeout=args.timeout)
    if st != 200 or not b.get("Success"):
        return _fail(st, b, "ExecuteScript")
    results = b.get("Results") or []
    if not results:
        print("  (无结果集)")
        return 0
    rc = 0
    for idx, r in enumerate(results):
        if len(results) > 1:
            print(f"--- 结果集 {idx + 1} ---")
        if not r.get("Success"):
            # 安全规则拦截等场景会走到这里，原文透出便于定位规则 ID
            print(f"[dms] 执行被拒: {r.get('Message', '')}", file=sys.stderr)
            rc = 1
            continue
        render_rows(r.get("ColumnNames") or [], r.get("Rows") or [], args.format)
    return rc


def cmd_order(args, ak, sk):
    """提交数据变更工单(DML 走审批流)。

    注意：这是有副作用的操作，会在 DMS 中真实创建一张待审批工单。
    必须显式带 --yes 才会提交。

    @param args: order 命令参数。
    @param ak: AccessKey ID。
    @param sk: AccessKey Secret。
    @return: 进程退出码。
    """
    script = args.sql
    if args.file:
        script = Path(args.file).expanduser().read_text(encoding="utf-8")
    script = script.strip()
    tid = resolve_tid(ak, sk, args.tid)

    param = {
        "dbItemList": [{"dbId": int(args.db), "logic": bool(args.logic)}],
        "sqlType": "TEXT",
        "exeSQL": script,
        "estimateAffectRows": int(args.rows),
        "classify": args.classify or "",
    }
    if args.rollback:
        param["rollbackSqlType"] = "TEXT"
        param["rollbackSQL"] = args.rollback

    print("=== 待提交的数据变更工单 ===")
    print(f"  Tid      : {tid}")
    print(f"  DbId     : {args.db}")
    print(f"  预估行数 : {args.rows}")
    print(f"  事由     : {args.comment}")
    print(f"  SQL      :\n{script}\n")
    if not args.yes:
        print("[dms] 未提交。确认无误后重跑并加 --yes 才会真正创建工单。", file=sys.stderr)
        return 0

    st, b = rpc("CreateDataCorrectOrder", {
        "Tid": tid,
        "Comment": args.comment,
        "Param": json.dumps(param, ensure_ascii=False),
        "EstimateAffectRows": int(args.rows),
    }, ak, sk)
    if st != 200 or not b.get("Success", True):
        return _fail(st, b, "CreateDataCorrectOrder")
    print(f"[dms] 工单已创建: {json.dumps(b, ensure_ascii=False)[:400]}")
    print("[dms] 请到 DMS 控制台跟进审批与执行。")
    return 0


def cmd_orders(args, ak, sk):
    """查询工单列表。

    注意：OrderResultType(按提交人/审批人筛选)需要额外的 RAM 权限，
    权限不足时接口返回 403 InvalidParameterValid。因此默认不传该参数，
    仅在用户显式指定 --result-type 时才带上。

    @param args: orders 命令参数。
    @param ak: AccessKey ID。
    @param sk: AccessKey Secret。
    @return: 进程退出码。
    """
    tid = resolve_tid(ak, sk, args.tid)
    st, b = rpc("ListOrders", {
        "Tid": tid, "PageNumber": 1, "PageSize": args.limit,
        "OrderResultType": args.result_type,
        "PluginType": args.plugin_type,
    }, ak, sk)
    if st != 200:
        if args.result_type:
            print("[dms] 提示: --result-type 需要额外权限，可去掉该参数重试。", file=sys.stderr)
        return _fail(st, b, "ListOrders")
    items = (b.get("Orders") or {}).get("Order", []) or []
    rows = [{
        "OrderId": o.get("OrderId"),
        "Status": o.get("StatusDesc"),
        "Type": o.get("PluginType"),
        "Comment": str(o.get("Comment", ""))[:40],
        "CreateTime": o.get("CreateTime"),
    } for o in items]
    render_rows(list(rows[0].keys()) if rows else [], rows, args.format)
    return 0


def main():
    """执行 DMS CLI。

    @return: 进程退出码。
    """
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

    ap = argparse.ArgumentParser(
        description="阿里云 DMS OpenAPI 客户端(stdlib-only)。只读直连，DML 走工单。")
    ap.add_argument("--env-file", help=f"私有 ENV 文件，默认 {UNIFIED_ENV_FILE}")
    ap.add_argument("--ak-env", default="ALIYUN_ACCESS_KEY_ID", help="AK 所在环境变量名")
    ap.add_argument("--sk-env", default="ALIYUN_ACCESS_KEY_SECRET", help="SK 所在环境变量名")
    ap.add_argument("--tid", help="DMS 租户 Tid，默认自动取当前激活租户")
    ap.add_argument("--format", choices=["table", "json", "csv"], default="table")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("instances", help="列出实例")
    p.add_argument("--search", help="按别名搜索")
    p.add_argument("--limit", type=int, default=100)
    p.set_defaults(func=cmd_instances)

    p = sub.add_parser("databases", help="列出某实例下的库(拿 DbId)")
    p.add_argument("--instance", required=True, help="InstanceId")
    p.set_defaults(func=cmd_databases)

    p = sub.add_parser("query", help="执行只读 SQL(SELECT/SHOW/DESC/EXPLAIN/WITH)")
    p.add_argument("--db", required=True, help="DbId")
    p.add_argument("--sql", default="", help="SQL 语句")
    p.add_argument("--file", help="从文件读 SQL")
    p.add_argument("--logic", action="store_true", help="逻辑库")
    p.add_argument("--timeout", type=int, default=60)
    p.set_defaults(func=cmd_query)

    p = sub.add_parser("order", help="提交数据变更工单(UPDATE/DELETE/INSERT)")
    p.add_argument("--db", required=True, help="DbId")
    p.add_argument("--sql", default="", help="变更 SQL")
    p.add_argument("--file", help="从文件读 SQL")
    p.add_argument("--rows", required=True, help="预估影响行数(必填，DMS 要求)")
    p.add_argument("--comment", required=True, help="变更事由(必填，会展示给审批人)")
    p.add_argument("--rollback", help="回滚 SQL")
    p.add_argument("--classify", help="工单分类")
    p.add_argument("--logic", action="store_true")
    p.add_argument("--yes", action="store_true", help="确认提交(不加则只预览)")
    p.set_defaults(func=cmd_order)

    p = sub.add_parser("orders", help="查看工单列表")
    p.add_argument("--limit", type=int, default=20)
    p.add_argument("--result-type", choices=["AS_SUBMITTER", "AS_APPROVER", "AS_EXECUTOR"],
                   help="按角色筛选(需额外权限，权限不足会 403)")
    p.add_argument("--plugin-type", help="工单类型，如 DATA_CORRECT")
    p.set_defaults(func=cmd_orders)

    args = ap.parse_args()
    try:
        load_env(args.env_file)
    except (OSError, ValueError) as exc:
        print(f"[dms] ENV 配置读取失败: {exc}", file=sys.stderr)
        return 2
    if not args.tid:
        args.tid = os.environ.get("ALIYUN_DMS_TID")
    try:
        ak, sk = get_credentials("dms", args.ak_env, args.sk_env)
    except ValueError as exc:
        print(exc, file=sys.stderr)
        return 2
    return args.func(args, ak, sk)


if __name__ == "__main__":
    sys.exit(main())
