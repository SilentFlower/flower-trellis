"""验证 task.py start 的 planning brief 门禁。"""

from __future__ import annotations

from contextlib import contextmanager, redirect_stdout
from io import StringIO
import importlib.util as importlib_util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
SOURCE_SCRIPTS = ROOT / ".trellis/scripts"
SESSION_ENV_KEYS = {
    "TRELLIS_CONTEXT_ID",
    "CLAUDE_SESSION_ID",
    "CLAUDE_CODE_SESSION_ID",
    "CODEX_SESSION_ID",
    "CODEX_THREAD_ID",
    "CURSOR_SESSION_ID",
    "OPENCODE_SESSION_ID",
    "OPENCODE_SESSIONID",
    "OPENCODE_RUN_ID",
    "GEMINI_SESSION_ID",
    "FACTORY_SESSION_ID",
    "DROID_SESSION_ID",
    "QODER_SESSION_ID",
    "CODEBUDDY_SESSION_ID",
    "KIRO_SESSION_ID",
    "COPILOT_SESSION_ID",
    "COPILOT_SESSIONID",
    "PI_SESSION_ID",
    "PI_SESSIONID",
    "TRAE_SESSION_ID",
}


class TaskStartBriefGateTest(unittest.TestCase):
    """在隔离 Trellis 仓库中验证首次启动和历史重绑行为。"""

    def setUp(self) -> None:
        """创建最小任务仓库并复制最终 dogfood 脚本。"""
        self.temp = tempfile.TemporaryDirectory(prefix="flower-task-brief-gate-")
        self.root = Path(self.temp.name)
        scripts = self.root / ".trellis/scripts"
        scripts.mkdir(parents=True)
        shutil.copy2(SOURCE_SCRIPTS / "task.py", scripts / "task.py")
        shutil.copy2(SOURCE_SCRIPTS / "decision_log.py", scripts / "decision_log.py")
        shutil.copytree(SOURCE_SCRIPTS / "common", scripts / "common")
        (self.root / ".trellis/tasks").mkdir(parents=True)
        (self.root / ".trellis/.developer").write_text("name=tester\n", encoding="utf-8")
        (self.root / ".trellis/config.yaml").write_text(
            "hooks:\n"
            "  after_start:\n"
            "    - \"touch hook-ran.txt\"\n"
            "  after_finish:\n"
            "    - \"touch finish-hook-ran.txt\"\n",
            encoding="utf-8",
        )
        self.task_dir = self.root / ".trellis/tasks/07-22-brief-gate"
        self.task_dir.mkdir()
        self.env = {**os.environ, "TRELLIS_CONTEXT_ID": "brief-gate-test"}

    def tearDown(self) -> None:
        """删除隔离仓库。"""
        self.temp.cleanup()

    def write_task(self, status: str = "planning") -> None:
        """写入最小任务元数据。

        Args:
            status: 任务状态。
        """
        (self.task_dir / "task.json").write_text(
            json.dumps({"title": "Brief gate", "status": status}),
            encoding="utf-8",
        )

    def write_artifact(self, name: str, mtime_ns: int) -> Path:
        """写入任务产物并设置确定性纳秒时间。

        Args:
            name: 文件名。
            mtime_ns: 文件修改时间。

        Returns:
            已写入的文件路径。
        """
        path = self.task_dir / name
        path.write_text(f"# {name}\n", encoding="utf-8")
        os.utime(path, ns=(mtime_ns, mtime_ns))
        return path

    def run_start(
        self,
        *,
        env: dict[str, str] | None = None,
    ) -> subprocess.CompletedProcess[str]:
        """执行 task.py start。

        Args:
            env: 可选进程环境。

        Returns:
            子进程结果。
        """
        return subprocess.run(
            [
                "python3",
                ".trellis/scripts/task.py",
                "start",
                self.task_dir.relative_to(self.root).as_posix(),
            ],
            cwd=self.root,
            env=env or self.env,
            capture_output=True,
            text=True,
            check=False,
        )

    def read_status(self) -> str:
        """读取当前任务状态。

        Returns:
            task.json 中的状态。
        """
        return json.loads(
            (self.task_dir / "task.json").read_text(encoding="utf-8")
        )["status"]

    @contextmanager
    def loaded_task_module(self):
        """加载隔离仓库中的 task.py 模块。

        Yields:
            已加载的 task.py 模块。
        """
        module_name = f"task_brief_gate_{id(self)}_{len(sys.modules)}"
        spec = importlib_util.spec_from_file_location(
            module_name,
            self.root / ".trellis/scripts/task.py",
        )
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        module = importlib_util.module_from_spec(spec)
        scripts_path = str(self.root / ".trellis/scripts")
        old_cwd = Path.cwd()
        cached_common = {
            name: value
            for name, value in sys.modules.items()
            if name == "common" or name.startswith("common.")
        }
        for name in cached_common:
            sys.modules.pop(name, None)
        sys.path.insert(0, scripts_path)
        sys.modules[module_name] = module
        try:
            spec.loader.exec_module(module)
            os.chdir(self.root)
            yield module
        finally:
            os.chdir(old_cwd)
            sys.path.remove(scripts_path)
            sys.modules.pop(module_name, None)
            for name in list(sys.modules):
                if name == "common" or name.startswith("common."):
                    sys.modules.pop(name, None)
            sys.modules.update(cached_common)

    def assert_guard_blocked(self, result: subprocess.CompletedProcess[str]) -> None:
        """断言门禁失败没有产生状态、指针或 hook 副作用。

        Args:
            result: start 子进程结果。
        """
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertEqual(self.read_status(), "planning")
        self.assertFalse((self.root / "hook-ran.txt").exists())
        self.assertFalse((self.root / ".trellis/.runtime/sessions").exists())

    def test_missing_brief_blocks_before_side_effects(self) -> None:
        """planning task 缺少 brief 时失败关闭。"""
        self.write_task()
        self.write_artifact("prd.md", 1_000_000_000)

        result = self.run_start()

        self.assert_guard_blocked(result)
        self.assertIn("brief.md is missing", result.stdout)
        self.assertIn("trellis-task-brief", result.stdout)

    def test_create_then_immediate_start_preserves_planning_pointer(self) -> None:
        """真实 create 后同一流程直接 start 时保留 planning 指针并拒绝启动。"""
        create = subprocess.run(
            [
                "python3",
                ".trellis/scripts/task.py",
                "create",
                "Same turn brief gate",
                "--slug",
                "same-turn-brief-gate",
            ],
            cwd=self.root,
            env=self.env,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(create.returncode, 0, create.stdout + create.stderr)
        matches = list((self.root / ".trellis/tasks").glob("*-same-turn-brief-gate"))
        self.assertEqual(len(matches), 1)
        self.task_dir = matches[0]
        sessions_dir = self.root / ".trellis/.runtime/sessions"
        pointer_before = {
            path.name: path.read_bytes()
            for path in sessions_dir.iterdir()
            if path.is_file()
        }

        result = self.run_start()

        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertEqual(self.read_status(), "planning")
        self.assertFalse((self.root / "hook-ran.txt").exists())
        pointer_after = {
            path.name: path.read_bytes()
            for path in sessions_dir.iterdir()
            if path.is_file()
        }
        self.assertEqual(pointer_after, pointer_before)
        self.assertIn("brief.md is missing", result.stdout)

    def test_any_newer_authoritative_artifact_makes_brief_stale(self) -> None:
        """PRD、设计或实施计划任一更新都会使 brief 过期。"""
        for stale_name in ("prd.md", "design.md", "implement.md"):
            with self.subTest(stale_name=stale_name):
                self.write_task()
                for name in ("prd.md", "design.md", "implement.md"):
                    self.write_artifact(name, 1_000_000_000)
                self.write_artifact("brief.md", 2_000_000_000)
                self.write_artifact(stale_name, 3_000_000_000)

                result = self.run_start()

                self.assert_guard_blocked(result)
                self.assertIn("brief.md is stale", result.stdout)
                self.assertIn(stale_name, result.stdout)

    def test_fresh_brief_starts_task_and_runs_hook(self) -> None:
        """brief 不早于权威产物时允许正常启动。"""
        self.write_task()
        for name in ("prd.md", "design.md", "implement.md"):
            self.write_artifact(name, 1_000_000_000)
        self.write_artifact("brief.md", 2_000_000_000)

        result = self.run_start()

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.read_status(), "in_progress")
        self.assertTrue((self.root / "hook-ran.txt").is_file())

    def test_authoritative_artifact_stat_error_is_controlled(self) -> None:
        """权威产物 stat 异常时返回受控错误和恢复指引。"""
        self.write_task()
        for name in ("prd.md", "design.md", "implement.md"):
            self.write_artifact(name, 1_000_000_000)
        self.write_artifact("brief.md", 2_000_000_000)
        original_is_file = Path.is_file

        def flaky_is_file(path: Path) -> bool:
            if path.name == "design.md":
                raise OSError("stat failed")
            return original_is_file(path)

        output = StringIO()
        with self.loaded_task_module() as module:
            with mock.patch.object(Path, "is_file", new=flaky_is_file):
                with redirect_stdout(output):
                    allowed = module._validate_planning_brief(
                        self.task_dir,
                        self.task_dir / "task.json",
                    )

        self.assertFalse(allowed)
        self.assertIn("Unable to validate planning brief freshness", output.getvalue())
        self.assertIn("Fix task artifact access", output.getvalue())

    def test_in_progress_task_without_brief_can_rebind(self) -> None:
        """历史 in_progress 任务缺少 brief 时仍可重新绑定。"""
        self.write_task("in_progress")

        result = self.run_start()

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.read_status(), "in_progress")
        self.assertTrue((self.root / "hook-ran.txt").is_file())

    def test_degraded_mode_still_checks_brief_first(self) -> None:
        """无 session identity 时也必须先执行 brief 门禁。"""
        self.write_task()
        self.write_artifact("prd.md", 1_000_000_000)
        degraded_env = {
            key: value
            for key, value in os.environ.items()
            if key not in SESSION_ENV_KEYS
        }

        result = self.run_start(env=degraded_env)

        self.assert_guard_blocked(result)
        self.assertIn("brief.md is missing", result.stdout)
        self.assertNotIn("degraded mode", result.stdout)

    def test_status_write_failure_returns_nonzero_without_pointer_or_hook(self) -> None:
        """planning 状态写入失败时不得设置 pointer 或执行 after_start。"""
        self.write_task()
        for name in ("prd.md", "design.md", "implement.md"):
            self.write_artifact(name, 1_000_000_000)
        self.write_artifact("brief.md", 2_000_000_000)
        output = StringIO()

        with self.loaded_task_module() as module:
            with mock.patch.dict(os.environ, self.env, clear=False):
                with mock.patch.object(module, "write_json", return_value=False):
                    with redirect_stdout(output):
                        result = module.cmd_start(module.argparse.Namespace(dir=self.task_dir.name))

        self.assertEqual(result, 1)
        self.assertEqual(self.read_status(), "planning")
        self.assertFalse((self.root / "hook-ran.txt").exists())
        self.assertFalse((self.root / ".trellis/.runtime/sessions").exists())
        self.assertIn("Failed to persist task status", output.getvalue())

    def test_pointer_failure_restores_planning_status_and_skips_hook(self) -> None:
        """pointer 绑定失败时补偿恢复 planning。"""
        self.write_task()
        for name in ("prd.md", "design.md", "implement.md"):
            self.write_artifact(name, 1_000_000_000)
        self.write_artifact("brief.md", 2_000_000_000)

        with self.loaded_task_module() as module:
            real_write = module.write_json
            with mock.patch.dict(os.environ, self.env, clear=False):
                with mock.patch.object(module, "set_active_task", return_value=None):
                    with mock.patch.object(module, "write_json", side_effect=real_write):
                        result = module.cmd_start(module.argparse.Namespace(dir=self.task_dir.name))

        self.assertEqual(result, 1)
        self.assertEqual(self.read_status(), "planning")
        self.assertFalse((self.root / "hook-ran.txt").exists())

    def test_pointer_failure_and_rollback_failure_report_manual_recovery(self) -> None:
        """pointer 与补偿写入都失败时保留真实状态并提示人工检查。"""
        self.write_task()
        for name in ("prd.md", "design.md", "implement.md"):
            self.write_artifact(name, 1_000_000_000)
        self.write_artifact("brief.md", 2_000_000_000)
        output = StringIO()

        with self.loaded_task_module() as module:
            real_write = module.write_json
            calls = 0

            def controlled_write(path: Path, data: dict) -> bool:
                nonlocal calls
                calls += 1
                if calls == 1:
                    return real_write(path, data)
                return False

            with mock.patch.dict(os.environ, self.env, clear=False):
                with mock.patch.object(module, "set_active_task", return_value=None):
                    with mock.patch.object(module, "write_json", side_effect=controlled_write):
                        with redirect_stdout(output):
                            result = module.cmd_start(
                                module.argparse.Namespace(dir=self.task_dir.name)
                            )

        self.assertEqual(result, 1)
        self.assertEqual(self.read_status(), "in_progress")
        self.assertFalse((self.root / "hook-ran.txt").exists())
        self.assertIn("Task status rollback also failed", output.getvalue())

    def test_degraded_status_write_failure_returns_nonzero_without_hook(self) -> None:
        """降级模式的 planning 状态写失败时同样失败关闭。"""
        self.write_task()
        for name in ("prd.md", "design.md", "implement.md"):
            self.write_artifact(name, 1_000_000_000)
        self.write_artifact("brief.md", 2_000_000_000)
        degraded_env = {
            key: value
            for key, value in os.environ.items()
            if key not in SESSION_ENV_KEYS
        }
        output = StringIO()

        with self.loaded_task_module() as module:
            with mock.patch.dict(os.environ, degraded_env, clear=True):
                with mock.patch.object(module, "write_json", return_value=False):
                    with redirect_stdout(output):
                        result = module.cmd_start(
                            module.argparse.Namespace(dir=self.task_dir.name)
                        )

        self.assertEqual(result, 1)
        self.assertEqual(self.read_status(), "planning")
        self.assertFalse((self.root / "hook-ran.txt").exists())
        self.assertFalse((self.root / ".trellis/.runtime/sessions").exists())
        self.assertIn("Failed to persist task status", output.getvalue())

    def test_finish_unlink_failure_returns_nonzero_and_skips_hook(self) -> None:
        """session 文件删除失败时 finish 不得报告成功或执行 hook。"""
        self.write_task("in_progress")
        session = self.root / ".trellis/.runtime/sessions/brief-gate-test.json"
        session.parent.mkdir(parents=True)
        session.write_text(
            json.dumps({"current_task": self.task_dir.relative_to(self.root).as_posix()}),
            encoding="utf-8",
        )

        with self.loaded_task_module() as module:
            active_task = sys.modules["common.active_task"]
            with mock.patch.dict(os.environ, self.env, clear=False):
                with mock.patch.object(active_task, "_remove_file", return_value=False):
                    result = module.cmd_finish(module.argparse.Namespace())

        self.assertEqual(result, 1)
        self.assertTrue(session.exists())
        self.assertFalse((self.root / "finish-hook-ran.txt").exists())


if __name__ == "__main__":
    unittest.main()
