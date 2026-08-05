#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""阿里云 RPC v1 HMAC-SHA1 签名与请求实现。"""

import base64
import hashlib
import hmac
import json
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone


def percent_encode(value):
    """按阿里云 RPC v1 规则编码签名参数。

    @param value: 待编码值。
    @return: RFC 3986 兼容的编码结果。
    """
    return urllib.parse.quote(str(value), safe="~")


def build_signed_parameters(version, action, params, access_key, access_secret, method):
    """构造包含公共参数与签名的 RPC 参数。

    @param version: OpenAPI 版本。
    @param action: OpenAPI Action。
    @param params: 产品业务参数。
    @param access_key: AccessKey ID。
    @param access_secret: AccessKey Secret。
    @param method: HTTP 方法。
    @return: 可直接发送的签名参数字典。
    """
    query = {
        "Format": "JSON",
        "Version": version,
        "Action": action,
        "AccessKeyId": access_key,
        "SignatureMethod": "HMAC-SHA1",
        "SignatureVersion": "1.0",
        "SignatureNonce": uuid.uuid4().hex,
        "Timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    query.update({key: value for key, value in params.items() if value is not None})
    canonical = "&".join(
        f"{percent_encode(key)}={percent_encode(query[key])}" for key in sorted(query)
    )
    string_to_sign = f"{method.upper()}&{percent_encode('/')}&{percent_encode(canonical)}"
    query["Signature"] = base64.b64encode(
        hmac.new(
            (access_secret + "&").encode("utf-8"),
            string_to_sign.encode("utf-8"),
            hashlib.sha1,
        ).digest()
    ).decode("utf-8")
    return query


def rpc_request(
    endpoint,
    version,
    action,
    params,
    access_key,
    access_secret,
    method="GET",
    timeout=60,
):
    """发送阿里云 RPC v1 请求并返回结构化响应。

    @param endpoint: 不含协议与路径的 API endpoint。
    @param version: OpenAPI 版本。
    @param action: OpenAPI Action。
    @param params: 产品业务参数。
    @param access_key: AccessKey ID。
    @param access_secret: AccessKey Secret。
    @param method: ``GET`` 或 ``POST``。
    @param timeout: 网络超时秒数。
    @return: ``(http_status, body_dict)`` 元组。
    """
    request_method = method.upper()
    signed = build_signed_parameters(
        version,
        action,
        params,
        access_key,
        access_secret,
        request_method,
    )
    if request_method == "GET":
        url = f"https://{endpoint}/?{urllib.parse.urlencode(signed)}"
        request = urllib.request.Request(url, method="GET")
    elif request_method == "POST":
        request = urllib.request.Request(
            f"https://{endpoint}/",
            data=urllib.parse.urlencode(signed).encode("utf-8"),
            method="POST",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    else:
        raise ValueError(f"不支持的 RPC HTTP 方法: {method}")

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, json.loads(exc.read().decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return exc.code, {"Message": "unparseable error body"}
    except Exception as exc:  # noqa: BLE001
        return -1, {"Message": f"{type(exc).__name__}: {exc}"}
