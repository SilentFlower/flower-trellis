"""Windows 确认宿主的实际进程与来源约束回归。"""

import os
import shutil
import socket
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from uuid import uuid4

from confirmation_fixture import ProjectFixture
from flower_confirmation_runtime import claude, runtime
from flower_confirmation_runtime.windows_process import ProcessHandle, check_listener_coverage, hook_frontend, listener_identity, open_identity


class WindowsConfirmationTest(unittest.TestCase):
    """分开验证 Windows 内核能力和 Claude 状态机。"""

    @unittest.skipUnless(sys.platform == "win32", "需要原生 Windows 内核")
    def test_windows_listener_and_process_handle_identify_the_original_process(self):
        """真实 TCP 表、进程创建时间和可等待句柄拒绝替代 PID。"""
        fixture = ProjectFixture(self)
        copy = fixture.root / "python.exe"
        shutil.copyfile(sys.executable, copy)
        with socket.socket() as server:
            server.bind(("127.0.0.1", 0))
            server.listen()
            port = server.getsockname()[1]
            identity = listener_identity("127.0.0.1", port, sys.executable)
            self.assertEqual(identity["pid"], os.getpid())
            self.assertEqual(listener_identity("127.0.0.1", port, copy), identity)
            copy.write_bytes(b"other image")
            with self.assertRaisesRegex(ValueError, "不是当前 Codex 客户端"):
                listener_identity("127.0.0.1", port, copy)
            self.assertEqual(hook_frontend(Path(identity["exe"]).name), identity)
            check_listener_coverage({os.getpid()}, sys.executable)
            with self.assertRaisesRegex(ValueError, "未归属"):
                check_listener_coverage(set(), sys.executable)
            with self.assertRaisesRegex(ValueError, "进程身份"):
                open_identity({**identity, "created": str(int(identity["created"]) + 1)})
        with self.assertRaisesRegex(ValueError, "监听者"):
            listener_identity("127.0.0.1", port, sys.executable)

        child = subprocess.Popen([sys.executable, "-c", "import sys; sys.stdin.buffer.read()"], stdin=subprocess.PIPE)
        try:
            process = ProcessHandle(child.pid)
            try:
                self.assertFalse(process.exited())
                # 同映像新前台即使尚未建立监听，也必须使来源覆盖失败。
                with patch("flower_confirmation_runtime.windows_process._parents",
                           return_value={child.pid: (os.getpid(), Path(sys.executable).name.lower())}):
                    with self.assertRaisesRegex(ValueError, "未归属"):
                        check_listener_coverage({os.getpid()}, sys.executable, {Path(sys.executable)})
                child.communicate(timeout=10)
                self.assertTrue(process.exited())
            finally:
                process.close()
        finally:
            if child.poll() is None:
                child.kill()
                child.wait()

    def test_windows_claude_second_frontend_revokes_existing_request(self):
        """同会话第二个原生前台不能继承首窗口的许可。"""
        fixture = ProjectFixture(self, "claude")
        transcript = fixture.root / (fixture.session + ".jsonl")
        first = {"pid": 10, "exe": "claude.exe", "created": "10"}
        second = {"pid": 20, "exe": "claude.exe", "created": "20"}
        event = {"hook_event_name": "SessionStart", "session_id": fixture.session,
                 "transcript_path": str(transcript), "cwd": str(fixture.root)}
        with patch.object(claude, "hook_frontend", return_value=first):
            claude.record_event(event, platform="win32")
        original = fixture.store.read()["native"]["runId"]
        fixture.client.run_id = original
        request = runtime.prepare(fixture.store, fixture.client, fixture.input, "1")
        with patch.object(claude, "hook_frontend", return_value=second), patch.object(claude, "open_identity", return_value=Mock()):
            claude.record_event(event, platform="win32")
        state = fixture.store.read()
        self.assertEqual(state["native"]["runId"], original)
        self.assertTrue(state["native"]["ambiguous"])
        self.assertEqual(state["request"]["id"], request["requestId"])
        self.assertEqual(state["request"]["error"], "frontend_ambiguous")

    def test_windows_claude_requires_structured_origin_even_without_turn_origin(self):
        """Windows 可核验旧版结构化来源，粘贴通知和矛盾来源仍不能领取。"""
        fixture = ProjectFixture(self, "claude")
        client = claude.ClaudeClient(fixture.root, fixture.session, platform="linux")
        client.platform = "win32"
        record = {"humanId": None, "notifications": {}}
        prompt = str(uuid4())
        notice = "<task-notification>\n<task-id>test-task</task-id>\n</task-notification>"
        entry = {"type": "user", "sessionId": fixture.session, "promptId": prompt, "message": {"content": notice}}
        client._consume_transcript(record, {**entry, "origin": {"kind": "human"}})
        self.assertEqual(record["humanId"], prompt)
        self.assertEqual(record["notifications"], {})
        with self.assertRaisesRegex(ValueError, "来源字段不可核验"):
            client._consume_transcript(record, {**entry, "origin": {"kind": "task-notification"}, "turnOrigin": "human"})
        with self.assertRaisesRegex(ValueError, "来源字段不可核验"):
            client._consume_transcript(record, entry)
        client._consume_transcript(record, {**entry, "origin": {"kind": "task-notification"}})
        self.assertEqual(record["notifications"], {"test-task": prompt})

    @unittest.skipUnless(sys.platform == "win32", "需要 Windows 文件路径语义")
    def test_claude_windows_wait_accepts_native_launcher_and_exact_paths(self):
        """Windows 空格路径与 py.exe 启动器可核验，异项目和重复参数均拒绝。"""
        fixture = ProjectFixture(self, "claude")
        request = str(uuid4())
        script = fixture.scripts / "flower_confirmation.py"
        command = f'py.exe -3.12 -X utf8 "{script}" wait --request {request} --platform claude --target "{fixture.root}"'
        self.assertTrue(claude._wait_command(command, fixture.root, fixture.session, request))
        self.assertFalse(claude._wait_command(command + " --request " + request, fixture.root, fixture.session, request))
        self.assertFalse(claude._wait_command(command.replace(str(script), str(fixture.root / "flower_confirmation.py")),
                                             fixture.root, fixture.session, request))


if __name__ == "__main__":
    unittest.main()
