"""输入事件序号与无历史人工消息的自动确认回归。"""

import json
import unittest
from unittest.mock import patch
from uuid import uuid4

import test_confirmation_origin as origin_fixture
from confirmation_fixture import ProjectFixture
from flower_confirmation_runtime import runtime
from flower_confirmation_runtime.codex import record_event as codex_event
from flower_confirmation_runtime.session_log import SessionLog


class ConfirmationInputSequenceTest(unittest.TestCase):
    """使用真实适配器验证新序号契约与竞争取消。"""

    def test_native_prepare_without_historical_human_message(self):
        """两端在当前原生回合建立基线，Claude 允许 peer 回传。

        @return: None。
        """
        for platform in ("claude", "codex"):
            with self.subTest(platform=platform):
                f, factory, file = origin_fixture.ConfirmationOriginTest.setup_origin(self, platform)
                state = f.store.read()
                turn = state["native"]["turnId"] if platform == "codex" else state["native"]["turn"]["id"]
                if platform == "claude":
                    rows = [{"type": "user", "sessionId": f.session, "promptId": turn,
                             "origin": {"kind": "peer"}, "turnOrigin": "peer", "message": {"content": "调研完成"}}]
                else:
                    rows = [{"type": "session_meta", "payload": {"id": f.session}},
                            {"type": "event_msg", "payload": {"type": "task_started", "turn_id": turn}}]
                file.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
                state.pop("lastHumanMessageId", None)
                state["native"].pop("humanId", None)
                state.update(request=None, inputSeq=0)
                f.store.update(lambda old: state)
                prepared = runtime.prepare(f.store, factory(), f.input, "1")
                self.assertTrue(prepared["prepared"])
                request = f.store.read()["request"]
                self.assertEqual(request["inputSeq"], 0)
                self.assertNotIn("baselineMessageId", request)
                self.assertNotIn("inputId", f.store.read()["turnOrigin"])
                with file.open("a", encoding="utf-8") as stream:
                    row = ({"type": "user", "sessionId": f.session, "origin": {"kind": "human"},
                            "message": {"content": "新意见"}} if platform == "claude" else
                           {"type": "event_msg", "payload": {"type": "item_completed", "turn_id": turn,
                            "item": {"type": "UserMessage", "content": []}}})
                    stream.write(json.dumps(row) + "\n")
                snapshot = factory().snapshot()
                self.assertGreater(snapshot["inputSeq"], request["inputSeq"])
                runtime._observe(f.store, request["id"], snapshot)
                self.assertEqual(f.store.read()["request"]["state"], "cancelled")

    def test_new_input_after_claim_prevents_started(self):
        """已领取但尚未开始时，宿主输入事件作废旧许可。

        @return: None。
        """
        f = ProjectFixture(self)
        prepared = runtime.prepare(f.store, f.client, f.input, "1")
        request_id = prepared["requestId"]
        f.store.change(request_id, lambda request, state: request.update(state="queued", queueId="queue"))
        receipt = runtime.claim(f.store, f.client, request_id)["receipt"]["id"]
        with patch("flower_confirmation_runtime.codex.hook_frontend", return_value=None):
            codex_event({"cwd": str(f.root), "session_id": f.session, "turn_id": str(uuid4()),
                         "hook_event_name": "UserPromptSubmit", "prompt": "暂停"})
        self.assertGreater(f.store.read()["inputSeq"], 0)
        with self.assertRaisesRegex(ValueError, "人工输入已变化"):
            runtime.record_result(f.store, f.client, request_id, receipt, "started")
        self.assertIsNone(f.store.read()["request"].get("execution"))

    def test_checkpoint_retains_unfinished_new_input(self):
        """准备边界停在完整行末，随后写完的输入仍被观察。

        @return: None。
        """
        f = ProjectFixture(self)
        file = f.root / "events.jsonl"
        file.write_bytes(b'{"old":true}\n{"new":')
        start = SessionLog.checkpoint(file)
        self.assertEqual(start["offset"], len(b'{"old":true}\n'))
        with file.open("ab") as stream:
            stream.write(b'true}\n')
        reader = SessionLog()
        reader.resume(start, [])
        records, _ = reader.read(file, [], lambda result, entry: result.append(entry))
        self.assertEqual(records, [{"new": True}])

    def test_input_wins_race_with_claim_and_started_lock(self):
        """锁内竞争先登记输入时，两端均拒绝旧领取或开始动作。

        @return: None。
        """
        for platform in ("claude", "codex"):
            for stage in ("claim", "started"):
                with self.subTest(platform=platform, stage=stage):
                    f = ProjectFixture(self, platform)
                    request_id = runtime.prepare(f.store, f.client, f.input, "1")["requestId"]
                    f.store.change(request_id, lambda request, state: request.update(state="queued", queueId="queue"))
                    if stage == "started":
                        receipt = runtime.claim(f.store, f.client, request_id)["receipt"]["id"]
                    change = f.store.change
                    received = []
                    def race(identifier, mutate):
                        if not received:
                            received.append(True)
                            f.client.human = str(uuid4())
                        return change(identifier, mutate)
                    with patch.object(f.store, "change", side_effect=race):
                        result = (runtime.claim(f.store, f.client, request_id) if stage == "claim" else
                                  runtime.record_result(f.store, f.client, request_id, receipt, "started"))
                    self.assertFalse(result["claimed" if stage == "claim" else "recorded"])
                    self.assertEqual(f.store.read()["inputSeq"], 1)
                    self.assertIsNone(f.store.read()["request"].get("execution"))

    def test_legacy_started_result_can_finish_before_new_prepare(self):
        """旧契约的已开始动作可以据实终结，新准备随后建立独立序号。

        @return: None。
        """
        f = ProjectFixture(self)
        previous = runtime.prepare(f.store, f.client, f.input, "1")["requestId"]
        receipt = str(uuid4())
        def legacy(state):
            request = state["request"]
            state.pop("inputSeq")
            request.pop("inputSeq")
            request["contract"]["version"] = 3
            request.update(state="consumed", receipt={"id": receipt}, execution={"state": "started"})
            return state
        f.store.update(legacy)
        with self.assertRaisesRegex(ValueError, "尚未记录终态"):
            runtime.prepare(f.store, f.client, f.input, "1")
        self.assertTrue(runtime.record_result(f.store, None, previous, receipt, "completed")["recorded"])
        current = runtime.prepare(f.store, f.client, f.input, "1")
        self.assertNotEqual(previous, current["requestId"])
        self.assertEqual(f.store.read()["request"]["inputSeq"], 0)


if __name__ == "__main__":
    unittest.main()
