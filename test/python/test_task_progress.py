"""task_progress.py 候选扫描诊断测试。"""

from __future__ import annotations

from argparse import Namespace
from contextlib import redirect_stdout
from importlib import util as importlib_util
from io import StringIO
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "vendor/skill-garden/.trellis/0.6/scripts/task_progress.py"


class TaskProgressDiagnosticsTest(unittest.TestCase):
    """验证健康候选与损坏诊断可以同时返回。"""

    @classmethod
    def setUpClass(cls) -> None:
        """加载 vendor task_progress 模块。"""
        spec = importlib_util.spec_from_file_location("task_progress_test", SOURCE)
        if spec is None or spec.loader is None:
            raise RuntimeError("无法加载 task_progress.py")
        cls.module = importlib_util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)

    def write_task(self, root: Path, name: str, data: dict | str) -> None:
        """写入候选任务元数据。"""
        task_dir = root / ".trellis/tasks" / name
        task_dir.mkdir(parents=True)
        value = data if isinstance(data, str) else json.dumps(data)
        (task_dir / "task.json").write_text(value, encoding="utf-8")

    def test_scan_returns_valid_invalid_and_warning_groups(self) -> None:
        """健康进度、坏 schema 和坏 task.json 分别进入对应列表。"""
        with tempfile.TemporaryDirectory(prefix="flower-progress-") as temp:
            root = Path(temp)
            self.write_task(root, "healthy", {
                "status": "in_progress",
                "progress": {
                    "updatedAt": "2026-07-23T00:00:00Z",
                    "completedSteps": ["plan"],
                    "partialStep": None,
                    "nextStep": "implement",
                    "notes": "",
                },
            })
            self.write_task(root, "invalid-progress", {
                "status": "in_progress",
                "progress": {"nextStep": None},
            })
            self.write_task(root, "invalid-json", "{broken")
            self.write_task(root, "completed", {
                "status": "completed",
                "completedAt": "2026-08-02",
                "progress": {
                    "updatedAt": "2026-08-02T00:00:00Z",
                    "completedSteps": ["push"],
                    "partialStep": None,
                    "nextStep": "finish-work archive",
                    "notes": "",
                },
            })

            candidates, invalid, warnings = self.module._progress_candidates(root)

            self.assertEqual(
                [item["task"] for item in candidates],
                [".trellis/tasks/completed", ".trellis/tasks/healthy"],
            )
            self.assertEqual(candidates[0]["taskStatus"], "completed")
            self.assertEqual(invalid[0]["task"], ".trellis/tasks/invalid-progress")
            self.assertEqual(invalid[0]["reason"], "invalid-progress-schema")
            self.assertEqual(warnings[0]["task"], ".trellis/tasks/invalid-json")
            self.assertEqual(warnings[0]["reason"], "invalid-task-json")

    def test_only_invalid_progress_keeps_no_current_task_status(self) -> None:
        """仅有损坏候选时不自动选择任务，但诊断不会消失。"""
        with tempfile.TemporaryDirectory(prefix="flower-progress-invalid-") as temp:
            root = Path(temp)
            self.write_task(root, "invalid-progress", {
                "status": "in_progress",
                "progress": {"nextStep": ""},
            })

            candidates, invalid, warnings = self.module._progress_candidates(root)

            self.assertEqual(candidates, [])
            self.assertEqual(len(invalid), 1)
            self.assertEqual(warnings, [])

    def test_invalid_write_keeps_task_json_unchanged(self) -> None:
        """非法 progress schema 必须在写盘前失败。"""
        with tempfile.TemporaryDirectory(prefix="flower-progress-write-") as temp:
            root = Path(temp)
            self.write_task(root, "current", {"status": "in_progress"})
            task_dir = root / ".trellis/tasks/current"
            task_json = task_dir / "task.json"
            before = task_json.read_bytes()
            args = Namespace(
                task=".trellis/tasks/current",
                progress_json=json.dumps({"nextStep": "implement"}),
                json=True,
            )

            with mock.patch.object(self.module, "_resolve_task_dir", return_value=task_dir):
                with redirect_stdout(StringIO()):
                    result = self.module.cmd_write(args, root)

            self.assertEqual(result, 1)
            self.assertEqual(task_json.read_bytes(), before)

    def test_atomic_replace_failure_keeps_task_json_unchanged(self) -> None:
        """原子替换失败时旧 task.json 与目录内容保持不变。"""
        with tempfile.TemporaryDirectory(prefix="flower-progress-atomic-") as temp:
            root = Path(temp)
            self.write_task(root, "current", {"status": "in_progress"})
            task_dir = root / ".trellis/tasks/current"
            task_json = task_dir / "task.json"
            before = task_json.read_bytes()
            progress = {
                "updatedAt": "2026-07-23T00:00:00Z",
                "completedSteps": ["plan"],
                "partialStep": None,
                "nextStep": "implement",
                "notes": "",
            }
            args = Namespace(
                task=".trellis/tasks/current",
                progress_json=json.dumps(progress),
                json=True,
            )

            with mock.patch.object(self.module, "_resolve_task_dir", return_value=task_dir):
                with mock.patch.object(self.module.os, "replace", side_effect=OSError("boom")):
                    with redirect_stdout(StringIO()):
                        result = self.module.cmd_write(args, root)

            self.assertEqual(result, 1)
            self.assertEqual(task_json.read_bytes(), before)
            self.assertEqual(list(task_dir.glob(".task.json.*.tmp")), [])

    def test_complete_writes_progress_and_status_atomically(self) -> None:
        """最终 push 只用一次原子写入完成进度与 completed 状态。"""
        with tempfile.TemporaryDirectory(prefix="flower-progress-complete-") as temp:
            root = Path(temp)
            self.write_task(root, "current", {
                "status": "in_progress",
                "completedAt": None,
            })
            task_dir = root / ".trellis/tasks/current"
            progress = {
                "updatedAt": "2026-08-02T00:00:00Z",
                "completedSteps": ["business push", "progress sync"],
                "partialStep": None,
                "nextStep": "finish-work archive",
                "notes": "",
            }
            args = Namespace(
                task=".trellis/tasks/current",
                progress_json=json.dumps(progress),
                complete=True,
                json=True,
            )

            with mock.patch.object(self.module, "_resolve_task_dir", return_value=task_dir):
                with redirect_stdout(StringIO()):
                    result = self.module.cmd_write(args, root)

            data = json.loads((task_dir / "task.json").read_text(encoding="utf-8"))
            self.assertEqual(result, 0)
            self.assertEqual(data["status"], "completed")
            self.assertRegex(data["completedAt"], r"^\d{4}-\d{2}-\d{2}$")
            self.assertEqual(data["progress"], progress)

    def test_complete_write_failure_keeps_status_and_progress_unchanged(self) -> None:
        """最终原子写失败时不得留下 completed 或半份 progress。"""
        with tempfile.TemporaryDirectory(prefix="flower-progress-complete-fail-") as temp:
            root = Path(temp)
            self.write_task(root, "current", {
                "status": "in_progress",
                "completedAt": None,
            })
            task_dir = root / ".trellis/tasks/current"
            task_json = task_dir / "task.json"
            before = task_json.read_bytes()
            progress = {
                "updatedAt": "2026-08-02T00:00:00Z",
                "completedSteps": ["business push"],
                "partialStep": None,
                "nextStep": "finish-work archive",
                "notes": "",
            }
            args = Namespace(
                task=".trellis/tasks/current",
                progress_json=json.dumps(progress),
                complete=True,
                json=True,
            )

            with mock.patch.object(self.module, "_resolve_task_dir", return_value=task_dir):
                with mock.patch.object(self.module.os, "replace", side_effect=OSError("boom")):
                    with redirect_stdout(StringIO()):
                        result = self.module.cmd_write(args, root)

            self.assertEqual(result, 1)
            self.assertEqual(task_json.read_bytes(), before)
            self.assertEqual(list(task_dir.glob(".task.json.*.tmp")), [])

    def test_complete_preserves_active_session_pointer(self) -> None:
        """completed 是待归档活动态，最终 progress 写入不能清理 session 指针。"""
        with tempfile.TemporaryDirectory(prefix="flower-progress-session-") as temp:
            root = Path(temp)
            self.write_task(root, "current", {"status": "in_progress", "completedAt": None})
            task_dir = root / ".trellis/tasks/current"
            session_file = root / ".trellis/.runtime/sessions/session-test.json"
            session_file.parent.mkdir(parents=True)
            session_file.write_text(
                json.dumps({"task": ".trellis/tasks/current"}),
                encoding="utf-8",
            )
            before = session_file.read_bytes()
            progress = {
                "updatedAt": "2026-08-02T00:00:00Z",
                "completedSteps": ["business push"],
                "partialStep": None,
                "nextStep": "finish-work archive",
                "notes": "",
            }
            args = Namespace(
                task=".trellis/tasks/current",
                progress_json=json.dumps(progress),
                complete=True,
                json=True,
            )

            with mock.patch.object(self.module, "_resolve_task_dir", return_value=task_dir):
                with redirect_stdout(StringIO()):
                    result = self.module.cmd_write(args, root)

            self.assertEqual(result, 0)
            self.assertEqual(session_file.read_bytes(), before)

    def test_partial_write_does_not_complete_task(self) -> None:
        """未带 --complete 的 partial progress 保持 in_progress。"""
        with tempfile.TemporaryDirectory(prefix="flower-progress-partial-") as temp:
            root = Path(temp)
            self.write_task(root, "current", {"status": "in_progress", "completedAt": None})
            task_dir = root / ".trellis/tasks/current"
            progress = {
                "updatedAt": "2026-08-02T00:00:00Z",
                "completedSteps": ["repo-a"],
                "partialStep": "repo-b push failed",
                "nextStep": "retry repo-b",
                "notes": "partial",
            }
            args = Namespace(
                task=".trellis/tasks/current",
                progress_json=json.dumps(progress),
                complete=False,
                json=True,
            )

            with mock.patch.object(self.module, "_resolve_task_dir", return_value=task_dir):
                with redirect_stdout(StringIO()):
                    result = self.module.cmd_write(args, root)

            data = json.loads((task_dir / "task.json").read_text(encoding="utf-8"))
            self.assertEqual(result, 0)
            self.assertEqual(data["status"], "in_progress")
            self.assertIsNone(data["completedAt"])

    def test_reopen_preserves_progress_and_clears_completed_at(self) -> None:
        """显式 reopen 只反转状态，不删除可审计进度。"""
        with tempfile.TemporaryDirectory(prefix="flower-progress-reopen-") as temp:
            root = Path(temp)
            progress = {
                "updatedAt": "2026-08-02T00:00:00Z",
                "completedSteps": ["push"],
                "partialStep": None,
                "nextStep": "finish-work archive",
                "notes": "",
            }
            self.write_task(root, "current", {
                "status": "completed",
                "completedAt": "2026-08-02",
                "progress": progress,
            })
            task_dir = root / ".trellis/tasks/current"
            args = Namespace(task=".trellis/tasks/current", json=True)

            with mock.patch.object(self.module, "_resolve_task_dir", return_value=task_dir):
                with redirect_stdout(StringIO()):
                    result = self.module.cmd_reopen(args, root)

            data = json.loads((task_dir / "task.json").read_text(encoding="utf-8"))
            self.assertEqual(result, 0)
            self.assertEqual(data["status"], "in_progress")
            self.assertIsNone(data["completedAt"])
            self.assertEqual(data["progress"], progress)


if __name__ == "__main__":
    unittest.main()
