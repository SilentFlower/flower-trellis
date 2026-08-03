"""Pre-Check session 软偏好 helper 测试。"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = ROOT / ".trellis/scripts"
HELPER_SOURCE = ROOT / "vendor/skill-garden/.trellis/0.6/scripts/pre_check_state.py"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))


def _load_helper() -> types.ModuleType:
    """加载真实 helper 源且不在 vendor 目录生成 pycache。

    Returns:
        已执行的 helper 模块。
    """
    module = types.ModuleType("flower_pre_check_state")
    module.__file__ = str(HELPER_SOURCE)
    source = HELPER_SOURCE.read_text(encoding="utf-8")
    exec(compile(source, str(HELPER_SOURCE), "exec"), module.__dict__)
    return module


class PreCheckStateTest(unittest.TestCase):
    """验证 session 隔离、原子保留和损坏保护。"""

    def setUp(self) -> None:
        """创建隔离 Trellis 项目。"""
        self.temp = tempfile.TemporaryDirectory(prefix="flower-pre-check-")
        self.root = Path(self.temp.name)
        (self.root / ".trellis/tasks/task-a").mkdir(parents=True)
        (self.root / ".trellis/tasks/task-b").mkdir(parents=True)
        self.helper = _load_helper()

    def tearDown(self) -> None:
        """删除隔离项目。"""
        self.temp.cleanup()

    def _session_path(self, context_key: str) -> Path:
        """返回测试 session 文件路径。

        Args:
            context_key: 已解析的 context key。

        Returns:
            session runtime 文件路径。
        """
        return self.root / ".trellis/.runtime/sessions" / f"{context_key}.json"

    def _activate(self, context_key: str, task: str = ".trellis/tasks/task-a") -> Path:
        """写入带其它字段的活动任务 runtime。

        Args:
            context_key: session context key。
            task: 当前任务路径。

        Returns:
            已写入的 runtime 文件路径。
        """
        path = self._session_path(context_key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(
                {
                    "platform": "codex",
                    "current_task": task,
                    "current_run": None,
                    "route_decisions": {"implement": {"mode": "inline"}},
                }
            ),
            encoding="utf-8",
        )
        return path

    def _activate_untracked(self, context_key: str, work_id: str = "work-123") -> Path:
        """写入无任务事项 runtime。

        Args:
            context_key: session context key。
            work_id: 无任务事项 ID。

        Returns:
            已写入的 runtime 文件路径。
        """
        path = self._session_path(context_key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(
                {
                    "platform": "codex",
                    "current_task": None,
                    "untracked_flow": {
                        "version": 2,
                        "id": work_id,
                        "summary": "修复一个小问题",
                        "stage": "implement",
                    },
                    "route_decisions": {},
                }
            ),
            encoding="utf-8",
        )
        return path

    def test_hold_status_clear_preserve_other_runtime_fields(self) -> None:
        """写入和清理只影响 pre_check_preference 字段。"""
        path = self._activate("codex_hold")
        with mock.patch.dict(os.environ, {"TRELLIS_CONTEXT_ID": "codex_hold"}, clear=False):
            held = self.helper.set_pre_check_hold(self.root, "user-explicit")
            status = self.helper.read_pre_check_preference(self.root)
            resumed = self.helper.read_pre_check_preference(self.root)
            hint = self.helper.session_start_hint(self.root)
            cleared = self.helper.clear_pre_check_preference(self.root)
            missing = self.helper.read_pre_check_preference(self.root)

        self.assertEqual(held["status"], "held")
        self.assertEqual(status["status"], "hit")
        self.assertEqual(resumed["status"], "hit")
        self.assertEqual(hint, self.helper.SESSION_START_HINT)
        self.assertEqual(cleared["status"], "cleared")
        self.assertTrue(cleared["existed"])
        self.assertEqual(missing["reason"], "no-hold")
        runtime = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(runtime["route_decisions"], {"implement": {"mode": "inline"}})
        self.assertNotIn("pre_check_preference", runtime)

    def test_missing_runtime_does_not_guess_task_or_create_file(self) -> None:
        """runtime 完全缺失时不通过其它 session 猜测当前任务。"""
        path = self._session_path("codex_missing")
        with mock.patch.dict(os.environ, {"TRELLIS_CONTEXT_ID": "codex_missing"}, clear=False):
            status = self.helper.read_pre_check_preference(self.root)
            held = self.helper.set_pre_check_hold(self.root, "user-explicit")
            cleared = self.helper.clear_pre_check_preference(self.root)

        self.assertEqual(status["reason"], "no-current-work")
        self.assertEqual(held["reason"], "no-current-work")
        self.assertEqual(cleared["reason"], "no-current-work")
        self.assertFalse(path.exists())

    def test_follow_up_hold_does_not_cross_context_or_task(self) -> None:
        """同 session 可恢复，不同 session 或任务不继承。"""
        path = self._activate("codex_first")
        with mock.patch.dict(os.environ, {"TRELLIS_CONTEXT_ID": "codex_first"}, clear=False):
            held = self.helper.set_pre_check_hold(self.root, "follow-up-edit")
            self.assertEqual(held["status"], "held")

        with mock.patch.dict(os.environ, {"TRELLIS_CONTEXT_ID": "codex_second"}, clear=False):
            other_session = self.helper.read_pre_check_preference(self.root)
        self.assertEqual(other_session["status"], "miss")
        self.assertEqual(other_session["reason"], "session-task-mismatch")

        runtime = json.loads(path.read_text(encoding="utf-8"))
        runtime["current_task"] = ".trellis/tasks/task-b"
        path.write_text(json.dumps(runtime), encoding="utf-8")
        with mock.patch.dict(os.environ, {"TRELLIS_CONTEXT_ID": "codex_first"}, clear=False):
            other_task = self.helper.read_pre_check_preference(self.root)
            clear_other_task = self.helper.clear_pre_check_preference(self.root)
        self.assertEqual(other_task["reason"], "subject-mismatch")
        self.assertEqual(clear_other_task["reason"], "subject-mismatch")
        self.assertIn("pre_check_preference", json.loads(path.read_text(encoding="utf-8")))

    def test_untracked_hold_status_clear_is_bound_to_work_id(self) -> None:
        """无任务 hold 绑定 work id，并保留 session 其它字段。"""
        path = self._activate_untracked("codex_untracked")
        with mock.patch.dict(os.environ, {"TRELLIS_CONTEXT_ID": "codex_untracked"}, clear=False):
            held = self.helper.set_pre_check_hold(self.root, "follow-up-edit")
            status = self.helper.read_pre_check_preference(self.root)
            cleared = self.helper.clear_pre_check_preference(self.root)

        self.assertEqual(held["subject"], {"kind": "untracked", "id": "work-123"})
        self.assertEqual(status["status"], "hit")
        self.assertEqual(status["workId"], "work-123")
        self.assertTrue(cleared["existed"])
        runtime = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(runtime["untracked_flow"]["id"], "work-123")

    def test_legacy_v1_untracked_still_supports_hold(self) -> None:
        """旧 v1 游标在升级后仍可绑定 pre-check hold。"""
        path = self._activate_untracked("codex_untracked_v1")
        runtime = json.loads(path.read_text(encoding="utf-8"))
        runtime["untracked_flow"]["version"] = 1
        path.write_text(json.dumps(runtime), encoding="utf-8")

        with mock.patch.dict(os.environ, {"TRELLIS_CONTEXT_ID": "codex_untracked_v1"}, clear=False):
            held = self.helper.set_pre_check_hold(self.root, "user-explicit")

        self.assertEqual(held["subject"], {"kind": "untracked", "id": "work-123"})
        self.assertIn(
            "pre_check_preference",
            json.loads(path.read_text(encoding="utf-8")),
        )

    def test_untracked_hold_does_not_cross_work_item(self) -> None:
        """切换无任务事项后不得读取或清除旧 hold。"""
        path = self._activate_untracked("codex_untracked_switch")
        with mock.patch.dict(
            os.environ,
            {"TRELLIS_CONTEXT_ID": "codex_untracked_switch"},
            clear=False,
        ):
            held = self.helper.set_pre_check_hold(self.root, "user-explicit")
            self.assertEqual(held["status"], "held")
            runtime = json.loads(path.read_text(encoding="utf-8"))
            runtime["untracked_flow"]["id"] = "work-456"
            path.write_text(json.dumps(runtime), encoding="utf-8")
            status = self.helper.read_pre_check_preference(self.root)
            cleared = self.helper.clear_pre_check_preference(self.root)

        self.assertEqual(status["reason"], "subject-mismatch")
        self.assertEqual(cleared["reason"], "subject-mismatch")
        self.assertIn("pre_check_preference", json.loads(path.read_text(encoding="utf-8")))

    def test_legacy_task_hold_remains_readable(self) -> None:
        """旧版 task 字段 hold 升级后仍可读取。"""
        path = self._activate("codex_legacy")
        runtime = json.loads(path.read_text(encoding="utf-8"))
        runtime["pre_check_preference"] = {
            "version": 1,
            "task": ".trellis/tasks/task-a",
            "mode": "hold",
            "source": "user-explicit",
            "updated_at": "2026-07-31T00:00:00Z",
        }
        path.write_text(json.dumps(runtime), encoding="utf-8")

        with mock.patch.dict(os.environ, {"TRELLIS_CONTEXT_ID": "codex_legacy"}, clear=False):
            status = self.helper.read_pre_check_preference(self.root)

        self.assertEqual(status["status"], "hit")
        self.assertEqual(status["subject"], {"kind": "task", "id": ".trellis/tasks/task-a"})

    def test_corrupt_runtime_is_reported_and_never_overwritten(self) -> None:
        """损坏 runtime 返回结构化错误并保留原始证据。"""
        path = self._session_path("codex_corrupt")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("{broken", encoding="utf-8")

        with mock.patch.dict(os.environ, {"TRELLIS_CONTEXT_ID": "codex_corrupt"}, clear=False):
            status = self.helper.read_pre_check_preference(self.root)
            held = self.helper.set_pre_check_hold(self.root, "user-explicit")
            cleared = self.helper.clear_pre_check_preference(self.root)

        self.assertEqual(status["reason"], "session-runtime-corrupt")
        self.assertEqual(held["reason"], "session-runtime-corrupt")
        self.assertEqual(cleared["reason"], "session-runtime-corrupt")
        self.assertEqual(path.read_text(encoding="utf-8"), "{broken")

    def test_runtime_io_error_is_reported_without_write(self) -> None:
        """runtime 读取 I/O 错误不会退化为缺失或触发覆盖。"""
        path = self._activate("codex_io_error")
        before = path.read_text(encoding="utf-8")
        with (
            mock.patch.dict(os.environ, {"TRELLIS_CONTEXT_ID": "codex_io_error"}, clear=False),
            mock.patch.object(self.helper.Path, "read_text", side_effect=OSError("read failed")),
        ):
            status = self.helper.read_pre_check_preference(self.root)
            held = self.helper.set_pre_check_hold(self.root, "user-explicit")
            cleared = self.helper.clear_pre_check_preference(self.root)

        self.assertEqual(status["reason"], "session-runtime-io_error")
        self.assertEqual(held["reason"], "session-runtime-io_error")
        self.assertEqual(cleared["reason"], "session-runtime-io_error")
        self.assertEqual(path.read_text(encoding="utf-8"), before)

    def test_write_failure_is_reported_and_preserves_runtime(self) -> None:
        """原子写入失败时返回稳定错误并保留原 runtime。"""
        path = self._activate("codex_write_error")
        before = path.read_text(encoding="utf-8")
        with (
            mock.patch.dict(os.environ, {"TRELLIS_CONTEXT_ID": "codex_write_error"}, clear=False),
            mock.patch.object(self.helper, "_write_json", side_effect=OSError("write failed")),
        ):
            held = self.helper.set_pre_check_hold(self.root, "user-explicit")
            cleared = self.helper.clear_pre_check_preference(self.root)

        self.assertEqual(held["reason"], "runtime-write-failed")
        self.assertEqual(cleared["status"], "cleared")
        self.assertFalse(cleared["existed"])
        self.assertEqual(path.read_text(encoding="utf-8"), before)

    def test_invalid_source_is_rejected_without_write(self) -> None:
        """非法来源不会创建或修改偏好。"""
        path = self._activate("codex_invalid")
        before = path.read_text(encoding="utf-8")
        with mock.patch.dict(os.environ, {"TRELLIS_CONTEXT_ID": "codex_invalid"}, clear=False):
            result = self.helper.set_pre_check_hold(self.root, "unknown")
        self.assertEqual(result, {"status": "error", "reason": "invalid-source"})
        self.assertEqual(path.read_text(encoding="utf-8"), before)


if __name__ == "__main__":
    unittest.main()
