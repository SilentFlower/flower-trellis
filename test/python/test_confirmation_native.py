"""项目 Python CLI 的两端完整链路与独立原生协议替身。"""

import base64
import hashlib
import json
import os
import shlex
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from confirmation_fixture import ProjectFixture
from flower_confirmation_runtime.codex import CodexClient
from flower_confirmation_runtime.session_log import SessionLog
from flower_confirmation_runtime.transport import CodexTransport


def _frame(payload, opcode=1, final=True):
    length = len(payload)
    return (bytes(((0x80 if final else 0) | opcode, length if length < 126 else 126 if length <= 65535 else 127))
            + (b"" if length < 126 else struct.pack("!H" if length <= 65535 else "!Q", length)) + payload)


class NativeConfirmationTest(unittest.TestCase):
    """实际子进程执行 Python 链路；协议替身与真实模型验收分别记录。"""

    def invoke(self, fixture, command, payload=None, success=True):
        """执行隔离 PATH 下的项目命令。

        @param fixture: 隔离项目。
        @param command: 入口后的参数。
        @param payload: Hook stdin JSON。
        @param success: 是否要求零退出码。
        @return: 最后一行 JSON。
        """
        args = [sys.executable, "-X", "utf8", str(fixture.scripts / "flower_confirmation.py"), *command,
                "--platform", fixture.platform, "--session", fixture.session]
        result = subprocess.run(args, cwd=str(fixture.root), env=fixture.env,
                                input=json.dumps(payload, ensure_ascii=False) if payload is not None else None,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, encoding="utf-8", timeout=15)
        self.assertEqual(result.stderr, "")
        if success:
            self.assertEqual(result.returncode, 0, result.stdout)
        return json.loads(result.stdout.splitlines()[-1])

    def start_wait(self, fixture, request_id):
        """启动真实后台命令并登记生命周期清理。

        @param fixture: 隔离项目。
        @param request_id: 请求 UUID。
        @return: 活动子进程。
        """
        child = subprocess.Popen([sys.executable, "-X", "utf8", str(fixture.scripts / "flower_confirmation.py"),
                                  "wait", "--platform", fixture.platform, "--session", fixture.session, "--request", request_id],
                                 cwd=str(fixture.root), env=fixture.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 encoding="utf-8")
        def cleanup():
            if child.poll() is None:
                child.terminate()
                try:
                    child.communicate(timeout=10)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.communicate()
            else:
                child.communicate()
        self.addCleanup(cleanup)
        line = child.stdout.readline()
        self.assertTrue(line, child.poll())
        self.assertEqual(json.loads(line)["event"], "prepared", line)
        return child

    def finish_actions(self, fixture, request_id):
        """真实命令领取、单次开始与终态记账。

        @param fixture: 隔离项目。
        @param request_id: 精确请求。
        @return: None。
        """
        result = self.invoke(fixture, ["claim", "--request", request_id])
        self.assertTrue(result["claimed"], result)
        self.assertEqual(result["source"], "policy_timeout")
        receipt = result["receipt"]["id"]
        self.assertFalse(self.invoke(fixture, ["claim", "--request", request_id])["claimed"])
        args = ["result", "--request", request_id, "--receipt", receipt, "--state", "started"]
        self.assertTrue(self.invoke(fixture, args)["recorded"])
        self.assertFalse(self.invoke(fixture, args)["recorded"])
        args[-1] = "completed"
        self.assertTrue(self.invoke(fixture, args)["recorded"])

    @unittest.skipUnless(sys.platform == "linux", "自动路径限定 Linux/WSL")
    def test_claude_project_cli_full_chain_without_external_runtimes(self):
        """真实 Hook、Stop 任务绑定、通知来源和记账均通过项目入口。"""
        f = ProjectFixture(self, "claude")
        f.env["PATH"] = str(f.root / "empty-bin")
        transcript = f.root / (f.session + ".jsonl")
        transcript.write_text("", encoding="utf-8")
        prompt_id = str(uuid4())
        payload = {"cwd": str(f.root), "session_id": f.session, "transcript_path": str(transcript)}
        self.invoke(f, ["hook"], {**payload, "hook_event_name": "SessionStart"})
        self.invoke(f, ["hook"], {**payload, "hook_event_name": "UserPromptSubmit", "prompt_id": prompt_id, "prompt": "开始"})
        transcript.write_text(json.dumps({"type": "user", "sessionId": f.session, "promptId": prompt_id,
                                          "origin": {"kind": "human"}, "turnOrigin": "human", "message": {"content": "开始"}}) + "\n", encoding="utf-8")
        record = b'{"type":"assistant","message":"' + b"x" * (6 * 1024 * 1024) + b'"}\n'
        with transcript.open("ab") as stream:
            for _ in range(3):
                stream.write(record)
        prepared = self.invoke(f, ["prepare", "--input", f.input, "--seconds", "1"])
        self.assertTrue(prepared["prepared"], prepared)
        request_id = prepared["requestId"]
        child = self.start_wait(f, request_id)
        command = " ".join(shlex.quote(token) for token in [sys.executable, "-X", "utf8", str(f.scripts / "flower_confirmation.py"),
                                                           "wait", "--platform", "claude", "--request", request_id])
        self.invoke(f, ["hook"], {**payload, "hook_event_name": "Stop", "prompt_id": prompt_id,
                                  "last_assistant_message": prepared["display"],
                                  "background_tasks": [{"id": "owned-task", "type": "shell", "command": command}]})
        output, errors = child.communicate(timeout=10)
        self.assertEqual(child.returncode, 0, output + errors)
        self.assertEqual(f.store.read()["request"]["state"], "queued")
        notice = "<task-notification>\n<task-id>owned-task</task-id>\n</task-notification>"
        notification_prompt = str(uuid4())
        with transcript.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps({"type": "user", "sessionId": f.session, "promptId": notification_prompt,
                                     "origin": {"kind": "task-notification"}, "turnOrigin": "task_notification",
                                     "message": {"content": notice}}) + "\n")
        self.invoke(f, ["hook"], {**payload, "hook_event_name": "UserPromptSubmit", "prompt_id": notification_prompt, "prompt": notice})
        self.finish_actions(f, request_id)

    @unittest.skipUnless(sys.platform == "linux", "自动路径限定 Linux/WSL")
    def test_codex_project_cli_full_chain_with_isolated_native_transport(self):
        """真实本机 WebSocket、rollout 与队列链路在空 PATH 下执行。"""
        f = ProjectFixture(self)
        f.env["PATH"] = str(f.root / "empty-bin")
        server = CodexServer(self, f)
        # 前台身份由独立 helper 专项与真实原生验收负责；此夹具只替换隔离项目的身份边界。
        (f.scripts / "flower_tui_lifetime.py").write_text(
            "import os\nwriters = []\n"
            "def bind_origin(origin): return {'version': 1, 'origin': origin}\n"
            "def check_binding(binding): pass\n"
            "def check_frontend_coverage(origins): pass\n"
            "def open_binding(binding):\n    read, write = os.pipe()\n    writers.append(write)\n    return read\n", encoding="utf-8")
        self.invoke(f, ["hook"], {"cwd": str(f.root), "session_id": f.session, "turn_id": server.origin,
                                  "hook_event_name": "UserPromptSubmit", "prompt": "开始"})
        prepared = self.invoke(f, ["prepare", "--input", f.input, "--seconds", "1"])
        self.assertTrue(prepared["prepared"], prepared)
        request_id = prepared["requestId"]
        child = self.start_wait(f, request_id)
        server.append({"type": "item_completed", "thread_id": f.session, "turn_id": server.origin,
                       "item": {"type": "AgentMessage", "phase": "final_answer", "content": [{"type": "Text", "text": prepared["display"]}]}})
        server.append({"type": "task_complete", "turn_id": server.origin})
        deadline = time.monotonic() + 10
        while f.store.read()["request"]["state"] != "queued":
            self.assertIsNone(child.poll())
            self.assertLess(time.monotonic(), deadline)
            time.sleep(0.02)
        self.finish_actions(f, request_id)
        output, errors = child.communicate(timeout=10)
        self.assertEqual(child.returncode, 0, output + errors)
        self.assertEqual(server.added, [request_id])
        self.assertNotIn("thread/resume", server.calls)
        self.assertEqual(server.errors, [])

    def test_websocket_fragmentation_ping_lengths_and_invalid_frames(self):
        """独立帧夹具覆盖控制帧插入、三种长度和非法帧。"""
        class MemorySocket:
            def __init__(self, raw):
                self.raw, self.sent = raw, []
            def recv(self, count):
                result, self.raw = self.raw[:count], self.raw[count:]
                return result
            def settimeout(self, timeout):
                pass
            def sendall(self, raw):
                self.sent.append(raw)
        for length in (1, 150, 66000):
            packet = {"text": "中" * length}
            raw = json.dumps(packet, ensure_ascii=False).encode("utf-8")
            split = len(raw) // 2
            memory = MemorySocket(_frame(raw[:split], final=False) + _frame(b"ping", opcode=9) + _frame(raw[split:], opcode=0))
            transport = CodexTransport("unused")
            transport.socket = memory
            self.assertEqual(transport._message(time.monotonic() + 2), packet)
            self.assertEqual(memory.sent[0][0], 0x8a)
            self.assertTrue(memory.sent[0][1] & 0x80)
        for raw in (b"\x81\x80", _frame(b"x", opcode=2), _frame(b"x", opcode=0), _frame(b"x", opcode=9, final=False),
                    b"\x81\x7f" + struct.pack("!Q", 16 * 1024 * 1024 + 1)):
            transport = CodexTransport("unused")
            transport.socket = MemorySocket(raw)
            with self.assertRaises(ValueError):
                transport._message(time.monotonic() + 1)

    def test_unsupported_platforms_and_missing_host_are_read_only(self):
        """平台能力失败和宿主缺失遵守实际读取边界。"""
        f = ProjectFixture(self)
        for platform in ("win32", "darwin"):
            with self.assertRaisesRegex(ValueError, "Linux/WSL"):
                CodexClient(f.root, f.session, env=f.env, platform=platform)
        if sys.platform == "linux":
            with self.assertRaises(FileNotFoundError):
                CodexClient(f.root, f.session, env=f.env)
        self.assertFalse(Path(f.env["CODEX_HOME"]).exists())

    @unittest.skipUnless(sys.platform == "linux", "自动路径限定 Linux/WSL")
    def test_rollout_partial_lines_rollback_identity_and_path_are_verified(self):
        """原队列客户端的增量记录、回滚与跨会话边界迁移。"""
        f = ProjectFixture(self)
        server = CodexServer(self, f)
        client = CodexClient(f.root, f.session, env=f.env, timeout=0.3)
        self.addCleanup(client.close)
        client.connect()
        baseline = client.snapshot()["humanId"]
        with server.file.open("ab") as stream:
            stream.write(b'{"type":"event_msg"')
        self.assertEqual(client.snapshot()["humanId"], baseline)
        with server.file.open("ab") as stream:
            stream.write(b',"payload":{"type":"thread_rolled_back"}}\n')
        with self.assertRaisesRegex(ValueError, "人工消息基线"):
            client.snapshot()
        server.file.write_text(json.dumps({"type": "session_meta", "payload": {"id": str(uuid4())}}) + "\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "替换、截断或重写"):
            client.snapshot()
        fresh = CodexClient(f.root, f.session, env=f.env, timeout=0.3)
        self.addCleanup(fresh.close)
        with self.assertRaisesRegex(ValueError, "标识不符"):
            fresh.read_rollout(str(server.file))
        with self.assertRaisesRegex(ValueError, "精确会话记录路径"):
            client.read_rollout(str(f.root / "wrong.jsonl"))
        outside = f.root / ("rollout-" + f.session + ".jsonl")
        outside.write_text("", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "越界"):
            client.read_rollout(str(outside))

    def test_long_session_scans_only_new_records_and_rejects_replacement(self):
        """跨过旧整份日志预算，续读完整行并拒绝另一个进程使用替换日志。"""
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "session.jsonl"
            irrelevant = b'{"type":"tool","data":"' + b"x" * (8 * 1024 * 1024) + b'"}\n'
            with file.open("wb") as stream:
                for _ in range(17):
                    stream.write(irrelevant)
                stream.write(b'{"type":"human","id":"first"}\n{"type":"human"')
            self.assertGreater(file.stat().st_size, 128 * 1024 * 1024)

            def consume(record, entry):
                record["records"] += 1
                if entry["type"] == "human":
                    record["latest"] = entry["id"]

            log = SessionLog()
            initial = {"records": 0, "latest": None}
            record, frozen = log.read(file, initial.copy(), consume)
            self.assertEqual(record, {"records": 18, "latest": "first"})
            with file.open("ab") as stream:
                stream.write(b',"id":"new"}\n')
            record, current = log.read(file, initial.copy(), consume)
            self.assertEqual(record, {"records": 19, "latest": "new"})
            SessionLog.verify(frozen, current)
            replaced = file.with_suffix(".tmp")
            replaced.write_text('{"type":"human","id":"first"}\n', encoding="utf-8")
            replaced.replace(file)
            with self.assertRaisesRegex(ValueError, "替换、截断或重写"):
                log.read(file, initial.copy(), consume)
            _, other = SessionLog().read(file, initial.copy(), consume)
            with self.assertRaisesRegex(ValueError, "冻结的原生会话记录已替换"):
                SessionLog.verify(frozen, other)

    @unittest.skipUnless(sys.platform == "linux", "自动路径限定 Linux/WSL")
    def test_native_rpc_unknown_receipt_is_not_retried_and_delete_is_precise(self):
        """保留超时单次写入和准确队列不存在错误处理。"""
        f = ProjectFixture(self)
        server = CodexServer(self, f)
        client = CodexClient(f.root, f.session, env=f.env, timeout=0.1)
        self.addCleanup(client.close)
        client.connect()
        server.override = lambda packet, connection: packet["method"] == "thread/queue/add"
        with self.assertRaisesRegex(TimeoutError, "回执超时"):
            client.add(str(uuid4()))
        self.assertEqual(server.calls.count("thread/queue/add"), 1)
        def reject(packet, connection):
            connection.sendall(_frame(json.dumps({"id": packet["id"], "error": {"code": -32600, "message": "queued submission not found"}}).encode("utf-8")))
            return True
        server.override = reject
        self.assertEqual(client.remove("owned"), "not_pending")
        def denied(packet, connection):
            connection.sendall(_frame(json.dumps({"id": packet["id"], "error": {"code": -32600, "message": "permission denied"}}).encode("utf-8")))
            return True
        server.override = denied
        with self.assertRaisesRegex(ValueError, "permission denied"):
            client.remove("owned")

    @unittest.skipUnless(sys.platform == "linux", "自动路径限定 Linux/WSL")
    def test_window_binding_requires_hook_and_rechecks_service_identity(self):
        """迁移原 TUI 适配器的 Hook、服务唯一性和准备期间重绑断言。"""
        f = ProjectFixture(self)
        server = CodexServer(self, f)
        client = CodexClient(f.root, f.session, env=f.env)
        self.addCleanup(client.close)
        client.connect()
        with self.assertRaisesRegex(ValueError, "输入 Hook"):
            client.capture_window(server.origin)
        f.store.update(lambda value: {**value, "native": {"version": 2, "project": str(f.root), "sessionId": f.session, "turnId": server.origin}})
        with patch("flower_confirmation_runtime.codex.bind_origin", return_value={"origin": "http://127.0.0.1:1"}), \
                patch("flower_confirmation_runtime.codex.check_frontend_coverage") as coverage:
            self.assertEqual(client.capture_window(server.origin)["origin"], "http://127.0.0.1:1")
            coverage.assert_called_once_with(["http://127.0.0.1:1"])
        for data in ([], [{"name": "codex_tui", "runtimeStatus": "failed", "httpOrigin": "http://127.0.0.1:1"}],
                     [{"name": "codex_tui", "runtimeStatus": "connected", "httpOrigin": "http://example.com:1"}]):
            with patch.object(client, "rpc", return_value={"data": data}), self.assertRaisesRegex(ValueError, "TUI 服务"):
                client._origin()
        with patch.object(client, "_origin", side_effect=("http://127.0.0.1:1", "http://127.0.0.1:2")), \
                patch("flower_confirmation_runtime.codex.bind_origin", return_value={"origin": "http://127.0.0.1:1"}), \
                self.assertRaisesRegex(ValueError, "绑定已改变"):
            client.capture_window(server.origin)
        with patch.object(client, "_origin", return_value="http://127.0.0.1:2"), self.assertRaisesRegex(ValueError, "绑定已改变"):
            client.verify_window({"origin": "http://127.0.0.1:1"})


class CodexServer:
    """独立 RFC 6455 服务替身，使用真实 Unix socket。"""

    def __init__(self, testcase, fixture):
        """启动隔离宿主并登记资源清理。

        @param testcase: unittest 用例。
        @param fixture: 项目夹具。
        @return: None。
        """
        directory = tempfile.TemporaryDirectory(prefix="fc-")
        testcase.addCleanup(directory.cleanup)
        self.home = Path(directory.name)
        (self.home / "app-server-control").mkdir()
        (self.home / "sessions").mkdir()
        fixture.env["CODEX_HOME"] = str(self.home)
        self.fixture = fixture
        self.origin = str(uuid4())
        self.file = self.home / "sessions" / ("rollout-test-" + fixture.session + ".jsonl")
        self.file.write_text(json.dumps({"type": "session_meta", "payload": {"id": fixture.session}}) + "\n", encoding="utf-8")
        self.append({"type": "task_started", "turn_id": self.origin})
        self.append({"type": "item_completed", "thread_id": fixture.session, "turn_id": self.origin,
                     "item": {"type": "UserMessage", "id": str(uuid4()), "content": []}})
        self.calls, self.added, self.errors, self.clients, self.threads = [], [], [], [], []
        self.override = None
        self.stopped = threading.Event()
        self.socket = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.socket.bind(str(self.home / "app-server-control/app-server-control.sock"))
        self.socket.listen()
        self.socket.settimeout(0.2)
        self.thread = threading.Thread(target=self._accept, daemon=True)
        self.thread.start()
        testcase.addCleanup(self.close)

    def append(self, event):
        """追加完整原生事件行。

        @param event: 事件载荷。
        @return: None。
        """
        with self.file.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps({"type": "event_msg", "payload": event}, ensure_ascii=False) + "\n")

    def _accept(self):
        while not self.stopped.is_set():
            try:
                client, unused = self.socket.accept()
            except socket.timeout:
                continue
            except OSError:
                return
            self.clients.append(client)
            thread = threading.Thread(target=self._serve, args=(client,), daemon=True)
            self.threads.append(thread)
            thread.start()

    def _serve(self, client):
        def read(size):
            result = b""
            while len(result) < size:
                raw = client.recv(size - len(result))
                if not raw:
                    raise EOFError()
                result += raw
            return result
        try:
            header = b""
            while not header.endswith(b"\r\n\r\n"):
                header += read(1)
            key = next(line.split(b":", 1)[1].strip() for line in header.split(b"\r\n") if line.lower().startswith(b"sec-websocket-key:"))
            accept = base64.b64encode(hashlib.sha1(key + b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest())
            client.sendall(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + b"\r\n\r\n")
            while not self.stopped.is_set():
                first, second = read(2)
                if not second & 0x80:
                    raise ValueError("客户端缺少帧掩码")
                size = second & 0x7f
                if size in (126, 127):
                    size = struct.unpack("!H" if size == 126 else "!Q", read(2 if size == 126 else 8))[0]
                mask, raw = read(4), read(size)
                packet = json.loads(bytes(value ^ mask[index % 4] for index, value in enumerate(raw)).decode("utf-8"))
                if "id" not in packet:
                    continue
                method, params = packet["method"], packet["params"]
                self.calls.append(method)
                if self.override and self.override(packet, client):
                    continue
                if method == "thread/read":
                    result = {"thread": {"id": self.fixture.session, "cwd": str(self.fixture.root), "path": str(self.file), "status": {"type": "idle"}}}
                elif method == "mcpServerStatus/list":
                    result = {"data": [{"name": "codex_tui", "runtimeStatus": "connected", "httpOrigin": "http://127.0.0.1:1"}]}
                elif method == "thread/loaded/list":
                    result = {"data": [self.fixture.session]}
                elif method == "thread/queue/add":
                    identifier = params["clientUserMessageId"]
                    self.added.append(identifier)
                    turn = str(uuid4())
                    self.append({"type": "task_started", "turn_id": turn})
                    self.append({"type": "item_completed", "thread_id": self.fixture.session, "turn_id": turn,
                                 "item": {"type": "UserMessage", "id": str(uuid4()), "client_id": identifier, "content": params["input"]}})
                    result = {"queuedSubmission": {"id": "queue"}}
                else:
                    result = {}
                client.sendall(_frame(json.dumps({"id": packet["id"], "result": result}).encode("utf-8")))
        except (EOFError, ConnectionError, OSError):
            pass
        except Exception as error:
            self.errors.append(str(error))
        finally:
            client.close()

    def close(self):
        """关闭本测试的连接和服务线程。

        @return: None。
        """
        self.stopped.set()
        self.socket.close()
        for client in self.clients:
            try:
                client.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
        self.thread.join(2)
        for thread in self.threads:
            thread.join(2)


if __name__ == "__main__":
    unittest.main()
