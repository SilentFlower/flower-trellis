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
import base64
import csv
import hashlib
import hmac
import io
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

# 主配置文件；不存在时回退到 SLS skill 的配置(通常是同一把 AK)
DEFAULT_ENV_FILE = "~/.config/aliyun-dms-query/env"
FALLBACK_ENV_FILE = "~/.config/aliyun-sls-query/env"

ENDPOINT = "dms-enterprise.aliyuncs.com"
API_VERSION = "2018-11-01"

# 只读语句白名单：这些直接走 ExecuteScript
READONLY_HEADS = {"SELECT", "SHOW", "DESC", "DESCRIBE", "EXPLAIN", "WITH"}


# --------------------------------------------------------------------------
# 配置加载
# --------------------------------------------------------------------------
def _parse_env_file(path):
    """解析简单 KEY=VALUE 配置文件，不执行 shell 展开。"""
    values = {}
    for line_no, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            raise ValueError(f"第 {line_no} 行缺少 '='")
        key, value = line.split("=", 1)
        key = key.strip()
        if not key or not (key[0].isalpha() or key[0] == "_") or not all(
            c.isalnum() or c == "_" for c in key
        ):
            raise ValueError(f"第 {line_no} 行变量名不合法: {key!r}")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        values[key] = value
    return values


def load_env(explicit_path=None):
    """加载配置。已存在的进程环境变量优先，配置文件只补缺失项。

    显式指定(--env-file 或 ALIYUN_DMS_ENV_FILE)时，文件必须存在，否则 fail-fast，
    避免"以为读了配置、实际用了别处凭证"的静默错配。
    未显式指定时，按 DMS 专用 → SLS 共用 的顺序依次补齐(通常是同一把 AK)。
    """
    explicit = explicit_path or os.environ.get("ALIYUN_DMS_ENV_FILE")
    if explicit:
        p = Path(explicit).expanduser()
        if not p.is_file():
            raise FileNotFoundError(f"ENV 文件不存在: {p}")
        for k, v in _parse_env_file(p).items():
            if not os.environ.get(k):
                os.environ[k] = v
        return [str(p)]

    loaded = []
    for cand in (DEFAULT_ENV_FILE, FALLBACK_ENV_FILE):
        p = Path(cand).expanduser()
        if not p.is_file():
            continue
        for k, v in _parse_env_file(p).items():
            if not os.environ.get(k):
                os.environ[k] = v
        loaded.append(str(p))
    return loaded


def get_credentials(ak_env, sk_env):
    """取 AK/SK。取不到直接 fail-fast，绝不回显凭证内容。"""
    ak, sk = os.environ.get(ak_env, ""), os.environ.get(sk_env, "")
    if not ak or not sk:
        raise SystemExit(
            f"[dms] 环境变量 {ak_env} / {sk_env} 未设置。\n"
            f"      请创建 {DEFAULT_ENV_FILE} (权限 600) 并填入凭证。"
        )
    return ak, sk


# --------------------------------------------------------------------------
# RPC v1.0 签名与调用
# --------------------------------------------------------------------------
def _pct(s):
    """阿里云 RPC 签名要求的 percent encode(safe='~')。"""
    return urllib.parse.quote(str(s), safe="~")


def rpc(action, params, ak, sk, timeout=60):
    """调用 DMS RPC 接口。返回 (http_status, body_dict)。"""
    q = {
        "Format": "JSON",
        "Version": API_VERSION,
        "Action": action,
        "AccessKeyId": ak,
        "SignatureMethod": "HMAC-SHA1",
        "SignatureVersion": "1.0",
        "SignatureNonce": uuid.uuid4().hex,
        "Timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    q.update({k: v for k, v in params.items() if v is not None})
    # StringToSign = METHOD & pct(/) & pct(按key升序拼接的query)
    canon = "&".join(f"{_pct(k)}={_pct(q[k])}" for k in sorted(q))
    sts = f"POST&{_pct('/')}&{_pct(canon)}"
    q["Signature"] = base64.b64encode(
        hmac.new((sk + "&").encode(), sts.encode(), hashlib.sha1).digest()
    ).decode()
    req = urllib.request.Request(
        f"https://{ENDPOINT}/", data=urllib.parse.urlencode(q).encode(), method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, json.loads(exc.read().decode("utf-8"))
        except Exception:
            return exc.code, {"Message": "unparseable error body"}
    except Exception as exc:  # noqa: BLE001
        return -1, {"Message": f"{type(exc).__name__}: {exc}"}


def _fail(status, body, what):
    """统一的错误输出。"""
    code = body.get("Code", "")
    msg = body.get("Message", "")
    print(f"[dms] {what} 失败: HTTP {status} {code} {msg}", file=sys.stderr)
    return 1


def resolve_tid(ak, sk, tid=None):
    """未显式指定 Tid 时，自动取当前激活租户。"""
    if tid:
        return int(tid)
    st, b = rpc("GetUserActiveTenant", {}, ak, sk)
    if st != 200 or not b.get("Tenant"):
        raise SystemExit(f"[dms] 无法获取租户 Tid: HTTP {st} {b.get('Message','')}")
    return int(b["Tenant"]["Tid"])


# --------------------------------------------------------------------------
# 结果渲染
# --------------------------------------------------------------------------
def render(cols, rows, fmt, max_width=60):
    """按指定格式输出结果集。"""
    if fmt == "json":
        print(json.dumps(rows, ensure_ascii=False, indent=2))
        return
    if fmt == "csv":
        w = csv.DictWriter(sys.stdout, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
        return
    # table：按列内容宽度对齐
    if not rows:
        print("  (0 行)")
        return
    widths = {}
    for c in cols:
        cell_max = max((len(str(r.get(c, ""))[:max_width]) for r in rows), default=0)
        widths[c] = min(max(len(c), cell_max), max_width)
    print("  " + " | ".join(str(c).ljust(widths[c]) for c in cols))
    print("  " + "-+-".join("-" * widths[c] for c in cols))
    for r in rows:
        print("  " + " | ".join(str(r.get(c, ""))[:max_width].ljust(widths[c]) for c in cols))
    print(f"\n  ({len(rows)} 行)")


# --------------------------------------------------------------------------
# 子命令
# --------------------------------------------------------------------------
def cmd_instances(args, ak, sk):
    """列出 DMS 纳管的实例。"""
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
    render(list(rows[0].keys()) if rows else [], rows, args.format)
    return 0


def cmd_databases(args, ak, sk):
    """列出某实例下的数据库(含 DbId，查询时要用)。"""
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
    render(list(rows[0].keys()) if rows else [], rows, args.format)
    return 0


def cmd_query(args, ak, sk):
    """执行只读 SQL。DML 会被拒绝并提示改用 order 子命令。"""
    script = args.sql
    if args.file:
        script = Path(args.file).expanduser().read_text(encoding="utf-8")
    script = script.strip().rstrip(";")
    head = script.lstrip("( \t\n").split(None, 1)[0].upper() if script else ""
    if head not in READONLY_HEADS:
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
        render(r.get("ColumnNames") or [], r.get("Rows") or [], args.format)
    return rc


def cmd_order(args, ak, sk):
    """提交数据变更工单(DML 走审批流)。

    注意：这是有副作用的操作，会在 DMS 中真实创建一张待审批工单。
    必须显式带 --yes 才会提交。
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
    render(list(rows[0].keys()) if rows else [], rows, args.format)
    return 0


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

    ap = argparse.ArgumentParser(
        description="阿里云 DMS OpenAPI 客户端(stdlib-only)。只读直连，DML 走工单。")
    ap.add_argument("--env-file", help=f"私有 ENV 文件，默认 {DEFAULT_ENV_FILE}")
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
    ak, sk = get_credentials(args.ak_env, args.sk_env)
    return args.func(args, ak, sk)


if __name__ == "__main__":
    sys.exit(main())
