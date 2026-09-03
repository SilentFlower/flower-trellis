"""task.py current 正常空状态契约测试。"""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
TASK_SCRIPT = ROOT / ".trellis/scripts/task.py"


class TaskCurrentQueryTest(unittest.TestCase):
    """验证无活动任务时 current 仍是成功查询。"""

    def run_current(self, root: Path, *args: str) -> subprocess.CompletedProcess[str]:
        """在隔离 Trellis 根运行 current 命令。"""
        env = {**os.environ, "TRELLIS_CONTEXT_ID": "codex_task_current_test"}
        return subprocess.run(
            ["python3", str(TASK_SCRIPT), "current", *args],
            cwd=root,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )

    def test_empty_current_json_returns_success(self) -> None:
        """JSON 用 null 表达无任务且退出码为 0。"""
        with tempfile.TemporaryDirectory(prefix="flower-current-json-") as temp:
            root = Path(temp)
            (root / ".trellis").mkdir()

            result = self.run_current(root, "--json")

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIsNone(json.loads(result.stdout)["current_task"])

    def test_empty_current_text_and_source_are_explicit(self) -> None:
        """文本和 source 模式都明确输出无任务。"""
        with tempfile.TemporaryDirectory(prefix="flower-current-text-") as temp:
            root = Path(temp)
            (root / ".trellis").mkdir()

            plain = self.run_current(root)
            source = self.run_current(root, "--source")

            self.assertEqual(plain.returncode, 0, plain.stderr)
            self.assertIn("No current task set", plain.stdout)
            self.assertEqual(source.returncode, 0, source.stderr)
            self.assertIn("Current task: (none)", source.stdout)


if __name__ == "__main__":
    unittest.main()
