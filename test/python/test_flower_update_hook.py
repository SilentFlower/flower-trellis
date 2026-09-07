"""验证复用升级 hook 的 CLI 安装引导及原有更新行为。"""

import importlib.util
import io
import json
import os
import subprocess
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock


class FlowerUpdateHookTest(unittest.TestCase):
    """使用真实 hook 主函数和隔离查询结果验证输出。"""

    def setUp(self) -> None:
        """隔离目标目录和被测模块。"""
        script = Path(__file__).resolve().parents[2] / "src/assets/flower_update_hook.py"
        spec = importlib.util.spec_from_file_location("flower_update_hook_test", script)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.temporary = tempfile.TemporaryDirectory(prefix="flower-bootstrap-")
        self.addCleanup(self.temporary.cleanup)
        self.project = Path(self.temporary.name)
        (self.project / ".flower").mkdir()
        self.lock = {"schemaVersion": 1, "roots": ["flower/skill-garden"], "plugins": [{"id": "flower/skill-garden", "version": "0.6.6", "source": {"id": "flower", "type": "builtin", "reference": "package:skill-garden:0.6"}}]}
        self.write_lock(self.lock)

    def write_lock(self, lock) -> None:
        """写隔离锁夹具。"""
        (self.project / ".flower/plugin-lock.json").write_text(json.dumps(lock), encoding="utf-8")

    def test_unknown_is_silent_and_real_updates_remain_actionable(self) -> None:
        """未知保持静默，真实全局和项目更新继续输出上下文。"""
        script = Path(__file__).resolve().parents[2] / "src/assets/flower_update_hook.py"
        spec = importlib.util.spec_from_file_location("flower_update_hook_test", script)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        for status in ("project_unknown", "update_available", "project_out_of_sync"):
            with self.subTest(status=status):
                output = io.StringIO()
                with mock.patch.object(module, "_run_self_check", return_value={"status": status}), mock.patch("sys.stdin", io.StringIO("{}")), redirect_stdout(output):
                    module.main([])
                if status == "project_unknown":
                    self.assertEqual(output.getvalue(), "")
                else:
                    self.assertIn("<flower-update>", json.loads(output.getvalue())["hookSpecificOutput"]["additionalContext"])

    def test_missing_cli_requests_confirmation_without_running_commands(self) -> None:
        """缺失分支直接读取锁，不需要执行 CLI 或 npm。"""
        module = self.module
        with mock.patch.object(module, "_executable_status", side_effect=lambda name: "missing" if name == "flower-trellis" else "available"), mock.patch.object(module.subprocess, "run") as run:
            data = module._run_self_check(self.project)
            self.assertEqual(data["status"], "cli_missing")
            self.assertEqual(data["command"], "npm install -g flower-trellis@0.6.6")
            context = module._format_bootstrap(data)
            self.assertIn("确认前禁止执行", context)
            self.assertIn("self-check --json", context)
            self.assertIn("不循环安装", context)
            run.assert_not_called()

    def test_bootstrap_only_does_not_read_stdin_or_query_updates(self) -> None:
        """手动入口只执行本机检测，并产出相同协议。"""
        module = self.module
        output = io.StringIO()
        with mock.patch.object(module, "_executable_status", side_effect=lambda name: "missing" if name == "flower-trellis" else "available"), mock.patch("sys.stdin") as stdin, mock.patch.object(module, "_run_self_check") as check, redirect_stdout(output):
            module.main(["--bootstrap-only", "--target", str(self.project)])
            stdin.read.assert_not_called()
            check.assert_not_called()
        result = json.loads(output.getvalue())
        self.assertEqual(result["hookSpecificOutput"]["hookEventName"], "SessionStart")
        self.assertIn("<flower-cli-bootstrap>", result["hookSpecificOutput"]["additionalContext"])

    def test_bad_versions_sources_and_records_never_become_commands(self) -> None:
        """范围、命令片段和不可靠来源不能进入安装参数。"""
        module = self.module
        for version in ["latest", "^0.6.6", "0.6", "01.2.3", "0.6.6-01", "0.6.6; touch /tmp/no", "0.6.6\n", "９.0.0", None, "9007199254740992.0.0"]:
            with self.subTest(version=version):
                self.lock["plugins"][0]["version"] = version
                self.write_lock(self.lock)
                with self.assertRaises(ValueError):
                    module._locked_flower_version(self.project)
        for version in ["0.6.6", "0.6.7-beta.1", "1.0.0-rc.0+build.3"]:
            self.lock["plugins"][0]["version"] = version
            self.write_lock(self.lock)
            self.assertEqual(module._locked_flower_version(self.project), version)
        for lock in [[], {}, {**self.lock, "schemaVersion": True}, {**self.lock, "plugins": []}, {**self.lock, "plugins": self.lock["plugins"] * 2}, {**self.lock, "plugins": [None]}]:
            self.write_lock(lock)
            with self.assertRaises(ValueError):
                module._locked_flower_version(self.project)
        self.lock["plugins"][0]["source"]["type"] = "github"
        self.write_lock(self.lock)
        with self.assertRaises(ValueError):
            module._locked_flower_version(self.project)

    def test_missing_lock_and_prerequisites_have_distinct_results(self) -> None:
        """没有 npm 与没有版本证据分别报告，不回退旧 manifest。"""
        module = self.module
        with mock.patch.object(module, "_executable_status", return_value="missing"):
            self.assertEqual(module._check_cli(self.project)["status"], "prerequisites_missing")
            (self.project / ".flower/plugin-lock.json").unlink()
            (self.project / ".trellis").mkdir()
            (self.project / ".trellis/.flower-manifest.json").write_text('{"flowerVersion":"0.1.0"}', encoding="utf-8")
            result = module._check_cli(self.project)
            self.assertEqual(result["status"], "project_version_unavailable")
            self.assertNotIn("command", result)
        with mock.patch.object(module, "_executable_status", return_value="unavailable"):
            self.assertEqual(module._check_cli(self.project)["status"], "cli_unavailable")

    def test_invalid_source_reference_returns_diagnostic_at_both_entries(self) -> None:
        """错误来源类型在自动和手动入口均返回诊断，不执行安装。

        Returns:
            无返回值；断言状态、诊断、无安装命令和锁字节不变。
        """
        module = self.module
        for reference in [[], {}, None, False, 42, ""]:
            self.lock["plugins"][0]["source"]["reference"] = reference
            self.write_lock(self.lock)
            before = (self.project / ".flower/plugin-lock.json").read_bytes()
            for args in [[], ["--bootstrap-only"]]:
                output = io.StringIO()
                with (
                    self.subTest(reference=reference, args=args),
                    mock.patch.dict(os.environ, {"TRELLIS_HOOKS": "1", "TRELLIS_DISABLE_HOOKS": "0", "CODEX_NON_INTERACTIVE": "0"}),
                    mock.patch.object(module, "_executable_status", return_value="missing"),
                    mock.patch.object(module.subprocess, "run") as run,
                    mock.patch("sys.stdin", io.StringIO("{}")),
                    redirect_stdout(output),
                ):
                    module.main([*args, "--target", str(self.project)])
                    result = json.loads(output.getvalue())
                    self.assertEqual(result["hookSpecificOutput"]["hookEventName"], "SessionStart")
                    context = result["hookSpecificOutput"]["additionalContext"]
                    self.assertIn("status: project_version_unavailable", context)
                    self.assertIn("不是受支持的内置来源", context)
                    self.assertIn("请维护者补齐有效项目锁", context)
                    self.assertNotIn("recommended_command:", context)
                    self.assertNotIn("npm install", context)
                    self.assertEqual((self.project / ".flower/plugin-lock.json").read_bytes(), before)
                    run.assert_not_called()

    def test_existing_cli_errors_are_not_install_requests(self) -> None:
        """超时、解释器丢失和异常结果不误导重装。"""
        module = self.module
        cases = [subprocess.TimeoutExpired("flower-trellis", 30), FileNotFoundError("interpreter"), PermissionError("denied"), subprocess.CompletedProcess([], 1, "", "failed"), subprocess.CompletedProcess([], 0, "invalid", ""), subprocess.CompletedProcess([], 0, "[]", ""), subprocess.CompletedProcess([], 0, "{}", "")]
        for result in cases:
            with self.subTest(result=result), mock.patch.object(module, "_executable_status", return_value="available"), mock.patch.object(module.subprocess, "run", **({"side_effect": result} if isinstance(result, Exception) else {"return_value": result})):
                data = module._run_self_check(self.project)
                self.assertEqual(data["status"], "cli_unavailable")
                self.assertNotIn("command", data)

    def test_path_probe_rejects_non_executable_and_broken_links(self) -> None:
        """真实 PATH 区分缺失、普通不可执行文件与断链。"""
        module = self.module
        with mock.patch.dict(os.environ, {"PATH": str(self.project)}, clear=False):
            self.assertEqual(module._executable_status("flower-trellis"), "missing")
            executable = self.project / "flower-trellis"
            executable.write_text("#!/missing/interpreter\n", encoding="utf-8")
            executable.chmod(0o600)
            self.assertEqual(module._executable_status("flower-trellis"), "unavailable")
            executable.unlink()
            executable.symlink_to(self.project / "missing")
            self.assertEqual(module._executable_status("flower-trellis"), "unavailable")

    def test_disabled_hooks_do_not_inject_bootstrap(self) -> None:
        """尊重宿主已有的 hooks 禁用开关。"""
        with mock.patch.dict(os.environ, {"TRELLIS_HOOKS": "0"}), mock.patch.object(self.module, "_run_self_check") as check, mock.patch.object(self.module, "_emit_context") as emit:
            self.module.main([])
            check.assert_not_called()
            emit.assert_not_called()
