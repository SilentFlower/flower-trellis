"""route_state.py 历史检查 mode 兼容测试。"""

from __future__ import annotations

import argparse
from contextlib import redirect_stdout
from importlib import util as importlib_util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock


PROJECT_ROOT = Path(__file__).resolve().parents[2]
SOURCE_HELPER = (
    PROJECT_ROOT
    / "vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/scripts/route_state.py"
)


class RouteStateCompatibilityTest(unittest.TestCase):
    """验证历史轻量 route 只做兼容归一化，不再绕过 Check-All。"""

    @classmethod
    def setUpClass(cls) -> None:
        """加载 route_state helper 模块。"""
        spec = importlib_util.spec_from_file_location("route_state_compat_test", SOURCE_HELPER)
        if spec is None or spec.loader is None:
            raise RuntimeError("无法加载 route_state.py")
        cls.module = importlib_util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)

    def test_legacy_check_modes_normalize_to_check_all(self) -> None:
        """旧 inline/subagent check mode 必须映射到统一 Check-All 入口。"""
        self.assertEqual(
            self.module._normalize_mode("check", "check-inline"),
            "check-all-inline",
        )
        self.assertEqual(
            self.module._normalize_mode("check", "check-subagent"),
            "check-all-subagent",
        )

    def test_legacy_runtime_decision_returns_canonical_mode(self) -> None:
        """旧 runtime decision 校验成功后只暴露 canonical mode。"""
        decision = {
            "target": "check",
            "mode": "check-inline",
            "source": "trellis-route",
            "scope": "task",
            "task": ".trellis/tasks/example",
        }

        normalized = self.module._normalized_decision(
            decision,
            "check",
            ".trellis/tasks/example",
        )

        self.assertIsNotNone(normalized)
        self.assertEqual(normalized["mode"], "check-all-inline")
        self.assertEqual(decision["mode"], "check-inline")

    def test_auto_route_requires_current_task_in_unfinished_queue(self) -> None:
        """其它任务的 running run 不得向当前任务提供 route 授权。"""
        with tempfile.TemporaryDirectory(prefix="flower-route-task-scope-") as temp:
            root = Path(temp)
            sessions = root / ".trellis/.runtime/sessions"
            runs = root / ".trellis/.runtime/auto-loop"
            sessions.mkdir(parents=True)
            runs.mkdir(parents=True)
            (sessions / "codex_test.json").write_text("{}\n", encoding="utf-8")
            run_path = runs / "auto-test.json"
            run_path.write_text(
                json.dumps({
                    "status": "running",
                    "route_authorization": {"implement": "subagent"},
                    "queue": [{"task": ".trellis/tasks/task-a", "status": "running",
                               "artifact_recovery": {"attempts": 2, "resolved": False}}],
                }),
                encoding="utf-8",
            )

            hit = self.module._auto_route_mode(
                root,
                "codex_test",
                ".trellis/tasks/task-a",
                "implement",
            )
            miss = self.module._auto_route_mode(
                root,
                "codex_test",
                ".trellis/tasks/task-b",
                "implement",
            )

            self.assertEqual(hit[0], "subagent")
            self.assertEqual(miss[0], None)
            self.assertEqual(miss[2], "auto-run-task-mismatch")

    def test_completed_auto_item_does_not_authorize_route(self) -> None:
        """已完成队列项不能继续提供临时 route 授权。"""
        with tempfile.TemporaryDirectory(prefix="flower-route-completed-") as temp:
            root = Path(temp)
            sessions = root / ".trellis/.runtime/sessions"
            runs = root / ".trellis/.runtime/auto-loop"
            sessions.mkdir(parents=True)
            runs.mkdir(parents=True)
            (sessions / "codex_test.json").write_text("{}\n", encoding="utf-8")
            (runs / "auto-test.json").write_text(
                json.dumps({
                    "status": "running",
                    "route_authorization": {"implement": "inline"},
                    "queue": [{"task": ".trellis/tasks/task-a", "status": "completed"}],
                }),
                encoding="utf-8",
            )

            mode, _, reason = self.module._auto_route_mode(
                root,
                "codex_test",
                ".trellis/tasks/task-a",
                "implement",
            )

            self.assertIsNone(mode)
            self.assertEqual(reason, "auto-run-task-mismatch")

    def test_corrupt_session_prevents_auto_fallback_and_overwrite(self) -> None:
        """当前 session 损坏时不读取其它 run，也不覆盖证据。"""
        with tempfile.TemporaryDirectory(prefix="flower-route-corrupt-") as temp:
            root = Path(temp)
            session = root / ".trellis/.runtime/sessions/codex_test.json"
            session.parent.mkdir(parents=True)
            session.write_text("{broken", encoding="utf-8")

            mode, path, reason = self.module._auto_route_mode(
                root,
                "codex_test",
                ".trellis/tasks/task-a",
                "implement",
            )

            self.assertIsNone(mode)
            self.assertEqual(path, session)
            self.assertEqual(reason, "session-runtime-corrupt")
            self.assertEqual(session.read_text(encoding="utf-8"), "{broken")

    def test_corrupt_session_bound_run_prevents_healthy_run_fallback(self) -> None:
        """session 显式绑定的 run 损坏时不得改用其它健康 run。"""
        with tempfile.TemporaryDirectory(prefix="flower-route-bound-run-corrupt-") as temp:
            root = Path(temp)
            sessions = root / ".trellis/.runtime/sessions"
            runs = root / ".trellis/.runtime/auto-loop"
            sessions.mkdir(parents=True)
            runs.mkdir(parents=True)
            (sessions / "codex_test.json").write_text(
                json.dumps({"current_auto_run": "auto-bad"}),
                encoding="utf-8",
            )
            bad_run = runs / "auto-bad.json"
            bad_run.write_text("{broken", encoding="utf-8")
            (runs / "auto-good.json").write_text(
                json.dumps({
                    "status": "running",
                    "route_authorization": {"implement": "inline"},
                    "queue": [{"task": ".trellis/tasks/task-a", "status": "running"}],
                }),
                encoding="utf-8",
            )

            mode, path, reason = self.module._auto_route_mode(
                root,
                "codex_test",
                ".trellis/tasks/task-a",
                "implement",
            )

            self.assertIsNone(mode)
            self.assertEqual(path, bad_run)
            self.assertEqual(reason, "session-auto-run-corrupt")
            self.assertEqual(bad_run.read_text(encoding="utf-8"), "{broken")

    def test_atomic_route_write_preserves_old_file_on_replace_failure(self) -> None:
        """route runtime 原子替换失败时保留旧文件。"""
        with tempfile.TemporaryDirectory(prefix="flower-route-atomic-") as temp:
            path = Path(temp) / "route.json"
            path.write_text('{"old": true}\n', encoding="utf-8")
            with mock.patch.object(self.module.os, "replace", side_effect=OSError("failed")):
                with self.assertRaises(OSError):
                    self.module._write_json(path, {"new": True})
            self.assertEqual(path.read_text(encoding="utf-8"), '{"old": true}\n')

    def test_read_only_preview_preserves_state_and_uses_explicit_task(self) -> None:
        """预检不同任务不能复用旧任务决策或写 session，缺省时才取 runner 候选。"""
        with tempfile.TemporaryDirectory(prefix="flower-route-preview-") as temp:
            root = Path(temp)
            task_ref = ".trellis/tasks/queued"
            task = root / task_ref
            task.mkdir(parents=True)
            (task / "task.json").write_text('{}\n', encoding="utf-8")
            session = root / ".trellis/.runtime/sessions/codex_test.json"
            session.parent.mkdir(parents=True)
            session.write_text(json.dumps({
                "current_task": ".trellis/tasks/old",
                "route_decisions": {"check": {
                    "task": ".trellis/tasks/old", "target": "check", "scope": "task",
                    "source": "trellis-route", "mode": "check-all-subagent",
                }},
            }), encoding="utf-8")
            pref = root / ".trellis/.route-prefs.tmp"
            for mode, origin in (("check-inline", "route-prefs"), (None, "auto-loop")):
                if mode:
                    pref.write_text(f"check={mode}\n", encoding="utf-8")
                elif pref.exists():
                    pref.unlink()
                before = {str(p): p.read_bytes() for p in root.rglob('*') if p.is_file()}
                args = self.module.build_parser().parse_args([
                    "resolve", "--target", "check", "--read-only", "--task", task_ref,
                    "--auto-mode", "check-all-inline", "--verbose",
                ])
                with mock.patch.object(self.module, "_repo_root", return_value=root), mock.patch.object(
                    self.module, "_current_task",
                    return_value=(".trellis/tasks/old", "session:codex_test", "codex_test"),
                ), mock.patch.object(self.module, "_auto_route_mode") as auto_lookup:
                    output = io.StringIO()
                    with redirect_stdout(output):
                        self.module.resolve_route(args)
                result = json.loads(output.getvalue())
                self.assertEqual(result["origin"], origin)
                self.assertEqual(result["mode"], "check-all-inline")
                self.assertEqual(result["task"], task_ref)
                self.assertFalse(result["wrote_runtime"])
                auto_lookup.assert_not_called()
                self.assertEqual(before, {str(p): p.read_bytes() for p in root.rglob('*') if p.is_file()})

    def test_preview_rejects_invalid_scope_and_does_not_grant_write_authorization(self) -> None:
        """显式任务与候选仅用于只读预检；非法路径和模式不能产生有效路由。"""
        with tempfile.TemporaryDirectory(prefix="flower-route-preview-invalid-") as temp:
            root = Path(temp)
            task = root / ".trellis/tasks/valid"
            task.mkdir(parents=True)
            (task / "task.json").write_text('{}\n', encoding="utf-8")
            (root / ".trellis/tasks/link").symlink_to(task, target_is_directory=True)
            cases = [
                (["--task", ".trellis/tasks/valid"], "preview-requires-read-only"),
                (["--auto-mode", "inline"], "preview-requires-read-only"),
                (["--read-only", "--auto-mode", "check-all-inline"], "invalid-auto-route-mode"),
            ]
            for task_ref in (str(task), "valid", ".trellis/tasks/missing", ".trellis/tasks/../outside", ".trellis/tasks/link"):
                cases.append((["--read-only", "--task", task_ref], "invalid-task-path"))
            for extra, reason in cases:
                with self.subTest(extra=extra), mock.patch.object(self.module, "_repo_root", return_value=root), mock.patch.object(
                    self.module, "_current_task", return_value=(None, None, None),
                ):
                    args = self.module.build_parser().parse_args(["resolve", "--target", "implement", *extra])
                    output = io.StringIO()
                    with redirect_stdout(output):
                        self.module.resolve_route(args)
                    self.assertEqual(json.loads(output.getvalue())["reason"], reason)
            self.assertFalse((root / ".trellis/.runtime").exists())

    def test_no_task_preference_read_write_does_not_use_session(self) -> None:
        """无任务偏好读写不得依赖 current task 或 session runtime。"""
        with tempfile.TemporaryDirectory(prefix="flower-route-pref-") as temp:
            root = Path(temp)
            (root / ".trellis").mkdir()
            write_args = argparse.Namespace(
                target="implement",
                mode="subagent",
                verbose=False,
            )
            read_args = argparse.Namespace(target="implement", verbose=False)

            with mock.patch.object(self.module, "_repo_root", return_value=root):
                write_output = io.StringIO()
                with redirect_stdout(write_output):
                    write_code = self.module.write_pref(write_args)
                read_output = io.StringIO()
                with redirect_stdout(read_output):
                    read_code = self.module.read_pref(read_args)

            self.assertEqual(write_code, 0)
            self.assertEqual(read_code, 0)
            self.assertEqual(json.loads(write_output.getvalue())["status"], "written")
            self.assertEqual(json.loads(read_output.getvalue())["mode"], "subagent")
            self.assertFalse((root / ".trellis/.runtime/sessions").exists())

    def test_invalid_preference_mode_is_rejected(self) -> None:
        """非法个人偏好不得写入配置文件。"""
        with tempfile.TemporaryDirectory(prefix="flower-route-pref-invalid-") as temp:
            root = Path(temp)
            (root / ".trellis").mkdir()
            args = argparse.Namespace(target="implement", mode="check-all-inline", verbose=False)

            with mock.patch.object(self.module, "_repo_root", return_value=root):
                output = io.StringIO()
                with redirect_stdout(output):
                    code = self.module.write_pref(args)

            self.assertEqual(code, 0)
            self.assertEqual(json.loads(output.getvalue())["reason"], "invalid-mode")
            self.assertFalse((root / ".trellis/.route-prefs.tmp").exists())

    def test_atomic_preference_write_preserves_old_file_on_replace_failure(self) -> None:
        """偏好原子替换失败时必须保留旧文件。"""
        with tempfile.TemporaryDirectory(prefix="flower-route-pref-atomic-") as temp:
            root = Path(temp)
            path = root / ".trellis/.route-prefs.tmp"
            path.parent.mkdir()
            path.write_text("implement=inline\n", encoding="utf-8")

            with mock.patch.object(self.module.os, "replace", side_effect=OSError("failed")):
                with self.assertRaises(OSError):
                    self.module._write_prefs(root, {"implement": "subagent"})

            self.assertEqual(path.read_text(encoding="utf-8"), "implement=inline\n")


if __name__ == "__main__":
    unittest.main()
