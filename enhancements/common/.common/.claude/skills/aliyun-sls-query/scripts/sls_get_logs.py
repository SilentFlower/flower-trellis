#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""用 AK/SK 查询阿里云 SLS（日志服务）logstore —— 纯 Python 标准库，零第三方依赖。

适用场景：机器上没有 aliyun CLI / aliyun-log-python-sdk，又需要临时拉日志排查。
SLS 用自有 V1 签名（HMAC-SHA1 + x-log-* headers），与阿里云 RPC/ROA 的
ACS3-HMAC-SHA256 是两套协议，不能混用，故单独实现。

配置：先读取进程环境变量，再从 ~/.config/aliyun-sls-query/env 补齐缺失项；
     可用 --env-file 或 ALIYUN_SLS_ENV_FILE 指定其它配置文件。
凭证：默认使用 ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET；
     可用 --ak-env / --sk-env 指定其它环境变量名（AK/SK 永远不进命令行参数）。

用法示例：
  # 拉最近 30 分钟日志，最新在前
  python sls_get_logs.py --project <proj> --logstore <store> --minutes 30 --reverse

  # 全文查询 + 指定时间窗（unix 秒）
  python sls_get_logs.py --project <proj> --logstore <store> \
      --from 1780300000 --to 1780306000 --query ERROR

  # 按 topic 精确过滤（FC 容器日志 topic=FCLogs:<函数名>）
  python sls_get_logs.py --project <proj> --logstore <store> \
      --topic "FCLogs:my-func" --minutes 10 --raw
"""
import argparse
import base64
import gzip
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from email.utils import formatdate
from pathlib import Path


DEFAULT_ENV_FILE = "~/.config/aliyun-sls-query/env"


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
            char.isalnum() or char == "_" for char in key
        ):
            raise ValueError(f"第 {line_no} 行变量名不合法: {key!r}")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        values[key] = value
    return values


def _load_env_file(path, required=False):
    """加载私有配置，已有进程环境变量优先。"""
    env_path = Path(path).expanduser()
    if not env_path.is_file():
        if required:
            raise FileNotFoundError(f"ENV 文件不存在: {env_path}")
        return env_path
    for key, value in _parse_env_file(env_path).items():
        if not os.environ.get(key):
            os.environ[key] = value
    return env_path


def _bootstrap_env(argv):
    """在构造完整参数默认值前加载 ENV 文件。"""
    configured_path = os.environ.get("ALIYUN_SLS_ENV_FILE", DEFAULT_ENV_FILE)
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--env-file", default=configured_path)
    known, _ = parser.parse_known_args(argv)
    explicit = "--env-file" in argv or "ALIYUN_SLS_ENV_FILE" in os.environ
    return _load_env_file(known.env_file, required=explicit)


def _canonicalized_headers(headers):
    # 只收 x-log-* / x-acs-*，key 转小写后按字典序
    items = []
    for k in sorted(headers, key=lambda x: x.lower()):
        lk = k.lower()
        if lk.startswith("x-log-") or lk.startswith("x-acs-"):
            items.append(f"{lk}:{headers[k]}")
    return "\n".join(items)


def _canonicalized_resource(path, params):
    if not params:
        return path
    # 签名串里的 query 用【原值】按 key 升序拼接，不做 urlencode；
    # 实际请求 URL 才 urlencode。两边不一致是 signature not match 的头号来源。
    sorted_q = "&".join(f"{k}={params[k]}" for k in sorted(params))
    return f"{path}?{sorted_q}"


def _sign(method, path, params, headers, ak, sk):
    string_to_sign = "\n".join([
        method,
        headers.get("Content-MD5", ""),
        headers.get("Content-Type", ""),
        headers["Date"],
        _canonicalized_headers(headers),
        _canonicalized_resource(path, params),
    ])
    sig = base64.b64encode(
        hmac.new(sk.encode("utf-8"), string_to_sign.encode("utf-8"), hashlib.sha1).digest()
    ).decode("utf-8")
    return f"LOG {ak}:{sig}"


def get_logs(project, logstore, region, ak, sk, from_ts, to_ts,
             query="", line=100, offset=0, reverse=False, topic="", timeout=30):
    """调 SLS GetLogs（查询 logstore 日志）。返回 (http_status, data, progress, err)。

    data：命中日志的 list（每条是 dict）；progress：x-log-progress 响应头，
    'Incomplete' 表示查询没扫完（大时间窗常见），应重试或缩窗。
    """
    host = f"{project}.{region}.log.aliyuncs.com"
    path = f"/logstores/{logstore}"
    params = {
        "type": "log",
        "from": str(int(from_ts)),
        "to": str(int(to_ts)),
        "line": str(int(line)),
        "offset": str(int(offset)),
        "reverse": "true" if reverse else "false",
    }
    if topic:
        params["topic"] = topic
    if query:
        params["query"] = query
    headers = {
        "Host": host,
        "Date": formatdate(timeval=time.time(), usegmt=True),
        "x-log-apiversion": "0.6.0",
        "x-log-signaturemethod": "hmac-sha1",
        "x-log-bodyrawsize": "0",
        "Content-Length": "0",
    }
    headers["Authorization"] = _sign("GET", path, params, headers, ak, sk)
    url = f"https://{host}{path}?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, method="GET", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            if resp.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            progress = resp.headers.get("x-log-progress", "")
            return resp.status, json.loads(raw.decode("utf-8")), progress, ""
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        return exc.code, None, "", body
    except Exception as exc:  # noqa: BLE001
        return -1, None, "", f"{type(exc).__name__}: {exc}"


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass
    try:
        env_file = _bootstrap_env(sys.argv[1:])
    except (OSError, ValueError) as exc:
        print(f"[sls] ENV 配置读取失败: {exc}", file=sys.stderr)
        return 2

    ap = argparse.ArgumentParser(description="查询阿里云 SLS logstore（stdlib-only）")
    ap.add_argument(
        "--env-file",
        default=str(env_file),
        help=f"私有 ENV 文件，默认 {DEFAULT_ENV_FILE}",
    )
    ap.add_argument(
        "--project",
        default=os.environ.get("ALIYUN_SLS_PROJECT", ""),
        help="SLS project 名，也可通过 ALIYUN_SLS_PROJECT 配置",
    )
    ap.add_argument(
        "--logstore",
        default=os.environ.get("ALIYUN_SLS_LOGSTORE", ""),
        help="logstore 名，也可通过 ALIYUN_SLS_LOGSTORE 配置",
    )
    ap.add_argument(
        "--region",
        default=os.environ.get("ALIYUN_SLS_REGION", "cn-hangzhou"),
        help="region，默认读取 ALIYUN_SLS_REGION 或使用 cn-hangzhou",
    )
    ap.add_argument("--ak-env", default="ALIYUN_ACCESS_KEY_ID", help="AK 所在环境变量名")
    ap.add_argument("--sk-env", default="ALIYUN_ACCESS_KEY_SECRET", help="SK 所在环境变量名")
    ap.add_argument("--minutes", type=int, default=30, help="拉最近 N 分钟（与 --from/--to 二选一）")
    ap.add_argument("--from", dest="from_ts", type=int, default=None, help="起始 unix 秒")
    ap.add_argument("--to", dest="to_ts", type=int, default=None, help="结束 unix 秒")
    ap.add_argument("--query", default="", help="SLS 查询串（全文/索引字段查询）")
    ap.add_argument("--topic", default="", help="按 __topic__ 精确过滤")
    ap.add_argument("--line", type=int, default=100, help="最多返回行数（单页上限 100）")
    ap.add_argument("--offset", type=int, default=0, help="翻页偏移")
    ap.add_argument("--reverse", action="store_true", help="按时间倒序（最新在前）")
    ap.add_argument("--raw", action="store_true", help="打印原始 JSON（看有哪些字段）")
    args = ap.parse_args()

    if not args.project or not args.logstore:
        print(
            "[sls] 请通过参数或 ENV 配置 ALIYUN_SLS_PROJECT / ALIYUN_SLS_LOGSTORE",
            file=sys.stderr,
        )
        return 2

    ak = os.environ.get(args.ak_env, "")
    sk = os.environ.get(args.sk_env, "")
    if not ak or not sk:
        print(f"[sls] 环境变量 {args.ak_env} / {args.sk_env} 未设置或为空", file=sys.stderr)
        return 2

    now = int(time.time())
    to_ts = args.to_ts if args.to_ts is not None else now
    from_ts = args.from_ts if args.from_ts is not None else now - args.minutes * 60

    status, data, progress, err = get_logs(
        args.project, args.logstore, args.region, ak, sk,
        from_ts, to_ts, query=args.query, line=args.line, offset=args.offset,
        reverse=args.reverse, topic=args.topic,
    )
    if status != 200:
        print(f"[sls] HTTP {status}: {err}", file=sys.stderr)
        return 1
    if progress and progress != "Complete":
        print(f"[sls] 警告：x-log-progress={progress}，结果不完整，建议缩小时间窗或重试", file=sys.stderr)
    if args.raw:
        print(json.dumps(data, ensure_ascii=False, indent=2))
        return 0
    logs = data if isinstance(data, list) else []
    for item in logs:
        ts = item.get("__time__", "")
        msg = item.get("message") or item.get("content") or json.dumps(item, ensure_ascii=False)
        print(f"{ts}  {msg}")
    print(f"\n[sls] {len(logs)} 行（from={from_ts} to={to_ts} "
          f"query={args.query!r} topic={args.topic!r} offset={args.offset}）", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
