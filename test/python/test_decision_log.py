"""AI 决策日志的持久化与审查测试。"""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "vendor/skill-garden/.trellis/0.6/scripts/decision_log.py"


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
    """验证 append-only 决策、digest 与归档门禁。"""

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

    def test_append_assigns_ids_and_requires_review(self) -> None:
        """决策 ID 递增，未审查时归档门禁关闭。"""
        first = self.append()
        second = self.append("错误处理")

        status = self.module.decision_review_status(self.task_dir)

        self.assertEqual(first["decision_id"], "DEC-0001")
        self.assertEqual(second["decision_id"], "DEC-0002")
        self.assertEqual(status["decision_count"], 2)
        self.assertTrue(status["needs_review"])
        self.assertFalse(status["archive_allowed"])

    def test_accept_all_binds_current_digest(self) -> None:
        """接受全部后当前 digest 可归档。"""
        self.append()
        event = self.module.review_decisions(self.task_dir, verdict="accepted")

        status = self.module.decision_review_status(self.task_dir)

        self.assertEqual(event["decision_digest"], status["decision_digest"])
        self.assertEqual(status["review_verdict"], "accepted")
        self.assertTrue(status["archive_allowed"])

    def test_new_decision_invalidates_old_review(self) -> None:
        """新增 decision 后旧 review digest 自动失效。"""
        self.append()
        self.module.review_decisions(self.task_dir, verdict="accepted")
        self.append("新增决策")

        status = self.module.decision_review_status(self.task_dir)

        self.assertIsNone(status["review_verdict"])
        self.assertTrue(status["needs_review"])

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
        self.assertFalse(status["archive_allowed"])

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


if __name__ == "__main__":
    unittest.main()
