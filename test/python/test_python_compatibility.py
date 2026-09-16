"""验证 Python 3.8、失效别名与宿主捕获流的跨平台边界。"""

from __future__ import annotations

import importlib.util
import io
import locale
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SOURCES = ROOT / "vendor/skill-garden/.trellis/0.6"
sys.path.insert(0, str(ROOT / ".trellis/scripts"))


def _load(name, path):
    """加载待验证的真实作者脚本，返回模块对象。"""
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PythonCompatibilityTest(unittest.TestCase):
    """验证真实子进程与标准流的行为合同。"""

    def test_route_and_auto_loop_without_python_alias(self):
        """PATH 没有 Python 时仍使用当前解释器，并保留中文任务与会话标识。"""
        auto = _load("compat_auto_loop", SOURCES / "scripts/auto_loop.py")
        route = _load("compat_route", SOURCES / ".agents/skills/trellis-route/scripts/route_state.py")
        with tempfile.TemporaryDirectory(prefix="flower-兼容 空格-") as directory:
            root = Path(directory)
            scripts = root / ".trellis/scripts"
            scripts.mkdir(parents=True)
            (root / ".trellis/tasks/中文任务").mkdir(parents=True)
            (root / ".trellis/tasks/中文任务/task.json").write_text('{"status":"in_progress"}', encoding="utf-8")
            (scripts / "task.py").write_text("print('Current task: .trellis/tasks/中文任务')\nprint('Source: session:中文会话')\n", encoding="utf-8")
            with patch.dict(os.environ, {"PATH": "", "TRELLIS_CONTEXT_ID": ""}):
                self.assertEqual(auto._current_session_key(root), "中文会话")
                self.assertEqual(route._current_task(root), (".trellis/tasks/中文任务", "session:中文会话", "中文会话"))
                helper = root / ".agents/skills/trellis-route/scripts/route_state.py"
                helper.parent.mkdir(parents=True)
                helper.write_bytes((SOURCES / ".agents/skills/trellis-route/scripts/route_state.py").read_bytes())
                self.assertEqual(auto._route_state_helper(root), helper)
                self.assertEqual(auto._effective_route_authorization(root, ".trellis/tasks/中文任务", {"implement": "inline", "check": "check-all-inline"}), {"implement": "inline", "check": "check-all-inline"})
            self.assertTrue(auto._is_relative_to(root / "child", root))
            self.assertFalse(auto._is_relative_to(root.parent / (root.name + "-other"), root))

    def test_common_preserves_stream_ownership(self):
        """StringIO、真实文本流与关闭流均不被 detach 或替换。"""
        import common

        memory = io.StringIO("已有正文")
        self.assertIs(common._configure_stream(memory), memory)
        self.assertEqual(memory.getvalue(), "已有正文")
        self.assertFalse(memory.closed)
        binary = io.BytesIO()
        stream = io.TextIOWrapper(binary, encoding="ascii")
        self.assertIs(common._configure_stream(stream), stream)
        stream.write("中文正文")
        stream.flush()
        self.assertEqual(binary.getvalue(), "中文正文".encode("utf-8"))
        stream.close()
        self.assertIs(common._configure_stream(stream), stream)

    def test_subagent_import_preserves_captured_stdout(self):
        """Windows Hook 导入时可以沿用宿主 StringIO。"""
        output = io.StringIO()
        with patch.object(sys, "platform", "win32"), patch.object(sys, "stdout", output):
            module = _load("compat_subagent", ROOT / ".claude/hooks/inject-subagent-context.py")
            self.assertIs(sys.stdout, output)
        self.assertFalse(output.closed)
        self.assertIn("Native Implement Subagent", module.build_codex_subagent_context("trellis-implement", ".trellis/tasks/test", "正文"))

    def test_utf8_adapter_ignores_host_codepage(self):
        """受控 CP936 条件下 UTF-8 JSON 仍往返完整，不能依赖宿主默认代码页。"""
        module = _load("compat_worktree", SOURCES / "scripts/worktree_setup.py")
        with tempfile.TemporaryDirectory(prefix="flower-adapter-") as directory:
            receiver = Path(directory) / "adapter.py"
            receiver.write_text("import json, sys\nvalue = json.loads(sys.stdin.buffer.read().decode('utf-8'))\nvalue['installation'] = 'complete'\nsys.stdout.buffer.write(json.dumps({'ok': True, 'result': value}, ensure_ascii=False).encode('utf-8'))\n", encoding="utf-8")
            with patch.dict(os.environ, {"FLOWER_WORKTREE_NODE": sys.executable, "FLOWER_WORKTREE_HELPER": str(receiver)}), \
                 patch.object(locale, "getpreferredencoding", return_value="cp936"), \
                 patch.object(subprocess, "_text_encoding", return_value="cp936", create=True):
                result = module._flower_call("status", source="中文😀目录")
            self.assertEqual(result, {"operation": "status", "source": "中文😀目录", "installation": "complete"})


if __name__ == "__main__":
    unittest.main()
