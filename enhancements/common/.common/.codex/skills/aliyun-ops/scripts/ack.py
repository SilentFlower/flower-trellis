#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""阿里云 ACK 与集群内 Kubernetes 资源的只读查询工具。"""

import argparse
import base64
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ack_roa_v3 import k8s_request, roa_request  # noqa: E402
from aliyun_common import get_credentials, load_product_env  # noqa: E402


CS_API_VERSION = "2015-12-15"
DEFAULT_REGION = "cn-hangzhou"
DEFAULT_WORKBENCH_PROFILE = "aliyun-ops"
DEFAULT_TEMPORARY_MINUTES = 30
MIN_TEMPORARY_MINUTES = 15
MAX_TEMPORARY_MINUTES = 4320
RESOURCE_API_GROUPS = {
    "pods": "/api/v1",
    "services": "/api/v1",
    "configmaps": "/api/v1",
    "secrets": "/api/v1",
    "endpoints": "/api/v1",
    "serviceaccounts": "/api/v1",
    "persistentvolumeclaims": "/api/v1",
    "deployments": "/apis/apps/v1",
    "replicasets": "/apis/apps/v1",
    "statefulsets": "/apis/apps/v1",
    "daemonsets": "/apis/apps/v1",
    "ingresses": "/apis/networking.k8s.io/v1",
    "cronjobs": "/apis/batch/v1",
    "jobs": "/apis/batch/v1",
}
NOISE_METADATA_KEYS = ("managedFields",)
SAFE_PATH_SEGMENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$")
SAFE_INSTANCE_ID = re.compile(r"^i-[A-Za-z0-9]+$")


class AckError(RuntimeError):
    """表示可直接展示给用户的 ACK 查询错误。"""


def scrub(text):
    """清理错误文本中的 AccessKey 痕迹。

    @param text: 待输出文本或对象。
    @return: 脱敏后的字符串。
    """
    if not isinstance(text, str):
        text = json.dumps(text, ensure_ascii=False)
    return re.sub(r"(?:LTAI|STS)[0-9A-Za-z]+", "<AK>", text)


def cs_endpoint(region):
    """构造 ACK OpenAPI 地域接入域名。

    @param region: 阿里云地域 ID。
    @return: ACK OpenAPI 域名。
    """
    return f"cs.{region}.aliyuncs.com"


def call_cs(args, method, path, query=None):
    """调用 ACK OpenAPI，并把非 200 响应转换为脱敏错误。

    @param args: 含地域与凭证的命令行参数。
    @param method: HTTP 方法。
    @param path: ROA 资源路径。
    @param query: 可选 Query 参数。
    @return: 解析后的响应体。
    """
    status, body = roa_request(
        cs_endpoint(args.region),
        method,
        path,
        CS_API_VERSION,
        args._access_key,
        args._access_secret,
        query=query,
    )
    if status != 200:
        raise AckError(f"ACK OpenAPI HTTP {status}: {scrub(body)[:500]}")
    return body


def validate_path_segment(value, label):
    """校验会进入 Kubernetes 或远端命令的单一路径标识。

    @param value: 待校验值。
    @param label: 错误信息中的字段名称。
    @return: 原始值。
    """
    if not SAFE_PATH_SEGMENT.fullmatch(value or ""):
        raise AckError(f"{label} 格式不合法: {value!r}")
    return value


def validate_minutes(minutes):
    """校验 ACK 临时 KubeConfig 有效期。

    @param minutes: 有效分钟数或 ``None``。
    @return: 原始分钟数。
    """
    if minutes is not None and not MIN_TEMPORARY_MINUTES <= minutes <= MAX_TEMPORARY_MINUTES:
        raise AckError(
            f"临时 KubeConfig 有效期必须在 {MIN_TEMPORARY_MINUTES}~"
            f"{MAX_TEMPORARY_MINUTES} 分钟之间"
        )
    return minutes


def parse_kubeconfig(config_text):
    """从 ACK KubeConfig 中提取直连 APIServer 所需字段。

    @param config_text: KubeConfig 正文。
    @return: ``(server, ca_pem, cert_pem, key_pem)``。
    """
    def pick(pattern):
        """按固定 ACK KubeConfig 结构提取一个字段。"""
        found = re.search(pattern, config_text)
        return found.group(1).strip() if found else None

    server = pick(r"server:\s*(\S+)")
    ca_b64 = pick(r"certificate-authority-data:\s*(\S+)")
    cert_b64 = pick(r"client-certificate-data:\s*(\S+)")
    key_b64 = pick(r"client-key-data:\s*(\S+)")
    if not all((server, ca_b64, cert_b64, key_b64)):
        raise AckError("KubeConfig 缺少 server 或客户端证书字段")
    try:
        return (
            server,
            base64.b64decode(ca_b64, validate=True).decode("utf-8"),
            base64.b64decode(cert_b64, validate=True).decode("utf-8"),
            base64.b64decode(key_b64, validate=True).decode("utf-8"),
        )
    except (ValueError, UnicodeDecodeError) as error:
        raise AckError(f"KubeConfig 证书字段无法解码: {error}") from None


def fetch_kubeconfig(args, internal=None, minutes=None):
    """获取 ACK KubeConfig 正文与过期时间。

    @param args: 含集群 ID 的命令行参数。
    @param internal: 是否强制请求内网配置；``None`` 时读取参数。
    @param minutes: 临时有效期；``None`` 时读取参数。
    @return: ``(KubeConfig 正文, 过期时间)``。
    """
    if internal is None:
        internal = bool(getattr(args, "internal", False))
    if minutes is None:
        minutes = getattr(args, "minutes", None)
    validate_minutes(minutes)
    query = {"PrivateIpAddress": bool(internal)}
    if minutes is not None:
        query["TemporaryDurationMinutes"] = minutes
    body = call_cs(
        args,
        "GET",
        f"/k8s/{validate_path_segment(args.cluster, '集群 ID')}/user_config",
        query=query,
    )
    config_text = body.get("config", "") if isinstance(body, dict) else ""
    if not config_text:
        raise AckError("ACK OpenAPI 未返回 KubeConfig 正文")
    return config_text, body.get("expiration", "")


def strip_noise(obj, keep_status=False):
    """精简 Kubernetes 对象并对 Secret 值脱敏。

    @param obj: 单个 Kubernetes 资源对象。
    @param keep_status: 是否保留 status。
    @return: 清理后的对象。
    """
    if not isinstance(obj, dict):
        return obj
    cleaned = dict(obj)
    metadata = dict(cleaned.get("metadata", {}))
    for key in NOISE_METADATA_KEYS:
        metadata.pop(key, None)
    cleaned["metadata"] = metadata
    if not keep_status:
        cleaned.pop("status", None)
    if cleaned.get("kind") == "Secret":
        for field in ("data", "stringData"):
            if isinstance(cleaned.get(field), dict):
                cleaned[field] = {
                    key: "<REDACTED>" for key in cleaned[field]
                }
    return cleaned


def extract_items(body):
    """把 Kubernetes 单对象或 List 响应统一为对象列表。

    @param body: Kubernetes JSON 响应。
    @return: 对象列表。
    """
    if isinstance(body, dict) and isinstance(body.get("items"), list):
        return body["items"]
    return [body]


def render_k8s_items(items, args):
    """按命令行格式输出 Kubernetes 对象。

    @param items: 已清理的 Kubernetes 对象列表。
    @param args: 含 resource、format、save 的命令行参数。
    @return: 无返回值。
    """
    if args.format == "summary":
        for item in items:
            metadata = item.get("metadata", {}) if isinstance(item, dict) else {}
            spec = item.get("spec", {}) if isinstance(item, dict) else {}
            extra = ""
            if args.resource == "services":
                ports = ",".join(
                    f"{port.get('port')}->{port.get('targetPort')}"
                    for port in spec.get("ports", [])
                )
                extra = (
                    f"  type={spec.get('type')}  ports={ports}"
                    f"  selector={spec.get('selector')}"
                )
            elif args.resource in ("deployments", "statefulsets", "daemonsets"):
                containers = (
                    spec.get("template", {})
                    .get("spec", {})
                    .get("containers", [])
                )
                images = ",".join(container.get("image", "") for container in containers)
                extra = f"  replicas={spec.get('replicas')}  image={images}"
            elif args.resource in ("configmaps", "secrets"):
                keys = sorted(
                    set((item.get("data") or {}).keys())
                    | set((item.get("stringData") or {}).keys())
                )
                extra = f"  keys={','.join(keys)}"
            print(f"  {metadata.get('name')}{extra}")
        print(f"\n  ({len(items)} 个对象)")
        return

    output = items[0] if args.name and len(items) == 1 else items
    text = json.dumps(output, ensure_ascii=False, indent=2)
    if args.save:
        target = Path(args.save).expanduser()
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")
        print(f"[ack] 已导出 {len(items)} 个对象 → {target}")
    else:
        print(text)


def write_private_text_file(target, content):
    """以平台兼容方式原子写入仅当前用户使用的文本文件。

    @param target: 目标文件路径。
    @param content: 待写入文本。
    @return: 无返回值。
    """
    target = Path(target)
    handle, temp_name = tempfile.mkstemp(
        prefix=f".{target.name}.",
        dir=str(target.parent),
    )
    temp_path = Path(temp_name)
    operation_error = None
    cleanup_errors = []
    committed = False
    try:
        # Windows 没有 os.fchmod；mkstemp 仍负责创建私有临时文件。
        fchmod = getattr(os, "fchmod", None)
        if callable(fchmod):
            fchmod(handle, 0o600)
        stream = os.fdopen(handle, "w", encoding="utf-8")
        handle = None
        with stream:
            stream.write(content)
        os.replace(temp_path, target)
        committed = True
    except Exception as error:
        operation_error = error
    finally:
        if handle is not None:
            try:
                os.close(handle)
            except OSError as error:
                cleanup_errors.append(f"文件描述符: {error}")
        if not committed and temp_path.exists():
            try:
                temp_path.unlink()
            except OSError as error:
                cleanup_errors.append(f"临时文件 {temp_path}: {error}")

    cleanup_detail = "；".join(cleanup_errors)
    if operation_error:
        suffix = f"；同时清理失败: {cleanup_detail}" if cleanup_detail else ""
        raise OSError(f"{operation_error}{suffix}") from operation_error
    if cleanup_detail:
        raise OSError(f"文件已写入，但临时资源清理失败: {cleanup_detail}")


def cmd_clusters(args):
    """列出当前凭证可见的 ACK 集群。

    @param args: 命令行参数。
    @return: 无返回值。
    """
    body = call_cs(args, "GET", "/api/v1/clusters")
    clusters = body.get("clusters", body) if isinstance(body, dict) else body
    rows = [
        {
            "cluster_id": item.get("cluster_id", ""),
            "name": item.get("name", ""),
            "state": item.get("state", ""),
            "type": item.get("cluster_type", ""),
            "version": item.get("current_version", ""),
        }
        for item in (clusters or [])
    ]
    if args.format == "json":
        print(json.dumps(rows, ensure_ascii=False, indent=2))
        return
    for row in rows:
        print(
            f"  {row['cluster_id']}  {row['name']}  state={row['state']}  "
            f"type={row['type']}  v={row['version']}"
        )
    print(f"\n  ({len(rows)} 个集群)")


def cmd_detail(args):
    """查看集群详情和 APIServer 端点。

    @param args: 命令行参数。
    @return: 无返回值。
    """
    cluster = validate_path_segment(args.cluster, "集群 ID")
    body = call_cs(args, "GET", f"/clusters/{cluster}")
    if args.format == "json":
        print(json.dumps(body, ensure_ascii=False, indent=2))
        return
    print(f"  name            = {body.get('name')}")
    print(f"  state           = {body.get('state')}")
    print(f"  version         = {body.get('current_version')}")
    print(f"  vpc_id          = {body.get('vpc_id')}")
    print(f"  cluster_type    = {body.get('cluster_type')}")
    master_url = body.get("master_url") or "{}"
    try:
        endpoints = json.loads(master_url)
    except (TypeError, json.JSONDecodeError):
        endpoints = {}
    public = endpoints.get("api_server_endpoint") or "(未开放公网)"
    internal = endpoints.get("intranet_api_server_endpoint") or "(无)"
    print(f"  apiserver 公网  = {public}")
    print(f"  apiserver 内网  = {internal}")


def cmd_resources(args):
    """查询集群关联的 SLB、VPC 等云资源。

    @param args: 命令行参数。
    @return: 无返回值。
    """
    cluster = validate_path_segment(args.cluster, "集群 ID")
    body = call_cs(args, "GET", f"/clusters/{cluster}/resources")
    items = body if isinstance(body, list) else body.get("resources", [])
    filtered = [
        item
        for item in items
        if not args.type
        or args.type.lower() in item.get("resource_type", "").lower()
    ]
    if args.format == "json":
        print(json.dumps(filtered, ensure_ascii=False, indent=2))
        return
    for item in filtered:
        print(
            f"  {item.get('resource_type', '')}  {item.get('resource_id', '')}  "
            f"state={item.get('state', '')}  auto_create={item.get('auto_create', '')}"
        )
    print(f"\n  ({len(filtered)} 项关联资源)")


def list_cluster_nodes(args, state="all"):
    """分页查询 ACK 集群节点。

    @param args: 含集群 ID 的命令行参数。
    @param state: ACK 节点状态过滤值。
    @return: 节点对象列表。
    """
    cluster = validate_path_segment(args.cluster, "集群 ID")
    nodes = []
    page_number = 1
    while True:
        body = call_cs(
            args,
            "GET",
            f"/clusters/{cluster}/nodes",
            query={
                "pageSize": 100,
                "pageNumber": page_number,
                "state": state,
            },
        )
        page_nodes = body.get("nodes", []) if isinstance(body, dict) else []
        nodes.extend(page_nodes)
        page = body.get("page", {}) if isinstance(body, dict) else {}
        total = int(page.get("total_count", len(nodes)) or len(nodes))
        if not page_nodes or len(nodes) >= total:
            return nodes
        page_number += 1


def cmd_nodes(args):
    """列出 ACK 集群 Worker 节点与 ECS 状态。

    @param args: 命令行参数。
    @return: 无返回值。
    """
    rows = [
        {
            "instance_id": node.get("instance_id", ""),
            "instance_name": node.get("instance_name", ""),
            "node_name": node.get("node_name", ""),
            "instance_role": node.get("instance_role", ""),
            "is_aliyun_node": node.get("is_aliyun_node", False),
            "state": node.get("state", ""),
            "node_status": node.get("node_status", ""),
            "instance_status": node.get("instance_status", ""),
            "ip_address": node.get("ip_address", []),
        }
        for node in list_cluster_nodes(args, state=args.state)
    ]
    if args.format == "json":
        print(json.dumps(rows, ensure_ascii=False, indent=2))
        return
    for row in rows:
        print(
            f"  {row['instance_id']}  {row['node_name']}  state={row['state']}  "
            f"node={row['node_status']}  ecs={row['instance_status']}  "
            f"role={row['instance_role']}  aliyun={row['is_aliyun_node']}  "
            f"ip={','.join(row['ip_address'])}"
        )
    print(f"\n  ({len(rows)} 个节点)")


def cmd_kubeconfig(args):
    """获取 KubeConfig 元信息，并仅在显式要求时安全落盘。

    @param args: 命令行参数。
    @return: 无返回值。
    """
    config_text, expiration = fetch_kubeconfig(args)
    server, _, _, _ = parse_kubeconfig(config_text)
    scope = "内网" if args.internal else "公网"
    print(f"[ack] KubeConfig 已获取（{scope}）")
    print(f"  apiserver  = {server}")
    print(f"  expiration = {expiration}")
    print(f"  正文长度   = {len(config_text)} 字符（含客户端证书私钥，未回显）")
    if args.save:
        target = Path(args.save).expanduser()
        target.parent.mkdir(parents=True, exist_ok=True)
        write_private_text_file(target, config_text)
        print(f"  已保存至   = {target}（权限 600，用完请及时删除）")


def select_workbench_instance(args):
    """返回显式实例，或稳定选择一个可用 ACK Worker。

    @param args: 含可选实例 ID 的命令行参数。
    @return: ECS 实例 ID。
    """
    if args.instance_id:
        if not SAFE_INSTANCE_ID.fullmatch(args.instance_id):
            raise AckError(f"ECS 实例 ID 格式不合法: {args.instance_id!r}")
        return args.instance_id
    candidates = []
    for node in list_cluster_nodes(args, state="running"):
        instance_status = str(node.get("instance_status", "")).lower()
        if (
            node.get("is_aliyun_node") is True
            and str(node.get("instance_role", "")).lower() == "worker"
            and str(node.get("state", "")).lower() == "running"
            # 部分 ACK 集群不返回 instance_status；返回时仍要求 ECS 为 Running。
            and instance_status in {"", "running"}
            and str(node.get("node_status", "")).lower() == "ready"
            and SAFE_INSTANCE_ID.fullmatch(node.get("instance_id", ""))
        ):
            candidates.append(node["instance_id"])
    if not candidates:
        raise AckError(
            "ACK 集群没有可自动选择的运行中 Ready 阿里云 Worker；"
            "请检查节点状态或显式传 --instance-id"
        )
    return sorted(candidates)[0]


def build_k8s_path(args):
    """构造直连 APIServer 的只读资源路径。

    @param args: 含 namespace/resource/name 的命令行参数。
    @return: Kubernetes API 路径。
    """
    namespace = validate_path_segment(args.namespace, "命名空间")
    resource = args.resource.lower()
    if resource not in RESOURCE_API_GROUPS:
        raise AckError(
            f"不支持的资源类型: {resource}；"
            f"可选: {', '.join(sorted(RESOURCE_API_GROUPS))}"
        )
    path = f"{RESOURCE_API_GROUPS[resource]}/namespaces/{namespace}/{resource}"
    if args.name:
        path = f"{path}/{validate_path_segment(args.name, '资源名')}"
    return path


def get_direct(args):
    """直连 APIServer 获取只读 Kubernetes JSON。

    @param args: get 子命令参数。
    @return: Kubernetes 响应对象。
    """
    path = build_k8s_path(args)
    config_text, _ = fetch_kubeconfig(args)
    server, ca_pem, cert_pem, key_pem = parse_kubeconfig(config_text)
    try:
        status, body = k8s_request(
            server,
            ca_pem,
            cert_pem,
            key_pem,
            path,
        )
    except ConnectionError as error:
        raise AckError(str(error)) from None
    if status != 200:
        raise AckError(f"APIServer HTTP {status}: {scrub(body)[:500]}")
    return body


def run_process(argv):
    """以 UTF-8 文本模式运行本地子进程，禁止 shell 展开。

    @param argv: 命令参数数组。
    @return: ``subprocess.CompletedProcess``。
    """
    return subprocess.run(
        argv,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )


def workbench_common_args(args, instance_id):
    """构造 Workbench CLI 的共享参数。

    @param args: 含 region/profile 的命令行参数。
    @param instance_id: ECS 实例 ID。
    @return: 参数数组。
    """
    profile = validate_path_segment(args.workbench_profile, "Workbench profile")
    return [
        "--instance-id",
        instance_id,
        "--region",
        args.region,
        "--profile",
        profile,
        "--output",
        "json",
    ]


def run_workbench_exec(args, instance_id, command, operation):
    """执行 Workbench 非交互命令并校验结构化结果。

    @param args: get 子命令参数。
    @param instance_id: ECS 实例 ID。
    @param command: 固定规则生成的远端命令。
    @param operation: 错误信息中的操作名称。
    @return: Workbench JSON 响应对象。
    """
    result = run_process(
        [
            "workbench",
            "exec",
            *workbench_common_args(args, instance_id),
            "--timeout",
            str(args.workbench_timeout),
            "--command",
            command,
        ]
    )
    if result.returncode != 0:
        detail = scrub(result.stderr or result.stdout)[:500]
        raise AckError(f"Workbench {operation} 失败: {detail}")
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        raise AckError(
            f"Workbench {operation} 未返回合法 JSON: {scrub(result.stdout)[:300]}"
        ) from None
    if not isinstance(payload, dict):
        raise AckError(f"Workbench {operation} 返回的 JSON 根节点必须是对象")
    exit_code = payload.get("exit_code")
    if isinstance(exit_code, bool) or not isinstance(exit_code, int):
        raise AckError(f"Workbench {operation} 返回的 exit_code 必须是整数")
    for field in ("stdout", "stderr", "output"):
        if field in payload and not isinstance(payload[field], str):
            raise AckError(f"Workbench {operation} 返回的 {field} 必须是字符串")
    if exit_code != 0:
        detail = scrub(payload.get("stderr") or payload.get("output") or "")[:500]
        raise AckError(f"Workbench {operation} 远端退出码 {exit_code}: {detail}")
    return payload


def remove_local_secret(path):
    """删除本地敏感临时文件，优先使用 shred。

    @param path: 本地文件路径。
    @return: 无返回值。
    """
    if not path.exists():
        return
    shred = shutil.which("shred")
    if shred:
        result = run_process([shred, "-u", "--", str(path)])
        if result.returncode == 0:
            return
    path.unlink()


def get_via_workbench(args):
    """通过 ACK Worker 和 Workbench 查询只读 Kubernetes JSON。

    @param args: get 子命令参数。
    @return: Kubernetes 响应对象。
    """
    build_k8s_path(args)
    if not shutil.which("workbench"):
        raise AckError("未找到 workbench CLI，请先安装并配置可用 profile")
    minutes = args.minutes or DEFAULT_TEMPORARY_MINUTES
    validate_minutes(minutes)
    if not 1 <= args.workbench_timeout <= 600:
        raise AckError("Workbench 超时必须在 1~600 秒之间")
    instance_id = select_workbench_instance(args)
    config_text, _ = fetch_kubeconfig(args, internal=True, minutes=minutes)

    temp_dir = None
    local_path = None
    remote_path = None
    upload_attempted = False
    query_error = None
    cleanup_errors = []
    body = None
    try:
        temp_dir = Path(tempfile.mkdtemp(prefix="aliyun-ops-ack-"))
        local_path = temp_dir / f"kubeconfig-{uuid.uuid4().hex}.yaml"
        remote_path = f"/tmp/{local_path.name}"
        write_private_text_file(local_path, config_text)

        upload_attempted = True
        upload = run_process(
            [
                "workbench",
                "upload",
                str(local_path),
                "/tmp/",
                *workbench_common_args(args, instance_id),
                "--force",
            ]
        )
        if upload.returncode != 0:
            detail = scrub(upload.stderr or upload.stdout)[:500]
            raise AckError(f"Workbench 上传临时 KubeConfig 失败: {detail}")

        command_parts = [
            "env",
            f"KUBECONFIG={remote_path}",
            "kubectl",
            "get",
            args.resource,
            "--namespace",
            args.namespace,
        ]
        if args.name:
            command_parts.append(args.name)
        command_parts.extend(["--output", "json", "--request-timeout", "20s"])
        remote_command = (
            f"{shlex.join(['chmod', '600', '--', remote_path])} && "
            f"{shlex.join(command_parts)}"
        )
        payload = run_workbench_exec(
            args,
            instance_id,
            remote_command,
            "kubectl get",
        )
        try:
            body = json.loads(payload.get("stdout", ""))
        except json.JSONDecodeError:
            raise AckError("kubectl 未返回合法 JSON") from None
    except (AckError, OSError) as error:
        query_error = error
    finally:
        try:
            if upload_attempted and remote_path:
                try:
                    run_workbench_exec(
                        args,
                        instance_id,
                        shlex.join(["unlink", "--", remote_path]),
                        "清理远端临时 KubeConfig",
                    )
                except Exception as error:
                    cleanup_errors.append(f"远端 {remote_path}: {error}")
        finally:
            if local_path:
                try:
                    remove_local_secret(local_path)
                except OSError as error:
                    cleanup_errors.append(f"本地 {local_path}: {error}")
            if temp_dir:
                try:
                    temp_dir.rmdir()
                except OSError as error:
                    cleanup_errors.append(f"本地临时目录 {temp_dir}: {error}")

    cleanup_detail = "；".join(cleanup_errors)
    if query_error:
        suffix = f"；同时清理失败: {cleanup_detail}" if cleanup_detail else ""
        raise AckError(f"{query_error}{suffix}") from None
    if cleanup_detail:
        raise AckError(f"查询成功，但临时 KubeConfig 清理失败: {cleanup_detail}")
    return body


def cmd_get(args):
    """查询并输出集群内指定资源。

    @param args: get 子命令参数。
    @return: 无返回值。
    """
    body = get_via_workbench(args) if args.via_workbench else get_direct(args)
    items = [
        strip_noise(item, keep_status=args.keep_status)
        for item in extract_items(body)
    ]
    render_k8s_items(items, args)


def build_parser():
    """构造 ACK CLI 参数解析器。

    @return: 配置完成的 ``ArgumentParser``。
    """
    parser = argparse.ArgumentParser(description="阿里云 ACK 只读查询（stdlib-only）")
    parser.add_argument("--env-file", help="私有 ENV 文件，默认 ~/.config/aliyun-ops/env")
    parser.add_argument("--region", default=DEFAULT_REGION, help=f"地域，默认 {DEFAULT_REGION}")
    parser.add_argument("--ak-env", default="ALIYUN_ACCESS_KEY_ID", help="AK 所在环境变量名")
    parser.add_argument("--sk-env", default="ALIYUN_ACCESS_KEY_SECRET", help="SK 所在环境变量名")
    subparsers = parser.add_subparsers(dest="command", required=True)

    clusters = subparsers.add_parser("clusters", help="列出可见的 ACK 集群")
    clusters.add_argument("--format", choices=("table", "json"), default="table")
    clusters.set_defaults(func=cmd_clusters)

    detail = subparsers.add_parser("detail", help="查看集群详情与 APIServer 端点")
    detail.add_argument("--cluster", required=True, help="集群 ID")
    detail.add_argument("--format", choices=("table", "json"), default="table")
    detail.set_defaults(func=cmd_detail)

    resources = subparsers.add_parser("resources", help="查询集群关联的云资源")
    resources.add_argument("--cluster", required=True, help="集群 ID")
    resources.add_argument("--type", help="按资源类型子串过滤，如 SLB")
    resources.add_argument("--format", choices=("table", "json"), default="table")
    resources.set_defaults(func=cmd_resources)

    nodes = subparsers.add_parser("nodes", help="查询集群 Worker 节点")
    nodes.add_argument("--cluster", required=True, help="集群 ID")
    nodes.add_argument(
        "--state",
        choices=("all", "running", "removing", "initial", "failed"),
        default="all",
    )
    nodes.add_argument("--format", choices=("table", "json"), default="table")
    nodes.set_defaults(func=cmd_nodes)

    kubeconfig = subparsers.add_parser("kubeconfig", help="获取 KubeConfig 元信息")
    kubeconfig.add_argument("--cluster", required=True, help="集群 ID")
    kubeconfig.add_argument("--internal", action="store_true", help="取内网连接凭据")
    kubeconfig.add_argument("--minutes", type=int, help="临时凭据有效分钟数，15~4320")
    kubeconfig.add_argument("--save", help="保存路径（0600）；不传则不回显正文")
    kubeconfig.set_defaults(func=cmd_kubeconfig)

    get_cmd = subparsers.add_parser("get", help="只读查询集群内资源")
    get_cmd.add_argument("--cluster", required=True, help="集群 ID")
    get_cmd.add_argument("--namespace", required=True, help="命名空间")
    get_cmd.add_argument(
        "--resource",
        required=True,
        choices=tuple(sorted(RESOURCE_API_GROUPS)),
        help="资源类型",
    )
    get_cmd.add_argument("--name", help="资源名；不传则列出命名空间内同类资源")
    get_cmd.add_argument("--format", choices=("json", "summary"), default="json")
    get_cmd.add_argument("--keep-status", action="store_true", help="保留 status 段")
    get_cmd.add_argument("--internal", action="store_true", help="直连时使用内网 APIServer")
    get_cmd.add_argument("--minutes", type=int, help="临时凭据有效分钟数，15~4320")
    get_cmd.add_argument("--save", help="把 JSON 保存到文件")
    get_cmd.add_argument(
        "--via-workbench",
        action="store_true",
        help="经 ACK Worker 和 Workbench 访问私网 APIServer",
    )
    get_cmd.add_argument("--instance-id", help="Workbench 目标 ECS；不传则自动选 Worker")
    get_cmd.add_argument(
        "--workbench-profile",
        default=DEFAULT_WORKBENCH_PROFILE,
        help=f"Workbench profile，默认 {DEFAULT_WORKBENCH_PROFILE}",
    )
    get_cmd.add_argument(
        "--workbench-timeout",
        type=int,
        default=60,
        help="Workbench 单次命令超时秒数，默认 60",
    )
    get_cmd.set_defaults(func=cmd_get)
    return parser


def main():
    """加载 ACK 凭证并分发只读子命令。

    @return: 进程退出码。
    """
    args = build_parser().parse_args()
    try:
        load_product_env("ack", args.env_file)
        args._access_key, args._access_secret = get_credentials(
            "ack",
            args.ak_env,
            args.sk_env,
        )
        args.func(args)
        return 0
    except (AckError, OSError, ValueError) as error:
        print(f"[ack] {scrub(error)[:1000]}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
