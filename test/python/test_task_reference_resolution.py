"""公共任务引用解析器测试。"""

from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = ROOT / ".trellis/scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from common.task_utils import (
    resolve_active_task_reference,
    resolve_task_reference,
    resolve_top_level_task_reference,
)


class TaskReferenceResolutionTest(unittest.TestCase):
    """验证任务引用支持形式与严格边界。"""

    def setUp(self) -> None:
        """创建隔离活动任务目录。"""
        self.temp = tempfile.TemporaryDirectory(prefix="flower-task-reference-")
        self.root = Path(self.temp.name)
        self.tasks = self.root / ".trellis/tasks"
        self.tasks.mkdir(parents=True)
        self.task = self.tasks / "09-03-cli-contract"
        self.write_task(self.task)

    def tearDown(self) -> None:
        """清理隔离目录。"""
        self.temp.cleanup()

    def write_task(self, task_dir: Path, *, closed: bool = False) -> None:
        """创建带合法 task.json 的活动或已关闭任务夹具。"""
        task_dir.mkdir(parents=True)
        data = {"status": "in_progress", "children": []}
        if closed:
            data = {
                "status": "completed",
                "children": [],
                "closeout": {
                    "status": "closed",
                    "closedAt": "2026-09-03T00:00:00Z",
                    "blockers": [],
                },
            }
        (task_dir / "task.json").write_text(
            json.dumps(data, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    def test_exact_short_relative_and_absolute_forms(self) -> None:
        """完整名、唯一短名、相对路径和绝对路径解析到同一目录。"""
        references = [
            "09-03-cli-contract",
            "cli-contract",
            ".trellis/tasks/09-03-cli-contract",
            str(self.task),
        ]

        resolved = [resolve_task_reference(value, self.root) for value in references]

        self.assertEqual(resolved, [self.task.resolve()] * len(references))

    def test_ambiguous_short_name_lists_sorted_candidates(self) -> None:
        """歧义短名按稳定顺序列出候选。"""
        self.write_task(self.tasks / "09-02-shared")
        self.write_task(self.tasks / "09-03-shared")

        with self.assertRaisesRegex(
            ValueError,
            "09-02-shared, 09-03-shared",
        ):
            resolve_task_reference("shared", self.root)

    def test_missing_nested_archive_and_outside_paths_fail_closed(self) -> None:
        """不存在、嵌套、归档和项目外路径都被拒绝。"""
        nested = self.task / "nested"
        nested.mkdir()
        archive = self.tasks / "archive/2026-09/old"
        archive.mkdir(parents=True)
        outside = self.root / "outside"
        outside.mkdir()

        with self.assertRaisesRegex(ValueError, "任务不存在"):
            resolve_task_reference("missing", self.root)
        for value in (str(nested), str(archive), str(outside)):
            with self.subTest(value=value):
                with self.assertRaisesRegex(ValueError, "必须指向活动任务目录"):
                    resolve_task_reference(value, self.root)

    def test_logically_closed_task_is_not_an_active_reference(self) -> None:
        """尚未物理 GC 的 closed 任务也不能被活动引用解析器命中。"""
        closed = self.tasks / "09-03-closed"
        self.write_task(closed, closed=True)

        for value in (closed.name, "closed", str(closed)):
            with self.subTest(value=value):
                with self.assertRaisesRegex(ValueError, "任务不存在|必须指向活动任务目录"):
                    resolve_active_task_reference(value, self.root)

    def test_top_level_resolver_accepts_logically_closed_task(self) -> None:
        """显式顶层解析器可按完整名、短名和路径命中尚未 GC 的 closed 任务。"""
        closed = self.tasks / "09-03-closed"
        self.write_task(closed, closed=True)

        references = [closed.name, "closed", str(closed)]

        resolved = [resolve_top_level_task_reference(value, self.root) for value in references]

        self.assertEqual(resolved, [closed.resolve()] * len(references))

    def test_symlink_outside_tasks_fails_closed(self) -> None:
        """活动任务目录中的软链不能把解析结果带到项目外。"""
        outside = self.root / "outside"
        outside.mkdir()
        link = self.tasks / "09-03-linked"
        try:
            link.symlink_to(outside, target_is_directory=True)
        except OSError as exc:
            self.skipTest(f"当前平台不支持软链测试：{exc}")

        with self.assertRaisesRegex(ValueError, "必须指向活动任务目录"):
            resolve_task_reference("09-03-linked", self.root)


if __name__ == "__main__":
    unittest.main()
