"""迁移后状态机、完整展示、独立入口和生命周期的行为回归。"""

import copy
import json
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from confirmation_fixture import ASSETS, ProjectFixture, write_json
from flower_confirmation_runtime import runtime
from flower_confirmation_runtime.store import ConfirmationStore, cancel_project, wake_id, wake_message


class ProjectConfirmationTest(unittest.TestCase):
    """原 store/runtime 套件的正式行为迁移。"""

    def ready(self, platform="codex"):
        """准备一秒测试请求及已完成展示。

        @param platform: 测试平台。
        @return: 隔离项目及准备结果。
        """
        fixture = ProjectFixture(self, platform)
        prepared = runtime.prepare(fixture.store, fixture.client, fixture.input, "1")
        fixture.client.turn["status"] = "completed"
        return fixture, prepared

    def test_full_flow_claim_and_started_are_single_use_on_both_platforms(self):
        """两端完整流程只领取和开始一次。"""
        for platform in ("codex", "claude"):
            with self.subTest(platform=platform):
                f, prepared = self.ready(platform)
                result = runtime.wait(f.store, f.client, prepared["requestId"])
                self.assertEqual(result["state"], "queued")
                self.assertEqual(runtime.wait(f.store, f.client, result["id"])["state"], "duplicate_worker")
                claimed = runtime.claim(f.store, f.client, result["id"])
                self.assertEqual(claimed["action"], "implement")
                self.assertEqual(claimed["source"], "policy_timeout")
                self.assertEqual(claimed["context"]["body"], prepared["display"].split("\n\n后台确认：")[0])
                self.assertFalse(runtime.claim(f.store, f.client, result["id"])["claimed"])
                receipt = claimed["receipt"]["id"]
                self.assertTrue(runtime.record_result(f.store, f.client, result["id"], receipt, "started")["recorded"])
                self.assertFalse(runtime.record_result(f.store, f.client, result["id"], receipt, "started")["recorded"])
                self.assertTrue(runtime.record_result(f.store, None, result["id"], receipt, "completed")["recorded"])
                self.assertEqual(f.client.added, [result["id"]])

    def test_large_input_keeps_state_compact_and_returns_full_claim_context(self):
        """较大的结构化输入可以准备并领取；状态文件只保留证明摘要。"""
        f = ProjectFixture(self)
        findings = [{"id": f"CHK-{index:05}", "status": "resolved"} for index in range(12000)]
        findings[0]["status"] = "pending"
        body = "完整正文。" + ("a" * (64 * 1024))
        write_json(f.root / f.input, {"kind": "check", "task": f.task, "body": body,
                                      "reportVersion": "1", "dispositionVersion": "1", "findings": findings})
        self.assertGreater((f.root / f.input).stat().st_size, 512 * 1024)
        prepared = runtime.prepare(f.store, f.client, f.input, "1")
        self.assertTrue(prepared["prepared"])
        self.assertLess(f.store.file.stat().st_size, 4096)
        f.client.text = prepared["display"]
        f.client.turn["status"] = "completed"
        queued = runtime.wait(f.store, f.client, prepared["requestId"])
        self.assertEqual(queued["state"], "queued")
        result = runtime.claim(f.store, f.client, queued["id"])
        self.assertTrue(result["claimed"])
        self.assertEqual(result["context"]["body"], body)
        self.assertEqual(result["context"]["findings"], findings)

    def test_display_deadline_is_independent_of_claim_deadline(self):
        """展示阶段使用独立期限；尚未展示时不会入队。"""
        f = ProjectFixture(self)
        prepared = runtime.prepare(f.store, f.client, f.input, "1")
        with patch.object(runtime, "DISPLAY_BUDGET", 0):
            stopped = runtime.wait(f.store, f.client, prepared["requestId"])
        self.assertEqual(stopped["error"], "display_completion_unverified")
        self.assertEqual(f.client.added, [])

    def test_display_is_required_and_only_heading_blank_lines_are_normalized(self):
        """原有展示匹配边界在 Python 中等价。"""
        f, prepared = self.ready()
        request = f.store.read()["request"]
        for text in ("正文缺失", prepared["display"].replace("等待 1 秒", "等待 2 秒"),
                     prepared["display"].replace("完整正文。", "完整正文。\n\n")):
            f.client.text = text
            with self.assertRaisesRegex(ValueError, "完整展示"):
                runtime._validate(f.store, f.client, request, "display")
        f.client.text = prepared["display"].replace("# 确认材料\n\n", "# 确认材料\n")
        runtime._validate(f.store, f.client, request, "display")
        for before, after in (("```\n# 标题\n\n代码\n```", "```\n# 标题\n代码\n```"),
                              ("段落\n\n正文", "段落\n正文")):
            self.assertNotEqual(runtime._normalize_display(before), runtime._normalize_display(after))

    def test_timer_starts_after_completed_display_and_ignores_wall_clock_jumps(self):
        """完成展示前维持 prepared，真实等待沿用单调时钟。"""
        f = ProjectFixture(self)
        result = runtime.prepare(f.store, f.client, f.input, "1")
        stopped = threading.Event()
        completed = []
        worker = threading.Thread(target=lambda: completed.append(runtime.wait(f.store, f.client, result["requestId"], stopped.is_set)))
        worker.start()
        try:
            time.sleep(0.15)
            self.assertEqual(f.store.read()["request"]["state"], "prepared")
            self.assertIsNone(f.store.read()["request"]["deadline"])
            start = time.monotonic()
            f.client.turn["status"] = "completed"
            with patch.object(runtime, "now_ms", return_value=10 ** 15):
                worker.join(4)
            self.assertFalse(worker.is_alive())
            self.assertGreaterEqual(time.monotonic() - start, 1)
            self.assertEqual(completed[0]["state"], "queued")
        finally:
            stopped.set()
            worker.join(4)

    def test_idle_wait_observations_do_not_contend_with_state_writer(self):
        """空轮询跨过活锁，新人工事件仍使旧请求失效。"""
        f, prepared = self.ready()
        f.client.turn["status"] = "inProgress"
        lock = f.store.file.with_name(f.store.file.name + ".lock")
        snapshot = f.client.snapshot
        human_event = str(uuid4())
        polls = 0

        def observe():
            nonlocal polls
            polls += 1
            if polls == 1:
                lock.mkdir()
                write_json(lock / "owner.json", {"pid": os.getpid(), "token": str(uuid4())})
            if polls == 4:
                shutil.rmtree(str(lock))
                return {**snapshot(), "humanEvents": [human_event]}
            return snapshot()

        f.client.snapshot = observe
        try:
            result = runtime.wait(f.store, f.client, prepared["requestId"])
        finally:
            shutil.rmtree(str(lock), ignore_errors=True)
        self.assertEqual(polls, 4)
        self.assertEqual(result["state"], "cancelled")
        self.assertEqual(result["error"], "user_replied")
        self.assertEqual(f.store.read()["lastHumanMessageId"], human_event)
        self.assertEqual(f.client.added, [])

    def test_changes_and_new_input_invalidate_before_dispatch_or_started(self):
        """材料、策略与输入代次的竞争拒绝旧动作。"""
        for mutation in ("material", "policy", "human", "window"):
            with self.subTest(mutation=mutation):
                f, prepared = self.ready()
                if mutation == "material":
                    (f.root / f.task / "design.md").write_text("变化", encoding="utf-8")
                elif mutation == "policy":
                    (f.root / ".trellis/config.yaml").write_text("confirmation_timeout:\n  enabled: false\n", encoding="utf-8")
                elif mutation == "human":
                    f.client.human = str(uuid4())
                else:
                    f.client.window_valid = False
                result = runtime.wait(f.store, f.client, prepared["requestId"])
                self.assertIn(result["state"], ("failed", "cancelled"))
                self.assertEqual(f.client.added, [])
        f, prepared = self.ready()
        runtime.wait(f.store, f.client, prepared["requestId"])
        claimed = runtime.claim(f.store, f.client, prepared["requestId"])
        f.store.update(lambda value: {**value, "generation": value["generation"] + 1})
        self.assertFalse(runtime.record_result(f.store, f.client, prepared["requestId"], claimed["receipt"]["id"], "started")["recorded"])

    def test_native_structure_error_invalidates_worker_permission(self):
        """原生消息结构异常也必须落盘失败状态，防止残留排队许可。"""
        f, prepared = self.ready()
        def invalid_snapshot():
            raise AttributeError("原生消息结构异常")
        f.client.snapshot = invalid_snapshot
        result = runtime.wait(f.store, f.client, prepared["requestId"])
        self.assertEqual(result["state"], "failed")
        self.assertEqual(f.store.read()["request"]["error"], "原生消息结构异常")

    def test_new_input_after_started_keeps_truthful_terminal_record(self):
        """已开始的副作用在输入变化后继续据实记账。"""
        f, prepared = self.ready()
        runtime.wait(f.store, f.client, prepared["requestId"])
        receipt = runtime.claim(f.store, f.client, prepared["requestId"])["receipt"]["id"]
        runtime.record_result(f.store, f.client, prepared["requestId"], receipt, "started")
        with self.assertRaisesRegex(ValueError, "尚未记录终态"):
            runtime.prepare(f.store, f.client, f.input, "1")
        cancel_project(f.root, "project_updated")
        self.assertTrue(runtime.record_result(f.store, None, prepared["requestId"], receipt, "interrupted")["recorded"])
        self.assertFalse(runtime.record_result(f.store, f.client, prepared["requestId"], receipt, "started")["recorded"])

    def test_cancel_replacement_unknown_delivery_and_signal_keep_single_delivery(self):
        """取消、替换、结果未知和信号均保持至多一次派发。"""
        f, prepared = self.ready()
        def unknown(request_id):
            f.client.added.append(request_id)
            raise TimeoutError("回执超时，结果未知")
        f.client.add = unknown
        result = runtime.wait(f.store, f.client, prepared["requestId"])
        self.assertEqual(result["state"], "delivery_unknown")
        self.assertEqual(len(f.client.added), 1)
        self.assertFalse(runtime.claim(f.store, f.client, result["id"])["claimed"])
        f, prepared = self.ready()
        result = runtime.wait(f.store, f.client, prepared["requestId"], lambda: True)
        self.assertEqual(result["state"], "cancelled")
        f, prepared = self.ready()
        runtime.cancel(f.store, request_id=prepared["requestId"])
        self.assertFalse(runtime.claim(f.store, f.client, prepared["requestId"])["claimed"])
        f.client.turn["status"] = "inProgress"
        newer = runtime.prepare(f.store, f.client, f.input, "1")
        self.assertFalse(runtime.claim(f.store, f.client, prepared["requestId"])["claimed"])
        self.assertEqual(f.store.read()["request"]["id"], newer["requestId"])

    def test_claim_requires_native_origin_and_current_window(self):
        """人工粘贴、错回合与原窗口失效均拒绝领取。"""
        for mutation in ("wake", "window", "human"):
            f, prepared = self.ready()
            runtime.wait(f.store, f.client, prepared["requestId"])
            if mutation == "wake":
                original = f.client.snapshot
                f.client.snapshot = lambda: {**original(), "wake": None}
            elif mutation == "window":
                f.client.window_valid = False
            else:
                f.client.human = str(uuid4())
            try:
                claimed = runtime.claim(f.store, f.client, prepared["requestId"])
                self.assertFalse(claimed["claimed"])
            except ValueError:
                self.assertEqual(f.store.read()["request"]["state"], "failed")

    def test_uninstall_does_not_recreate_runtime_and_help_has_no_side_effect(self):
        """卸载中的 worker 和空查询遵守原目录生命周期。"""
        f, prepared = self.ready()
        shutil.rmtree(str(f.root / ".trellis"))
        result = runtime.cancel(f.store, request_id=prepared["requestId"])
        self.assertEqual(result["state"], "absent")
        self.assertFalse((f.root / ".trellis").exists())
        result = subprocess.run([sys.executable, "-X", "utf8", str(ASSETS / "flower_confirmation.py"), "--help", "--target", str(f.root / "missing")],
                                env=f.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, encoding="utf-8", timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((f.root / "missing").exists())

    def test_state_limits_symlinks_and_missing_state_are_fail_closed(self):
        """损坏、过大、错身份和软链状态均拒绝。"""
        f, prepared = self.ready()
        good = f.store.file.read_bytes()
        for raw in (b"{}", b"broken", b" " * (1024 * 1024 + 1)):
            f.store.file.write_bytes(raw)
            with self.assertRaises(ValueError):
                f.store.read()
        f.store.file.write_bytes(good)
        if os.name != "nt":
            outside = f.root / "outside.json"
            outside.write_bytes(good)
            f.store.file.unlink()
            f.store.file.symlink_to(outside)
            with self.assertRaises(ValueError):
                f.store.read()

    def test_project_commands_run_without_node_npm_or_flower(self):
        """隔离 PATH 后真实项目入口仍执行帮助、查询、取消和策略。"""
        f = ProjectFixture(self)
        empty = f.root / "empty-bin"
        empty.mkdir()
        environment = {**f.env, "PATH": str(empty)}
        entry = str(f.scripts / "flower_confirmation.py")
        common = ["--platform", "codex", "--session", f.session]
        for command in (["status"], ["cancel"], ["prepare", "--input", f.input, "--seconds", "0"],
                        ["claim", "--request", str(uuid4())], ["result", "--request", str(uuid4()), "--receipt", str(uuid4()), "--state", "completed"]):
            result = subprocess.run([sys.executable, "-X", "utf8", entry, *command, *common], cwd=str(f.root), env=environment,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, encoding="utf-8", timeout=15)
            self.assertEqual(result.stderr, "")
            self.assertIsInstance(json.loads(result.stdout), dict)
        result = subprocess.run([sys.executable, "-X", "utf8", str(f.scripts / "flower_confirmation_hook.py"), "--entry"],
                                cwd=str(f.root), env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, encoding="utf-8", timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["entry"], [sys.executable, "-X", "utf8", entry])

    def test_full_internal_body_and_client_id_are_both_required(self):
        """完整正文、精确 client_id 与单消息结构共同确认来源。"""
        identifier = str(uuid4())
        item = {"type": "userMessage", "clientId": identifier, "content": [{"type": "text", "text": wake_message(identifier)}]}
        self.assertEqual(wake_id(item), identifier)
        for changed in ({**item, "clientId": str(uuid4())}, {**item, "content": item["content"] * 2},
                        {**item, "content": [{"type": "text", "text": wake_message(identifier) + "\n额外回复"}]}):
            self.assertIsNone(wake_id(changed))

    def test_check_policy_and_push_snapshots_preserve_original_plan(self):
        """Check 计数及 Push 的 HEAD、索引、内容与远端快照保持完整。"""
        f = ProjectFixture(self)
        f.material.update(kind="check", body="完整报告", reportVersion="1", dispositionVersion="1",
                          findings=[{"id": "CHK-001"}, {"id": "CHK-001"}, {"id": "DOC-001"}, {"id": "FBK-001", "status": "accepted"}])
        f.save()
        self.assertEqual(runtime.inspect_confirmation(f.store, f.input)["seconds"], 100)
        f.material["findings"].append({"id": "FBK-002"})
        f.save()
        self.assertEqual(runtime.inspect_confirmation(f.store, f.input)["seconds"], 130)
        environment = {**f.env, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}
        def git(*args):
            return subprocess.check_output(["git", "-C", str(f.root), *args], env=environment, stderr=subprocess.PIPE).decode("utf-8").strip()
        git("init", "-q")
        git("config", "user.name", "confirmation-test")
        git("config", "user.email", "confirmation@example.invalid")
        tracked = f.root / "tracked.txt"
        tracked.write_text("原文", encoding="utf-8")
        git("add", "tracked.txt")
        git("commit", "-qm", "测试基线")
        f.material = {"kind": "push", "task": f.task, "body": "精确提交计划", "mode": "commit-only",
                      "evidence": {"check": "passed", "spec": "no-op", "unresolvedRisks": 0},
                      "repositories": [{"root": ".", "branch": git("symbolic-ref", "--short", "HEAD"), "head": git("rev-parse", "HEAD"),
                                        "upstream": None, "message": "精确消息", "files": ["tracked.txt"]}]}
        f.save()
        original = runtime.inspect_confirmation(f.store, f.input)
        self.assertEqual(original["seconds"], 200)
        self.assertEqual(original["plan"]["mode"], "commit-only")
        tracked.write_text("新内容", encoding="utf-8")
        self.assertNotEqual(runtime.inspect_confirmation(f.store, f.input)["materialHash"], original["materialHash"])
        tracked.write_text("原文", encoding="utf-8")
        git("remote", "add", "origin", "https://example.invalid/readonly.git")
        self.assertNotEqual(runtime.inspect_confirmation(f.store, f.input)["materialHash"], original["materialHash"])
        f.material["evidence"]["unresolvedRisks"] = 1
        f.save()
        with self.assertRaisesRegex(ValueError, "风险"):
            runtime.inspect_confirmation(f.store, f.input)

    def test_uninstall_while_worker_is_queued_never_revives_directories(self):
        """真实后台线程在目录删除后撤销观察且保持目录缺失。"""
        f, prepared = self.ready()
        f.client.delivery_on_exit = False
        result = []
        queued, released, stopped = threading.Event(), threading.Event(), threading.Event()
        def notify(value):
            if value["event"] == "queued":
                # 固定目录删除发生在入队落盘与下一次观察之间，避免轮询读取干扰 Windows 文件共享。
                queued.set()
                released.wait(20)
        worker = threading.Thread(target=lambda: result.append(runtime.wait(
            f.store, f.client, prepared["requestId"], interrupted=stopped.is_set, notify=notify)))
        worker.start()
        try:
            self.assertTrue(queued.wait(20), repr(result))
            shutil.rmtree(str(f.root / ".trellis"))
            released.set()
            worker.join(5)
            self.assertFalse(worker.is_alive())
            self.assertEqual(result[0]["state"], "replaced")
            self.assertFalse((f.root / ".trellis").exists())
        finally:
            stopped.set()
            released.set()
            worker.join(5)

    def test_control_state_even_json_null_keeps_manual(self):
        """关闭、修复、损坏控制状态都保留人工边界。"""
        f = ProjectFixture(self)
        control = f.root / ".flower/trellis-control.json"
        control.parent.mkdir()
        for raw in ('null', '{"status":"disabled"}', '{"status":"repair-required"}', 'broken'):
            control.write_text(raw, encoding="utf-8")
            with self.assertRaises(ValueError):
                runtime.inspect_confirmation(f.store, f.input)

    def test_claude_pasted_notification_and_run_restart_revoke_old_permission(self):
        """迁移原 Claude 客户端的粘贴来源、重复输入和重启边界。"""
        from flower_confirmation_runtime.claude import ClaudeClient, record_event

        def record_linux_event(payload):
            return record_event(payload, platform="linux")
        f = ProjectFixture(self, "claude")
        transcript = f.root / (f.session + ".jsonl")
        prompt = str(uuid4())
        payload = {"cwd": str(f.root), "session_id": f.session, "transcript_path": str(transcript)}
        record_linux_event({**payload, "hook_event_name": "SessionStart"})
        event = {**payload, "hook_event_name": "UserPromptSubmit", "prompt_id": prompt, "prompt": "开始"}
        record_linux_event(event)
        generation = f.store.read()["generation"]
        record_linux_event(event)
        self.assertEqual(f.store.read()["generation"], generation)
        transcript.write_text(json.dumps({"type": "user", "sessionId": f.session, "promptId": prompt,
                                          "origin": {"kind": "human"}, "turnOrigin": "human", "message": {"content": "开始"}}) + "\n", encoding="utf-8")
        client = ClaudeClient(f.root, f.session, platform="linux")
        prepared = runtime.prepare(f.store, client, f.input, "1")
        request_id = prepared["requestId"]
        def queued(value):
            value["native"]["tasks"]["owned"] = request_id
            value["request"].update(state="queued", queueId="owned", claimDeadline=int(time.time() * 1000) + 100000)
            return value
        f.store.update(queued)
        pasted = str(uuid4())
        notice = "<task-notification>\n<task-id>owned</task-id>\n</task-notification>"
        record_linux_event({**payload, "hook_event_name": "UserPromptSubmit", "prompt_id": pasted, "prompt": notice})
        with transcript.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps({"type": "user", "sessionId": f.session, "promptId": pasted,
                                     "origin": {"kind": "human"}, "turnOrigin": "human", "message": {"content": notice}}) + "\n")
        with self.assertRaisesRegex(ValueError, "原生任务通知"):
            runtime.claim(f.store, ClaudeClient(f.root, f.session, platform="linux"), request_id)
        self.assertEqual(f.store.read()["request"]["state"], "cancelled")
        old_run = f.store.read()["native"]["runId"]
        record_linux_event({**payload, "hook_event_name": "SessionStart"})
        self.assertNotEqual(f.store.read()["native"]["runId"], old_run)
        record_linux_event({**payload, "hook_event_name": "SessionEnd"})
        with self.assertRaisesRegex(ValueError, "退出"):
            client.connect()

    def test_claude_claim_waits_for_exact_notification_transcript_flush(self):
        """Hook 先到、完整通知行后到时，单次 claim 等待精确来源证据。"""
        from flower_confirmation_runtime.claude import ClaudeClient
        f = ProjectFixture(self, "claude")
        transcript = f.root / (f.session + ".jsonl")
        prompt = str(uuid4())
        human = {"type": "user", "sessionId": f.session, "promptId": f.client.human, "origin": {"kind": "human"},
                 "turnOrigin": "human", "message": {"content": "开始"}}
        transcript.write_text(json.dumps(human) + "\n", encoding="utf-8")
        def active(value):
            value["native"].update(transcript=str(transcript), tasks={},
                                   turn={"id": f.client.human, "status": "inProgress"})
            return value
        f.store.update(active)
        client = ClaudeClient(f.root, f.session, platform="linux")
        request_id = runtime.prepare(f.store, client, f.input, "1")["requestId"]
        def queued(value):
            value["native"].update(transcript=str(transcript), tasks={"queue": request_id}, turn={"id": prompt, "status": "inProgress"},
                                   notification={"promptId": prompt, "taskId": "queue", "requestId": request_id})
            value["request"].update(state="queued", queueId="queue", claimDeadline=int(time.time() * 1000) + 100000)
            return value
        f.store.update(queued)
        client = ClaudeClient(f.root, f.session, platform="linux")
        self.assertTrue(client.snapshot()["notificationPending"])
        def flush():
            time.sleep(0.08)
            with transcript.open("a", encoding="utf-8") as stream:
                stream.write(json.dumps({"type": "user", "sessionId": f.session, "promptId": prompt,
                                         "origin": {"kind": "task-notification"}, "turnOrigin": "task_notification",
                                         "message": {"content": "<task-notification>\n<task-id>queue</task-id>\n</task-notification>"}}) + "\n")
        writer = threading.Thread(target=flush)
        writer.start()
        try:
            self.assertTrue(runtime.claim(f.store, client, request_id)["claimed"])
        finally:
            writer.join(3)

    def test_claude_prepare_requires_current_origin_and_checks_new_input_after_anchor(self):
        """在两种来源字段格式下，旧记录跳过，当前未知和随后人工输入阻止准备。"""
        from flower_confirmation_runtime.claude import ClaudeClient
        for platform in ("linux", "win32"):
            with self.subTest(platform=platform):
                f = ProjectFixture(self, "claude")
                client = ClaudeClient(f.root, f.session, platform="linux")
                client.platform = platform
                transcript = f.root / (f.session + ".jsonl")
                identity = {"pid": 10, "exe": "claude.exe", "created": "10"}
                prompt = f.client.human

                def active(value):
                    value["native"].update(transcript=str(transcript), frontend=identity,
                                           turn={"id": prompt, "status": "inProgress"})
                    return value

                f.store.update(active)
                entry = {"type": "user", "sessionId": f.session, "promptId": prompt,
                         "origin": {"kind": "beer"}, "message": {"content": "当前记录"}}
                old = {**entry, "promptId": str(uuid4()), "origin": {"kind": "peer"}, "turnOrigin": "peer"}
                human = {**entry, "origin": {"kind": "human"}}
                if platform == "linux":
                    human["turnOrigin"] = "human"

                def write(entries):
                    transcript.write_text("".join(json.dumps(item) + "\n" for item in entries), encoding="utf-8")

                with patch("flower_confirmation_runtime.claude.open_identity") as frontend:
                    frontend.return_value.identity = identity
                    frontend.return_value.exited.return_value = False
                    write([old, entry])
                    with self.assertRaisesRegex(ValueError, "当前回合缺少可核验"):
                        runtime.prepare(f.store, client, f.input, "1")
                    write([old, human, {**human, "promptId": str(uuid4())}])
                    with self.assertRaisesRegex(ValueError, "回合或人工输入已变化"):
                        runtime.prepare(f.store, client, f.input, "1")
                    client = ClaudeClient(f.root, f.session, platform="linux")
                    client.platform = platform
                    write([old, human])
                    self.assertTrue(runtime.prepare(f.store, client, f.input, "1")["prepared"])


if __name__ == "__main__":
    unittest.main()
