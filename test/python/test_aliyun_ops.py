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
            {"HOME": str(self.home), "SHARED": "process"},
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


if __name__ == "__main__":
    unittest.main()
