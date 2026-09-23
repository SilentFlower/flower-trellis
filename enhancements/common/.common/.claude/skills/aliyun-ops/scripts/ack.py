#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""阿里云 ACK 与集群内 Kubernetes 资源的只读查询与受控 Deployment 变更工具。"""

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
from contextlib import contextmanager
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
SAFE_IMAGE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,511}$")
SAFE_ENV_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
ANSI_ESCAPE = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
# Workbench CLI 的进度动画以盲文点阵字符开头，对诊断没有价值。
SPINNER_LINE = re.compile(r"^[\u2800-\u28ff]")
WRITE_NAMESPACES_ENV = "ALIYUN_ACK_WRITE_NAMESPACES"
IMAGE_PREFIXES_ENV = "ALIYUN_ACK_IMAGE_PREFIXES"
UPLOAD_ATTEMPTS = 2
DEFAULT_ROLLOUT_TIMEOUT = 300
MIN_ROLLOUT_TIMEOUT = 10
# Workbench 单次 exec 上限 600 秒，需给 rollout status 之外的连接开销预留 30 秒。
MAX_ROLLOUT_TIMEOUT = 570
ROLLOUT_EXEC_OVERHEAD = 30


class AckError(RuntimeError):
    """表示可直接展示给用户的 ACK 查询错误。"""


def scrub(text):
    """清理错误文本中的 AccessKey 痕迹。

    @param text: 待输出文本或对象。
    @return: 脱敏后的字符串。
    """
    if isinstance(text, BaseException):
        text = str(text)
    elif not isinstance(text, str):
        text = json.dumps(text, ensure_ascii=False, default=str)
    return re.sub(r"(?:LTAI|STS)[0-9A-Za-z]+", "<AK>", text)


def summarize_cli_output(text, limit=500):
    """提取 CLI 输出中的有效诊断信息并脱敏。

    Workbench 失败时会先输出大量进度动画帧，真实原因通常在末尾，
    因此去除动画与 ANSI 转义后保留尾部内容。

    @param text: CLI 原始输出。
    @param limit: 最多保留的字符数。
    @return: 脱敏后的诊断文本。
    """
    lines = [
        line.strip()
        for line in ANSI_ESCAPE.sub("", text or "").splitlines()
        if line.strip() and not SPINNER_LINE.match(line.strip())
    ]
    return scrub("\n".join(lines))[-limit:]


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


def run_workbench_exec(args, instance_id, command, operation, timeout=None):
    """执行 Workbench 非交互命令并校验结构化结果。

    @param args: 含 region/profile/超时的命令行参数。
    @param instance_id: ECS 实例 ID。
    @param command: 固定规则生成的远端命令。
    @param operation: 错误信息中的操作名称。
    @param timeout: 单次执行超时秒数；``None`` 时使用 ``--workbench-timeout``。
    @return: Workbench JSON 响应对象。
    """
    result = run_process(
        [
            "workbench",
            "exec",
            *workbench_common_args(args, instance_id),
            "--timeout",
            str(timeout or args.workbench_timeout),
            "--command",
            command,
        ]
    )
    if result.returncode != 0:
        detail = summarize_cli_output(f"{result.stderr}\n{result.stdout}")
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


class WorkbenchSession:
    """一次 Workbench 会话内共享的远端 kubectl 执行器。"""

    def __init__(self, args, instance_id, remote_path):
        """记录会话参数。

        @param args: 命令行参数。
        @param instance_id: 目标 ECS 实例 ID。
        @param remote_path: 远端临时 KubeConfig 路径。
        """
        self.args = args
        self.instance_id = instance_id
        self.remote_path = remote_path
        # 清理失败时用于告知用户主流程的真实结果，写入后必须改为“写入已生效”。
        self.outcome = "查询成功"

    def run(self, kubectl_args, operation, timeout=None):
        """在 Worker 上执行一条由固定参数构造的 kubectl 命令。

        @param kubectl_args: 已校验的 kubectl 参数数组。
        @param operation: 错误信息中的操作名称。
        @param timeout: 单次执行超时秒数；``None`` 时使用默认值。
        @return: Workbench JSON 响应对象。
        """
        command_parts = ["env", f"KUBECONFIG={self.remote_path}", "kubectl", *kubectl_args]
        remote_command = (
            f"{shlex.join(['chmod', '600', '--', self.remote_path])} && "
            f"{shlex.join(command_parts)}"
        )
        return run_workbench_exec(
            self.args,
            self.instance_id,
            remote_command,
            operation,
            timeout=timeout,
        )


def upload_kubeconfig(args, instance_id, local_path):
    """上传临时 KubeConfig，偶发失败时重试。

    Workbench 上传偶发失败且重试即可成功；``--force`` 覆盖同名文件，重试天然幂等。

    @param args: 命令行参数。
    @param instance_id: 目标 ECS 实例 ID。
    @param local_path: 本地临时 KubeConfig 路径。
    @return: 无返回值。
    """
    detail = ""
    for _ in range(UPLOAD_ATTEMPTS):
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
        if upload.returncode == 0:
            return
        detail = summarize_cli_output(f"{upload.stderr}\n{upload.stdout}")
    raise AckError(
        f"Workbench 上传临时 KubeConfig 失败（共尝试 {UPLOAD_ATTEMPTS} 次）: {detail}"
    )


@contextmanager
def workbench_kubectl_session(args):
    """建立 Workbench 会话并保证临时 KubeConfig 在两端被清理。

    会话内的主错误与清理错误合并报告；主流程成功但清理失败时整体失败，
    并用 ``session.outcome`` 说明主流程结果，避免用户误判变更是否生效。

    @param args: 含集群、实例、profile、有效期与超时的命令行参数。
    @return: 生成 ``WorkbenchSession`` 的上下文管理器。
    """
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
    session = None
    primary_error = None
    cleanup_errors = []
    try:
        temp_dir = Path(tempfile.mkdtemp(prefix="aliyun-ops-ack-"))
        local_path = temp_dir / f"kubeconfig-{uuid.uuid4().hex}.yaml"
        remote_path = f"/tmp/{local_path.name}"
        write_private_text_file(local_path, config_text)
        upload_attempted = True
        upload_kubeconfig(args, instance_id, local_path)
        session = WorkbenchSession(args, instance_id, remote_path)
        yield session
    except (AckError, OSError) as error:
        primary_error = error
    finally:
        try:
            if upload_attempted and remote_path:
                try:
                    # 上传可能未落盘，rm -f 保证清理幂等，避免误报残留。
                    run_workbench_exec(
                        args,
                        instance_id,
                        shlex.join(["rm", "-f", "--", remote_path]),
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
    if primary_error:
        suffix = f"；同时清理失败: {cleanup_detail}" if cleanup_detail else ""
        raise AckError(f"{primary_error}{suffix}") from None
    if cleanup_detail:
        outcome = session.outcome if session else "查询成功"
        raise AckError(f"{outcome}，但临时 KubeConfig 清理失败: {cleanup_detail}")


def get_via_workbench(args):
    """通过 ACK Worker 和 Workbench 查询只读 Kubernetes JSON。

    @param args: get 子命令参数。
    @return: Kubernetes 响应对象。
    """
    build_k8s_path(args)
    kubectl_args = ["get", args.resource, "--namespace", args.namespace]
    if args.name:
        kubectl_args.append(args.name)
    kubectl_args.extend(["--output", "json", "--request-timeout", "20s"])
    with workbench_kubectl_session(args) as session:
        payload = session.run(kubectl_args, "kubectl get")
        try:
            body = json.loads(payload.get("stdout", ""))
        except json.JSONDecodeError:
            raise AckError("kubectl 未返回合法 JSON") from None
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


def read_allowlist(env_name):
    """读取逗号分隔的写入白名单。

    @param env_name: 环境变量名。
    @return: 去空后的白名单列表；未配置时为空列表。
    """
    return [item.strip() for item in os.environ.get(env_name, "").split(",") if item.strip()]


def validate_write_namespace(namespace):
    """校验写命令的命名空间格式与可选白名单。

    @param namespace: 命名空间。
    @return: 原始命名空间。
    """
    validate_path_segment(namespace, "命名空间")
    allowed = read_allowlist(WRITE_NAMESPACES_ENV)
    if allowed and namespace not in allowed:
        raise AckError(
            f"命名空间 {namespace!r} 不在 {WRITE_NAMESPACES_ENV} 白名单内: {', '.join(allowed)}"
        )
    return namespace


def validate_image(image):
    """校验镜像引用格式与可选仓库前缀白名单。

    @param image: 完整镜像引用。
    @return: 原始镜像引用。
    """
    if not SAFE_IMAGE.fullmatch(image or ""):
        raise AckError(f"镜像格式不合法: {image!r}")
    # 必须显式指定 tag 或 digest，避免隐式 latest 让回退目标不可追溯。
    if ":" not in image.rsplit("/", 1)[-1] and "@sha256:" not in image:
        raise AckError(f"镜像必须包含 :tag 或 @sha256: digest: {image!r}")
    prefixes = read_allowlist(IMAGE_PREFIXES_ENV)
    if prefixes and not any(image.startswith(prefix) for prefix in prefixes):
        raise AckError(
            f"镜像 {image!r} 不匹配 {IMAGE_PREFIXES_ENV} 白名单前缀: {', '.join(prefixes)}"
        )
    return image


def validate_rollout_timeout(timeout):
    """校验 rollout status 等待秒数。

    @param timeout: 等待秒数。
    @return: 原始秒数。
    """
    if not MIN_ROLLOUT_TIMEOUT <= timeout <= MAX_ROLLOUT_TIMEOUT:
        raise AckError(
            f"rollout 等待时间必须在 {MIN_ROLLOUT_TIMEOUT}~{MAX_ROLLOUT_TIMEOUT} 秒之间"
        )
    return timeout


def parse_env_changes(set_items, unset_items):
    """解析 set-env 的变更集合。

    @param set_items: ``KEY=VALUE`` 列表。
    @param unset_items: 待删除键列表。
    @return: 键到目标值的有序字典，目标值 ``None`` 表示删除。
    """
    changes = {}
    for raw in set_items or []:
        key, separator, value = raw.partition("=")
        if not separator:
            raise AckError(f"--set 必须是 KEY=VALUE 形式: {raw!r}")
        if any(char in value for char in "\r\n\x00"):
            raise AckError(f"环境变量 {key} 的值不能包含换行或 NUL")
        changes.setdefault(key, [])
        changes[key].append(value)
    for key in unset_items or []:
        changes.setdefault(key, [])
        changes[key].append(None)
    if not changes:
        raise AckError("set-env 至少需要一个 --set 或 --unset")
    result = {}
    for key, values in changes.items():
        if not SAFE_ENV_KEY.fullmatch(key):
            raise AckError(f"环境变量名不合法: {key!r}")
        if len(values) > 1:
            raise AckError(f"环境变量 {key} 被重复指定")
        result[key] = values[0]
    return result


def pick_container(deployment, container_name):
    """从 Deployment 中选出目标容器。

    @param deployment: Deployment JSON 对象。
    @param container_name: 用户指定的容器名；``None`` 时仅在单容器时自动选择。
    @return: 容器对象。
    """
    containers = [
        item
        for item in (
            deployment.get("spec", {}).get("template", {}).get("spec", {}).get("containers")
            or []
        )
        if isinstance(item, dict)
    ]
    names = [str(item.get("name", "")) for item in containers]
    if container_name:
        for item in containers:
            if item.get("name") == container_name:
                return item
        raise AckError(f"Deployment 中没有容器 {container_name!r}；现有容器: {', '.join(names)}")
    if len(containers) != 1:
        raise AckError(f"Deployment 有 {len(containers)} 个容器，请用 --container 指定: {', '.join(names)}")
    return containers[0]


def plan_image_change(container, image):
    """计算镜像变更。

    @param container: 目标容器对象。
    @param image: 目标镜像。
    @return: ``(显示名, 当前值, 目标值, kubectl 参数)`` 列表。
    """
    current = container.get("image", "")
    if current == image:
        return []
    return [("image", current, image, f"{container['name']}={image}")]


def plan_env_changes(container, changes):
    """计算环境变量变更，拒绝修改引用 Secret/ConfigMap 的键。

    @param container: 目标容器对象。
    @param changes: 键到目标值的字典，``None`` 表示删除。
    @return: ``(显示名, 当前值, 目标值, kubectl 参数)`` 列表。
    """
    current_env = {
        item.get("name"): item
        for item in container.get("env") or []
        if isinstance(item, dict)
    }
    planned = []
    for key, target in changes.items():
        item = current_env.get(key)
        # valueFrom 指向 Secret/ConfigMap，被覆盖为明文值会破坏密钥引用。
        if item is not None and "valueFrom" in item:
            raise AckError(f"环境变量 {key} 当前通过 valueFrom 引用 Secret/ConfigMap，拒绝修改")
        current = None if item is None else item.get("value", "")
        if current == target:
            continue
        token = f"{key}-" if target is None else f"{key}={target}"
        planned.append((f"env {key}", current, target, token))
    return planned


def describe_value(value):
    """把变更值转换为预览文本。

    @param value: 当前值或目标值，``None`` 表示不存在。
    @return: 预览文本。
    """
    return "<未设置>" if value is None else repr(value)


def run_rollout_status(session, args, timeout):
    """在 Workbench 会话内等待 Deployment 滚动发布完成。

    @param session: Workbench 会话。
    @param args: 含 namespace/deployment 的命令行参数。
    @param timeout: 等待秒数。
    @return: 无返回值。
    """
    # rollout status 依赖长连接 watch，不能附加 --request-timeout，否则会被提前中断。
    payload = session.run(
        [
            "rollout",
            "status",
            f"deployment/{args.deployment}",
            "--namespace",
            args.namespace,
            f"--timeout={timeout}s",
        ],
        "kubectl rollout status",
        timeout=timeout + ROLLOUT_EXEC_OVERHEAD,
    )
    print((payload.get("stdout") or "").strip())


def apply_deployment_change(args, plan, verb_args):
    """读取 Deployment、输出预览，并在 ``--yes`` 时执行受控变更。

    @param args: 写命令参数。
    @param plan: 以容器对象为入参、返回变更列表的函数。
    @param verb_args: 以容器名为入参、返回 kubectl 动词参数的函数。
    @return: 无返回值。
    """
    validate_write_namespace(args.namespace)
    validate_path_segment(args.deployment, "Deployment 名")
    if args.container:
        validate_path_segment(args.container, "容器名")
    rollout_timeout = validate_rollout_timeout(args.timeout) if args.wait else None

    with workbench_kubectl_session(args) as session:
        payload = session.run(
            [
                "get",
                "deployment",
                args.deployment,
                "--namespace",
                args.namespace,
                "--output",
                "json",
                "--request-timeout",
                "20s",
            ],
            "读取 Deployment",
        )
        try:
            deployment = json.loads(payload.get("stdout", ""))
        except json.JSONDecodeError:
            raise AckError("kubectl 未返回合法 Deployment JSON") from None
        container = pick_container(deployment, args.container)
        container_name = validate_path_segment(container.get("name", ""), "容器名")
        changes = plan(container)

        namespaces = read_allowlist(WRITE_NAMESPACES_ENV)
        prefixes = read_allowlist(IMAGE_PREFIXES_ENV)
        print("=== 待执行的 Deployment 变更 ===")
        print(f"  集群       : {args.cluster}")
        print(f"  命名空间   : {args.namespace}")
        print(f"  Deployment : {args.deployment}")
        print(f"  容器       : {container_name}")
        print(f"  命名空间白名单 : {', '.join(namespaces) if namespaces else '未配置（不限制）'}")
        print(f"  镜像前缀白名单 : {', '.join(prefixes) if prefixes else '未配置（不限制）'}")
        if not changes:
            print("  变更       : 无（当前值与目标值一致）")
            print("[ack] 无需变更，未执行写入。", file=sys.stderr)
            return
        for label, current, target, _ in changes:
            print(f"  {label}: {describe_value(current)} → {describe_value(target)}")
        if not args.yes:
            print("[ack] 仅预览，未执行。确认无误后加 --yes 重跑。", file=sys.stderr)
            return

        session.run(
            [
                *verb_args(container_name),
                *(token for *_, token in changes),
                "--namespace",
                args.namespace,
                "--request-timeout",
                "20s",
            ],
            "kubectl set",
        )
        session.outcome = "写入已生效"
        print("[ack] 变更已提交。")
        if rollout_timeout:
            try:
                run_rollout_status(session, args, rollout_timeout)
            except AckError as error:
                raise AckError(f"写入已生效，但等待发布失败: {error}") from None


def cmd_set_image(args):
    """受控切换 Deployment 容器镜像。

    @param args: set-image 子命令参数。
    @return: 无返回值。
    """
    image = validate_image(args.image)
    apply_deployment_change(
        args,
        lambda container: plan_image_change(container, image),
        lambda _: ["set", "image", f"deployment/{args.deployment}"],
    )


def cmd_set_env(args):
    """受控设置或删除 Deployment 容器环境变量。

    @param args: set-env 子命令参数。
    @return: 无返回值。
    """
    changes = parse_env_changes(args.set, args.unset)
    apply_deployment_change(
        args,
        lambda container: plan_env_changes(container, changes),
        lambda container_name: [
            "set",
            "env",
            f"deployment/{args.deployment}",
            "--containers",
            container_name,
        ],
    )


def cmd_rollout_status(args):
    """只读等待并输出 Deployment 滚动发布状态。

    @param args: rollout-status 子命令参数。
    @return: 无返回值。
    """
    validate_path_segment(args.namespace, "命名空间")
    validate_path_segment(args.deployment, "Deployment 名")
    timeout = validate_rollout_timeout(args.timeout)
    with workbench_kubectl_session(args) as session:
        run_rollout_status(session, args, timeout)


def add_workbench_arguments(parser):
    """为经 Workbench 执行的子命令添加共享参数。

    @param parser: 子命令解析器。
    @return: 无返回值。
    """
    parser.add_argument("--minutes", type=int, help="临时凭据有效分钟数，15~4320")
    parser.add_argument("--instance-id", help="Workbench 目标 ECS；不传则自动选 Worker")
    parser.add_argument(
        "--workbench-profile",
        default=DEFAULT_WORKBENCH_PROFILE,
        help=f"Workbench profile，默认 {DEFAULT_WORKBENCH_PROFILE}",
    )
    parser.add_argument(
        "--workbench-timeout",
        type=int,
        default=60,
        help="Workbench 单次命令超时秒数，默认 60",
    )


def add_deployment_arguments(parser, wait_flag):
    """为 Deployment 变更类子命令添加共享参数。

    @param parser: 子命令解析器。
    @param wait_flag: 是否提供 ``--wait``（写命令）而非必等（rollout-status）。
    @return: 无返回值。
    """
    parser.add_argument("--cluster", required=True, help="集群 ID")
    parser.add_argument("--namespace", required=True, help="命名空间")
    parser.add_argument("--deployment", required=True, help="Deployment 名")
    if wait_flag:
        parser.add_argument("--container", help="容器名；Deployment 只有一个容器时可省略")
        parser.add_argument("--wait", action="store_true", help="写入后等待 rollout 完成")
        parser.add_argument("--yes", action="store_true", help="确认执行；不传只输出预览")
    parser.add_argument(
        "--timeout",
        type=int,
        default=DEFAULT_ROLLOUT_TIMEOUT,
        help=(
            f"rollout 等待秒数，{MIN_ROLLOUT_TIMEOUT}~{MAX_ROLLOUT_TIMEOUT}，"
            f"默认 {DEFAULT_ROLLOUT_TIMEOUT}"
        ),
    )
    add_workbench_arguments(parser)


def build_parser():
    """构造 ACK CLI 参数解析器。

    @return: 配置完成的 ``ArgumentParser``。
    """
    parser = argparse.ArgumentParser(
        description="阿里云 ACK 只读查询与受控 Deployment 变更（stdlib-only）"
    )
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
    get_cmd.add_argument("--save", help="把 JSON 保存到文件")
    get_cmd.add_argument(
        "--via-workbench",
        action="store_true",
        help="经 ACK Worker 和 Workbench 访问私网 APIServer",
    )
    add_workbench_arguments(get_cmd)
    get_cmd.set_defaults(func=cmd_get)

    set_image = subparsers.add_parser(
        "set-image",
        help="受控切换 Deployment 容器镜像（经 Workbench；默认预览，--yes 执行）",
    )
    add_deployment_arguments(set_image, wait_flag=True)
    set_image.add_argument("--image", required=True, help="目标镜像，须含 :tag 或 @sha256:")
    set_image.set_defaults(func=cmd_set_image)

    set_env = subparsers.add_parser(
        "set-env",
        help="受控设置或删除 Deployment 容器环境变量（经 Workbench；默认预览，--yes 执行）",
    )
    add_deployment_arguments(set_env, wait_flag=True)
    set_env.add_argument("--set", action="append", metavar="KEY=VALUE", help="设置环境变量，可重复")
    set_env.add_argument("--unset", action="append", metavar="KEY", help="删除环境变量，可重复")
    set_env.set_defaults(func=cmd_set_env)

    rollout = subparsers.add_parser("rollout-status", help="只读等待 Deployment 滚动发布结果")
    add_deployment_arguments(rollout, wait_flag=False)
    rollout.set_defaults(func=cmd_rollout_status)
    return parser


def main():
    """加载 ACK 凭证并分发子命令。

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
