"""确认入口解析与原生 Hook 共用命令选择，不依赖维护者全局 Flower。"""

import io
import json
import subprocess
import sys
import tempfile
import unittest
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


ASSET = Path(__file__).resolve().parents[2] / "src/assets/flower_confirmation_hook.py"
SPEC = spec_from_file_location("confirmation_hook_test", ASSET)
HOOK = module_from_spec(SPEC)
SPEC.loader.exec_module(HOOK)


class FlowerConfirmationHookTest(unittest.TestCase):
    """覆盖源码优先、安装入口、失败原因及事件转发的一致性。"""

    def test_local_entry_wins_over_global_and_is_reported_as_argv(self):
        """真实子进程解析本仓入口，返回 argv，不启动默认动作。"""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            (root / "bin").mkdir()
            (root / "bin/flower-trellis.js").write_text("throw Error('不应执行');", encoding="utf-8")
            (root / "package.json").write_text('{"name":"flower-trellis"}', encoding="utf-8")
            result = subprocess.run([sys.executable, "-X", "utf8", str(ASSET), "--entry"],
                                    cwd=str(root), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    encoding="utf-8", timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            entry = json.loads(result.stdout)["entry"]
            self.assertEqual(len(entry), 2)
            self.assertEqual(entry[1], str(root / "bin/flower-trellis.js"))
            self.assertIn("node", Path(entry[0]).name.lower())

    def test_other_project_cannot_borrow_a_similarly_named_local_bin(self):
        """同名文件不构成源码入口，普通项目使用已有安装。"""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "bin").mkdir()
            (root / "bin/flower-trellis.js").write_text("", encoding="utf-8")
            (root / "package.json").write_text('{"name":"another-project"}', encoding="utf-8")
            with patch.object(HOOK.shutil, "which", return_value="/installed/flower-trellis") as which:
                self.assertEqual(HOOK.resolve_confirmation_entry(root), ["/installed/flower-trellis"])
                which.assert_called_once_with("flower-trellis")

    def test_missing_entry_reports_a_reason_instead_of_empty_success(self):
        """缺入口给出机器可读的人工原因，不把无输出当作探测结果。"""
        with tempfile.TemporaryDirectory() as directory:
            output = io.StringIO()
            with patch.object(HOOK.sys, "argv", [str(ASSET), "--entry"]), \
                    patch.object(HOOK.Path, "cwd", return_value=Path(directory)), \
                    patch.object(HOOK.shutil, "which", return_value=None), \
                    patch.object(HOOK.sys, "stdout", output):
                self.assertEqual(HOOK.main(), 1)
            value = json.loads(output.getvalue())
            self.assertIsNone(value["entry"])
            self.assertIn("入口", value["reason"])

    def test_event_forwarding_uses_the_same_entry_and_original_payload(self):
        """入口查询不改变 Codex/Claude 原生事件载荷和平台选择。"""
        with tempfile.TemporaryDirectory() as directory:
            raw = json.dumps({"cwd": directory, "hook_event_name": "UserPromptSubmit"}).encode("utf-8")
            for platform in ("codex", "claude"):
                with patch.object(HOOK.sys, "argv", [str(ASSET), "--platform", platform]), \
                        patch.object(HOOK.sys, "platform", "linux"), \
                        patch.object(HOOK.sys, "stdin", SimpleNamespace(buffer=io.BytesIO(raw))), \
                        patch.object(HOOK.sys, "stdout", io.StringIO()), \
                        patch.object(HOOK, "resolve_confirmation_entry", return_value=["node", "local-cli.js"]), \
                        patch.object(HOOK.subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout=b"{}")) as run:
                    self.assertEqual(HOOK.main(), 0)
                self.assertEqual(run.call_args[0][0], ["node", "local-cli.js", "confirm", "hook", "--platform", platform])
                self.assertEqual(run.call_args[1]["input"], raw)


if __name__ == "__main__":
    unittest.main()
