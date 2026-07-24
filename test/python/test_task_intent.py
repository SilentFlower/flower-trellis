"""task_intent.py 自动创建与安全丢弃测试。"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from argparse import Namespace
from contextlib import contextmanager
from importlib import util as importlib_util
from pathlib import Path
from unittest import mock


PROJECT_ROOT = Path(__file__).resolve().parents[2]
SOURCE_HELPER = PROJECT_ROOT / "vendor/skill-garden/.trellis/0.6/scripts/task_intent.py"
SOURCE_SCRIPTS = PROJECT_ROOT / ".trellis/scripts"


class TaskIntentTest(unittest.TestCase):
    """在临时 Git/Trellis 仓库验证 task intent helper。"""

    def setUp(self) -> None:
        """创建隔离仓库并复制 helper 运行依赖。"""
        self.temp = tempfile.TemporaryDirectory(prefix="flower-task-intent-")
        self.root = Path(self.temp.name)
        scripts = self.root / ".trellis/scripts"
        scripts.mkdir(parents=True)
        shutil.copy2(SOURCE_HELPER, scripts / "task_intent.py")
        shutil.copy2(SOURCE_SCRIPTS / "task.py", scripts / "task.py")
        shutil.copy2(SOURCE_SCRIPTS / "decision_log.py", scripts / "decision_log.py")
        shutil.copytree(SOURCE_SCRIPTS / "common", scripts / "common")
        (self.root / ".trellis/tasks").mkdir(parents=True)
        (self.root / ".trellis/.developer").write_text("name=tester\n", encoding="utf-8")
        (self.root / ".trellis/config.yaml").write_text(
            "project:\n  type: single\n",
            encoding="utf-8",
        )
        self.run_command(["git", "init", "-q"])
        self.run_command(["git", "config", "user.name", "Tester"])
        self.run_command(["git", "config", "user.email", "tester@example.com"])
        (self.root / "tracked.txt").write_text("base\n", encoding="utf-8")
        (self.root / "rename-source.txt").write_text("rename\n", encoding="utf-8")
        self.run_command(["git", "add", "tracked.txt", "rename-source.txt"])
        self.run_command(["git", "commit", "-qm", "initial"])
        self.env = {**os.environ, "TRELLIS_CONTEXT_ID": "intent-test-session"}

    def tearDown(self) -> None:
        """删除临时仓库。"""
        self.temp.cleanup()

    def run_command(
        self,
        args: list[str],
        *,
        env: dict[str, str] | None = None,
        check: bool = True,
    ) -> subprocess.CompletedProcess:
        """在临时仓库执行命令。

        Args:
            args: 命令参数。
            env: 可选环境变量。
            check: 是否要求退出码为 0。

        Returns:
            subprocess 执行结果。
        """
        return subprocess.run(
            args,
            cwd=self.root,
            env=env,
            capture_output=True,
            text=True,
            check=check,
        )

    def helper(self, *args: str, check: bool = True) -> tuple[subprocess.CompletedProcess, dict]:
        """执行 helper 并解析 stdout JSON。"""
        result = self.run_command(
            ["python3", ".trellis/scripts/task_intent.py", *args],
            env=self.env,
            check=False,
        )
        payload = json.loads(result.stdout)
        if check and result.returncode != 0:
            self.fail(f"helper failed: {payload}\n{result.stderr}")
        return result, payload

    def create_task(self, slug: str = "auto-task", *extra: str) -> tuple[Path, dict]:
        """通过 helper 创建自动路由 task。"""
        _, payload = self.helper(
            "create",
            "--title",
            "Auto task",
            "--slug",
            slug,
            *extra,
        )
        task_dir = self.root / payload["task"]
        return task_dir, json.loads((task_dir / "task.json").read_text(encoding="utf-8"))

    @contextmanager
    def loaded_helper(self):
        """加载隔离仓库中的 helper 模块，并临时切换到仓库根目录。"""
        module_name = f"task_intent_test_{id(self)}_{len(sys.modules)}"
        spec = importlib_util.spec_from_file_location(
            module_name,
            self.root / ".trellis/scripts/task_intent.py",
        )
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        module = importlib_util.module_from_spec(spec)
        scripts_path = str(self.root / ".trellis/scripts")
        old_cwd = Path.cwd()
        sys.path.insert(0, scripts_path)
        try:
            spec.loader.exec_module(module)
            os.chdir(self.root)
            with mock.patch.dict(os.environ, self.env, clear=False):
                yield module
        finally:
            os.chdir(old_cwd)
            sys.path.remove(scripts_path)
            sys.modules.pop(module_name, None)

    def test_create_records_pre_task_dirty_baseline(self) -> None:
        """create 在 task 文件出现前记录 tracked 与 untracked dirty。"""
        (self.root / "tracked.txt").write_text("changed\n", encoding="utf-8")
        (self.root / "untracked.txt").write_text("new\n", encoding="utf-8")
        self.run_command(["git", "mv", "rename-source.txt", "rename-target.txt"])
        task_dir, data = self.create_task()

        intent = data["meta"]["intentRouting"]
        self.assertTrue(intent["autoCreated"])
        self.assertEqual(intent["contextKey"], "intent-test-session")
        self.assertFalse(intent["implementationStarted"])
        paths = {entry["path"] for entry in intent["baseline"]["status"]}
        self.assertIn("tracked.txt", paths)
        self.assertIn("untracked.txt", paths)
        rename_entries = [
            entry for entry in intent["baseline"]["status"] if "R" in entry["status"]
        ]
        self.assertEqual(len(rename_entries), 1)
        self.assertEqual(
            {rename_entries[0]["path"], rename_entries[0]["originalPath"]},
            {"rename-source.txt", "rename-target.txt"},
        )
        self.assertNotIn(task_dir.relative_to(self.root).as_posix(), paths)
        self.assertEqual(data["status"], "planning")

    def test_create_is_not_auto_discard_eligible_when_active_binding_misses(self) -> None:
        """task 已创建但 active pointer 未绑定时不得承诺自动丢弃。"""
        with self.loaded_helper() as module:
            active = mock.Mock(
                context_key="intent-test-session",
                task_path=".trellis/tasks/other-task",
            )
            args = Namespace(
                title="Auto task",
                slug="binding-miss",
                parent=None,
                package=None,
                priority="P2",
                description="",
            )
            with mock.patch.object(module, "resolve_active_task", return_value=active):
                payload = module.create_auto_task(args)

        self.assertFalse(payload["autoDiscardEligible"])

    def test_discard_removes_task_session_and_preserves_business_dirty(self) -> None:
        """安全 discard 只清理 task 与 session，不删除业务 dirty 文件。"""
        business = self.root / "business.txt"
        business.write_text("keep\n", encoding="utf-8")
        task_dir, _ = self.create_task()
        task_ref = task_dir.relative_to(self.root).as_posix()

        _, payload = self.helper("discard", "--task", task_ref)
        self.assertEqual(payload["status"], "discarded")
        self.assertFalse(task_dir.exists())
        self.assertTrue(business.exists())
        sessions = self.root / ".trellis/.runtime/sessions"
        self.assertEqual(list(sessions.glob("*.json")), [])

    def test_discard_cleans_parent_reference(self) -> None:
        """child discard 会从 parent children 中精确移除引用。"""
        parent_result = self.run_command(
            [
                "python3",
                ".trellis/scripts/task.py",
                "create",
                "Parent",
                "--slug",
                "parent",
            ],
            env=self.env,
        )
        parent_ref = [line for line in parent_result.stdout.splitlines() if line.startswith(".trellis/tasks/")][-1]
        parent_dir = self.root / parent_ref
        child_dir, _ = self.create_task("child", "--parent", parent_ref)

        self.helper("discard", "--task", child_dir.relative_to(self.root).as_posix())
        parent = json.loads((parent_dir / "task.json").read_text(encoding="utf-8"))
        self.assertNotIn(child_dir.name, parent["children"])

    def test_discard_delete_failure_rolls_back_parent(self) -> None:
        """目录删除失败时 parent 引用必须恢复且 child 保留。"""
        parent_result = self.run_command(
            [
                "python3",
                ".trellis/scripts/task.py",
                "create",
                "Parent rollback",
                "--slug",
                "parent-rollback",
            ],
            env=self.env,
        )
        parent_ref = [line for line in parent_result.stdout.splitlines() if line.startswith(".trellis/tasks/")][-1]
        parent_dir = self.root / parent_ref
        child_dir, _ = self.create_task("child-rollback", "--parent", parent_ref)
        parent_before = (parent_dir / "task.json").read_text(encoding="utf-8")

        with self.loaded_helper() as module:
            with mock.patch.object(module.shutil, "rmtree", side_effect=OSError("boom")):
                with self.assertRaises(module.IntentTaskError) as raised:
                    module.discard_auto_task(
                        Namespace(task=child_dir.relative_to(self.root).as_posix())
                    )
            self.assertEqual(raised.exception.reason, "task-delete-failed")

        self.assertTrue(child_dir.exists())
        self.assertEqual(
            (parent_dir / "task.json").read_text(encoding="utf-8"),
            parent_before,
        )
        sessions = list((self.root / ".trellis/.runtime/sessions").glob("*.json"))
        self.assertEqual(len(sessions), 1)
        self.assertEqual(
            json.loads(sessions[0].read_text(encoding="utf-8"))["current_task"],
            child_dir.relative_to(self.root).as_posix(),
        )

    def test_create_metadata_failure_rolls_back_task_and_session(self) -> None:
        """intent 元数据写入失败时不得留下未标记 task 或 session。"""
        with self.loaded_helper() as module:
            with mock.patch.object(module, "write_json", return_value=False):
                with self.assertRaises(module.IntentTaskError) as raised:
                    module.create_auto_task(
                        Namespace(
                            title="Rollback create",
                            slug="rollback-create",
                            parent=None,
                            package=None,
                            priority="P2",
                            description=None,
                        )
                    )
            self.assertEqual(raised.exception.reason, "task-json-write-failed")

        self.assertEqual(
            [
                path
                for path in (self.root / ".trellis/tasks").iterdir()
                if path.is_dir() and path.name != "archive"
            ],
            [],
        )
        sessions_dir = self.root / ".trellis/.runtime/sessions"
        self.assertEqual(list(sessions_dir.glob("*.json")), [])

    def test_session_cleanup_failure_rolls_back_parent_and_keeps_task(self) -> None:
        """session 删除失败时 parent、task 与 session 必须全部保持。"""
        parent_result = self.run_command(
            [
                "python3",
                ".trellis/scripts/task.py",
                "create",
                "Parent session rollback",
                "--slug",
                "parent-session-rollback",
            ],
            env=self.env,
        )
        parent_ref = [
            line
            for line in parent_result.stdout.splitlines()
            if line.startswith(".trellis/tasks/")
        ][-1]
        parent_dir = self.root / parent_ref
        child_dir, _ = self.create_task(
            "child-session-rollback",
            "--parent",
            parent_ref,
        )
        parent_before = (parent_dir / "task.json").read_text(encoding="utf-8")
        sessions_before = {
            path.name: path.read_text(encoding="utf-8")
            for path in (self.root / ".trellis/.runtime/sessions").glob("*.json")
        }

        with self.loaded_helper() as module:
            failure = module.IntentTaskError("session-clear-failed", "boom")
            with mock.patch.object(module, "_remove_session_files", side_effect=failure):
                with self.assertRaises(module.IntentTaskError) as raised:
                    module.discard_auto_task(
                        Namespace(task=child_dir.relative_to(self.root).as_posix())
                    )
            self.assertEqual(raised.exception.reason, "session-clear-failed")

        self.assertTrue(child_dir.exists())
        self.assertEqual(
            (parent_dir / "task.json").read_text(encoding="utf-8"),
            parent_before,
        )
        sessions_after = {
            path.name: path.read_text(encoding="utf-8")
            for path in (self.root / ".trellis/.runtime/sessions").glob("*.json")
        }
        self.assertEqual(sessions_after, sessions_before)

    def test_discard_rejects_started_children_commit_and_versioned_task(self) -> None:
        """任一实施证据存在时都必须零副作用拒删。"""
        cases = (
            ("started", lambda data, task_dir: data.update(status="in_progress"), "implementation-started"),
            (
                "started-flag",
                lambda data, task_dir: data["meta"]["intentRouting"].update(
                    implementationStarted=True
                ),
                "implementation-started",
            ),
            ("children", lambda data, task_dir: data.update(children=["child"]), "has-children"),
            ("subtasks", lambda data, task_dir: data.update(subtasks=["child"]), "has-children"),
            ("commit", lambda data, task_dir: data.update(commit="abc123"), "has-commit"),
            ("pr", lambda data, task_dir: data.update(pr_url="https://example.test/pr/1"), "has-pr"),
            ("worktree", lambda data, task_dir: data.update(worktree_path="/tmp/worktree"), "has-worktree"),
            ("progress", lambda data, task_dir: data.update(progress={"nextStep": "x"}), "has-progress"),
            (
                "legacy-progress",
                lambda data, task_dir: data.update(last_push_snapshot={"phase": "x"}),
                "has-progress",
            ),
            (
                "manual",
                lambda data, task_dir: data["meta"].pop("intentRouting"),
                "not-auto-created",
            ),
        )
        for slug, mutate, reason in cases:
            with self.subTest(reason=reason):
                task_dir, data = self.create_task(slug)
                mutate(data, task_dir)
                (task_dir / "task.json").write_text(json.dumps(data), encoding="utf-8")
                result, payload = self.helper(
                    "discard",
                    "--task",
                    task_dir.relative_to(self.root).as_posix(),
                    check=False,
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(payload["reason"], reason)
                self.assertTrue(task_dir.exists())

        task_dir, _ = self.create_task("versioned")
        task_ref = task_dir.relative_to(self.root).as_posix()
        self.run_command(["git", "add", task_ref])
        result, payload = self.helper("discard", "--task", task_ref, check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(payload["reason"], "task-already-versioned")
        self.assertTrue(task_dir.exists())

    def test_discard_rejects_request_scope_and_unsafe_paths(self) -> None:
        """其它 session 与路径穿越不能触发自动删除。"""
        task_dir, _ = self.create_task("scope")
        other_env = {**self.env, "TRELLIS_CONTEXT_ID": "other-session"}
        result = self.run_command(
            [
                "python3",
                ".trellis/scripts/task_intent.py",
                "discard",
                "--task",
                task_dir.relative_to(self.root).as_posix(),
            ],
            env=other_env,
            check=False,
        )
        self.assertEqual(json.loads(result.stdout)["reason"], "request-scope-mismatch")
        self.assertTrue(task_dir.exists())

        result, payload = self.helper("discard", "--task", "../outside", check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(payload["reason"], "unsafe-task-path")

        outside = self.root / "outside-task"
        outside.mkdir()
        symlink = self.root / ".trellis/tasks/symlink-task"
        symlink.symlink_to(outside, target_is_directory=True)
        result, payload = self.helper("discard", "--task", "symlink-task", check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(payload["reason"], "unsafe-task-path")

        archive_task = self.root / ".trellis/tasks/archive/archived"
        archive_task.mkdir(parents=True)
        result, payload = self.helper(
            "discard",
            "--task",
            ".trellis/tasks/archive/archived",
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(payload["reason"], "unsafe-task-path")


if __name__ == "__main__":
    unittest.main()
