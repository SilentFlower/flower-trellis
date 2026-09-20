#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""阿里云 ROA 风格 OpenAPI 的 ACS3-HMAC-SHA256 签名与只读请求实现。"""

import hashlib
import hmac
import json
import os
import ssl
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone


SIGNATURE_ALGORITHM = "ACS3-HMAC-SHA256"


def rfc3986_encode(value, safe=""):
    """按 RFC3986 对字符串做百分号编码。

    @param value: 待编码字符串。
    @param safe: 额外不编码的字符。
    @return: 编码后的字符串。
    """
    return urllib.parse.quote(str(value), safe=safe + "-_.~")


def build_canonical_query(params):
    """构造按参数名排序的规范化查询字符串。

    @param params: Query 参数字典，值为 ``None`` 的项会被跳过。
    @return: 规范化查询字符串。
    """
    if not params:
        return ""
    pairs = []
    for key in sorted(params):
        value = params[key]
        if value is None:
            continue
        if isinstance(value, bool):
            value = "true" if value else "false"
        pairs.append(f"{rfc3986_encode(key)}={rfc3986_encode(value)}")
    return "&".join(pairs)


def sign_request(method, path, query, headers, payload, access_secret):
    """按 ACS3-HMAC-SHA256 计算签名。

    @param method: 大写 HTTP 方法名。
    @param path: 已编码的资源路径。
    @param query: 规范化查询字符串。
    @param headers: 不含 Authorization 的请求头。
    @param payload: 请求体字节串。
    @param access_secret: AccessKey Secret。
    @return: ``(签名十六进制串, SignedHeaders 串)``。
    """
    signable = {
        name.lower(): str(value).strip()
        for name, value in headers.items()
        if name.lower().startswith("x-acs-")
        or name.lower() in {"host", "content-type"}
    }
    signed_names = sorted(signable)
    canonical_headers = "".join(
        f"{name}:{signable[name]}\n" for name in signed_names
    )
    signed_headers = ";".join(signed_names)
    hashed_payload = hashlib.sha256(payload or b"").hexdigest()
    canonical_request = "\n".join(
        [method, path, query, canonical_headers, signed_headers, hashed_payload]
    )
    string_to_sign = (
        f"{SIGNATURE_ALGORITHM}\n"
        f"{hashlib.sha256(canonical_request.encode('utf-8')).hexdigest()}"
    )
    signature = hmac.new(
        access_secret.encode("utf-8"),
        string_to_sign.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return signature, signed_headers


def roa_request(
    endpoint,
    method,
    path,
    version,
    access_key,
    access_secret,
    query=None,
    body=None,
    action=None,
    timeout=30,
):
    """发起 ROA 风格 OpenAPI 请求并解析响应。

    @param endpoint: 服务接入域名。
    @param method: HTTP 方法名。
    @param path: ROA 资源路径。
    @param version: API 版本号。
    @param access_key: AccessKey ID。
    @param access_secret: AccessKey Secret。
    @param query: Query 参数字典。
    @param body: 可选 JSON 请求体。
    @param action: 可选 API Action 名称。
    @param timeout: 请求超时秒数。
    @return: ``(HTTP 状态码, 响应对象或原始文本)``。
    """
    payload = (
        b""
        if body is None
        else json.dumps(body, ensure_ascii=False).encode("utf-8")
    )
    canonical_query = build_canonical_query(query)
    canonical_path = (
        "/"
        + "/".join(
            rfc3986_encode(segment) for segment in path.strip("/").split("/")
        )
        if path.strip("/")
        else "/"
    )
    headers = {
        "host": endpoint,
        "x-acs-version": version,
        "x-acs-date": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "x-acs-signature-nonce": uuid.uuid4().hex,
        "x-acs-content-sha256": hashlib.sha256(payload).hexdigest(),
    }
    if action:
        headers["x-acs-action"] = action
    if payload:
        headers["content-type"] = "application/json; charset=utf-8"

    signature, signed_headers = sign_request(
        method,
        canonical_path,
        canonical_query,
        headers,
        payload,
        access_secret,
    )
    headers["Authorization"] = (
        f"{SIGNATURE_ALGORITHM} Credential={access_key},"
        f"SignedHeaders={signed_headers},Signature={signature}"
    )
    url = f"https://{endpoint}{canonical_path}"
    if canonical_query:
        url = f"{url}?{canonical_query}"

    request = urllib.request.Request(
        url,
        data=payload or None,
        headers=headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            status = response.status
            text = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as error:
        status = error.code
        text = error.read().decode("utf-8", errors="replace")

    try:
        return status, json.loads(text)
    except json.JSONDecodeError:
        return status, text


def k8s_request(server, ca_data, cert_data, key_data, path, timeout=30):
    """用 KubeConfig 客户端证书直连 Kubernetes APIServer 执行 GET。

    @param server: APIServer 地址。
    @param ca_data: PEM 格式 CA 证书。
    @param cert_data: PEM 格式客户端证书。
    @param key_data: PEM 格式客户端私钥。
    @param path: Kubernetes API 资源路径。
    @param timeout: 请求超时秒数。
    @return: ``(HTTP 状态码, 响应对象或原始文本)``。
    """
    temp_paths = []
    cleanup_errors = []
    operation_error = None
    result = None

    def write_temp(content):
        """写入权限为 600 的证书临时文件。"""
        handle, temp_path = tempfile.mkstemp(prefix="aliyun-ops-ack-cert-")
        temp_paths.append(temp_path)
        try:
            stream = os.fdopen(handle, "w", encoding="utf-8")
            handle = None
            with stream:
                stream.write(content)
            os.chmod(temp_path, 0o600)
        finally:
            if handle is not None:
                os.close(handle)
        return temp_path

    try:
        context = ssl.create_default_context(cafile=write_temp(ca_data))
        context.load_cert_chain(write_temp(cert_data), write_temp(key_data))
        request = urllib.request.Request(
            f"{server.rstrip('/')}{path}",
            method="GET",
        )
        try:
            with urllib.request.urlopen(
                request,
                timeout=timeout,
                context=context,
            ) as response:
                status = response.status
                text = response.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as error:
            status = error.code
            text = error.read().decode("utf-8", errors="replace")
        except urllib.error.URLError as error:
            raise ConnectionError(
                f"无法连通 APIServer {server}: {error.reason}。"
                "该端点可能仅限 VPC 访问；可改用 ack.py get --via-workbench。"
            ) from None
        try:
            result = (status, json.loads(text))
        except json.JSONDecodeError:
            result = (status, text)
    except Exception as error:
        operation_error = error
    finally:
        for temp_path in temp_paths:
            try:
                os.unlink(temp_path)
            except OSError as error:
                cleanup_errors.append(f"{temp_path}: {error}")

    cleanup_detail = "；".join(cleanup_errors)
    if operation_error:
        if cleanup_detail:
            raise OSError(
                f"{operation_error}；同时清理客户端证书失败: {cleanup_detail}"
            ) from operation_error
        raise operation_error
    if cleanup_detail:
        raise OSError(f"APIServer 查询成功，但清理客户端证书失败: {cleanup_detail}")
    return result
