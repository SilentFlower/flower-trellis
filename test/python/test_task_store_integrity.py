"""task_store.py 核心写入失败语义测试。"""

from __future__ import annotations

from argparse import Namespace
from contextlib import contextmanager
import importlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
SOURCE_SCRIPTS = ROOT / ".trellis/scripts"


class TaskStoreIntegrityTest(unittest.TestCase):
    """在隔离 Trellis 根目录验证 task store 补偿和错误返回。"""

    def setUp(self) -> None:
        """创建最小 Trellis 目录。"""
        self.temp = tempfile.TemporaryDirectory(prefix="flower-task-store-")
        self.root = Path(self.temp.name)
        (self.root / ".trellis/tasks").mkdir(parents=True)
        (self.root / ".trellis/.developer").write_text("name=tester\n", encoding="utf-8")
        (self.root / ".trellis/config.yaml").write_text(
            "project:\n  type: single\n",
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        """删除隔离目录。"""
        self.temp.cleanup()

    @contextmanager
    def loaded_store(self):
        """加载当前 dogfood 的 common.task_store 模块。"""
        scripts_path = str(SOURCE_SCRIPTS)
        old_cwd = Path.cwd()
        cached = {
            name: value
            for name, value in sys.modules.items()
            if name == "common" or name.startswith("common.") or name == "decision_log"
        }
        for name in cached:
            sys.modules.pop(name, None)
        sys.path.insert(0, scripts_path)
        os.chdir(self.root)
        try:
            module = importlib.import_module("common.task_store")
            yield module
        finally:
            os.chdir(old_cwd)
            sys.path.remove(scripts_path)
            for name in list(sys.modules):
                if name == "common" or name.startswith("common.") or name == "decision_log":
                    sys.modules.pop(name, None)
            sys.modules.update(cached)

    def create_args(self, slug: str = "integrity") -> Namespace:
        """返回 cmd_create 所需参数。"""
        return Namespace(
            title="Integrity task",
            slug=slug,
            assignee="tester",
            priority="P2",
            parent=None,
            package=None,
            description="",
        )

    def test_duplicate_slug_fails_without_overwriting_existing_task(self) -> None:
        """同日重复 slug 返回失败且保留原 task.json。"""
        with self.loaded_store() as module:
            args = self.create_args("duplicate")
            self.assertEqual(module.cmd_create(args), 0)
            task_dir = next((self.root / ".trellis/tasks").glob("*-duplicate"))
            task_json = task_dir / "task.json"
            before = task_json.read_bytes()

            result = module.cmd_create(args)

        self.assertEqual(result, 1)
        self.assertEqual(task_json.read_bytes(), before)

    def test_initial_task_json_failure_removes_new_directory(self) -> None:
        """首次 task.json 写入失败时清理本次创建目录。"""
        with self.loaded_store() as module:
            with mock.patch.object(module, "write_json", return_value=False):
                result = module.cmd_create(self.create_args("write-fail"))

        self.assertEqual(result, 1)
        self.assertEqual(list((self.root / ".trellis/tasks").glob("*-write-fail")), [])

    def test_add_subtask_second_write_failure_restores_both_files(self) -> None:
        """父文件成功、子文件失败时恢复双方原始内容。"""
        parent = self.root / ".trellis/tasks/parent"
        child = self.root / ".trellis/tasks/child"
        parent.mkdir()
        child.mkdir()
        parent_json = parent / "task.json"
        child_json = child / "task.json"
        parent_json.write_text(json.dumps({"children": []}), encoding="utf-8")
        child_json.write_text(json.dumps({"parent": None}), encoding="utf-8")

        with self.loaded_store() as module:
            real_write = module.write_json
            calls = 0

            def controlled_write(path: Path, data: dict) -> bool:
                nonlocal calls
                calls += 1
                if calls == 2:
                    return False
                return real_write(path, data)

            with mock.patch.object(module, "write_json", side_effect=controlled_write):
                result = module.cmd_add_subtask(
                    Namespace(parent_dir="parent", child_dir="child")
                )

        self.assertEqual(result, 1)
        self.assertEqual(json.loads(parent_json.read_text(encoding="utf-8")), {"children": []})
        self.assertEqual(json.loads(child_json.read_text(encoding="utf-8")), {"parent": None})

    def test_set_branch_write_failure_returns_nonzero(self) -> None:
        """set-branch 写失败时不输出成功退出码。"""
        task_dir = self.root / ".trellis/tasks/task"
        task_dir.mkdir()
        (task_dir / "task.json").write_text(json.dumps({"branch": None}), encoding="utf-8")

        with self.loaded_store() as module:
            with mock.patch.object(module, "write_json", return_value=False):
                result = module.cmd_set_branch(Namespace(dir="task", branch="feature/test"))

        self.assertEqual(result, 1)

    def test_archive_in_progress_task_stops_before_move(self) -> None:
        """archive 只接受已由普通 push 完成的任务。"""
        task_dir = self.root / ".trellis/tasks/task"
        task_dir.mkdir()
        task_json = task_dir / "task.json"
        task_json.write_text(
            json.dumps({"status": "in_progress", "children": []}),
            encoding="utf-8",
        )

        with self.loaded_store() as module:
            with mock.patch.object(module, "write_json") as write_json:
                with mock.patch.object(module, "archive_task_complete") as archive:
                    result = module.cmd_archive(Namespace(name="task", no_commit=True))

        self.assertEqual(result, 1)
        archive.assert_not_called()
        write_json.assert_not_called()
        self.assertTrue(task_dir.is_dir())
        self.assertEqual(json.loads(task_json.read_text(encoding="utf-8"))["status"], "in_progress")

    def test_archive_completed_task_without_timestamp_backfills_before_move(self) -> None:
        """已完成任务缺少 completedAt 时补写日期并继续归档。"""
        task_dir = self.root / ".trellis/tasks/task"
        task_dir.mkdir()
        (task_dir / "task.json").write_text(
            json.dumps({"status": "completed", "children": []}),
            encoding="utf-8",
        )

        with self.loaded_store() as module:
            with mock.patch.object(module, "datetime") as patched_datetime:
                patched_datetime.now.return_value.strftime.return_value = "2026-08-17"
                result = module.cmd_archive(Namespace(name="task", no_commit=True))

        archived = list((self.root / ".trellis/tasks/archive").glob("*/task"))
        self.assertEqual(result, 0)
        self.assertEqual(len(archived), 1)
        archived_data = json.loads((archived[0] / "task.json").read_text(encoding="utf-8"))
        self.assertEqual(archived_data["status"], "completed")
        self.assertEqual(archived_data["completedAt"], "2026-08-17")

    def test_archive_completed_at_backfill_failure_stops_before_move(self) -> None:
        """completedAt 补写失败时保留原任务并返回失败。"""
        task_dir = self.root / ".trellis/tasks/task"
        task_dir.mkdir()
        task_json = task_dir / "task.json"
        task_json.write_text(
            json.dumps({"status": "completed", "children": []}),
            encoding="utf-8",
        )

        with self.loaded_store() as module:
            with mock.patch.object(module, "write_json", return_value=False):
                with mock.patch.object(module, "archive_task_complete") as archive:
                    result = module.cmd_archive(Namespace(name="task", no_commit=True))

        self.assertEqual(result, 1)
        archive.assert_not_called()
        self.assertTrue(task_dir.is_dir())
        self.assertNotIn("completedAt", json.loads(task_json.read_text(encoding="utf-8")))

    def test_archive_unreviewed_decision_stops_before_status_write(self) -> None:
        """存在未审 AI 决策时不得写状态、清 session 或移动目录。"""
        task_dir = self.root / ".trellis/tasks/task"
        task_dir.mkdir()
        task_json = task_dir / "task.json"
        task_json.write_text(
            json.dumps({"status": "completed", "completedAt": "2026-08-02", "children": []}),
            encoding="utf-8",
        )

        with self.loaded_store() as module:
            decision_log = importlib.import_module("decision_log")
            decision_log.append_decision(
                task_dir,
                run_id="run-test",
                topic="实现方案",
                options=["方案 A", "方案 B"],
                choice="方案 A",
                summary="仓库现有模式支持方案 A",
                evidence=["现有测试覆盖"],
                risk="low",
                confidence="high",
                requirements=["REQ-1"],
                files=["src/example.py"],
            )
            with mock.patch.object(module, "write_json") as write_json:
                with mock.patch.object(module, "archive_task_complete") as archive:
                    result = module.cmd_archive(Namespace(name="task", no_commit=True))

        self.assertEqual(result, 1)
        write_json.assert_not_called()
        archive.assert_not_called()
        self.assertTrue(task_dir.is_dir())
        self.assertEqual(json.loads(task_json.read_text(encoding="utf-8"))["status"], "completed")

    def test_archive_accepted_decisions_permits_existing_archive_flow(self) -> None:
        """当前决策摘要已接受时允许既有归档流程继续。"""
        task_dir = self.root / ".trellis/tasks/task"
        task_dir.mkdir()
        (task_dir / "task.json").write_text(
            json.dumps({"status": "completed", "completedAt": "2026-08-02", "children": []}),
            encoding="utf-8",
        )

        with self.loaded_store() as module:
            decision_log = importlib.import_module("decision_log")
            decision_log.append_decision(
                task_dir,
                run_id="run-test",
                topic="实现方案",
                options=["方案 A", "方案 B"],
                choice="方案 A",
                summary="仓库现有模式支持方案 A",
                evidence=["现有测试覆盖"],
                risk="medium",
                confidence="medium",
                requirements=["REQ-1"],
                files=["src/example.py"],
            )
            decision_log.review_decisions(task_dir, verdict="accepted")

            result = module.cmd_archive(Namespace(name="task", no_commit=True))

        archived = list((self.root / ".trellis/tasks/archive").glob("*/task"))
        self.assertEqual(result, 0)
        self.assertEqual(len(archived), 1)
        archived_data = json.loads((archived[0] / "task.json").read_text(encoding="utf-8"))
        self.assertEqual(archived_data["status"], "completed")
        self.assertEqual(archived_data["completedAt"], "2026-08-02")

    def test_archive_completed_parent_clears_child_parent_only(self) -> None:
        """归档 completed 父任务时保留子任务状态，只解除活动子任务的 parent。"""
        parent = self.root / ".trellis/tasks/parent"
        child = self.root / ".trellis/tasks/child"
        parent.mkdir()
        child.mkdir()
        (parent / "task.json").write_text(
            json.dumps({
                "status": "completed",
                "completedAt": "2026-08-02",
                "children": ["child"],
            }),
            encoding="utf-8",
        )
        (child / "task.json").write_text(
            json.dumps({
                "status": "in_progress",
                "completedAt": None,
                "children": [],
                "parent": "parent",
            }),
            encoding="utf-8",
        )

        with self.loaded_store() as module:
            result = module.cmd_archive(Namespace(name="parent", no_commit=True))

        child_data = json.loads((child / "task.json").read_text(encoding="utf-8"))
        archived = list((self.root / ".trellis/tasks/archive").glob("*/parent"))
        self.assertEqual(result, 0)
        self.assertEqual(len(archived), 1)
        self.assertEqual(child_data["status"], "in_progress")
        self.assertIsNone(child_data["completedAt"])
        self.assertIsNone(child_data["parent"])

    def test_archive_corrupt_decision_log_fails_closed(self) -> None:
        """损坏的 decisions.jsonl 必须在任何归档写入前失败。"""
        task_dir = self.root / ".trellis/tasks/task"
        task_dir.mkdir()
        task_json = task_dir / "task.json"
        task_json.write_text(
            json.dumps({"status": "completed", "completedAt": "2026-08-02", "children": []}),
            encoding="utf-8",
        )
        (task_dir / "decisions.jsonl").write_text("{broken\n", encoding="utf-8")

        with self.loaded_store() as module:
            with mock.patch.object(module, "write_json") as write_json:
                with mock.patch.object(module, "archive_task_complete") as archive:
                    result = module.cmd_archive(Namespace(name="task", no_commit=True))

        self.assertEqual(result, 1)
        write_json.assert_not_called()
        archive.assert_not_called()
        self.assertTrue(task_dir.is_dir())
        self.assertEqual(json.loads(task_json.read_text(encoding="utf-8"))["status"], "completed")


if __name__ == "__main__":
    unittest.main()
