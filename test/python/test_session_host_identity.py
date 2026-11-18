"""验证多平台环境中的任务身份选择与宿主识别。"""

import importlib.util
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src/assets"))
from flower_session_host import select_platform


class SessionHostIdentityTest(unittest.TestCase):
    """覆盖继承冲突、显式上下文和最近宿主。"""

    def setUp(self):
        """加载实际任务模块并应用持久 Patch 的候选选择块。

        @return: None。
        """
        spec = importlib.util.spec_from_file_location("host_test_active_task", ROOT / ".trellis/scripts/common/active_task.py")
        self.module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {spec.name: self.module}):
            spec.loader.exec_module(self.module)
        content = ROOT / "vendor/skill-garden/.trellis/0.6/overrides/patches/scripts/runtime-state-integrity/active-task-env-content.py"
        exec(compile(content.read_text(), str(content), "exec"), self.module.__dict__)

    def test_conflicting_variables_follow_nearest_host(self):
        """两种继承方向按当前宿主选择，显式参数继续优先。

        @return: None。
        """
        env = {"CODEX_THREAD_ID": "current-codex", "CLAUDE_CODE_SESSION_ID": "inherited-claude"}
        with patch.dict(os.environ, env, clear=True):
            for host in ("codex", "claude"):
                with self.subTest(host=host), patch("flower_session_host.select_platform", return_value=host):
                    expected = "codex_current-codex" if host == "codex" else "claude_inherited-claude"
                    self.assertEqual(self.module.resolve_context_key(), expected)
                    self.assertEqual(self.module.resolve_context_key(platform="codex"), "codex_current-codex")
                    self.assertEqual(self.module.resolve_context_key({"session_id": "hook-session"}, "claude"), "claude_hook-session")
            os.environ["TRELLIS_CONTEXT_ID"] = "explicit-context"
            self.assertEqual(self.module.resolve_context_key(), "explicit-context")

    def test_single_candidate_and_ambiguous_host(self):
        """单候选沿用既有行为，多个候选的歧义给出明确提示。

        @return: None。
        """
        with patch.dict(os.environ, {"CLAUDE_CODE_SESSION_ID": "one"}, clear=True):
            self.assertEqual(self.module.resolve_context_key(), "claude_one")
        with patch.dict(os.environ, {"CLAUDE_CODE_SESSION_ID": "one", "CODEX_THREAD_ID": "two"}, clear=True):
            with patch("flower_session_host.select_platform", side_effect=ValueError("宿主身份不明确")):
                with self.assertRaisesRegex(ValueError, "宿主身份不明确"):
                    self.module.resolve_context_key()

    def test_linux_ancestor_chain_chooses_inner_host(self):
        """忽略普通中间进程，嵌套工具选择最近宿主。

        @return: None。
        """
        for inner, outer, image in (("codex", "claude", "/opt/codex"),
                                    ("claude", "codex", "/opt/claude"),
                                    ("claude", "codex", "/opt/claude-code/bin/claude.exe")):
            with self.subTest(inner=inner, image=image), patch("flower_session_host.sys.platform", "linux"), \
                    patch("flower_session_host.os.getpid", return_value=30), \
                    patch("flower_session_host.os.readlink", side_effect=["/usr/bin/python3", image, "/opt/" + outer]) as readlink, \
                    patch("flower_session_host.Path.read_text", side_effect=["30 (python helper) S 20", "20 (tool) S 10", "10 (outer tool) S 0"]):
                self.assertEqual(select_platform({inner, outer}), inner)
                self.assertEqual(readlink.call_count, 2)

    def test_windows_ancestor_selection_accepts_both_native_hosts(self):
        """Windows 复用实际进程查询并允许最近的两种宿主。

        @return: None。
        """
        with patch("flower_session_host.sys.platform", "win32"):
            with patch("flower_confirmation_runtime.windows_process.hook_frontend", return_value={"exe": "codex.exe"}) as frontend:
                self.assertEqual(select_platform({"codex", "claude"}), "codex")
                frontend.assert_called_once_with(("codex.exe", "claude.exe"))

    def test_windows_process_walk_stops_at_nearest_allowed_image(self):
        """使用真实祖先遍历函数核对顺序、创建时间和句柄释放。

        @return: None。
        """
        from flower_confirmation_runtime.windows_process import hook_frontend
        handles = [Mock(identity={"exe": "python.exe", "created": "30"}),
                   Mock(identity={"exe": "claude.exe", "created": "20"})]
        with patch("flower_confirmation_runtime.windows_process._parents", return_value={3: (2, "python.exe"), 2: (1, "claude.exe")}), \
                patch("flower_confirmation_runtime.windows_process.os.getpid", return_value=3), \
                patch("flower_confirmation_runtime.windows_process.ProcessHandle", side_effect=handles):
            self.assertEqual(hook_frontend(("codex.exe", "claude.exe"))["exe"], "claude.exe")
        for handle in handles:
            handle.close.assert_called_once()
