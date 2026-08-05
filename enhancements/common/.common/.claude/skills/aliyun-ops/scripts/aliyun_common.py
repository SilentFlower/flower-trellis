#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""阿里云运维脚本共享的配置、凭证与输出工具。"""

import csv
import json
import os
import sys
from pathlib import Path


UNIFIED_ENV_FILE = "~/.config/aliyun-ops/env"
LEGACY_DMS_ENV_FILE = "~/.config/aliyun-dms-query/env"
LEGACY_SLS_ENV_FILE = "~/.config/aliyun-sls-query/env"

_PRODUCT_ENV_VARS = {
    "dms": "ALIYUN_DMS_ENV_FILE",
    "sls": "ALIYUN_SLS_ENV_FILE",
    "mse": "ALIYUN_MSE_ENV_FILE",
}
_PRODUCT_LEGACY_FILES = {
    "dms": (LEGACY_DMS_ENV_FILE, LEGACY_SLS_ENV_FILE),
    "sls": (LEGACY_SLS_ENV_FILE, LEGACY_DMS_ENV_FILE),
    "mse": (LEGACY_SLS_ENV_FILE, LEGACY_DMS_ENV_FILE),
}


def parse_env_file(path):
    """解析简单的 ``KEY=VALUE`` 文件，不执行 shell 展开。

    @param path: ENV 文件路径。
    @return: 文件中解析出的环境变量字典。
    """
    env_path = Path(path).expanduser()
    values = {}
    for line_no, raw_line in enumerate(
        env_path.read_text(encoding="utf-8").splitlines(),
        1,
    ):
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


def _load_env_file(path, required):
    """只用文件内容补齐尚未设置的进程环境变量。"""
    env_path = Path(path).expanduser()
    if not env_path.is_file():
        if required:
            raise FileNotFoundError(f"ENV 文件不存在: {env_path}")
        return None
    if os.name != "nt" and env_path.stat().st_mode & 0o077:
        raise PermissionError(f"ENV 文件权限必须仅当前用户可读写: {env_path}")
    for key, value in parse_env_file(env_path).items():
        if not os.environ.get(key):
            os.environ[key] = value
    return str(env_path)


def load_product_env(product, explicit_path=None):
    """按统一优先级加载指定产品的私有 ENV 配置。

    显式路径、产品级 ENV 文件变量和 ``ALIYUN_OPS_ENV_FILE`` 都属于唯一配置源；
    只要被设置，文件缺失就立即失败，不再静默回退。未显式指定时依次读取统一
    配置与产品旧配置，且所有文件只补齐缺失变量。

    @param product: 产品标识，支持 ``dms``、``sls``、``mse``。
    @param explicit_path: 命令行 ``--env-file`` 显式路径。
    @return: 实际读取过的文件路径列表。
    """
    if product not in _PRODUCT_ENV_VARS:
        raise ValueError(f"不支持的阿里云产品: {product}")

    configured_path = (
        explicit_path
        or os.environ.get(_PRODUCT_ENV_VARS[product])
        or os.environ.get("ALIYUN_OPS_ENV_FILE")
    )
    if configured_path:
        loaded = _load_env_file(configured_path, required=True)
        return [loaded]

    loaded_paths = []
    for candidate in (UNIFIED_ENV_FILE, *_PRODUCT_LEGACY_FILES[product]):
        loaded = _load_env_file(candidate, required=False)
        if loaded:
            loaded_paths.append(loaded)
    return loaded_paths


def get_credentials(product, ak_env="ALIYUN_ACCESS_KEY_ID", sk_env="ALIYUN_ACCESS_KEY_SECRET"):
    """从进程环境读取 AK/SK，缺失时给出不含凭证内容的错误。

    @param product: 错误信息中的产品标识。
    @param ak_env: AccessKey ID 所在环境变量名。
    @param sk_env: AccessKey Secret 所在环境变量名。
    @return: ``(access_key_id, access_key_secret)`` 元组。
    """
    access_key = os.environ.get(ak_env, "")
    access_secret = os.environ.get(sk_env, "")
    if not access_key or not access_secret:
        raise ValueError(
            f"[{product}] 环境变量 {ak_env} / {sk_env} 未设置或为空。"
            f"请创建 {UNIFIED_ENV_FILE}（权限 600）或使用旧配置文件。"
        )
    return access_key, access_secret


def render_rows(columns, rows, output_format="table", max_width=60):
    """以 table、json 或 csv 格式输出字典行。

    @param columns: 输出列名及顺序。
    @param rows: 字典组成的结果行。
    @param output_format: ``table``、``json`` 或 ``csv``。
    @param max_width: table 模式下单列最大字符宽度。
    @return: 无返回值。
    """
    if output_format == "json":
        print(json.dumps(rows, ensure_ascii=False, indent=2))
        return
    if output_format == "csv":
        writer = csv.DictWriter(sys.stdout, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
        return
    if not rows:
        print("  (0 行)")
        return

    widths = {}
    for column in columns:
        cell_max = max(
            (len(str(row.get(column, ""))[:max_width]) for row in rows),
            default=0,
        )
        widths[column] = min(max(len(column), cell_max), max_width)
    print("  " + " | ".join(str(column).ljust(widths[column]) for column in columns))
    print("  " + "-+-".join("-" * widths[column] for column in columns))
    for row in rows:
        print(
            "  " + " | ".join(
                str(row.get(column, ""))[:max_width].ljust(widths[column])
                for column in columns
            )
        )
    print(f"\n  ({len(rows)} 行)")
