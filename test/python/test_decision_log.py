"""AI 决策日志的持久化与审查测试。"""

from __future__ import annotations

import sys
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "vendor/skill-garden/.trellis/0.6/scripts/decision_log.py"
COMMON_SOURCE = ROOT / ".trellis/scripts/common"


def load_module():
    """加载 canonical decision_log 模块。

    Returns:
        已加载的 Python 模块。
    """
    spec = importlib.util.spec_from_file_location("flower_decision_log", SOURCE)
    if spec is None or spec.loader is None:
        raise RuntimeError("无法加载 decision_log.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class DecisionLogTest(unittest.TestCase):
    """验证决策审查、返工要求与任务生命周期的独立性。"""

    def setUp(self) -> None:
        """创建隔离任务目录。"""
        self.temp = tempfile.TemporaryDirectory(prefix="flower-decision-log-")
        self.task_dir = Path(self.temp.name) / ".trellis/tasks/task-one"
        self.task_dir.mkdir(parents=True)
        self.module = load_module()

    def tearDown(self) -> None:
        """清理隔离目录。"""
        self.temp.cleanup()

    def append(self, topic: str = "默认实现") -> dict:
        """追加一条测试决策。

        Args:
            topic: 决策主题。

        Returns:
            新增的决策事件。
        """
        return self.module.append_decision(
            self.task_dir,
            run_id="auto-test",
            topic=topic,
            options=["A", "B"],
            choice="A",
            summary="仓库现有模式使用 A",
            evidence=["src/example.py"],
            risk="low",
            confidence="high",
            requirements=["R4"],
            files=["src/example.py"],
        )

    def run_cli(self, root: Path, *args: str) -> tuple[subprocess.CompletedProcess[str], dict]:
        """在隔离项目运行 decision_log CLI。

        Args:
            root: 隔离 Trellis 项目根目录。
            *args: 传给 decision_log.py 的参数。

        Returns:
            子进程结果和解析后的 JSON 输出。
        """
        scripts_dir = root / ".trellis/scripts"
        scripts_dir.mkdir(parents=True, exist_ok=True)
        if not (scripts_dir / "common").exists():
            shutil.copytree(COMMON_SOURCE, scripts_dir / "common")
        result = subprocess.run(
            [sys.executable, "-X", "utf8", str(SOURCE), *args],
            cwd=root,
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=False,
        )
        return result, json.loads(result.stdout)

    def write_active_task(self, task_dir: Path) -> None:
        """创建可被共享 active 解析器识别的任务记录。"""
        task_dir.mkdir(parents=True)
        (task_dir / "task.json").write_text(
            json.dumps({"status": "in_progress", "children": []}) + "\n",
            encoding="utf-8",
        )

    def test_append_requires_review_but_allows_close(self) -> None:
        """决策 ID 递增，未审查状态不阻塞 Close。"""
        first = self.append()
        second = self.append("错误处理")

        status = self.module.decision_review_status(self.task_dir)

        self.assertEqual(first["decision_id"], "DEC-0001")
        self.assertEqual(second["decision_id"], "DEC-0002")
        self.assertEqual(status["decision_count"], 2)
        self.assertTrue(status["needs_review"])
        self.assertTrue(status["close_allowed"])
        self.assertEqual(status["pending_change_ids"], [])

    def test_accept_all_binds_current_digest(self) -> None:
        """接受全部后当前 digest 可 Close。"""
        self.append()
        event = self.module.review_decisions(self.task_dir, verdict="accepted")

        status = self.module.decision_review_status(self.task_dir)

        self.assertEqual(event["decision_digest"], status["decision_digest"])
        self.assertEqual(status["review_verdict"], "accepted")
        self.assertTrue(status["close_allowed"])

    def test_new_decision_invalidates_old_review(self) -> None:
        """新增 decision 后旧 review digest 自动失效。"""
        self.append()
        self.module.review_decisions(self.task_dir, verdict="accepted")
        self.append("新增决策")

        status = self.module.decision_review_status(self.task_dir)

        self.assertIsNone(status["review_verdict"])
        self.assertTrue(status["needs_review"])
        self.assertTrue(status["close_allowed"])

    def test_changes_requested_requires_known_ids(self) -> None:
        """返工审查必须指定存在的 decision ID。"""
        self.append()
        with self.assertRaises(self.module.DecisionLogError):
            self.module.review_decisions(self.task_dir, verdict="changes-requested")
        with self.assertRaises(self.module.DecisionLogError):
            self.module.review_decisions(
                self.task_dir,
                verdict="changes-requested",
                decision_ids=["DEC-9999"],
            )

        self.module.review_decisions(
            self.task_dir,
            verdict="changes-requested",
            decision_ids=["DEC-0001"],
        )
        status = self.module.decision_review_status(self.task_dir)
        self.assertEqual(status["review_verdict"], "changes-requested")
        self.assertFalse(status["close_allowed"])
        self.assertEqual(status["pending_change_ids"], ["DEC-0001"])

    def test_new_decisions_preserve_requested_changes_until_acceptance(self) -> None:
        """新增决策不清除已要求返工的旧决策，明确接受后才解除。"""
        self.append()
        self.module.review_decisions(
            self.task_dir, verdict="changes-requested", decision_ids=["DEC-0001"],
        )
        self.append("新增决策")

        status = self.module.decision_review_status(self.task_dir)

        self.assertIsNone(status["review_verdict"])
        self.assertTrue(status["needs_review"])
        self.assertFalse(status["close_allowed"])
        self.assertEqual(status["pending_change_ids"], ["DEC-0001"])
        self.module.review_decisions(self.task_dir, verdict="accepted")
        self.append("审查后新增的决策")
        status = self.module.decision_review_status(self.task_dir)
        self.assertTrue(status["close_allowed"])
        self.assertTrue(status["needs_review"])
        self.assertEqual(status["pending_change_ids"], [])

    def test_multiple_change_requests_accumulate(self) -> None:
        """后一次返工审查不会覆盖前一次尚未解决的决策 ID。"""
        self.append()
        self.append("另一项决策")
        for decision_id in ["DEC-0001", "DEC-0002"]:
            self.module.review_decisions(
                self.task_dir, verdict="changes-requested", decision_ids=[decision_id],
            )

        status = self.module.decision_review_status(self.task_dir)

        self.assertEqual(status["pending_change_ids"], ["DEC-0001", "DEC-0002"])
        self.assertFalse(status["close_allowed"])
        self.module.review_decisions(self.task_dir, verdict="accepted")
        self.assertTrue(self.module.decision_review_status(self.task_dir)["close_allowed"])

    def test_invalid_review_binding_cannot_clear_requested_changes(self) -> None:
        """损坏的审查摘要、决策集合和返工引用不能被视为可关闭。"""
        self.append()
        self.module.review_decisions(
            self.task_dir, verdict="changes-requested", decision_ids=["DEC-0001"],
        )
        path = self.task_dir / "decisions.jsonl"
        original = path.read_text(encoding="utf-8")
        for field, value in [
            ("decision_digest", "invalid"),
            ("decision_ids", ["DEC-9999"]),
            ("requested_decision_ids", []),
            ("requested_decision_ids", ["DEC-9999"]),
        ]:
            with self.subTest(field=field, value=value):
                events = [json.loads(line) for line in original.splitlines()]
                events[-1][field] = value
                path.write_text("\n".join(json.dumps(event) for event in events) + "\n", encoding="utf-8")
                with self.assertRaises(self.module.DecisionLogError):
                    self.module.decision_review_status(self.task_dir)

    def test_high_risk_decision_is_rejected(self) -> None:
        """高风险事项不能伪装成已授权决策。"""
        with self.assertRaises(self.module.DecisionLogError):
            self.module.append_decision(
                self.task_dir,
                run_id="auto-test",
                topic="生产发布",
                options=["deploy"],
                choice="deploy",
                summary="禁止",
                evidence=[],
                risk="high",
                confidence="high",
                requirements=[],
                files=[],
            )

    def test_corrupt_jsonl_fails_closed(self) -> None:
        """损坏日志不能被覆盖或视为无决策。"""
        path = self.task_dir / "decisions.jsonl"
        path.write_text("{broken\n", encoding="utf-8")
        before = path.read_bytes()

        with self.assertRaises(self.module.DecisionLogError):
            self.append()

        self.assertEqual(path.read_bytes(), before)

    def test_atomic_replace_failure_preserves_old_log(self) -> None:
        """原子替换失败时保留旧日志。"""
        self.append()
        path = self.task_dir / "decisions.jsonl"
        before = path.read_bytes()
        with mock.patch.object(self.module.os, "replace", side_effect=OSError("replace failed")):
            with self.assertRaises(OSError):
                self.append("替换失败")
        self.assertEqual(path.read_bytes(), before)

    def test_log_lines_are_valid_json_objects(self) -> None:
        """日志保持一行一个 JSON 对象。"""
        self.append()
        self.module.review_decisions(self.task_dir, verdict="accepted")

        lines = (self.task_dir / "decisions.jsonl").read_text(encoding="utf-8").splitlines()

        self.assertEqual(len(lines), 2)
        self.assertTrue(all(isinstance(json.loads(line), dict) for line in lines))

    def test_cli_resolves_unique_short_task_name(self) -> None:
        """唯一短名与完整日期目录得到同一任务。"""
        root = Path(self.temp.name)
        task_dir = root / ".trellis/tasks/09-03-unique-one"
        self.write_active_task(task_dir)

        result, payload = self.run_cli(root, "status", "--task", "unique-one", "--json")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["decision_count"], 0)
        self.assertTrue(payload["close_allowed"])
        self.assertFalse(payload["needs_review"])

    def test_cli_reviews_closed_and_archived_tasks_without_reopening(self) -> None:
        """已关闭和已归档任务仍可审查，审查写入不改变任务工作状态。"""
        root = Path(self.temp.name)
        for relative in ["09-03-closed", "archive/2026-09/09-04-archived"]:
            with self.subTest(task=relative):
                self.task_dir = root / ".trellis/tasks" / relative
                self.write_active_task(self.task_dir)
                task_json = self.task_dir / "task.json"
                task_json.write_text(json.dumps({
                    "status": "completed", "children": [],
                    "closeout": {"status": "closed", "closedAt": "2026-09-01T00:00:00Z", "blockers": []},
                }) + "\n", encoding="utf-8")
                before = task_json.read_bytes()
                self.append()
                task_ref = self.task_dir.relative_to(root).as_posix()

                for reference in [task_ref, str(self.task_dir), self.task_dir.name]:
                    status_result, status = self.run_cli(root, "status", "--task", reference, "--json")
                    self.assertEqual(status_result.returncode, 0, status_result.stderr)
                    self.assertTrue(status["needs_review"])
                    self.assertTrue(status["close_allowed"])
                review_result, review = self.run_cli(
                    root, "review", "--task", str(self.task_dir), "--verdict", "accepted",
                )

                self.assertEqual(review_result.returncode, 0, review_result.stderr)
                self.assertEqual(review["status"], "reviewed")
                self.assertFalse(self.module.decision_review_status(self.task_dir)["needs_review"])
                self.assertEqual(task_json.read_bytes(), before)

    def test_cli_rejects_ambiguous_active_and_archived_suffix(self) -> None:
        """短名跨活跃与归档目录有歧义时失败，完整归档路径可唯一定位。"""
        root = Path(self.temp.name)
        self.write_active_task(root / ".trellis/tasks/09-02-shared")
        archived = root / ".trellis/tasks/archive/2026-09/09-03-shared"
        self.write_active_task(archived)

        result, payload = self.run_cli(root, "status", "--task", "shared", "--json")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("任务引用存在歧义", payload["message"])
        self.assertIn("archive/2026-09/09-03-shared", payload["message"])
        result, payload = self.run_cli(root, "status", "--task", archived.relative_to(root).as_posix(), "--json")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(payload["status"], "ok")

    def test_cli_rejects_duplicate_task_identity_across_archive(self) -> None:
        """同名任务同时出现在顶层和归档时，不通过显式路径绕过身份冲突。"""
        root = Path(self.temp.name)
        self.write_active_task(root / ".trellis/tasks/09-03-duplicate")
        self.write_active_task(root / ".trellis/tasks/archive/2026-09/09-03-duplicate")

        result, payload = self.run_cli(
            root, "status", "--task", ".trellis/tasks/09-03-duplicate", "--json",
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Duplicate task identity", payload["message"])

    def test_cli_rejects_symlink_alias_to_archived_task(self) -> None:
        """归档分桶的软链别名不能扩大审查写入路径。"""
        root = Path(self.temp.name)
        archived = root / ".trellis/tasks/archive/2026-09/09-03-archived"
        self.write_active_task(archived)
        alias = archived.parent.parent / "alias"
        try:
            alias.symlink_to(archived.parent, target_is_directory=True)
        except OSError as error:
            if os.name == "nt" and getattr(error, "winerror", None) == 1314:
                self.skipTest("Windows 当前用户没有创建目录软链的权限")
            raise

        result, payload = self.run_cli(
            root, "review", "--task", f".trellis/tasks/archive/alias/{archived.name}", "--verdict", "accepted",
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("本项目任务目录", payload["message"])
        self.assertFalse((archived / "decisions.jsonl").exists())

    def test_cli_review_defers_for_unfinished_maintenance(self) -> None:
        """维护事务未恢复时不追加审查，也不删除事务恢复证据。"""
        root = Path(self.temp.name)
        task_dir = root / ".trellis/tasks/09-03-review"
        self.write_active_task(task_dir)
        self.task_dir = task_dir
        self.append()
        before = (task_dir / "decisions.jsonl").read_bytes()
        for name in ["task-gc-transaction.json", "task-maintenance-commit.json"]:
            with self.subTest(journal=name):
                journal = root / ".trellis/.runtime" / name
                journal.parent.mkdir(parents=True, exist_ok=True)
                journal.write_text("{}\n", encoding="utf-8")

                result, payload = self.run_cli(
                    root, "review", "--task", task_dir.name, "--verdict", "accepted",
                )

                self.assertNotEqual(result.returncode, 0)
                self.assertIn("维护事务尚未恢复", payload["message"])
                self.assertEqual((task_dir / "decisions.jsonl").read_bytes(), before)
                self.assertTrue(journal.is_file())
                journal.unlink()

    def test_cli_rejects_ambiguous_short_task_name(self) -> None:
        """多个日期目录命中同一短名时必须列出候选并失败。"""
        root = Path(self.temp.name)
        self.write_active_task(root / ".trellis/tasks/09-02-shared")
        self.write_active_task(root / ".trellis/tasks/09-03-shared")

        result, payload = self.run_cli(root, "status", "--task", "shared", "--json")

        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(payload["reason"], "decision-log-error")
        self.assertIn("任务引用存在歧义", payload["message"])
        self.assertIn("09-02-shared", payload["message"])
        self.assertIn("09-03-shared", payload["message"])

    def test_cli_rejects_task_path_outside_tasks(self) -> None:
        """项目外和任务目录外的路径都不能被解析。"""
        root = Path(self.temp.name)
        outside = root / "outside"
        outside.mkdir()

        result, payload = self.run_cli(root, "status", "--task", str(outside), "--json")

        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(payload["reason"], "decision-log-error")
        self.assertIn("必须指向本项目任务目录", payload["message"])


if __name__ == "__main__":
    unittest.main()
