"""公共任务引用解析器测试。"""

from __future__ import annotations

from pathlib import Path
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = ROOT / ".trellis/scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from common.task_utils import resolve_task_reference


class TaskReferenceResolutionTest(unittest.TestCase):
    """验证任务引用支持形式与严格边界。"""

    def setUp(self) -> None:
        """创建隔离活动任务目录。"""
        self.temp = tempfile.TemporaryDirectory(prefix="flower-task-reference-")
        self.root = Path(self.temp.name)
        self.tasks = self.root / ".trellis/tasks"
        self.tasks.mkdir(parents=True)
        self.task = self.tasks / "09-03-cli-contract"
        self.task.mkdir()

    def tearDown(self) -> None:
        """清理隔离目录。"""
        self.temp.cleanup()

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
        (self.tasks / "09-02-shared").mkdir()
        (self.tasks / "09-03-shared").mkdir()

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
