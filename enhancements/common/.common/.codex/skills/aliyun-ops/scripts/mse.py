#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""阿里云 MSE 托管 Nacos 的只读查询客户端。"""

import argparse
import json
import os
import sys

from aliyun_common import UNIFIED_ENV_FILE, get_credentials, load_product_env, render_rows
from aliyun_rpc_v1 import rpc_request


API_VERSION = "2019-05-31"
DEFAULT_REGION = "cn-hangzhou"
DEFAULT_GROUP = "DEFAULT_GROUP"


def _non_empty(value):
    """拒绝可能把完整配置全部匹配出来的空过滤词。"""
    if not value.strip():
        raise argparse.ArgumentTypeError("--grep 不能为空")
    return value


def resolve_endpoint(region, configured_endpoint=None):
    """解析 MSE endpoint，并拒绝带协议或路径的歧义值。

    @param region: 阿里云地域 ID。
    @param configured_endpoint: 用户覆盖的 endpoint。
    @return: 不含协议和路径的 endpoint。
    """
    endpoint = (configured_endpoint or f"mse.{region}.aliyuncs.com").strip()
    if not endpoint or "://" in endpoint or "/" in endpoint:
        raise ValueError("MSE endpoint 必须是不含协议和路径的主机名")
    return endpoint


def call_mse(action, params, args, access_key, access_secret):
    """调用 MSE RPC，并统一校验 HTTP 与业务成功状态。

    @param action: MSE OpenAPI Action。
    @param params: 产品业务参数。
    @param args: CLI 全局参数。
    @param access_key: AccessKey ID。
    @param access_secret: AccessKey Secret。
    @return: 成功响应字典。
    """
    request_params = {"RegionId": args.region, **params}
    status, body = rpc_request(
        args.endpoint,
        API_VERSION,
        action,
        request_params,
        access_key,
        access_secret,
        method="GET",
        timeout=args.timeout,
    )
    success = body.get("Success")
    if isinstance(success, str):
        success = success.lower() != "false"
    if status != 200 or success is False:
        code = body.get("ErrorCode") or body.get("Code", "")
        message = str(body.get("Message", ""))[:500]
        raise RuntimeError(f"{action} 失败: HTTP {status} {code} {message}")
    return body


def _list_value(body, *keys):
    """兼容 MSE 列表响应中常见的列表或单层包装结构。"""
    for key in keys:
        value = body.get(key)
        if isinstance(value, list):
            return value
        if isinstance(value, dict):
            for nested in value.values():
                if isinstance(nested, list):
                    return nested
    data = body.get("Data")
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in keys:
            value = data.get(key)
            if isinstance(value, list):
                return value
            if isinstance(value, dict):
                for nested in value.values():
                    if isinstance(nested, list):
                        return nested
    return []


def _total_count(body, fallback):
    """从响应顶层或 Data 包装中读取总数。"""
    total = body.get("TotalCount")
    if total is None and isinstance(body.get("Data"), dict):
        total = body["Data"].get("TotalCount")
    try:
        return int(total)
    except (TypeError, ValueError):
        return fallback


def _configuration(body):
    """从当前或历史配置响应中提取配置对象。"""
    for container in (body, body.get("Data") if isinstance(body.get("Data"), dict) else {}):
        value = container.get("Configuration")
        if isinstance(value, dict):
            return value
    return {}


def render_configuration(configuration, data_id, grep=None, nid=None):
    """输出配置安全摘要，或仅输出关键字命中的行。

    @param configuration: MSE 返回的配置对象。
    @param data_id: 配置 DataId。
    @param grep: 可选的非空过滤词。
    @param nid: 可选的历史版本 ID。
    @return: 无返回值。
    """
    content = str(configuration.get("Content") or "")
    lines = content.splitlines()
    if grep is not None:
        needle = grep.lower()
        for line_no, line in enumerate(lines, 1):
            if needle in line.lower():
                print(f"{data_id}:{line_no}: {line.strip()}")
        return

    summary = {
        "DataId": data_id,
        "Group": configuration.get("Group") or DEFAULT_GROUP,
        "Type": configuration.get("Type"),
        "Lines": len(lines),
        "Characters": len(content),
        "LastModifiedTime": (
            configuration.get("LastModifiedTime") or configuration.get("GmtModified")
        ),
    }
    if nid is not None:
        summary["Nid"] = nid
        summary["OpType"] = configuration.get("OpType")
        summary["SrcUser"] = configuration.get("SrcUser")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def cmd_clusters(args, access_key, access_secret):
    """列出当前地域的 MSE 集群。

    @param args: clusters 命令参数。
    @param access_key: AccessKey ID。
    @param access_secret: AccessKey Secret。
    @return: 进程退出码。
    """
    body = call_mse(
        "ListClusters",
        {"PageNum": 1, "PageSize": args.limit},
        args,
        access_key,
        access_secret,
    )
    items = _list_value(body, "Clusters", "ClusterList")
    rows = [
        {
            "InstanceId": item.get("InstanceId"),
            "Alias": item.get("ClusterAliasName"),
            "Type": item.get("ClusterType"),
            "Version": item.get("AppVersion"),
            "RegionId": item.get("RegionId") or args.region,
        }
        for item in items
    ]
    render_rows(list(rows[0].keys()) if rows else [], rows, args.format)
    return 0


def cmd_namespaces(args, access_key, access_secret):
    """列出指定 MSE 实例中的 Nacos 命名空间。

    @param args: namespaces 命令参数。
    @param access_key: AccessKey ID。
    @param access_secret: AccessKey Secret。
    @return: 进程退出码。
    """
    body = call_mse(
        "ListEngineNamespaces",
        {"InstanceId": args.instance},
        args,
        access_key,
        access_secret,
    )
    items = _list_value(body, "Namespaces", "NamespaceList")
    rows = [
        {
            "Namespace": item.get("Namespace") or "(public)",
            "Name": item.get("NamespaceShowName"),
            "ConfigCount": item.get("ConfigCount"),
        }
        for item in items
    ]
    render_rows(list(rows[0].keys()) if rows else [], rows, args.format)
    return 0


def _collect_pages(action, params, keys, args, access_key, access_secret):
    """按上限自动翻页，避免因异常总数造成无限请求。"""
    items = []
    for page in range(1, args.max_pages + 1):
        body = call_mse(
            action,
            {**params, "PageNum": page, "PageSize": args.page_size},
            args,
            access_key,
            access_secret,
        )
        page_items = _list_value(body, *keys)
        items.extend(page_items)
        total = _total_count(body, len(items))
        if not page_items or len(items) >= total or len(page_items) < args.page_size:
            break
    return items


def cmd_configs(args, access_key, access_secret):
    """分页列出 Nacos 配置元数据。

    @param args: configs 命令参数。
    @param access_key: AccessKey ID。
    @param access_secret: AccessKey Secret。
    @return: 进程退出码。
    """
    items = _collect_pages(
        "ListNacosConfigs",
        {"InstanceId": args.instance, "NamespaceId": args.namespace},
        ("Configurations", "ConfigList"),
        args,
        access_key,
        access_secret,
    )
    rows = [
        {
            "DataId": item.get("DataId"),
            "Group": item.get("Group"),
            "Type": item.get("Type"),
        }
        for item in items
    ]
    render_rows(list(rows[0].keys()) if rows else [], rows, args.format)
    return 0


def cmd_config(args, access_key, access_secret):
    """查看当前 Nacos 配置的摘要或关键字命中行。

    @param args: config 命令参数。
    @param access_key: AccessKey ID。
    @param access_secret: AccessKey Secret。
    @return: 进程退出码。
    """
    body = call_mse(
        "GetNacosConfig",
        {
            "InstanceId": args.instance,
            "NamespaceId": args.namespace,
            "DataId": args.data_id,
            "Group": args.group,
        },
        args,
        access_key,
        access_secret,
    )
    render_configuration(_configuration(body), args.data_id, grep=args.grep)
    return 0


def cmd_history(args, access_key, access_secret):
    """分页列出指定 Nacos 配置的历史版本。

    @param args: history 命令参数。
    @param access_key: AccessKey ID。
    @param access_secret: AccessKey Secret。
    @return: 进程退出码。
    """
    items = _collect_pages(
        "ListNacosHistoryConfigs",
        {
            "InstanceId": args.instance,
            "NamespaceId": args.namespace,
            "DataId": args.data_id,
            "Group": args.group,
        },
        ("HistoryItems", "Configurations"),
        args,
        access_key,
        access_secret,
    )
    rows = [
        {
            "Nid": item.get("Id") or item.get("Nid"),
            "Modified": item.get("LastModifiedTime") or item.get("GmtModified"),
            "OpType": item.get("OpType"),
            "SrcUser": item.get("SrcUser"),
        }
        for item in items
    ]
    render_rows(list(rows[0].keys()) if rows else [], rows, args.format)
    return 0


def cmd_history_config(args, access_key, access_secret):
    """查看 Nacos 历史配置的摘要或关键字命中行。

    @param args: history-config 命令参数。
    @param access_key: AccessKey ID。
    @param access_secret: AccessKey Secret。
    @return: 进程退出码。
    """
    body = call_mse(
        "GetNacosHistoryConfig",
        {
            "InstanceId": args.instance,
            "NamespaceId": args.namespace,
            "DataId": args.data_id,
            "Group": args.group,
            "Nid": args.nid,
        },
        args,
        access_key,
        access_secret,
    )
    render_configuration(
        _configuration(body),
        args.data_id,
        grep=args.grep,
        nid=args.nid,
    )
    return 0


def _add_instance_namespace(parser):
    """为 Nacos 子命令添加实例和命名空间参数。"""
    parser.add_argument("--instance", required=True, help="MSE InstanceId")
    parser.add_argument("--namespace", default="", help="Nacos namespace ID，默认 public")


def _add_config_identity(parser):
    """为配置详情子命令添加配置标识参数。"""
    _add_instance_namespace(parser)
    parser.add_argument("--data-id", required=True, help="Nacos DataId")
    parser.add_argument("--group", default=DEFAULT_GROUP, help="Nacos Group")


def _add_pagination(parser):
    """为列表子命令添加受控分页参数。"""
    parser.add_argument("--page-size", type=int, default=100, choices=range(1, 101))
    parser.add_argument("--max-pages", type=int, default=100, choices=range(1, 1001))


def build_parser():
    """构造 MSE 只读 CLI 参数解析器。

    @return: 配置完成的 ``ArgumentParser``。
    """
    parser = argparse.ArgumentParser(
        description="查询阿里云 MSE 托管 Nacos（只读，stdlib-only）"
    )
    parser.add_argument("--env-file", help=f"私有 ENV 文件，默认 {UNIFIED_ENV_FILE}")
    parser.add_argument("--region", help="MSE RegionId，默认读取 ALIYUN_MSE_REGION")
    parser.add_argument("--endpoint", help="MSE endpoint，默认由 region 生成")
    parser.add_argument("--ak-env", default="ALIYUN_ACCESS_KEY_ID", help="AK 所在环境变量名")
    parser.add_argument("--sk-env", default="ALIYUN_ACCESS_KEY_SECRET", help="SK 所在环境变量名")
    parser.add_argument("--timeout", type=int, default=30, help="网络超时秒数")
    parser.add_argument("--format", choices=["table", "json", "csv"], default="table")
    subparsers = parser.add_subparsers(dest="cmd", required=True)

    command = subparsers.add_parser("clusters", help="列出当前地域的 MSE 集群")
    command.add_argument("--limit", type=int, default=50, choices=range(1, 101))
    command.set_defaults(func=cmd_clusters)

    command = subparsers.add_parser("namespaces", help="列出 Nacos 命名空间")
    command.add_argument("--instance", required=True, help="MSE InstanceId")
    command.set_defaults(func=cmd_namespaces)

    command = subparsers.add_parser("configs", help="列出 Nacos 配置")
    _add_instance_namespace(command)
    _add_pagination(command)
    command.set_defaults(func=cmd_configs)

    command = subparsers.add_parser("config", help="查看当前配置摘要或关键字命中行")
    _add_config_identity(command)
    command.add_argument("--grep", type=_non_empty, help="仅输出包含关键字的配置行")
    command.set_defaults(func=cmd_config)

    command = subparsers.add_parser("history", help="列出 Nacos 配置历史")
    _add_config_identity(command)
    _add_pagination(command)
    command.set_defaults(func=cmd_history)

    command = subparsers.add_parser(
        "history-config",
        help="查看历史配置摘要或关键字命中行",
    )
    _add_config_identity(command)
    command.add_argument("--nid", required=True, help="历史版本 ID")
    command.add_argument("--grep", type=_non_empty, help="仅输出包含关键字的配置行")
    command.set_defaults(func=cmd_history_config)
    return parser


def main(argv=None):
    """执行 MSE 只读 CLI。

    @param argv: 可选的命令行参数列表。
    @return: 进程退出码。
    """
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

    args = build_parser().parse_args(argv)
    try:
        load_product_env("mse", args.env_file)
        args.region = args.region or os.environ.get("ALIYUN_MSE_REGION", DEFAULT_REGION)
        args.endpoint = resolve_endpoint(
            args.region,
            args.endpoint or os.environ.get("ALIYUN_MSE_ENDPOINT"),
        )
        access_key, access_secret = get_credentials("mse", args.ak_env, args.sk_env)
        return args.func(args, access_key, access_secret)
    except (OSError, ValueError) as exc:
        print(f"[mse] 配置错误: {exc}", file=sys.stderr)
        return 2
    except RuntimeError as exc:
        print(f"[mse] {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
