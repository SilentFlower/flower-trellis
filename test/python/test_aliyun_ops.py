"""统一阿里云运维 Skill 的配置、签名与 MSE 安全边界测试。"""

from __future__ import annotations

import contextlib
import io
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock
import urllib.parse


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = (
    ROOT
    / "vendor/skill-garden/.common/.codex/skills/aliyun-ops/scripts"
)
sys.dont_write_bytecode = True
sys.path.insert(0, str(SCRIPTS))

import aliyun_common  # noqa: E402
import aliyun_rpc_v1  # noqa: E402
import ack  # noqa: E402
import ack_roa_v3  # noqa: E402
import dms  # noqa: E402
import mse  # noqa: E402


class AliyunCommonEnvTest(unittest.TestCase):
    """验证统一配置与旧配置的只读优先级。"""

    def setUp(self) -> None:
        """创建隔离 HOME。"""
        self.temp = tempfile.TemporaryDirectory(prefix="flower-aliyun-ops-")
        self.home = Path(self.temp.name)

    def tearDown(self) -> None:
        """清理隔离 HOME。"""
        self.temp.cleanup()

    def write_env(self, relative: str, content: str) -> Path:
        """写入权限为 600 的测试 ENV 文件。

        Args:
            relative: 相对隔离 HOME 的路径。
            content: ENV 文件内容。

        Returns:
            已创建文件路径。
        """
        path = self.home / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        path.chmod(0o600)
        return path

    def test_default_files_only_fill_missing_values(self) -> None:
        """进程变量和统一文件优先，旧文件只补空值。"""
        self.write_env(
            ".config/aliyun-ops/env",
            "ALIYUN_ACCESS_KEY_ID=unified-ak\nSHARED=unified\n",
        )
        self.write_env(
            ".config/aliyun-dms-query/env",
            "ALIYUN_ACCESS_KEY_ID=legacy-ak\nALIYUN_ACCESS_KEY_SECRET=dms-sk\n"
            "DMS_ONLY=1\n",
        )
        self.write_env(
            ".config/aliyun-sls-query/env",
            "ALIYUN_ACCESS_KEY_SECRET=sls-sk\nSLS_ONLY=1\n",
        )

        with mock.patch.dict(
            os.environ,
            {"HOME": str(self.home), "USERPROFILE": str(self.home), "SHARED": "process"},
            clear=True,
        ):
            loaded = aliyun_common.load_product_env("dms")
            self.assertEqual(os.environ["SHARED"], "process")
            self.assertEqual(os.environ["ALIYUN_ACCESS_KEY_ID"], "unified-ak")
            self.assertEqual(os.environ["ALIYUN_ACCESS_KEY_SECRET"], "dms-sk")
            self.assertEqual(os.environ["DMS_ONLY"], "1")
            self.assertEqual(os.environ["SLS_ONLY"], "1")
            self.assertEqual(len(loaded), 3)

    def test_explicit_missing_file_fails_without_fallback(self) -> None:
        """显式文件缺失时不读取已存在的默认文件。"""
        self.write_env(
            ".config/aliyun-ops/env",
            "ALIYUN_ACCESS_KEY_ID=should-not-load\n",
        )
        missing = self.home / "missing.env"
        with mock.patch.dict(os.environ, {"HOME": str(self.home)}, clear=True):
            with self.assertRaises(FileNotFoundError):
                aliyun_common.load_product_env("sls", str(missing))
            self.assertNotIn("ALIYUN_ACCESS_KEY_ID", os.environ)

    def test_product_env_file_beats_unified_env_file_variable(self) -> None:
        """产品级显式文件优先于统一显式文件。"""
        product = self.write_env("product.env", "SOURCE=product\n")
        unified = self.write_env("unified.env", "SOURCE=unified\n")
        with mock.patch.dict(
            os.environ,
            {
                "HOME": str(self.home),
                "ALIYUN_MSE_ENV_FILE": str(product),
                "ALIYUN_OPS_ENV_FILE": str(unified),
            },
            clear=True,
        ):
            aliyun_common.load_product_env("mse")
            self.assertEqual(os.environ["SOURCE"], "product")

    def test_ack_uses_its_product_env_file(self) -> None:
        """ACK 可使用独立 ENV 文件且不会读取统一文件。"""
        product = self.write_env("ack.env", "SOURCE=ack\n")
        unified = self.write_env("unified.env", "SOURCE=unified\n")
        with mock.patch.dict(
            os.environ,
            {
                "HOME": str(self.home),
                "ALIYUN_ACK_ENV_FILE": str(product),
                "ALIYUN_OPS_ENV_FILE": str(unified),
            },
            clear=True,
        ):
            loaded = aliyun_common.load_product_env("ack")

        self.assertEqual(loaded, [str(product)])

    def test_env_file_is_not_modified(self) -> None:
        """加载配置不会改写内容、权限或修改时间。"""
        path = self.write_env("explicit.env", "ALIYUN_ACCESS_KEY_ID=test-ak\n")
        before = (path.read_bytes(), stat.S_IMODE(path.stat().st_mode), path.stat().st_mtime_ns)
        with mock.patch.dict(os.environ, {"HOME": str(self.home)}, clear=True):
            aliyun_common.load_product_env("dms", str(path))
        after = (path.read_bytes(), stat.S_IMODE(path.stat().st_mode), path.stat().st_mtime_ns)
        self.assertEqual(after, before)

    def test_insecure_env_file_is_rejected(self) -> None:
        """非 Windows 平台拒绝组或其它用户可读的凭证文件。"""
        if os.name == "nt":
            self.skipTest("Windows 不提供一致的 POSIX 权限语义")
        path = self.write_env("insecure.env", "ALIYUN_ACCESS_KEY_ID=test-ak\n")
        path.chmod(0o644)
        with mock.patch.dict(os.environ, {"HOME": str(self.home)}, clear=True):
            with self.assertRaises(PermissionError):
                aliyun_common.load_product_env("dms", str(path))


class AliyunRpcV1Test(unittest.TestCase):
    """验证共享 RPC v1 请求契约。"""

    def test_get_request_contains_business_and_common_parameters(self) -> None:
        """GET 请求携带 Action、Version、RegionId 与签名。"""
        response = mock.MagicMock()
        response.status = 200
        response.read.return_value = b'{"Success":true}'
        context = mock.MagicMock()
        context.__enter__.return_value = response
        context.__exit__.return_value = False

        with mock.patch.object(
            aliyun_rpc_v1.urllib.request,
            "urlopen",
            return_value=context,
        ) as urlopen:
            status, body = aliyun_rpc_v1.rpc_request(
                "mse.cn-shanghai.aliyuncs.com",
                "2019-05-31",
                "ListClusters",
                {"RegionId": "cn-shanghai", "Ignored": None},
                "test-ak",
                "test-sk",
                method="GET",
            )

        request = urlopen.call_args.args[0]
        query = urllib.parse.parse_qs(urllib.parse.urlparse(request.full_url).query)
        self.assertEqual(status, 200)
        self.assertTrue(body["Success"])
        self.assertEqual(query["Action"], ["ListClusters"])
        self.assertEqual(query["Version"], ["2019-05-31"])
        self.assertEqual(query["RegionId"], ["cn-shanghai"])
        self.assertIn("Signature", query)
        self.assertNotIn("Ignored", query)


class DmsReadonlyGuardTest(unittest.TestCase):
    """验证 DMS 只读通道不会接收混合语句或 CTE 写操作。"""

    def query_args(self, sql: str) -> SimpleNamespace:
        """构造 DMS query 命令参数。

        Args:
            sql: 待检查的 SQL 脚本。

        Returns:
            可供 ``cmd_query`` 使用的参数对象。
        """
        return SimpleNamespace(
            sql=sql,
            file=None,
            tid="1",
            db="2",
            logic=False,
            timeout=30,
            format="json",
        )

    def test_readonly_statements_still_execute(self) -> None:
        """多条只读语句、注释和只读 CTE 仍可执行。"""
        sql = "SELECT 'a;UPDATE'; -- UPDATE in comment\nWITH cte AS (SELECT 1) SELECT * FROM cte"
        output = io.StringIO()
        with mock.patch.object(
            dms,
            "rpc",
            return_value=(200, {"Success": True, "Results": []}),
        ) as request:
            with contextlib.redirect_stdout(output):
                result = dms.cmd_query(self.query_args(sql), "ak", "sk")

        self.assertEqual(result, 0)
        request.assert_called_once()
        self.assertEqual(request.call_args.args[0], "ExecuteScript")

    def test_mutating_statements_are_rejected_before_rpc(self) -> None:
        """混合语句、CTE 写操作和 MySQL 可执行注释都在 RPC 前拒绝。"""
        cases = (
            ("SELECT 1; UPDATE t_xxx SET c_a=1", "UPDATE"),
            ("WITH cte AS (SELECT 1) UPDATE t_xxx SET c_a=1", "UPDATE"),
            ("SELECT 1 /*!; DELETE FROM t_xxx */", "MYSQL_EXEC_COMMENT"),
        )
        for sql, keyword in cases:
            with self.subTest(sql=sql):
                error = io.StringIO()
                with mock.patch.object(dms, "rpc") as request:
                    with contextlib.redirect_stderr(error):
                        result = dms.cmd_query(self.query_args(sql), "ak", "sk")

                self.assertEqual(result, 2)
                request.assert_not_called()
                self.assertIn(f"({keyword})", error.getvalue())


class MseCliTest(unittest.TestCase):
    """验证 MSE 区域参数、分页与配置内容保护。"""

    def mse_args(self, **overrides) -> SimpleNamespace:
        """构造 MSE 命令测试参数。

        Args:
            overrides: 覆盖的命令参数。

        Returns:
            可供命令函数使用的参数对象。
        """
        values = {
            "region": "cn-shanghai",
            "endpoint": "mse.cn-shanghai.aliyuncs.com",
            "timeout": 30,
            "format": "json",
            "page_size": 2,
            "max_pages": 10,
            "instance": "mse-cn-test",
            "namespace": "public",
            "data_id": "application.yml",
            "group": "DEFAULT_GROUP",
            "grep": None,
            "nid": "42",
        }
        values.update(overrides)
        return SimpleNamespace(**values)

    def test_call_mse_always_adds_region_id(self) -> None:
        """所有 MSE 请求统一补入 RegionId。"""
        with mock.patch.object(
            mse,
            "rpc_request",
            return_value=(200, {"Success": True}),
        ) as request:
            mse.call_mse("ListClusters", {"PageNum": 1}, self.mse_args(), "ak", "sk")

        args = request.call_args.args
        self.assertEqual(args[0], "mse.cn-shanghai.aliyuncs.com")
        self.assertEqual(args[2], "ListClusters")
        self.assertEqual(args[3]["RegionId"], "cn-shanghai")

    def test_call_mse_reports_official_error_code(self) -> None:
        """业务失败时优先显示 MSE 官方 ``ErrorCode``。"""
        with mock.patch.object(
            mse,
            "rpc_request",
            return_value=(
                200,
                {"Success": False, "ErrorCode": "NoPermission", "Message": "denied"},
            ),
        ):
            with self.assertRaisesRegex(RuntimeError, r"NoPermission denied"):
                mse.call_mse("GetNacosConfig", {}, self.mse_args(), "ak", "sk")

    def test_config_without_grep_only_outputs_summary(self) -> None:
        """当前配置默认输出摘要，不泄露配置正文。"""
        body = {
            "Success": True,
            "Configuration": {
                "Content": "password=top-secret\nservice.name=srm\n",
                "Group": "DEFAULT_GROUP",
                "Type": "yaml",
            },
        }
        output = io.StringIO()
        with mock.patch.object(mse, "call_mse", return_value=body):
            with contextlib.redirect_stdout(output):
                result = mse.cmd_config(self.mse_args(), "ak", "sk")

        self.assertEqual(result, 0)
        self.assertIn('"Lines": 2', output.getvalue())
        self.assertNotIn("top-secret", output.getvalue())
        self.assertNotIn("password=", output.getvalue())

    def test_config_with_grep_only_outputs_matching_lines(self) -> None:
        """关键字过滤只输出命中行。"""
        body = {
            "Success": True,
            "Configuration": {
                "Content": "password=top-secret\nservice.name=srm\n",
            },
        }
        output = io.StringIO()
        with mock.patch.object(mse, "call_mse", return_value=body):
            with contextlib.redirect_stdout(output):
                result = mse.cmd_config(self.mse_args(grep="service"), "ak", "sk")

        self.assertEqual(result, 0)
        self.assertIn("service.name=srm", output.getvalue())
        self.assertNotIn("top-secret", output.getvalue())

    def test_configs_stops_after_last_page(self) -> None:
        """配置列表按总数翻页且不会继续发空请求。"""
        pages = [
            {
                "Success": True,
                "TotalCount": 3,
                "Configurations": [
                    {"DataId": "a", "Group": "g", "Type": "yaml"},
                    {"DataId": "b", "Group": "g", "Type": "yaml"},
                ],
            },
            {
                "Success": True,
                "TotalCount": 3,
                "Configurations": [
                    {"DataId": "c", "Group": "g", "Type": "yaml"},
                ],
            },
        ]
        output = io.StringIO()
        with mock.patch.object(mse, "call_mse", side_effect=pages) as call:
            with contextlib.redirect_stdout(output):
                result = mse.cmd_configs(self.mse_args(), "ak", "sk")

        self.assertEqual(result, 0)
        self.assertEqual(call.call_count, 2)
        self.assertEqual([row["DataId"] for row in json.loads(output.getvalue())], ["a", "b", "c"])

    def test_history_config_summary_hides_content(self) -> None:
        """历史配置默认同样不输出正文。"""
        body = {
            "Success": True,
            "Configuration": {
                "Content": "token=history-secret\n",
                "OpType": "U",
                "SrcUser": "operator",
            },
        }
        output = io.StringIO()
        with mock.patch.object(mse, "call_mse", return_value=body):
            with contextlib.redirect_stdout(output):
                result = mse.cmd_history_config(self.mse_args(), "ak", "sk")

        self.assertEqual(result, 0)
        self.assertIn('"Nid": "42"', output.getvalue())
        self.assertNotIn("history-secret", output.getvalue())


class AckRoaV3Test(unittest.TestCase):
    """验证 ACK ROA V3 查询编码与签名边界。"""

    def test_canonical_query_uses_sorted_acs_values(self) -> None:
        """Query 参数排序、布尔值和特殊字符编码符合 ACS3 契约。"""
        query = ack_roa_v3.build_canonical_query(
            {"z": None, "PrivateIpAddress": True, "name": "a b"}
        )

        self.assertEqual(query, "PrivateIpAddress=true&name=a%20b")

    def test_signature_never_contains_access_secret(self) -> None:
        """签名结果只返回摘要与头名单，不回传 Secret。"""
        signature, signed_headers = ack_roa_v3.sign_request(
            "GET",
            "/api/v1/clusters",
            "",
            {
                "host": "cs.cn-hangzhou.aliyuncs.com",
                "x-acs-date": "2026-09-20T00:00:00Z",
                "x-acs-content-sha256": "abc",
            },
            b"",
            "test-secret",
        )

        self.assertRegex(signature, r"^[0-9a-f]{64}$")
        self.assertNotIn("test-secret", signature)
        self.assertEqual(
            signed_headers,
            "host;x-acs-content-sha256;x-acs-date",
        )


class AckCliTest(unittest.TestCase):
    """验证 ACK 只读查询和 Workbench 临时凭证生命周期。"""

    def ack_args(self, **overrides) -> SimpleNamespace:
        """构造 ACK 命令参数。

        Args:
            overrides: 需要覆盖的参数。

        Returns:
            可供 ACK 命令函数使用的参数对象。
        """
        values = {
            "region": "cn-hangzhou",
            "cluster": "c-test-cluster",
            "internal": False,
            "minutes": None,
            "namespace": "xhgj-ai",
            "resource": "configmaps",
            "name": None,
            "format": "summary",
            "keep_status": False,
            "save": None,
            "via_workbench": False,
            "instance_id": None,
            "workbench_profile": "aliyun-ops",
            "workbench_timeout": 60,
            "_access_key": "test-ak",
            "_access_secret": "test-sk",
        }
        values.update(overrides)
        return SimpleNamespace(**values)

    def completed(self, argv, returncode=0, stdout="", stderr=""):
        """构造 subprocess 完成结果。

        Args:
            argv: 原始参数数组。
            returncode: 进程退出码。
            stdout: 标准输出。
            stderr: 标准错误。

        Returns:
            ``subprocess.CompletedProcess`` 等价对象。
        """
        return SimpleNamespace(
            args=argv,
            returncode=returncode,
            stdout=stdout,
            stderr=stderr,
        )

    def test_nodes_use_official_pagination_parameters(self) -> None:
        """节点列表使用 pageSize/pageNumber 并按总数翻页。"""
        pages = [
            {
                "nodes": [{"instance_id": "i-a"}],
                "page": {"total_count": 2},
            },
            {
                "nodes": [{"instance_id": "i-b"}],
                "page": {"total_count": 2},
            },
        ]
        with mock.patch.object(ack, "call_cs", side_effect=pages) as request:
            nodes = ack.list_cluster_nodes(self.ack_args(), state="running")

        self.assertEqual([node["instance_id"] for node in nodes], ["i-a", "i-b"])
        self.assertEqual(request.call_args_list[0].kwargs["query"], {
            "pageSize": 100,
            "pageNumber": 1,
            "state": "running",
        })
        self.assertEqual(request.call_args_list[1].kwargs["query"]["pageNumber"], 2)

    def test_auto_select_only_uses_ready_running_aliyun_worker(self) -> None:
        """自动选择过滤非阿里云、非 Worker 和非 Ready 节点。"""
        nodes = [
            {
                "instance_id": "i-z",
                "is_aliyun_node": True,
                "instance_role": "Worker",
                "instance_status": "Running",
                "node_status": "Ready",
            },
            {
                "instance_id": "i-a",
                "is_aliyun_node": True,
                "instance_role": "Worker",
                "state": "running",
                "node_status": "Ready",
            },
            {
                "instance_id": "i-bad",
                "is_aliyun_node": False,
                "instance_role": "Worker",
                "instance_status": "Running",
                "node_status": "Ready",
            },
        ]
        with mock.patch.object(ack, "list_cluster_nodes", return_value=nodes):
            selected = ack.select_workbench_instance(self.ack_args())

        self.assertEqual(selected, "i-a")

    def test_secret_data_and_string_data_are_redacted(self) -> None:
        """Secret 的两种值字段都只保留键名。"""
        cleaned = ack.strip_noise({
            "kind": "Secret",
            "metadata": {"name": "credentials", "managedFields": ["noise"]},
            "data": {"password": "c2VjcmV0"},
            "stringData": {"token": "plain-secret"},
            "status": {"phase": "unused"},
        })

        self.assertEqual(cleaned["data"], {"password": "<REDACTED>"})
        self.assertEqual(cleaned["stringData"], {"token": "<REDACTED>"})
        self.assertNotIn("managedFields", cleaned["metadata"])
        self.assertNotIn("status", cleaned)

    def test_direct_get_uses_fixed_readonly_api_path(self) -> None:
        """直连路径只向白名单资源发送 Kubernetes GET。"""
        args = self.ack_args(name="app-config")
        with mock.patch.object(
                ack,
                "fetch_kubeconfig",
                return_value=("kubeconfig", "expiration"),
            ), mock.patch.object(
                ack,
                "parse_kubeconfig",
                return_value=("https://api:6443", "ca", "cert", "key"),
            ), mock.patch.object(
                ack,
                "k8s_request",
                return_value=(200, {"kind": "ConfigMap"}),
            ) as request:
            body = ack.get_direct(args)

        self.assertEqual(body["kind"], "ConfigMap")
        self.assertEqual(
            request.call_args.args[-1],
            "/api/v1/namespaces/xhgj-ai/configmaps/app-config",
        )

    def test_kubeconfig_save_does_not_require_fchmod(self) -> None:
        """Windows 缺少 fchmod 时仍能保存 KubeConfig。"""
        with tempfile.TemporaryDirectory(prefix="flower-ack-save-") as root:
            target = Path(root) / "config.yaml"
            args = self.ack_args(save=str(target))
            with mock.patch.object(
                    ack,
                    "fetch_kubeconfig",
                    return_value=("apiVersion: v1\n", "2026-09-20T01:00:00Z"),
                ), mock.patch.object(
                    ack,
                    "parse_kubeconfig",
                    return_value=("https://api:6443", "ca", "cert", "key"),
                ), mock.patch.object(ack.os, "fchmod", new=None):
                ack.cmd_kubeconfig(args)

            self.assertEqual(target.read_text(encoding="utf-8"), "apiVersion: v1\n")

    def test_direct_temp_setup_failure_removes_partial_certificate(self) -> None:
        """直连证书初始化失败时删除已经创建的敏感临时文件。"""
        real_mkstemp = tempfile.mkstemp
        with tempfile.TemporaryDirectory(prefix="flower-ack-cert-") as root:
            def create_in_test_dir(prefix):
                """在测试目录创建临时证书文件。"""
                return real_mkstemp(prefix=prefix, dir=root)

            with mock.patch.object(
                    ack_roa_v3.tempfile,
                    "mkstemp",
                    side_effect=create_in_test_dir,
                ), mock.patch.object(
                    ack_roa_v3.os,
                    "chmod",
                    side_effect=OSError("chmod failed"),
                ):
                with self.assertRaisesRegex(OSError, "chmod failed"):
                    ack_roa_v3.k8s_request(
                        "https://api.invalid",
                        "CA",
                        "CERT",
                        "KEY",
                        "/api/v1/pods",
                    )

            self.assertEqual(list(Path(root).iterdir()), [])

    def test_direct_temp_cleanup_failure_reports_residual_path(self) -> None:
        """直连证书删除失败时返回残留路径而非静默成功。"""
        response = mock.MagicMock()
        response.status = 200
        response.read.return_value = b'{"items":[]}'
        response_context = mock.MagicMock()
        response_context.__enter__.return_value = response
        response_context.__exit__.return_value = False
        ssl_context = mock.MagicMock()
        residual_paths = []
        real_mkstemp = tempfile.mkstemp

        def fail_unlink(path):
            """记录待人工清理路径并模拟删除失败。"""
            residual_paths.append(Path(path))
            raise OSError("unlink failed")

        with tempfile.TemporaryDirectory(prefix="flower-ack-cleanup-") as root:
            def create_in_test_dir(prefix):
                """在测试目录创建待清理证书文件。"""
                return real_mkstemp(prefix=prefix, dir=root)

            try:
                with mock.patch.object(
                        ack_roa_v3.tempfile,
                        "mkstemp",
                        side_effect=create_in_test_dir,
                    ), mock.patch.object(
                        ack_roa_v3.ssl,
                        "create_default_context",
                        return_value=ssl_context,
                    ), mock.patch.object(
                        ack_roa_v3.urllib.request,
                        "urlopen",
                        return_value=response_context,
                    ), mock.patch.object(
                        ack_roa_v3.os,
                        "unlink",
                        side_effect=fail_unlink,
                    ):
                    with self.assertRaisesRegex(
                        OSError,
                        r"查询成功.*清理客户端证书失败.*aliyun-ops-ack-cert-",
                    ):
                        ack_roa_v3.k8s_request(
                            "https://api.invalid",
                            "CA",
                            "CERT",
                            "KEY",
                            "/api/v1/pods",
                        )
            finally:
                for path in residual_paths:
                    if path.exists():
                        path.unlink()

    def test_workbench_rejects_valid_json_with_invalid_schema(self) -> None:
        """Workbench 合法 JSON 的结构异常会转换为可诊断错误。"""
        cases = (
            ("[]", "根节点必须是对象"),
            ('{"exit_code":0,"stdout":null}', "stdout 必须是字符串"),
        )
        args = self.ack_args()
        for stdout, message in cases:
            with self.subTest(stdout=stdout), mock.patch.object(
                ack,
                "run_process",
                return_value=self.completed([], stdout=stdout),
            ):
                with self.assertRaisesRegex(ack.AckError, message):
                    ack.run_workbench_exec(args, "i-test", "true", "测试")

    def test_workbench_get_uploads_executes_and_cleans_both_sides(self) -> None:
        """Workbench 成功链路上传、查询并清理远端和本地临时文件。"""
        calls = []
        local_paths = []

        def which(command):
            return f"/usr/bin/{command}"

        def run(argv):
            calls.append(argv)
            if argv[0].endswith("shred"):
                local_paths.append(Path(argv[-1]))
                Path(argv[-1]).unlink()
                return self.completed(argv)
            if argv[1] == "upload":
                local_paths.append(Path(argv[2]))
                return self.completed(argv, stdout='{"uploaded":true}')
            command = argv[argv.index("--command") + 1]
            if "kubectl get" in command:
                stdout = json.dumps({
                    "items": [
                        {
                            "kind": "ConfigMap",
                            "metadata": {"name": "app-config"},
                            "data": {"application.yml": "content"},
                        }
                    ]
                })
                return self.completed(
                    argv,
                    stdout=json.dumps({
                        "exit_code": 0,
                        "stdout": stdout,
                        "stderr": "",
                    }),
                )
            return self.completed(
                argv,
                stdout='{"exit_code":0,"stdout":"","stderr":""}',
            )

        with mock.patch.object(ack.shutil, "which", side_effect=which), \
                mock.patch.object(
                    ack,
                    "select_workbench_instance",
                    return_value="i-test",
                ), \
                mock.patch.object(
                    ack,
                    "fetch_kubeconfig",
                    return_value=("apiVersion: v1\n", "2026-09-20T01:00:00Z"),
                ), \
                mock.patch.object(ack, "run_process", side_effect=run):
            body = ack.get_via_workbench(self.ack_args())

        self.assertEqual(body["items"][0]["metadata"]["name"], "app-config")
        self.assertTrue(any(argv[1] == "upload" for argv in calls if len(argv) > 1))
        remote_commands = [
            argv[argv.index("--command") + 1]
            for argv in calls
            if "--command" in argv
        ]
        self.assertTrue(any("kubectl get configmaps" in command for command in remote_commands))
        self.assertTrue(any("chmod 600 --" in command for command in remote_commands))
        self.assertTrue(any("unlink --" in command for command in remote_commands))
        self.assertTrue(local_paths)
        self.assertTrue(all(not path.exists() for path in local_paths))

    def test_workbench_query_failure_still_cleans_remote_file(self) -> None:
        """kubectl 失败时仍执行远端和本地清理。"""
        commands = []

        def run(argv):
            if argv[0].endswith("shred"):
                Path(argv[-1]).unlink()
                return self.completed(argv)
            if argv[1] == "upload":
                return self.completed(argv, stdout="{}")
            command = argv[argv.index("--command") + 1]
            commands.append(command)
            if "kubectl get" in command:
                return self.completed(
                    argv,
                    stdout='{"exit_code":1,"stdout":"","stderr":"Forbidden"}',
                )
            return self.completed(
                argv,
                stdout='{"exit_code":0,"stdout":"","stderr":""}',
            )

        with mock.patch.object(
                ack.shutil,
                "which",
                side_effect=lambda name: f"/usr/bin/{name}",
            ), \
                mock.patch.object(
                    ack,
                    "select_workbench_instance",
                    return_value="i-test",
                ), \
                mock.patch.object(
                    ack,
                    "fetch_kubeconfig",
                    return_value=("secret", "expiration"),
                ), \
                mock.patch.object(ack, "run_process", side_effect=run):
            with self.assertRaisesRegex(ack.AckError, "Forbidden"):
                ack.get_via_workbench(self.ack_args())

        self.assertTrue(any("unlink --" in command for command in commands))

    def test_workbench_cleanup_failure_overrides_success(self) -> None:
        """查询成功但远端凭证清理失败时命令整体失败。"""
        def run(argv):
            if argv[0].endswith("shred"):
                Path(argv[-1]).unlink()
                return self.completed(argv)
            if argv[1] == "upload":
                return self.completed(argv, stdout="{}")
            command = argv[argv.index("--command") + 1]
            if "kubectl get" in command:
                return self.completed(
                    argv,
                    stdout=json.dumps({
                        "exit_code": 0,
                        "stdout": '{"items":[]}',
                        "stderr": "",
                    }),
                )
            return self.completed(
                argv,
                stdout='{"exit_code":1,"stdout":"","stderr":"denied"}',
            )

        with mock.patch.object(
                ack.shutil,
                "which",
                side_effect=lambda name: f"/usr/bin/{name}",
            ), mock.patch.object(
                ack,
                "select_workbench_instance",
                return_value="i-test",
            ), mock.patch.object(
                ack,
                "fetch_kubeconfig",
                return_value=("secret", "expiration"),
            ), mock.patch.object(ack, "run_process", side_effect=run):
            with self.assertRaisesRegex(ack.AckError, "查询成功.*清理失败"):
                ack.get_via_workbench(self.ack_args())

    def test_invalid_cleanup_response_still_removes_local_secret(self) -> None:
        """远端清理响应结构异常时仍继续删除本地 KubeConfig。"""
        local_paths = []

        def run(argv):
            if argv[0].endswith("shred"):
                local_paths.append(Path(argv[-1]))
                Path(argv[-1]).unlink()
                return self.completed(argv)
            if argv[1] == "upload":
                local_paths.append(Path(argv[2]))
                return self.completed(argv, stdout="{}")
            command = argv[argv.index("--command") + 1]
            if "kubectl get" in command:
                return self.completed(
                    argv,
                    stdout='{"exit_code":0,"stdout":"{\\"items\\":[]}","stderr":""}',
                )
            return self.completed(argv, stdout="[]")

        with mock.patch.object(
                ack.shutil,
                "which",
                side_effect=lambda name: f"/usr/bin/{name}",
            ), mock.patch.object(
                ack,
                "select_workbench_instance",
                return_value="i-test",
            ), mock.patch.object(
                ack,
                "fetch_kubeconfig",
                return_value=("secret", "expiration"),
            ), mock.patch.object(ack, "run_process", side_effect=run):
            with self.assertRaisesRegex(ack.AckError, "根节点必须是对象"):
                ack.get_via_workbench(self.ack_args())

        self.assertTrue(local_paths)
        self.assertTrue(all(not path.exists() for path in local_paths))

    def test_invalid_minutes_fail_before_node_or_kubeconfig_queries(self) -> None:
        """非法临时有效期在节点和凭证请求前失败。"""
        args = self.ack_args(minutes=5)
        with mock.patch.object(
                ack.shutil,
                "which",
                return_value="/usr/bin/workbench",
            ), mock.patch.object(
                ack,
                "select_workbench_instance",
            ) as select, mock.patch.object(
                ack,
                "fetch_kubeconfig",
            ) as kubeconfig:
            with self.assertRaisesRegex(ack.AckError, "15~4320"):
                ack.get_via_workbench(args)

        select.assert_not_called()
        kubeconfig.assert_not_called()

    def test_invalid_namespace_fails_before_workbench_or_kubeconfig(self) -> None:
        """可能扩展远端命令的标识符在任何云调用前拒绝。"""
        args = self.ack_args(namespace="default;whoami")
        with mock.patch.object(
                ack,
                "select_workbench_instance",
            ) as select, mock.patch.object(
                ack,
                "fetch_kubeconfig",
            ) as kubeconfig:
            with self.assertRaisesRegex(ack.AckError, r"命名空间.*格式不合法"):
                ack.get_via_workbench(args)

        select.assert_not_called()
        kubeconfig.assert_not_called()

    def test_cmd_get_redacts_secret_before_json_output(self) -> None:
        """Secret 直连响应在输出前完成脱敏。"""
        args = self.ack_args(resource="secrets", name="credentials", format="json")
        output = io.StringIO()
        with mock.patch.object(
            ack,
            "get_direct",
            return_value={
                "kind": "Secret",
                "metadata": {"name": "credentials"},
                "data": {"password": "real-secret"},
            },
        ):
            with contextlib.redirect_stdout(output):
                ack.cmd_get(args)

        self.assertIn("<REDACTED>", output.getvalue())
        self.assertNotIn("real-secret", output.getvalue())


if __name__ == "__main__":
    unittest.main()
