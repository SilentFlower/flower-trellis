"""验证复用升级 hook 的 CLI 安装引导及原有更新行为。"""

import importlib.util
import io
import json
import os
import subprocess
import tempfile
import unittest
from platform_test_utils import symlink_or_skip
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
            self.assertIn("普通请求路由前", context)
            self.assertIn("确认前禁止执行", context)
            self.assertIn("self-check --json", context)
            self.assertIn("不循环安装", context)
            run.assert_not_called()

    def test_actionable_update_owns_order_confirmation_and_deferral(self) -> None:
        """真实更新事件动态承载路由顺序、确认、暂缓和跳过契约。"""
        data = {
            "status": "update_available",
            "current": {"flowerVersion": "0.6.6"},
            "project": {"flowerVersion": "0.6.6"},
            "remote": {"tags": {"latest": "0.6.7"}},
            "commands": {"recommended": "flower-trellis self-update"},
            "ai": {"mode": "ask"},
            "prompt": {"commands": {
                "snooze": "flower-trellis self-check --snooze",
                "skip": "flower-trellis self-check --skip-version 0.6.7",
            }},
            "releaseNotes": {"versions": [{"version": "0.6.7", "body": "变更摘要"}]},
        }
        context = self.module._format_context(data)
        system_message = self.module._system_message(data)
        self.assertIn("普通请求路由前", context)
        self.assertIn("确认前禁止执行 recommended_command", context)
        self.assertIn("执行 snooze_command", context)
        self.assertIn("执行 skip_command", context)
        self.assertIn("snooze_command: flower-trellis self-check --snooze", context)
        self.assertIn("skip_command: flower-trellis self-check --skip-version 0.6.7", context)
        self.assertIn("普通请求路由前", system_message)
        self.assertIn("snooze_command", system_message)
        self.assertIn("skip_command", system_message)

    def test_auto_updates_own_order_without_adding_confirmation(self) -> None:
        """自动更新先展示动态信息，同时保持已有安全授权。

        Returns:
            无返回值；断言更新和项目不同步路径均不新增确认门禁。
        """
        for status, release_notes in [
            ("update_available", {"versions": [{"version": "0.6.7", "body": "变更摘要"}]}),
            ("project_out_of_sync", None),
        ]:
            data = {
                "status": status,
                "current": {"flowerVersion": "0.6.7"},
                "project": {"flowerVersion": "0.6.6"},
                "commands": {"recommended": "flower-trellis update -y"},
                "ai": {"mode": "auto", "instruction": "安全条件满足,可以直接执行受控更新命令。"},
            }
            if release_notes:
                data["releaseNotes"] = release_notes
            with self.subTest(status=status, release_notes=bool(release_notes)):
                context = self.module._format_context(data)
                system_message = self.module._system_message(data)
                self.assertIn("普通请求路由前", context)
                self.assertIn("安全条件满足,可以直接执行受控更新命令", context)
                self.assertIn("普通请求路由前", system_message)
                self.assertIn("既有授权语义", system_message)
                self.assertNotIn("询问用户确认", context)
                self.assertNotIn("确认前禁止", context)
                self.assertNotIn("询问用户", system_message)
                self.assertNotIn("确认前禁止", system_message)

    def test_update_priority_follows_final_ai_mode(self) -> None:
        """阻塞优先级只跟随最终 ask 模式，包含 auto 安全降级。

        Returns:
            无返回值；断言模式、状态和摘要组合中的优先级与动作指令一致。
        """
        mode_cases = [
            ("ask", {"mode": "ask"}, True),
            ("auto", {
                "mode": "auto",
                "instruction": "安全条件满足,可以直接执行受控更新命令。",
            }, False),
            ("notify", {
                "mode": "notify",
                "instruction": "只告知用户发现更新和手动命令,不要主动询问或执行。",
            }, False),
            ("auto-downgraded", {
                "mode": "ask",
                "instruction": "必须先询问用户是否执行推荐命令;用户明确确认前禁止运行推荐命令。",
                "downgradedFromAuto": True,
                "downgradeReasons": ["working-tree-dirty"],
            }, True),
        ]
        for status in ["update_available", "project_out_of_sync"]:
            for release_notes in [None, {"versions": [{"version": "0.6.7", "body": "变更摘要"}]}]:
                for case_name, ai, expects_blocking in mode_cases:
                    data = {
                        "status": status,
                        "current": {"flowerVersion": "0.6.6"},
                        "project": {"flowerVersion": "0.6.6"},
                        "commands": {"recommended": "flower-trellis self-update"},
                        "ai": ai,
                    }
                    if release_notes:
                        data["releaseNotes"] = release_notes
                    with self.subTest(
                        mode=case_name,
                        status=status,
                        release_notes=bool(release_notes),
                    ):
                        context = self.module._format_context(data)
                        system_message = self.module._system_message(data)
                        self.assertIn("instruction_scope: first_assistant_reply", context)
                        if expects_blocking:
                            self.assertIn("priority: blocking_confirmation_required", context)
                            self.assertIn("确认前禁止", context)
                            self.assertIn("确认前禁止", system_message)
                        else:
                            self.assertNotIn("priority: blocking_confirmation_required", context)
                            self.assertNotIn("确认前禁止", context)
                            self.assertNotIn("确认前禁止", system_message)

    def test_commandless_bootstrap_diagnostics_own_request_order(self) -> None:
        """无安装命令的 CLI 诊断仍先于普通请求路由。

        Returns:
            无返回值；断言诊断不执行子进程、不生成安装命令且保留处理顺序。
        """
        cases = [
            {"status": "cli_unavailable", "reason": "入口不可执行"},
            {"status": "project_version_unavailable", "reason": "项目锁无效"},
            {"status": "prerequisites_missing", "version": "0.6.6", "reason": "缺少 npm"},
        ]
        with mock.patch.object(self.module.subprocess, "run") as run:
            for data in cases:
                with self.subTest(status=data["status"]):
                    context = self.module._format_bootstrap(data)
                    self.assertIn("普通请求路由前先说明诊断原因与缺失前提", context)
                    self.assertNotIn("recommended_command:", context)
                    self.assertNotIn("npm install", context)
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
                with self.subTest(reference=reference, args=args), \
                    mock.patch.dict(os.environ, {"TRELLIS_HOOKS": "1", "TRELLIS_DISABLE_HOOKS": "0", "CODEX_NON_INTERACTIVE": "0"}), \
                    mock.patch.object(module, "_executable_status", return_value="missing"), \
                    mock.patch.object(module.subprocess, "run") as run, \
                    mock.patch("sys.stdin", io.StringIO("{}")), \
                    redirect_stdout(output):
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
            with self.subTest(result=result), mock.patch.object(module, "_executable_status", return_value="available"), mock.patch.object(module.shutil, "which", return_value="/fixture/flower-trellis"), mock.patch.object(module.subprocess, "run", **({"side_effect": result} if isinstance(result, Exception) else {"return_value": result})):
                data = module._run_self_check(self.project)
                self.assertEqual(data["status"], "cli_unavailable")
                self.assertNotIn("command", data)

    def test_self_check_uses_the_resolved_cli_path(self) -> None:
        """Windows 可执行文件和 POSIX 入口直接使用探测路径，保留参数边界。

        Returns:
            无返回值；断言启动路径、参数和 JSON 状态。
        """
        module = self.module
        for platform, executable in [("nt", r"C:\Program Files\flower-trellis.EXE"), ("posix", "/fixture/bin with spaces/flower-trellis"), ("posix", "/fixture/flower-trellis.cmd")]:
            with self.subTest(platform=platform, executable=executable), mock.patch.object(module.os, "name", platform), mock.patch.object(module.shutil, "which", return_value=executable), mock.patch.object(module.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, '{"status":"up_to_date"}', "")) as run:
                self.assertEqual(module._run_self_check(self.project), {"status": "up_to_date"})
                self.assertEqual(run.call_args.args[0], [executable, "self-check", "--json", "--target", str(self.project)])
                self.assertEqual(run.call_args.kwargs["cwd"], str(self.project))
                self.assertEqual(run.call_args.kwargs["timeout"], module.SELF_CHECK_TIMEOUT_SECONDS)
                self.assertFalse(run.call_args.kwargs.get("shell", False))

    def test_windows_batch_paths_only_enter_the_child_environment(self) -> None:
        """批处理入口和目标通过子进程环境传递，固定命令关闭延迟展开。

        Returns:
            无返回值；断言路径不进入命令文本且宿主环境不被修改。
        """
        module = self.module
        processor = r"C:\Windows\System32\cmd.exe"
        for extension in ["CMD", "bat"]:
            executable = rf"C:\bin&ver%FLOWER_TEST_LITERAL%!literal!\flower-trellis.{extension}"
            with self.subTest(extension=extension), mock.patch.object(module.os, "name", "nt"), mock.patch.dict(module.os.environ, {"COMSPEC": processor, "FLOWER_UPDATE_HOOK_CLI": "inherited CLI", "FLOWER_UPDATE_HOOK_TARGET": "inherited target"}), mock.patch.object(module.shutil, "which", return_value=executable), mock.patch.object(module.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, '{"status":"up_to_date"}', "")) as run:
                self.assertEqual(module._run_self_check(self.project), {"status": "up_to_date"})
                command = run.call_args.args[0]
                self.assertEqual(command, f'"{processor}" /d /v:off /s /c ""%FLOWER_UPDATE_HOOK_CLI%" self-check --json --target "%FLOWER_UPDATE_HOOK_TARGET%""')
                self.assertNotIn(executable, command)
                self.assertNotIn(str(self.project), command)
                self.assertEqual(run.call_args.kwargs["executable"], processor)
                self.assertEqual(run.call_args.kwargs["env"]["FLOWER_UPDATE_HOOK_CLI"], executable)
                self.assertEqual(run.call_args.kwargs["env"]["FLOWER_UPDATE_HOOK_TARGET"], str(self.project))
                self.assertEqual(module.os.environ["FLOWER_UPDATE_HOOK_CLI"], "inherited CLI")
                self.assertEqual(module.os.environ["FLOWER_UPDATE_HOOK_TARGET"], "inherited target")
                self.assertFalse(run.call_args.kwargs.get("shell", False))

    def test_windows_batch_processor_fallback_and_missing_path(self) -> None:
        """COMSPEC 缺失时只回退系统目录，无法确认绝对路径时不启动进程。

        Returns:
            无返回值；断言系统目录回退及缺失或相对解释器路径的诊断。
        """
        module = self.module
        executable = r"C:\bin\flower-trellis.cmd"
        for processor, system_root in [("", r"C:\Windows"), ("", ""), ("cmd.exe", r"C:\Windows")]:
            with self.subTest(processor=processor, system_root=system_root), mock.patch.object(module.os, "name", "nt"), mock.patch.dict(module.os.environ, {"COMSPEC": processor, "SystemRoot": system_root}), mock.patch.object(module.shutil, "which", return_value=executable), mock.patch.object(module.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, '{"status":"up_to_date"}', "")) as run:
                data = module._run_self_check(self.project)
                if not processor and system_root:
                    self.assertEqual(data, {"status": "up_to_date"})
                    self.assertEqual(run.call_args.kwargs["executable"], os.path.join(system_root, "System32", "cmd.exe"))
                else:
                    self.assertEqual(data["status"], "cli_unavailable")
                    self.assertIn("Windows 命令解释器", data["reason"])
                    self.assertNotIn("command", data)
                    run.assert_not_called()

    def test_cli_disappearing_before_execution_returns_diagnostic(self) -> None:
        """探测后入口消失时返回诊断，避免把空路径交给子进程。

        Returns:
            无返回值；断言诊断状态、无安装命令及无进程启动。
        """
        module = self.module
        with mock.patch.object(module.shutil, "which", side_effect=["/fixture/flower-trellis", None]), mock.patch.object(module.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, '{"status":"up_to_date"}', "")) as run:
            data = module._run_self_check(self.project)
            self.assertEqual(data["status"], "cli_unavailable")
            self.assertIn("执行前已不可用", data["reason"])
            self.assertNotIn("command", data)
            run.assert_not_called()

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
            with self.subTest(path="dangling-symlink"):
                symlink_or_skip(self.project / "missing", executable)
                self.assertEqual(module._executable_status("flower-trellis"), "unavailable")

    def test_disabled_hooks_do_not_inject_bootstrap(self) -> None:
        """尊重宿主已有的 hooks 禁用开关。"""
        with mock.patch.dict(os.environ, {"TRELLIS_HOOKS": "0"}), mock.patch.object(self.module, "_run_self_check") as check, mock.patch.object(self.module, "_emit_context") as emit:
            self.module.main([])
            check.assert_not_called()
            emit.assert_not_called()
