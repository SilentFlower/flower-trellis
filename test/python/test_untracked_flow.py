"""untracked_flow.py 轻量流程游标测试。"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "vendor/skill-garden/.trellis/0.6/scripts"
COMMON_DIR = ROOT / ".trellis/scripts/common"


class UntrackedFlowTest(unittest.TestCase):
    """在隔离 Trellis 项目验证 untracked 流程游标。"""

    def setUp(self) -> None:
        """创建不依赖 Git 的隔离 Trellis 项目。"""
        self.temp = tempfile.TemporaryDirectory(prefix="flower-untracked-")
        self.root = Path(self.temp.name) / "root"
        scripts = self.root / ".trellis/scripts"
        scripts.mkdir(parents=True)
        shutil.copy2(SOURCE_DIR / "untracked_flow.py", scripts / "untracked_flow.py")
        shutil.copytree(COMMON_DIR, scripts / "common")
        (self.root / ".trellis/.gitignore").write_text(
            ".runtime/\n*.tmp\n",
            encoding="utf-8",
        )
        self.env = {**os.environ, "TRELLIS_CONTEXT_ID": "codex_untracked_test"}

    def tearDown(self) -> None:
        """删除隔离项目。"""
        self.temp.cleanup()

    def _run(self, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
        """在隔离项目运行命令并返回结果。"""
        return subprocess.run(
            list(args),
            cwd=self.root,
            env=self.env,
            capture_output=True,
            text=True,
            check=check,
        )

    def _helper(self, *args: str, check: bool = True) -> tuple[subprocess.CompletedProcess[str], dict]:
        """运行 untracked helper 并解析 JSON。"""
        result = self._run(
            "python3",
            ".trellis/scripts/untracked_flow.py",
            *args,
            check=False,
        )
        payload = json.loads(result.stdout)
        if check and result.returncode != 0:
            self.fail(f"helper failed: {payload}\n{result.stderr}")
        return result, payload

    def _session_path(self) -> Path:
        """返回当前测试 session runtime 路径。"""
        return self.root / ".trellis/.runtime/sessions/codex_untracked_test.json"

    def _session(self) -> dict:
        """读取当前测试 session runtime。"""
        return json.loads(self._session_path().read_text(encoding="utf-8"))

    def test_begin_is_single_active_and_writes_minimal_v2_state(self) -> None:
        """同事项 begin 幂等，不同事项冲突且 v2 只保存流程字段。"""
        session = self._session_path()
        session.parent.mkdir(parents=True)
        session.write_text(
            json.dumps({"route_decisions": {"check": {"mode": "inline"}}}),
            encoding="utf-8",
        )

        _, created = self._helper(
            "begin",
            "--summary",
            "修改 A",
            "--source",
            "user-explicit",
            "--mode",
            "tracked-direct-edit",
        )
        _, hit = self._helper(
            "begin",
            "--summary",
            "修改 A",
            "--source",
            "user-explicit",
            "--mode",
            "tracked-direct-edit",
        )
        result, conflict = self._helper(
            "begin",
            "--summary",
            "修改 B",
            "--source",
            "user-explicit",
            "--mode",
            "tracked-direct-edit",
            check=False,
        )

        self.assertEqual(created["status"], "created")
        self.assertEqual(created["stage"], "implement")
        self.assertEqual(created["owner"], "trellis-route(target=implement)")
        self.assertEqual(
            created["remainingOwners"],
            [
                "trellis-route(target=implement)",
                "trellis-check-all",
                "trellis-update-spec",
                "trellis-push",
            ],
        )
        self.assertEqual(hit["status"], "hit")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(conflict["reason"], "active-work-conflict")
        runtime = self._session()
        self.assertEqual(runtime["route_decisions"], {"check": {"mode": "inline"}})
        self.assertEqual(
            set(runtime["untracked_flow"]),
            {"version", "id", "source", "summary", "stage", "createdAt", "updatedAt"},
        )

    def test_begin_requires_tracked_direct_edit_mode(self) -> None:
        """小改和 workflow action 不应创建可恢复 untracked 游标。"""
        result = self._run(
            "python3",
            ".trellis/scripts/untracked_flow.py",
            "begin",
            "--summary",
            "快速改动",
            "--source",
            "inferred",
            check=False,
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("the following arguments are required: --mode", result.stderr)

        result = self._run(
            "python3",
            ".trellis/scripts/untracked_flow.py",
            "begin",
            "--summary",
            "发布 beta",
            "--source",
            "inferred",
            "--mode",
            "workflow-action",
            check=False,
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(
            json.loads(result.stdout),
            {
                "status": "error",
                "reason": "invalid-entry-mode",
                "message": "只有需要跨轮恢复的无任务直接修改才能创建无任务事项",
                "mode": "workflow-action",
                "allowed": ["tracked-direct-edit"],
            },
        )
        self.assertFalse(self._session_path().exists())

    def test_stage_cursor_ignores_workspace_changes_and_allows_backtrack(self) -> None:
        """文件变化不阻止阶段推进，findings 可把游标设回 implement。"""
        self._helper(
            "begin",
            "--summary",
            "完成链",
            "--source",
            "inferred",
            "--mode",
            "tracked-direct-edit",
        )
        observed = []
        expected_owners = {
            "check": [
                "trellis-check-all",
                "trellis-update-spec",
                "trellis-push",
            ],
            "spec": [
                "trellis-update-spec",
                "trellis-push",
            ],
            "push": ["trellis-push"],
            "implement": [
                "trellis-route(target=implement)",
                "trellis-check-all",
                "trellis-update-spec",
                "trellis-push",
            ],
        }
        for stage in ("check", "spec", "push", "implement"):
            (self.root / f"changed-{stage}.txt").write_text(stage, encoding="utf-8")
            _, payload = self._helper("advance", "--stage", stage)
            observed.append(payload["stage"])
            self.assertEqual(payload["remainingOwners"], expected_owners[stage])

        self.assertEqual(observed, ["check", "spec", "push", "implement"])
        state = self._session()["untracked_flow"]
        for removed in (
            "baseline",
            "scope",
            "preparedFingerprint",
            "workspaceFingerprint",
            "evidence",
        ):
            self.assertNotIn(removed, state)

    def test_status_verbose_exposes_minimal_state_and_default_stays_compact(self) -> None:
        """verbose 返回内部游标，默认输出不暴露 state。"""
        self._helper(
            "begin",
            "--summary",
            "详细状态",
            "--source",
            "inferred",
            "--mode",
            "tracked-direct-edit",
        )

        _, compact = self._helper("status")
        _, verbose = self._helper("status", "--verbose")

        self.assertNotIn("state", compact)
        self.assertEqual(verbose["state"]["summary"], "详细状态")
        self.assertEqual(verbose["state"]["version"], 2)
        self.assertEqual(verbose["state"]["stage"], "implement")

    def test_v1_state_is_read_and_lazily_migrated(self) -> None:
        """旧 v1 evidence 状态可读取，并在下一次写入时收缩为 v2。"""
        path = self._session_path()
        path.parent.mkdir(parents=True)
        legacy = {
            "version": 1,
            "id": "uw-legacy",
            "mode": "direct_edit",
            "source": "inferred",
            "summary": "旧事项",
            "stage": "inspect",
            "baseline": {"fingerprint": "old"},
            "scope": ["src/old.py"],
            "workspaceFingerprint": "old",
            "evidence": {"checkAll": {"result": "pass"}},
            "createdAt": "2026-07-31T00:00:00Z",
            "updatedAt": "2026-07-31T00:00:00Z",
        }
        path.write_text(json.dumps({"untracked_flow": legacy}), encoding="utf-8")

        _, status = self._helper("status", "--verbose")

        self.assertEqual(status["stage"], "implement")
        self.assertEqual(status["state"]["version"], 2)
        self.assertEqual(self._session()["untracked_flow"]["version"], 1)

        self._helper("advance", "--stage", "check")
        migrated = self._session()["untracked_flow"]
        self.assertEqual(migrated["version"], 2)
        self.assertEqual(migrated["stage"], "check")
        self.assertNotIn("baseline", migrated)
        self.assertNotIn("evidence", migrated)

    def test_session_start_hint_reports_current_cursor(self) -> None:
        """SessionStart 提示只携带事项、阶段和摘要。"""
        _, created = self._helper(
            "begin",
            "--summary",
            "恢复事项",
            "--source",
            "inferred",
            "--mode",
            "tracked-direct-edit",
        )
        self._helper("advance", "--stage", "push")

        _, payload = self._helper("session-start-hint")

        self.assertEqual(payload["status"], "hit")
        self.assertIn(created["workId"], payload["hint"])
        self.assertIn("stage=push", payload["hint"])
        self.assertIn("owner=trellis-push", payload["hint"])
        self.assertIn("remaining=trellis-push", payload["hint"])
        self.assertIn("summary=恢复事项", payload["hint"])
        self.assertNotIn("trellis-check-all", payload["hint"])
        self.assertNotIn("trellis-update-spec", payload["hint"])

    def test_cross_session_and_active_task_are_isolated(self) -> None:
        """其它 session 不继承事项，当前 session 有 task 时拒绝 begin 和 clear。"""
        _, created = self._helper(
            "begin",
            "--summary",
            "session A",
            "--source",
            "inferred",
            "--mode",
            "tracked-direct-edit",
        )
        other_env = {**self.env, "TRELLIS_CONTEXT_ID": "codex_other"}
        result = subprocess.run(
            ["python3", ".trellis/scripts/untracked_flow.py", "status"],
            cwd=self.root,
            env=other_env,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(json.loads(result.stdout)["status"], "miss")

        runtime = self._session()
        runtime["current_task"] = ".trellis/tasks/task-a"
        self._session_path().write_text(json.dumps(runtime), encoding="utf-8")
        status_result, status = self._helper("status", check=False)
        self.assertEqual(status_result.returncode, 0)
        self.assertEqual(status["status"], "not-applicable")
        self.assertEqual(status["reason"], "active-task-present")
        self.assertEqual(status["task"], ".trellis/tasks/task-a")

        result, payload = self._helper(
            "begin",
            "--summary",
            "new",
            "--source",
            "inferred",
            "--mode",
            "tracked-direct-edit",
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(payload["reason"], "active-task-present")

        result, payload = self._helper(
            "clear",
            "--reason",
            "abandoned",
            "--work-id",
            created["workId"],
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(payload["reason"], "active-task-present")
        self.assertIn("untracked_flow", self._session())

    def test_corrupt_runtime_and_replace_failure_preserve_existing_data(self) -> None:
        """损坏或原子替换失败不覆盖旧 runtime。"""
        path = self._session_path()
        path.parent.mkdir(parents=True)
        path.write_text("{broken", encoding="utf-8")
        result, payload = self._helper(
            "begin",
            "--summary",
            "broken",
            "--source",
            "inferred",
            "--mode",
            "tracked-direct-edit",
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(payload["reason"], "session-runtime-corrupt")
        self.assertEqual(path.read_text(encoding="utf-8"), "{broken")

        module = types.ModuleType("untracked_atomic_test")
        module.__file__ = str(SOURCE_DIR / "untracked_flow.py")
        scripts_path = str(self.root / ".trellis/scripts")
        sys.path.insert(0, scripts_path)
        try:
            source = (SOURCE_DIR / "untracked_flow.py").read_text(encoding="utf-8")
            exec(compile(source, module.__file__, "exec"), module.__dict__)
            path.write_text('{"old": true}\n', encoding="utf-8")
            with mock.patch.object(module.os, "replace", side_effect=OSError("failed")):
                with self.assertRaises(OSError):
                    module._write_json(path, {"new": True})
            self.assertEqual(path.read_text(encoding="utf-8"), '{"old": true}\n')
        finally:
            sys.path.remove(scripts_path)

    def test_clear_requires_matching_work_id(self) -> None:
        """精确 work id 防止误清其它事项。"""
        _, created = self._helper(
            "begin",
            "--summary",
            "clear",
            "--source",
            "inferred",
            "--mode",
            "tracked-direct-edit",
        )
        result, mismatch = self._helper(
            "clear",
            "--reason",
            "abandoned",
            "--work-id",
            "uw-other",
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(mismatch["reason"], "work-id-mismatch")

        _, cleared = self._helper(
            "clear",
            "--reason",
            "abandoned",
            "--work-id",
            created["workId"],
        )
        self.assertTrue(cleared["existed"])
        self.assertNotIn("untracked_flow", self._session())

    def test_removed_evidence_commands_are_not_exposed(self) -> None:
        """旧证据子命令不再出现在 CLI 帮助中。"""
        result = self._run(
            "python3",
            ".trellis/scripts/untracked_flow.py",
            "--help",
        )

        for command in ("prepare-edit", "record-validation", "record-check", "record-spec"):
            self.assertNotIn(command, result.stdout)

    def test_status_from_linked_worktree_does_not_read_main_trellis_root(self) -> None:
        """linked worktree 无本地 .trellis 时不得读取其它分支 runtime。"""
        (self.root / "README.md").write_text("main\n", encoding="utf-8")
        self._run("git", "init")
        self._run("git", "config", "user.email", "test@example.invalid")
        self._run("git", "config", "user.name", "Test User")
        self._run("git", "add", "README.md")
        self._run("git", "commit", "-m", "init")
        linked = Path(self.temp.name) / "linked"
        self._run("git", "worktree", "add", "--detach", str(linked), "HEAD")

        _, created = self._helper(
            "begin",
            "--summary",
            "worktree 恢复",
            "--source",
            "inferred",
            "--mode",
            "tracked-direct-edit",
        )

        result = subprocess.run(
            [
                "python3",
                str(self.root / ".trellis/scripts/untracked_flow.py"),
                "status",
            ],
            cwd=linked,
            env=self.env,
            capture_output=True,
            text=True,
            check=False,
        )
        payload = json.loads(result.stdout)

        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(payload["status"], "error")
        self.assertEqual(payload["reason"], "not-trellis-project")
        self.assertEqual(self._session()["untracked_flow"]["id"], created["workId"])

    def test_nested_git_boundary_does_not_read_parent_trellis_root(self) -> None:
        """嵌套 worktree 根有 `.git` 时不得继续读取父目录的 Trellis。"""
        nested = self.root / "nested-linked"
        nested.mkdir()
        (nested / ".git").write_text("gitdir: /tmp/example\n", encoding="utf-8")

        result = subprocess.run(
            ["python3", str(self.root / ".trellis/scripts/untracked_flow.py"), "status"],
            cwd=nested,
            env=self.env,
            capture_output=True,
            text=True,
            check=False,
        )
        payload = json.loads(result.stdout)

        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(payload["reason"], "not-trellis-project")


if __name__ == "__main__":
    unittest.main()
