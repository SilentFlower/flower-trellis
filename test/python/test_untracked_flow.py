"""untracked_flow.py 无任务状态机测试。"""

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
    """在隔离多仓 Trellis 项目验证 untracked 状态机。"""

    def setUp(self) -> None:
        """创建根仓、submodule 和独立 Git package。"""
        self.temp = tempfile.TemporaryDirectory(prefix="flower-untracked-")
        self.root = Path(self.temp.name) / "root"
        self.root.mkdir()
        scripts = self.root / ".trellis/scripts"
        scripts.mkdir(parents=True)
        shutil.copy2(SOURCE_DIR / "git_evidence.py", scripts / "git_evidence.py")
        shutil.copy2(SOURCE_DIR / "untracked_flow.py", scripts / "untracked_flow.py")
        shutil.copytree(COMMON_DIR, scripts / "common")
        (self.root / ".trellis/config.yaml").write_text(
            "project:\n  type: monorepo\npackages:\n  external:\n    path: packages/external\n    git: true\n",
            encoding="utf-8",
        )
        (self.root / ".trellis/.gitignore").write_text(
            ".runtime/\n*.tmp\n",
            encoding="utf-8",
        )
        self._init_repo(self.root)
        (self.root / "tracked.txt").write_text("root\n", encoding="utf-8")
        self._git(self.root, "add", "tracked.txt")
        self._git(self.root, "commit", "-qm", "root")

        self.submodule_source = Path(self.temp.name) / "submodule-source"
        self.submodule_source.mkdir()
        self._init_repo(self.submodule_source)
        (self.submodule_source / "sub.txt").write_text("sub\n", encoding="utf-8")
        self._git(self.submodule_source, "add", "sub.txt")
        self._git(self.submodule_source, "commit", "-qm", "sub")
        self._git(
            self.root,
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            "-q",
            str(self.submodule_source),
            "vendor/sub",
        )
        self._git(self.root, "commit", "-qam", "submodule")

        self.external = self.root / "packages/external"
        self.external.mkdir(parents=True)
        self._init_repo(self.external)
        (self.external / "external.txt").write_text("external\n", encoding="utf-8")
        self._git(self.external, "add", "external.txt")
        self._git(self.external, "commit", "-qm", "external")
        self.env = {**os.environ, "TRELLIS_CONTEXT_ID": "codex_untracked_test"}

    def tearDown(self) -> None:
        """删除隔离仓库。"""
        self.temp.cleanup()

    def _init_repo(self, path: Path) -> None:
        """初始化带测试身份的 Git 仓库。"""
        self._run(path, "git", "init", "-q")
        self._run(path, "git", "config", "user.name", "Tester")
        self._run(path, "git", "config", "user.email", "tester@example.com")

    def _run(self, cwd: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
        """在指定目录运行命令并返回结果。"""
        return subprocess.run(
            list(args),
            cwd=cwd,
            env=self.env if hasattr(self, "env") else os.environ,
            capture_output=True,
            text=True,
            check=check,
        )

    def _git(self, cwd: Path, *args: str) -> subprocess.CompletedProcess[str]:
        """在指定仓库运行 Git。"""
        return self._run(cwd, "git", *args)

    def _helper(self, *args: str, check: bool = True) -> tuple[subprocess.CompletedProcess[str], dict]:
        """运行 untracked helper 并解析 JSON。"""
        result = self._run(
            self.root,
            "python3",
            ".trellis/scripts/untracked_flow.py",
            *args,
            check=False,
        )
        payload = json.loads(result.stdout)
        if check and result.returncode != 0:
            self.fail(f"helper failed: {payload}\n{result.stderr}")
        return result, payload

    def _session(self) -> dict:
        """读取当前测试 session runtime。"""
        path = self.root / ".trellis/.runtime/sessions/codex_untracked_test.json"
        return json.loads(path.read_text(encoding="utf-8"))

    def test_begin_is_single_active_and_preserves_runtime_fields(self) -> None:
        """同事项 begin 幂等，不同事项冲突且保留其它 runtime 字段。"""
        session = self.root / ".trellis/.runtime/sessions/codex_untracked_test.json"
        session.parent.mkdir(parents=True)
        session.write_text(json.dumps({"route_decisions": {"check": {"mode": "inline"}}}), encoding="utf-8")

        _, created = self._helper("begin", "--summary", "修改 A", "--source", "user-explicit")
        _, hit = self._helper("begin", "--summary", "修改 A", "--source", "user-explicit")
        result, conflict = self._helper(
            "begin",
            "--summary",
            "修改 B",
            "--source",
            "user-explicit",
            check=False,
        )

        self.assertEqual(created["status"], "created")
        self.assertEqual(created["stage"], "inspect")
        self.assertEqual(hit["status"], "hit")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(conflict["reason"], "active-work-conflict")
        self.assertEqual(self._session()["route_decisions"], {"check": {"mode": "inline"}})

    def test_prepare_edit_captures_all_repositories_and_immutable_baseline(self) -> None:
        """首次 edit 捕获根仓、submodule 与独立 package，后续不覆盖 baseline。"""
        self._helper("begin", "--summary", "多仓修改", "--source", "inferred")
        _, prepared = self._helper("prepare-edit", "--paths", "tracked.txt")
        first = self._session()["untracked_flow"]["baseline"]
        roots = {entry["root"] for entry in first["repositories"]}
        self.assertEqual(roots, {".", "packages/external", "vendor/sub"})

        (self.root / "tracked.txt").write_text("changed\n", encoding="utf-8")
        self._helper("prepare-edit", "--paths", "vendor/sub/sub.txt")
        second = self._session()["untracked_flow"]["baseline"]

        self.assertEqual(first["fingerprint"], second["fingerprint"])
        self.assertEqual(prepared["stage"], "implement")
        self.assertEqual(
            self._session()["untracked_flow"]["scope"],
            ["tracked.txt", "vendor/sub/sub.txt"],
        )

    def test_staged_content_is_recorded_and_not_reset(self) -> None:
        """已有 staged 内容进入 baseline，但 helper 不修改 index。"""
        (self.root / "tracked.txt").write_text("staged\n", encoding="utf-8")
        self._git(self.root, "add", "tracked.txt")
        before = self._run(self.root, "git", "diff", "--cached").stdout

        self._helper("begin", "--summary", "保留 staged", "--source", "inferred")
        self._helper("prepare-edit", "--paths", "tracked.txt")

        root_evidence = next(
            entry
            for entry in self._session()["untracked_flow"]["baseline"]["repositories"]
            if entry["root"] == "."
        )
        self.assertTrue(any(entry["status"][0] != " " for entry in root_evidence["status"]))
        self.assertEqual(self._run(self.root, "git", "diff", "--cached").stdout, before)

    def test_validation_stage_chain_and_new_edit_invalidates_evidence(self) -> None:
        """证据绑定 fingerprint，完成链可推进且新修改清空下游结果。"""
        self._helper("begin", "--summary", "完成链", "--source", "inferred")
        self._helper("prepare-edit", "--paths", "tracked.txt")
        (self.root / "tracked.txt").write_text("changed\n", encoding="utf-8")
        self._helper("record-validation", "--result", "pass", "--summary", "unit")
        self._helper("advance", "--stage", "check")
        self._helper("record-check", "--result", "pass", "--summary", "full")
        self._helper("advance", "--stage", "spec")
        self._helper("record-spec", "--result", "no-op", "--summary", "none")
        _, pushed = self._helper("advance", "--stage", "push")
        self.assertEqual(pushed["stage"], "push")

        self._helper("prepare-edit", "--paths", "tracked.txt")
        state = self._session()["untracked_flow"]
        self.assertEqual(state["stage"], "implement")
        self.assertEqual(state["evidence"], {})

    def test_prepare_edit_blocks_drift_after_focused_validation(self) -> None:
        """implement 阶段已有验证证据时，外部漂移不能被下一批修改吸收。"""
        self._helper("begin", "--summary", "验证后漂移", "--source", "inferred")
        self._helper("prepare-edit", "--paths", "tracked.txt")
        (self.root / "tracked.txt").write_text("changed\n", encoding="utf-8")
        self._helper("record-validation", "--result", "pass", "--summary", "unit")
        (self.external / "external.txt").write_text("drift\n", encoding="utf-8")

        result, payload = self._helper(
            "prepare-edit",
            "--paths",
            "tracked.txt",
            check=False,
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(payload["reason"], "workspace-drift")
        self.assertIn("focusedValidation", self._session()["untracked_flow"]["evidence"])

    def test_workspace_drift_blocks_verified_stage(self) -> None:
        """未授权 workspace 漂移不能沿用已验证证据。"""
        self._helper("begin", "--summary", "漂移", "--source", "inferred")
        self._helper("prepare-edit", "--paths", "tracked.txt")
        (self.root / "tracked.txt").write_text("changed\n", encoding="utf-8")
        self._helper("record-validation", "--result", "pass", "--summary", "unit")
        self._helper("advance", "--stage", "check")
        (self.external / "external.txt").write_text("drift\n", encoding="utf-8")

        result, payload = self._helper("status", check=False)

        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(payload["reason"], "workspace-drift")
        self.assertIn("untracked_flow", self._session())

    def test_status_verbose_exposes_state_and_default_output_stays_compact(self) -> None:
        """verbose status 返回完整状态，默认输出继续隐藏内部 schema。"""
        self._helper("begin", "--summary", "详细状态", "--source", "inferred")
        self._helper("prepare-edit", "--paths", "tracked.txt")

        _, compact = self._helper("status")
        _, verbose = self._helper("status", "--verbose")

        self.assertNotIn("state", compact)
        self.assertEqual(verbose["state"]["summary"], "详细状态")
        self.assertEqual(verbose["state"]["scope"], ["tracked.txt"])

    def test_verified_work_is_cleared_after_workspace_returns_to_baseline(self) -> None:
        """已实际验证的事项完全回滚后，status 自动清理旧状态。"""
        self._helper("begin", "--summary", "恢复 baseline", "--source", "inferred")
        self._helper("prepare-edit", "--paths", "tracked.txt")
        (self.root / "tracked.txt").write_text("changed\n", encoding="utf-8")
        self._helper("record-validation", "--result", "pass", "--summary", "unit")
        (self.root / "tracked.txt").write_text("root\n", encoding="utf-8")

        _, payload = self._helper("status")

        self.assertEqual(payload["status"], "miss")
        self.assertEqual(payload["reason"], "baseline-restored")
        self.assertNotIn("untracked_flow", self._session())

    def test_new_work_replaces_reverted_unvalidated_item(self) -> None:
        """旧事项未留下 workspace 差异时，新事项不会被 stale guard 阻塞。"""
        self._helper("begin", "--summary", "旧事项", "--source", "inferred")
        self._helper("prepare-edit", "--paths", "tracked.txt")

        _, created = self._helper("begin", "--summary", "新事项", "--source", "inferred")

        self.assertEqual(created["status"], "created")
        self.assertEqual(created["summary"], "新事项")

    def test_cross_session_and_active_task_are_isolated(self) -> None:
        """其它 session 不继承事项，当前 session 有 task 时拒绝 begin。"""
        self._helper("begin", "--summary", "session A", "--source", "inferred")
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
        path = self.root / ".trellis/.runtime/sessions/codex_untracked_test.json"
        path.write_text(json.dumps(runtime), encoding="utf-8")
        result, payload = self._helper(
            "begin",
            "--summary",
            "new",
            "--source",
            "inferred",
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(payload["reason"], "active-task-present")

    def test_corrupt_runtime_and_replace_failure_preserve_evidence(self) -> None:
        """损坏或原子替换失败不覆盖旧 runtime。"""
        path = self.root / ".trellis/.runtime/sessions/codex_untracked_test.json"
        path.parent.mkdir(parents=True)
        path.write_text("{broken", encoding="utf-8")
        result, payload = self._helper(
            "begin",
            "--summary",
            "broken",
            "--source",
            "inferred",
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
        _, created = self._helper("begin", "--summary", "clear", "--source", "inferred")
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


if __name__ == "__main__":
    unittest.main()
