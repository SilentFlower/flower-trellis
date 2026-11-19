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
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from confirmation_fixture import ProjectFixture
from flower_confirmation_runtime.codex import CodexClient
from flower_confirmation_runtime.session_log import SessionLog
from flower_confirmation_runtime.store import wake_message
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
        self._claude_project_cli_flow("human")

    @unittest.skipUnless(sys.platform == "linux", "自动路径限定 Linux/WSL")
    def test_claude_peer_turn_cli_full_chain_without_human_history(self):
        """peer 回合完整执行准备、展示、唤醒与单次记账。

        @return: None。
        """
        self._claude_project_cli_flow("peer")

    def _claude_project_cli_flow(self, source):
        f = ProjectFixture(self, "claude")
        f.env["PATH"] = str(f.root / "empty-bin")
        transcript = f.root / (f.session + ".jsonl")
        transcript.write_text("", encoding="utf-8")
        prompt_id = str(uuid4())
        payload = {"cwd": str(f.root), "session_id": f.session, "transcript_path": str(transcript)}
        self.invoke(f, ["hook"], {**payload, "hook_event_name": "SessionStart"})
        self.invoke(f, ["hook"], {**payload, "hook_event_name": "UserPromptSubmit", "prompt_id": prompt_id, "prompt": "开始"})
        old = {"type": "user", "sessionId": f.session, "promptId": str(uuid4()),
               "origin": {"kind": "unknown-old"}, "message": {"content": "旧记录"}}
        human = {"type": "user", "sessionId": f.session, "promptId": prompt_id,
                 "origin": {"kind": source}, "turnOrigin": source, "message": {"content": "开始"}}
        transcript.write_text(json.dumps(old) + "\n" + json.dumps(human) + "\n", encoding="utf-8")
        record = b'{"type":"assistant","message":"' + b"x" * (6 * 1024 * 1024) + b'"}\n'
        with transcript.open("ab") as stream:
            for _ in range(3):
                stream.write(record)
        prepared = self.invoke(f, ["prepare", "--input", f.input, "--seconds", "1"])
        self.assertTrue(prepared["prepared"], prepared)
        start = f.store.read()["request"]["contract"]["claudeLogStart"]
        self.assertEqual(start["offset"], transcript.stat().st_size)
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
            stream.write(json.dumps({**old, "origin": {"kind": "beer"}}) + "\n")
            stream.write(json.dumps({**old, "origin": {"kind": "task-notification"}, "queueTranscriptOnly": True,
                                     "message": {"content": notice}}) + "\n")
            stream.write(json.dumps({"type": "user", "sessionId": f.session, "promptId": notification_prompt,
                                     "origin": {"kind": "task-notification"}, "turnOrigin": "task_notification",
                                     "message": {"content": notice}}) + "\n")
        self.invoke(f, ["hook"], {**payload, "hook_event_name": "UserPromptSubmit", "prompt_id": notification_prompt, "prompt": notice})
        self.finish_actions(f, request_id)
        for index in range(2):
            previous = request_id
            prepared = self.invoke(f, ["prepare", "--input", f.input, "--seconds", "1"])
            self.invoke(f, ["cancel", "--request", prepared["requestId"]])
            prepared = self.invoke(f, ["prepare", "--input", f.input, "--seconds", "1"])
            prepared = self.invoke(f, ["prepare", "--input", f.input, "--seconds", "1"])
            request_id = prepared["requestId"]
            self.assertEqual(self.invoke(f, ["claim", "--request", previous])["reason"], "not_current")
            child = self.start_wait(f, request_id)
            self.assertIsNone(f.store.read()["request"]["deadline"])
            command = " ".join(shlex.quote(token) for token in [sys.executable, "-X", "utf8", str(f.scripts / "flower_confirmation.py"),
                                                               "wait", "--platform", "claude", "--request", request_id])
            task_id = "replacement-task-" + str(index)
            self.invoke(f, ["hook"], {**payload, "hook_event_name": "Stop", "prompt_id": notification_prompt,
                                      "last_assistant_message": prepared["display"],
                                      "background_tasks": [{"id": task_id, "type": "shell", "command": command}]})
            output, errors = child.communicate(timeout=10)
            self.assertEqual(child.returncode, 0, output + errors)
            self.assertEqual(f.store.read()["request"]["state"], "queued")
            notification_prompt = str(uuid4())
            notice = "<task-notification>\n<task-id>" + task_id + "</task-id>\n</task-notification>"
            with transcript.open("a", encoding="utf-8") as stream:
                stream.write(json.dumps({"type": "user", "sessionId": f.session, "promptId": notification_prompt,
                                         "origin": {"kind": "task-notification"}, "turnOrigin": "task_notification",
                                         "message": {"content": notice}}) + "\n")
            self.invoke(f, ["hook"], {**payload, "hook_event_name": "UserPromptSubmit", "prompt_id": notification_prompt, "prompt": notice})
            self.finish_actions(f, request_id)

    @unittest.skipUnless(sys.platform == "linux", "自动路径限定 Linux/WSL")
    def test_codex_project_cli_full_chain_with_isolated_native_transport(self):
        """真实本机 WebSocket、rollout 与队列链路在空 PATH 下执行。"""
        self._codex_project_cli_flow()

    @unittest.skipUnless(sys.platform == "linux", "本机 Unix socket 链路限定 Linux/WSL，Windows 使用原生分支专项")
    def test_codex_recovered_turn_full_chain_with_isolated_native_transport(self):
        """连续恢复后跨进程准备、展示、领取和 started 仍只执行一次。

        @return: None。
        """
        self._codex_project_cli_flow(recovery=True)

    def _codex_project_cli_flow(self, recovery=False):
        """运行普通及连续恢复的实际 Python CLI 完成链。

        @param recovery: 是否在输入后加入两次原生恢复和中途插话。
        @return: None。
        """
        f = ProjectFixture(self)
        f.env["PATH"] = str(f.root / "empty-bin")
        server = CodexServer(self, f)
        input_turn = server.origin
        if recovery:
            original = server.origin
            for index in range(2):
                server.append({"type": "turn_aborted", "turn_id": server.origin, "reason": "interrupted"})
                parent = server.origin
                server.origin = str(uuid4())
                server.append({"type": "task_started", "turn_id": server.origin, "root_turn_id": parent,
                               "turn_attribution": {"turn_id": server.origin, "turn_trigger": "daemon_recovery", "root_turn_id": parent}})
                if index == 0:
                    input_turn = server.origin
                    server.append({"type": "item_completed", "turn_id": input_turn,
                                   "item": {"type": "UserMessage", "id": str(uuid4()), "content": []}})
            self.assertNotEqual(original, server.origin)
        header, current = server.file.read_bytes().split(b"\n", 1)
        server.file.write_bytes(header + b"\n{invalid-old-json}\n" + current)
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
        self.assertGreater(f.store.read()["request"]["contract"]["codexLogStart"]["offset"], len(header))
        self.assertNotIn("inputTurnId", f.store.read()["turnOrigin"])
        self.assertEqual(f.store.read()["turnOrigin"]["inputSeq"], f.store.read()["inputSeq"])
        self.assertEqual(f.store.read()["turnOrigin"]["turnId"], server.origin)
        request_id = prepared["requestId"]
        child = self.start_wait(f, request_id)
        server.append({"type": "item_completed", "thread_id": f.session, "turn_id": server.origin,
                       "item": {"type": "AgentMessage", "phase": "final_answer", "content": [
                           {"type": "future-annotation", "details": {}}, {"type": "new-text-kind", "text": prepared["display"]}]}})
        server.append({"type": "task_complete", "turn_id": server.origin})
        deadline = time.monotonic() + 10
        while f.store.read()["request"]["state"] != "queued":
            if child.poll() is not None:
                output, errors = child.communicate()
                self.fail(output + errors)
            self.assertLess(time.monotonic(), deadline)
            time.sleep(0.02)
        self.invoke(f, ["hook"], {"cwd": str(f.root), "session_id": f.session, "turn_id": server.wake_turn,
                                  "hook_event_name": "UserPromptSubmit", "prompt": "平台前缀\n" + wake_message(request_id) + "\n附加说明"})
        self.finish_actions(f, request_id)
        output, errors = child.communicate(timeout=10)
        self.assertEqual(child.returncode, 0, output + errors)
        self.assertEqual(server.added, [request_id])
        for _ in range(2):
            previous, origin_turn = request_id, server.wake_turn
            prepared = self.invoke(f, ["prepare", "--input", f.input, "--seconds", "1"])
            self.invoke(f, ["cancel", "--request", prepared["requestId"]])
            prepared = self.invoke(f, ["prepare", "--input", f.input, "--seconds", "1"])
            prepared = self.invoke(f, ["prepare", "--input", f.input, "--seconds", "1"])
            request_id = prepared["requestId"]
            self.assertEqual(self.invoke(f, ["claim", "--request", previous])["reason"], "not_current")
            child = self.start_wait(f, request_id)
            self.assertIsNone(f.store.read()["request"]["deadline"])
            server.append({"type": "item_completed", "thread_id": f.session, "turn_id": origin_turn,
                           "item": {"type": "AgentMessage", "phase": "final_answer", "content": prepared["display"]}})
            server.append({"type": "task_complete", "turn_id": origin_turn})
            deadline = time.monotonic() + 10
            while f.store.read()["request"]["state"] != "queued":
                if child.poll() is not None:
                    output, errors = child.communicate()
                    self.fail(output + errors)
                self.assertLess(time.monotonic(), deadline)
                time.sleep(0.02)
            self.invoke(f, ["hook"], {"cwd": str(f.root), "session_id": f.session, "turn_id": server.wake_turn,
                                      "hook_event_name": "UserPromptSubmit", "prompt": wake_message(request_id)})
            self.finish_actions(f, request_id)
            output, errors = child.communicate(timeout=10)
            self.assertEqual(child.returncode, 0, output + errors)
        self.assertEqual(len(set(server.added)), 3)
        self.assertNotIn("thread/resume", server.calls)
        self.assertEqual(server.errors, [])

    def test_codex_scoped_rollout_ignores_history_and_rejects_new_input_or_rollback(self):
        """两种宿主共用起点读取，人工插话与回滚仍作废本次观察。"""
        for platform in ("linux", "win32"):
            with self.subTest(platform=platform):
                f = ProjectFixture(self)
                home = Path(f.env["CODEX_HOME"])
                (home / "sessions").mkdir(parents=True)
                file = home / "sessions" / ("rollout-test-" + f.session + ".jsonl")
                turn, human = str(uuid4()), str(uuid4())
                header = {"type": "session_meta", "payload": {"id": f.session}}
                start = {"type": "task_started", "turn_id": turn}
                item = {"type": "item_completed", "turn_id": turn, "item": {"type": "UserMessage", "id": human}}
                newline = b"\r\n" if platform == "win32" else b"\n"

                def append(*events):
                    with file.open("ab") as stream:
                        for event in events:
                            stream.write(json.dumps({"type": "event_msg", "payload": event}).encode("utf-8") + newline)

                def native(value):
                    value["native"].update(version=2, turnId=turn)
                    return value

                f.store.update(native)
                file.write_bytes(json.dumps(header).encode("utf-8") + newline + b"{invalid-old-json}" + newline)
                append(start, {**item, "item": {**item["item"], "id": str(uuid4())}},
                       {**item, "item": {"type": "AgentMessage", "phase": "final_answer", "content": "旧结构"}}, item,
                       {"type": "beer", "turn_id": turn})
                client = CodexClient(f.root, f.session, env=f.env, platform="linux")
                client.platform = platform
                rpc = {"thread": {"id": f.session, "cwd": str(f.root), "path": str(file)}}
                with patch.object(client, "rpc", return_value=rpc):
                    snapshot = client.prepare_snapshot()
                    self.assertEqual(snapshot["inputSeq"], 0)
                    append({**item, "item": {**item["item"], "id": str(uuid4())}})
                    with self.assertRaisesRegex(ValueError, "人工输入已变化"):
                        client.prepare_snapshot()

                def prepared(value):
                    value["inputSeq"] = 0
                    value["request"] = {"id": str(uuid4()), "state": "prepared", "generation": value["generation"],
                                        "contract": {"codexLogStart": snapshot["codexLogStart"]},
                                        "originTurnId": turn, "inputSeq": 0}
                    return value

                f.store.update(prepared)
                append({"type": "thread_rolled_back"}, start, item)
                fresh = CodexClient(f.root, f.session, env=f.env, platform="linux")
                fresh.platform = platform
                with patch.object(fresh, "rpc", return_value=rpc):
                    with self.assertRaisesRegex(ValueError, "本次观察期间已回滚"):
                        fresh.snapshot()

    def test_recovery_prepare_requires_current_thread_instead_of_historical_input(self):
        """恢复回合按当前会话建立观察，历史人工消息和恢复祖先均可缺失。

        @return: None。
        """
        for mode in ("no_history", "old_input", "opaque_input", "foreign_current"):
            with self.subTest(mode=mode):
                f = ProjectFixture(self)
                home = Path(f.env["CODEX_HOME"])
                (home / "sessions").mkdir(parents=True)
                file = home / "sessions/events.jsonl"
                original, recovered = str(uuid4()), str(uuid4())
                rows = [{"type": "session_meta", "payload": {"id": f.session}}]
                if mode == "old_input":
                    rows.append({"type": "event_msg", "payload": {"type": "item_completed", "turn_id": original,
                                 "item": {"type": "UserMessage", "id": str(uuid4())}}})
                event = {"type": "task_started", "turn_id": recovered,
                         "turn_attribution": {"turn_trigger": "daemon_recovery", "root_turn_id": original}}
                if mode == "foreign_current":
                    event["thread_id"] = str(uuid4())
                rows.append({"type": "event_msg", "payload": event})
                if mode == "opaque_input":
                    rows.append({"type": "event_msg", "payload": {"type": "item_completed", "turn_id": recovered,
                                 "item": {"type": "UserMessage", "content": []}}})
                file.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
                f.store.update(lambda state: {**state, "native": {"version": 2, "project": str(f.root),
                                                                 "sessionId": f.session, "turnId": recovered}})
                client = CodexClient(f.root, f.session, env=f.env, platform="linux")
                with patch.object(client, "rpc", return_value={"thread": {"id": f.session, "cwd": str(f.root), "path": str(file)}}):
                    if mode == "foreign_current":
                        with self.assertRaises(ValueError):
                            client.prepare_snapshot()
                        continue
                    snapshot = client.prepare_snapshot()
                    self.assertEqual(snapshot["turn"]["id"], recovered)
                    self.assertEqual(snapshot["inputSeq"], 0)
                    self.assertNotIn("baselineMessageId", snapshot["turnOrigin"])
                    with file.open("a", encoding="utf-8") as stream:
                        stream.write(json.dumps({"type": "event_msg", "payload": {"type": "item_completed", "turn_id": recovered,
                                     "item": {"type": "UserMessage", "content": []}}}) + "\n")
                    with self.assertRaisesRegex(ValueError, "人工输入已变化"):
                        client.prepare_snapshot()

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
        for platform in (("darwin",) if sys.platform == "win32" else ("win32", "darwin")):
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
        baseline = client.snapshot()["inputSeq"]
        with server.file.open("ab") as stream:
            stream.write(b'{"type":"event_msg"')
        self.assertEqual(client.snapshot()["inputSeq"], baseline)
        with server.file.open("ab") as stream:
            stream.write(b',"payload":{"type":"thread_rolled_back"}}\n')
        with self.assertRaisesRegex(ValueError, "本次观察期间已回滚"):
            client.snapshot()
        server.file.write_text(json.dumps({"type": "session_meta", "payload": {"id": str(uuid4())}}) + "\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "替换、截断或重写"):
            client.snapshot()
        fresh = CodexClient(f.root, f.session, env=f.env, timeout=0.3)
        self.addCleanup(fresh.close)
        with self.assertRaisesRegex(ValueError, "标识不符"):
            fresh.read_rollout(str(server.file))
        with self.assertRaises(FileNotFoundError):
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

    def test_log_append_metadata_settles_before_size_growth(self):
        """追加的 mtime 先变化时，起读与读后核验均等待真实增长。

        @return: None。
        """
        for phase in ("before", "after", "locate"):
            with self.subTest(phase=phase), tempfile.TemporaryDirectory() as directory:
                file = Path(directory) / "session.jsonl"
                file.write_bytes(b'{"id":"old"}\n')
                log = SessionLog()
                consume = lambda record, entry: record.update(entry)
                log.read(file, {}, consume)
                if phase == "after":
                    log.resume(log.observation, log.result)
                before = file.lstat()
                with file.open("ab") as stream:
                    stream.write(b'{"id":"new"}\n')
                grown = file.lstat()
                lag = SimpleNamespace(st_mode=before.st_mode, st_dev=before.st_dev, st_ino=before.st_ino,
                                      st_size=before.st_size, st_mtime_ns=before.st_mtime_ns + 1)
                observed = [lag, grown, grown] if phase == "before" else [before, lag, grown]
                metadata_events = iter(observed)
                with patch.object(Path, "lstat", side_effect=lambda: next(metadata_events, grown)) as metadata:
                    if phase == "locate":
                        start = SessionLog.locate(file, "old", lambda entry: entry.get("id") == "old")
                        log.resume(start, {"id": "old"})
                    else:
                        record, _ = log.read(file, {}, consume)
                        self.assertEqual(record["id"], "new" if phase == "before" else "old")
                    self.assertGreaterEqual(metadata.call_count, 3)
                self.assertEqual(log.read(file, {}, consume)[0]["id"], "new")

    def test_log_metadata_recheck_preserves_rewrite_and_replacement_rejection(self):
        """元数据重读继续拒绝同大小重写和等待期间的文件替换。

        @return: None。
        """
        for change in ("rewrite", "replacement", "truncation"):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as directory:
                file = Path(directory) / "session.jsonl"
                file.write_bytes(b'{"id":"old"}\n')
                log = SessionLog()
                log.read(file, {}, lambda record, entry: record.update(entry))
                before = file.lstat()
                changed = SimpleNamespace(st_mode=before.st_mode, st_dev=before.st_dev, st_ino=before.st_ino,
                                          st_size=before.st_size, st_mtime_ns=before.st_mtime_ns + 1)
                if change != "rewrite":
                    field = "st_ino" if change == "replacement" else "st_size"
                    value = before.st_ino + 1 if change == "replacement" else before.st_size - 1
                    altered = SimpleNamespace(**{**vars(changed), field: value})
                    metadata = patch.object(Path, "lstat", side_effect=[changed, altered])
                else:
                    metadata = patch.object(Path, "lstat", return_value=changed)
                with metadata, self.assertRaisesRegex(ValueError, "替换、截断或重写"):
                    log.read(file, {}, lambda record, entry: record.update(entry))
                self.assertEqual(log.result, {"id": "old"})

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
                    self.wake_turn = turn
                    self.append({"type": "task_started", "turn_id": turn})
                    self.append({"type": "item_completed", "thread_id": self.fixture.session, "turn_id": turn,
                                 "item": {"type": "UserMessage", "id": str(uuid4()), "client_id": identifier, "content": params["input"] + [
                                     {"type": "future-annotation", "details": {}}, {"type": "text", "text": "\n附加说明"}]}})
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
