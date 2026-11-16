"""后台确认的回合来源与请求替换回归。"""

import json
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from uuid import uuid4

from confirmation_fixture import ProjectFixture
from flower_confirmation_runtime import runtime
from flower_confirmation_runtime.claude import ClaudeClient, record_event as claude_event
from flower_confirmation_runtime.codex import CodexClient, record_event as codex_event
from flower_confirmation_runtime.store import cancel_project, wake_message


class ConfirmationOriginTest(unittest.TestCase):
    """使用真实适配器和策略进程验证独立来源的生命周期。"""

    def setup_origin(self, platform, host="linux", opaque=False):
        """建立旧状态中的已消费通知回合。

        @param platform: codex 或 claude。
        @param host: 适配器的宿主分支。
        @param opaque: 是否采用非 UUID 的原生标识。
        @return: 隔离项目、新客户端工厂和日志路径。
        """
        f = ProjectFixture(self, platform)
        original, turn, human = str(uuid4()), str(uuid4()), f.client.human
        task = "original-task"
        if opaque:
            turn, human, task = "turn/α:1", "message/β:2", "task/γ:3"
        identity = {"pid": 10, "exe": "claude.exe", "created": "10"}
        native = {**f.store.read()["native"], "humanId": human}
        if platform == "codex":
            sessions = Path(f.env["CODEX_HOME"]) / "sessions"
            sessions.mkdir(parents=True)
            file = sessions / ("native-session.events" if opaque else "rollout-test-" + f.session + ".jsonl")
            rows = [{"type": "session_meta", "payload": {"id": f.session}},
                    {"type": "event_msg", "payload": {"type": "task_started", "turn_id": turn}},
                    {"type": "event_msg", "payload": {"type": "item_completed", "turn_id": turn,
                     "item": {"type": "UserMessage", "id": "input/δ:4" if opaque else str(uuid4()), "client_id": original,
                              "content": [{"type": "text", "text": wake_message(original)}]}}}]
            native.update(version=2, turnId=turn)

            def client():
                value = CodexClient(f.root, f.session, env=f.env, platform="linux")
                value.platform = host
                value.rpc = lambda *args: {"thread": {"id": f.session, "cwd": str(f.root), "path": str(file)}}
                value.capture_window = lambda *args: f.client.capture_window(turn)
                value.verify_window = f.client.verify_window
                value.remove = lambda *args: "not_pending"
                return value
        else:
            file = f.root / ("native-session.events" if opaque else f.session + ".jsonl")
            rows = [{"type": "user", "sessionId": f.session, "promptId": human,
                     "origin": {"kind": "human"}, "turnOrigin": "human", "message": {"content": "开始"}},
                    {"type": "user", "sessionId": f.session, "promptId": turn,
                     "origin": {"kind": "task-notification"}, "turnOrigin": "task_notification",
                     "message": {"content": "<task-notification>\n<task-id>" + task + "</task-id>\n</task-notification>"}}]
            native.update(transcript=str(file), frontend=identity, tasks={task: original},
                          turn={"id": turn, "status": "inProgress"},
                          notification={"taskId": task, "requestId": original, "promptId": turn})
            frontend = Mock(identity=identity)
            frontend.exited.return_value = False
            patcher = patch("flower_confirmation_runtime.claude.open_identity", return_value=frontend)
            patcher.start()
            self.addCleanup(patcher.stop)

            def client():
                value = ClaudeClient(f.root, f.session, platform="linux")
                value.platform = host
                return value
        file.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
        f.store.update(lambda state: {**state, "native": native, "lastHumanMessageId": human,
                                     "request": {"id": original, "generation": state["generation"], "state": "consumed",
                                                 "baselineMessageId": human, "queueId": task,
                                                 "execution": {"state": "completed"}}})
        return f, client, file

    def test_internal_turn_preserves_origin_across_cancel_and_replacements(self):
        """两端两个宿主分支在新客户端中连续替换，来源保持独立。"""
        for platform in ("codex", "claude"):
            for host in ("linux", "win32"):
                for cancelled in (False, True):
                    with self.subTest(platform=platform, host=host, cancelled=cancelled):
                        f, client, _ = self.setup_origin(platform, host)
                        first = runtime.prepare(f.store, client(), f.input, "1")
                        if cancelled:
                            runtime.cancel(f.store, request_id=first["requestId"])
                        second = runtime.prepare(f.store, client(), f.input, "2")
                        origin = f.store.read()["turnOrigin"]
                        third = runtime.prepare(f.store, client(), f.input, "3")
                        self.assertNotEqual(second["requestId"], third["requestId"])
                        self.assertEqual(f.store.read()["turnOrigin"]["turnId"], origin["turnId"])
                        self.assertEqual(f.store.read()["turnOrigin"]["wakeRequestId"], origin["wakeRequestId"])
                        self.assertEqual(f.store.read()["request"]["seconds"], 3)
                        self.assertIsNone(f.store.read()["request"]["deadline"])
                        self.assertEqual(runtime.claim(f.store, client(), first["requestId"])["reason"], "not_current")

    def test_reused_origin_rechecks_log_and_frontend(self):
        """持久来源仍受日志身份、边界和原窗口约束。"""
        for platform in ("codex", "claude"):
            for mutation in ("truncate", "rewrite", "replace"):
                with self.subTest(platform=platform, mutation=mutation):
                    f, client, file = self.setup_origin(platform)
                    runtime.prepare(f.store, client(), f.input, "1")
                    raw = file.read_bytes()
                    if mutation == "truncate":
                        file.write_bytes(b"")
                    elif mutation == "rewrite":
                        file.write_bytes(raw.replace(b"task", b"tusk"))
                    else:
                        temporary = file.with_suffix(".tmp")
                        temporary.write_bytes(raw)
                        temporary.replace(file)
                    with self.assertRaises(ValueError):
                        runtime.prepare(f.store, client(), f.input, "1")
        f, client, _ = self.setup_origin("codex")
        runtime.prepare(f.store, client(), f.input, "1")
        f.client.window_valid = False
        with self.assertRaisesRegex(ValueError, "窗口"):
            runtime.prepare(f.store, client(), f.input, "1")
        f.client.window_valid = True
        current = client()
        current.capture_window = lambda *args: {"version": 1, "origin": "http://127.0.0.1:2", "pid": 456}
        with self.assertRaisesRegex(ValueError, "窗口"):
            runtime.prepare(f.store, current, f.input, "1")

    def test_input_hooks_and_project_lifecycle_invalidate_origin(self):
        """新人工输入与项目生命周期清理独立来源。"""
        for platform in ("codex", "claude"):
            for change in ("human", "project"):
                with self.subTest(platform=platform, change=change):
                    f, client, file = self.setup_origin(platform)
                    runtime.prepare(f.store, client(), f.input, "1")
                    self.assertIn("turnOrigin", f.store.read())
                    if change == "project":
                        cancel_project(f.root, "project_updated")
                    elif platform == "codex":
                        with patch("flower_confirmation_runtime.codex.hook_frontend", return_value=None):
                            codex_event({"cwd": str(f.root), "session_id": f.session, "turn_id": str(uuid4()),
                                         "hook_event_name": "UserPromptSubmit", "prompt": "新意见"})
                    else:
                        claude_event({"cwd": str(f.root), "session_id": f.session, "transcript_path": str(file),
                                      "hook_event_name": "UserPromptSubmit", "prompt_id": str(uuid4()),
                                      "prompt": "新意见"}, platform="linux")
                    self.assertNotIn("turnOrigin", f.store.read())
                    self.assertEqual(f.store.read()["request"]["state"], "cancelled")

    def test_origin_survives_absent_request_without_granting_claim(self):
        """来源独立于旧请求存在，新请求仍须取得自己的原生唤醒。"""
        for platform in ("codex", "claude"):
            with self.subTest(platform=platform):
                f, client, _ = self.setup_origin(platform)
                runtime.prepare(f.store, client(), f.input, "1")
                f.store.update(lambda state: {**state, "request": None})
                prepared = runtime.prepare(f.store, client(), f.input, "1")
                f.store.change(prepared["requestId"], lambda request, state: request.update(state="queued"))
                with self.assertRaisesRegex(ValueError, "原生.*消息|原生任务通知"):
                    runtime.claim(f.store, client(), prepared["requestId"])

    def test_prepare_race_preserves_new_generation(self):
        """来源复核期间出现新代次，旧候选不能覆盖原子状态。"""
        f, client, _ = self.setup_origin("codex")
        runtime.prepare(f.store, client(), f.input, "1")
        previous = f.store.read()["request"]["id"]
        current = client()
        def changed(turn):
            f.store.update(lambda state: {**state, "generation": state["generation"] + 1})
            return f.client.capture_window(turn)
        current.capture_window = changed
        with self.assertRaisesRegex(ValueError, "代次已变化"):
            runtime.prepare(f.store, current, f.input, "1")
        self.assertEqual(f.store.read()["request"]["id"], previous)

    def test_new_input_or_turn_cannot_reuse_old_origin(self):
        """日志中的新人工输入、回滚与原生回合变化均拒绝复用。"""
        for platform in ("codex", "claude"):
            for change in ("human", "turn", "run"):
                with self.subTest(platform=platform, change=change):
                    f, client, file = self.setup_origin(platform)
                    runtime.prepare(f.store, client(), f.input, "1")
                    if change == "human":
                        if platform == "codex":
                            row = {"type": "event_msg", "payload": {"type": "item_completed",
                                   "turn_id": f.store.read()["turnOrigin"]["turnId"],
                                   "item": {"type": "UserMessage", "id": str(uuid4()), "content": []}}}
                        else:
                            row = {"type": "user", "sessionId": f.session, "promptId": str(uuid4()),
                                   "origin": {"kind": "human"}, "turnOrigin": "human", "message": {"content": "插话"}}
                        with file.open("a", encoding="utf-8") as stream:
                            stream.write(json.dumps(row) + "\n")
                    elif platform == "codex" and change == "run":
                        with file.open("a", encoding="utf-8") as stream:
                            stream.write(json.dumps({"type": "event_msg", "payload": {"type": "thread_rolled_back"}}) + "\n")
                    else:
                        def changed(state):
                            if change == "run":
                                state["native"]["runId"] = str(uuid4())
                            elif platform == "codex":
                                state["native"]["turnId"] = str(uuid4())
                            else:
                                state["native"]["turn"] = {"id": str(uuid4()), "status": "inProgress"}
                            return state
                        f.store.update(changed)
                    with self.assertRaises(ValueError):
                        runtime.prepare(f.store, client(), f.input, "1")

    def test_claude_skill_metadata_is_neither_human_nor_notification(self):
        """技能重复调用的原生元消息不阻止定位真实输入和连续准备。"""
        for host in ("linux", "win32"):
            with self.subTest(host=host):
                f, client, file = self.setup_origin("claude", host)
                prompt = f.store.read()["native"]["turn"]["id"]
                metadata = {"type": "user", "sessionId": f.session, "promptId": prompt, "isMeta": True,
                            "message": {"content": "(Re-invocation of /trellis-route — the skill instructions were previously loaded.)"}}
                with file.open("a", encoding="utf-8") as stream:
                    stream.write(json.dumps(metadata) + "\n")
                runtime.prepare(f.store, client(), f.input, "1")
                with file.open("a", encoding="utf-8") as stream:
                    stream.write(json.dumps(metadata) + "\n")
                self.assertTrue(runtime.prepare(f.store, client(), f.input, "1")["prepared"])
                evidence = {"humanId": None, "notifications": {}}
                current = client()
                current._consume_transcript(evidence, metadata)
                self.assertEqual(evidence, {"humanId": None, "notifications": {}})
                for changed in ({"isMeta": False}, {"isMeta": "true"}, {"origin": {}}):
                    current._consume_transcript(evidence, {**metadata, **changed})
                    self.assertEqual(evidence, {"humanId": None, "notifications": {}})
                current._consume_transcript(evidence, {**metadata, "origin": {"kind": "human"}, "turnOrigin": "human"})
                self.assertEqual(evidence["humanId"], prompt)

    def test_unknown_records_and_opaque_native_ids_allow_automatic_prepare(self):
        """新增附加记录与原生标识格式变化无需追加兼容条件。"""
        for platform in ("codex", "claude"):
            with self.subTest(platform=platform):
                f, client, file = self.setup_origin(platform, opaque=True)
                if platform == "codex":
                    rows = [["future-context"], {"type": "event_msg", "payload": ["future-content"]},
                            {"type": "event_msg", "payload": {"type": "item_completed", "item": "new-context"}},
                            {"type": "event_msg", "payload": {"type": "item_completed", "thread_id": str(uuid4()),
                             "item": {"type": "UserMessage", "id": "other-message", "content": []}}}]
                else:
                    rows = [{"type": "user", "sessionId": f.session, "promptId": "turn/α:1",
                             "origin": {"kind": "future-context"}, "turnOrigin": "new-extra-value",
                             "message": {"content": "附加信息"}},
                            {"type": "user", "sessionId": f.session, "promptId": "turn/α:1",
                             "message": {"content": "未知上下文，没有固定元消息标记"}}]
                with file.open("a", encoding="utf-8") as stream:
                    stream.write("".join(json.dumps(row) + "\n" for row in rows))
                file.write_bytes(file.read_bytes().replace(b"/", b"\\/"))
                self.assertTrue(runtime.prepare(f.store, client(), f.input, "1")["prepared"])
                self.assertTrue(runtime.prepare(f.store, client(), f.input, "1")["prepared"])
                self.assertEqual(f.store.read()["turnOrigin"]["baselineMessageId"], "message/β:2")

    def test_claude_single_origin_field_and_notification_content_variants(self):
        """来源单字段、旧字段和通知分块统一适用于两个宿主。"""
        for host in ("linux", "win32"):
            for mode in ("primary", "legacy", "extra", "long"):
                with self.subTest(host=host, mode=mode):
                    f, client, file = self.setup_origin("claude", host, opaque=True)
                    rows = [json.loads(line) for line in file.read_text().splitlines()]
                    if mode == "long":
                        identifier = "native-turn-" + "x" * 512
                        rows[-1]["promptId"] = identifier
                        def long_identifier(state):
                            state["native"]["turn"]["id"] = identifier
                            state["native"]["notification"]["promptId"] = identifier
                            return state
                        f.store.update(long_identifier)
                    for row in rows:
                        if mode == "legacy":
                            row.pop("origin")
                        elif mode == "primary":
                            row.pop("turnOrigin")
                        else:
                            row["turnOrigin"] = "new-auxiliary-format"
                    rows[-1]["message"]["content"] = [{"type": "new-content-kind", "text": "新外壳\n<task-id> task/γ:3 </task-id>\n附加说明"},
                                                       {"type": "new-annotation", "details": {"version": 2}}]
                    if mode == "extra":
                        def extra_metadata(state):
                            state["native"]["notification"]["futureMetadata"] = {"version": 2}
                            return state
                        f.store.update(extra_metadata)
                    file.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
                    self.assertTrue(runtime.prepare(f.store, client(), f.input, "1")["prepared"])
                    self.assertTrue(runtime.prepare(f.store, client(), f.input, "1")["prepared"])

    def test_corrupt_or_foreign_origin_is_rejected(self):
        """未知版本、跨会话和坏边界均阻止来源复用。"""
        for platform in ("codex", "claude"):
            for mutation in ({"version": 2}, {"sessionId": str(uuid4())}, {"platform": "other"},
                             {"logStart": {}}, {"baselineMessageId": ""}):
                with self.subTest(platform=platform, mutation=mutation):
                    f, client, _ = self.setup_origin(platform)
                    runtime.prepare(f.store, client(), f.input, "1")
                    f.store.update(lambda state: {**state, "turnOrigin": {**state["turnOrigin"], **mutation}})
                    with self.assertRaises(ValueError):
                        runtime.prepare(f.store, client(), f.input, "1")


if __name__ == "__main__":
    unittest.main()
