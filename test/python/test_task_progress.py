"""task_progress.py 候选扫描诊断测试。"""

from __future__ import annotations

from importlib import util as importlib_util
import json
from pathlib import Path
import tempfile
import unittest


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

            candidates, invalid, warnings = self.module._progress_candidates(root)

            self.assertEqual([item["task"] for item in candidates], [".trellis/tasks/healthy"])
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


if __name__ == "__main__":
    unittest.main()
