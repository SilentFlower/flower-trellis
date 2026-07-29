"""auto_loop.py 检查深度与自动续跑回归测试。"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from importlib import util as importlib_util
from pathlib import Path
from unittest import mock


PROJECT_ROOT = Path(__file__).resolve().parents[2]
SOURCE_RUNNER = PROJECT_ROOT / "vendor/skill-garden/.trellis/0.6/scripts/auto_loop.py"
SOURCE_DECISION_LOG = PROJECT_ROOT / "vendor/skill-garden/.trellis/0.6/scripts/decision_log.py"
SOURCE_SCRIPTS = PROJECT_ROOT / ".trellis/scripts"


class AutoLoopCheckDepthTest(unittest.TestCase):
    """在隔离 Trellis 目录中验证检查深度状态机。"""

    def setUp(self) -> None:
        """创建 runner 与两个 in_progress 任务。"""
        self.temp = tempfile.TemporaryDirectory(prefix="flower-auto-loop-")
        self.root = Path(self.temp.name)
        scripts = self.root / ".trellis/scripts"
        scripts.mkdir(parents=True)
        shutil.copy2(SOURCE_RUNNER, scripts / "auto_loop.py")
        shutil.copy2(SOURCE_DECISION_LOG, scripts / "decision_log.py")
        shutil.copy2(SOURCE_SCRIPTS / "task.py", scripts / "task.py")
        shutil.copy2(SOURCE_SCRIPTS / "task_progress.py", scripts / "task_progress.py")
        shutil.copytree(SOURCE_SCRIPTS / "common", scripts / "common")
        (self.root / ".trellis/.developer").write_text("name=tester\n", encoding="utf-8")
        (self.root / ".trellis/config.yaml").write_text(
            "project:\n  type: single\n",
            encoding="utf-8",
        )
        self.env = {
            **os.environ,
            "TRELLIS_CONTEXT_ID": "auto-loop-test",
            "PYTHONDONTWRITEBYTECODE": "1",
        }
        for name in ("task-one", "task-two"):
            task_dir = self.root / ".trellis/tasks" / name
            task_dir.mkdir(parents=True)
            (task_dir / "task.json").write_text(
                json.dumps({"status": "in_progress"}),
                encoding="utf-8",
            )

    def tearDown(self) -> None:
        """删除隔离目录。"""
        self.temp.cleanup()

    def runner(self, *args: str) -> dict:
        """执行 runner 并返回 JSON。

        Args:
            args: auto_loop.py 子命令参数。

        Returns:
            runner 输出的 JSON 对象。
        """
        result = subprocess.run(
            ["python3", ".trellis/scripts/auto_loop.py", *args],
            cwd=self.root,
            env=self.env,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        return payload

    def start(self, *extra: str, tasks: tuple[str, ...] = ("task-one",)) -> dict:
        """启动固定 run。

        Args:
            extra: 追加的 start 参数。
            tasks: 按顺序加入队列的任务名。

        Returns:
            start 输出。
        """
        refs = [f".trellis/tasks/{task}" for task in tasks]
        return self.runner(
            "start",
            "--run-id",
            "auto-test",
            "--tasks",
            *refs,
            *extra,
        )

    def advance_to_check(self, *start_args: str) -> dict:
        """启动并推进到首次 Check-All action。

        Args:
            start_args: 追加的 start 参数。

        Returns:
            run_check_all action。
        """
        self.start(*start_args)
        implement = self.runner("next")
        self.assertEqual(implement["action"], "run_implement")
        self.runner(
            "record",
            "--action",
            "run_implement",
            "--result",
            "ok",
            "--route-mode",
            "inline",
            "--route-source",
            "trellis-route",
        )
        return self.runner("next")

    def state_path(self) -> Path:
        """返回测试 run 状态文件。

        Returns:
            auto-test.json 路径。
        """
        return self.root / ".trellis/.runtime/auto-loop/auto-test.json"

    def task_json(self, task: str = "task-one") -> dict:
        """读取测试任务元数据。

        Args:
            task: 测试任务目录名。

        Returns:
            任务 `task.json` 内容。
        """
        path = self.root / ".trellis/tasks" / task / "task.json"
        return json.loads(path.read_text(encoding="utf-8"))

    def progress_status(self, task: str = ".trellis/tasks/task-one") -> dict:
        """通过 task_progress.py 读取任务进度。

        Args:
            task: 任务目录引用。

        Returns:
            task_progress.py 输出的 JSON 对象。
        """
        result = subprocess.run(
            [
                "python3",
                ".trellis/scripts/task_progress.py",
                "status",
                "--task",
                task,
                "--json",
            ],
            cwd=self.root,
            env=self.env,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return json.loads(result.stdout)

    def manifest_events(self) -> list[dict]:
        """读取测试 run 的 manifest audit 事件。"""
        path = self.root / ".trellis/.runtime/auto-loop/auto-test.manifest.jsonl"
        return [
            json.loads(line)
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]

    def write_planning_task(self, open_questions: str) -> None:
        """创建带指定 Open Questions 的 planning 任务。"""
        task_dir = self.root / ".trellis/tasks/task-planning"
        task_dir.mkdir(parents=True, exist_ok=True)
        (task_dir / "task.json").write_text(
            json.dumps({"status": "planning"}),
            encoding="utf-8",
        )
        (task_dir / "prd.md").write_text(
            f"# Planning\n\n## Goal\n\nTest\n\n## Open Questions\n\n{open_questions}\n",
            encoding="utf-8",
        )
        (task_dir / "brief.md").write_text("# Brief\n", encoding="utf-8")

    def start_planning(self) -> dict:
        """启动使用 inline route 的 planning run。"""
        return self.runner(
            "start",
            "--run-id",
            "auto-test",
            "--tasks",
            ".trellis/tasks/task-planning",
            "--route-implement",
            "inline",
            "--route-check",
            "check-all-inline",
        )

    def record_planning_ready(self) -> dict:
        """完成当前 planning task 的语义就绪复核。

        Returns:
            readiness record 输出。
        """
        action = self.runner("next")
        self.assertEqual(action["action"], "review_planning_readiness")
        return self.runner(
            "record",
            "--action",
            "review_planning_readiness",
            "--result",
            "ok",
            "--readiness-verdict",
            "ready",
            "--summary",
            "验收标准可测试且关键决策已收敛",
        )

    def advance_planning_to_start(self) -> dict:
        """完成 readiness，并返回无需二次确认的 start action。

        Returns:
            start_task action。
        """
        self.record_planning_ready()
        action = self.runner("next")
        self.assertEqual(action["action"], "start_task")
        return action

    def load_runner_module(self):
        """加载 vendor runner 以测试底层 runtime helper。"""
        name = f"auto_loop_test_{id(self)}"
        spec = importlib_util.spec_from_file_location(name, SOURCE_RUNNER)
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        module = importlib_util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
        self.addCleanup(sys.modules.pop, name, None)
        return module

    def init_git_repo(self) -> None:
        """把隔离目录初始化为具有干净基线的 Git 仓库。"""
        commands = (
            ("init",),
            ("config", "user.email", "test@example.com"),
            ("config", "user.name", "Test User"),
            ("add", "."),
            ("commit", "-m", "baseline"),
        )
        for command in commands:
            result = subprocess.run(
                ["git", *command],
                cwd=self.root,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_open_questions_checkbox_contract(self) -> None:
        """unchecked 进入人工批量门禁，checked 与空章节进入 readiness。"""
        for content, expected in (
            ("- [ ] 待确认", "resolve_open_questions"),
            ("- [x] 已确认", "review_planning_readiness"),
            ("", "review_planning_readiness"),
        ):
            with self.subTest(content=content):
                shutil.rmtree(self.root / ".trellis/.runtime/auto-loop", ignore_errors=True)
                self.write_planning_task(content)
                self.start_planning()
                action = self.runner("next")
                self.assertEqual(action["action"], expected)
                if expected == "resolve_open_questions":
                    self.assertEqual(action["questions"][0]["question"], "待确认")
                    self.assertEqual(action["questions"][0]["kind"], "unchecked")

    def test_missing_open_questions_section_enters_semantic_readiness(self) -> None:
        """PRD 不包含 Open Questions 章节时仍必须进入 semantic readiness。"""
        self.write_planning_task("")
        prd = self.root / ".trellis/tasks/task-planning/prd.md"
        prd.write_text("# Planning\n\n## Goal\n\nTest\n", encoding="utf-8")
        self.start_planning()

        self.assertEqual(self.runner("next")["action"], "review_planning_readiness")

    def test_bare_open_questions_require_human_normalization(self) -> None:
        """历史裸列表必须由人工更新 artifacts，AI 不能代答。"""
        self.write_planning_task("- 无。当前实现口径已确认。")
        self.start_planning()

        action = self.runner("next")

        self.assertEqual(action["action"], "resolve_open_questions")
        self.assertEqual(action["questions"][0]["kind"], "bare")
        prd = self.root / ".trellis/tasks/task-planning/prd.md"
        prd.write_text("# Planning\n\n## Goal\n\nTest\n", encoding="utf-8")
        recorded = self.runner(
            "record",
            "--action",
            "resolve_open_questions",
            "--result",
            "ok",
        )
        self.assertEqual(recorded["summary"]["run_status"], "preparing")
        self.assertEqual(self.runner("next")["action"], "review_planning_readiness")

    def test_unresolved_open_questions_cannot_be_recorded_as_done(self) -> None:
        """人工问题仍存在时 resolve record 必须拒绝。"""
        self.write_planning_task("- TBD")
        self.start_planning()
        self.assertEqual(self.runner("next")["action"], "resolve_open_questions")

        rejected = self.runner(
            "record",
            "--action",
            "resolve_open_questions",
            "--result",
            "ok",
        )

        self.assertEqual(rejected["reason"], "open-questions-still-unresolved")

    def test_open_questions_are_collected_across_the_full_queue(self) -> None:
        """prepare 必须一次汇总全部 planning 任务的人工问题。"""
        self.write_planning_task("- [ ] 第一个问题")
        second = self.root / ".trellis/tasks/task-planning-two"
        second.mkdir()
        (second / "task.json").write_text(json.dumps({"status": "planning"}), encoding="utf-8")
        (second / "prd.md").write_text(
            "# Two\n\n## Goal\n\nTest\n\n## Open Questions\n\n- [ ] 第二个问题\n",
            encoding="utf-8",
        )
        (second / "brief.md").write_text("# Brief\n", encoding="utf-8")
        self.runner(
            "start",
            "--run-id",
            "auto-test",
            "--tasks",
            ".trellis/tasks/task-planning",
            ".trellis/tasks/task-planning-two",
            "--route-implement",
            "inline",
            "--route-check",
            "check-all-inline",
        )

        action = self.runner("next")

        self.assertEqual(action["action"], "resolve_open_questions")
        self.assertEqual([item["question"] for item in action["questions"]], ["第一个问题", "第二个问题"])
        state = json.loads(self.state_path().read_text(encoding="utf-8"))
        self.assertEqual(state["status"], "awaiting_input")
        self.assertEqual(len(state["queue"]), 2)

    def test_planning_readiness_is_hash_bound_and_blocks_conservatively(self) -> None:
        """readiness 结论绑定 artifacts，blocking 不能启动任务。"""
        self.write_planning_task("")
        self.start_planning()
        self.assertEqual(self.runner("next")["action"], "review_planning_readiness")
        prd = self.root / ".trellis/tasks/task-planning/prd.md"
        prd.write_text(prd.read_text(encoding="utf-8") + "\nChanged\n", encoding="utf-8")
        rejected = self.runner(
            "record",
            "--action",
            "review_planning_readiness",
            "--result",
            "ok",
            "--readiness-verdict",
            "ready",
            "--summary",
            "旧结论",
        )
        self.assertEqual(rejected["reason"], "stale-planning-readiness-review")

        shutil.rmtree(self.root / ".trellis/.runtime/auto-loop", ignore_errors=True)
        self.write_planning_task("")
        self.start_planning()
        self.runner("next")
        recorded = self.runner(
            "record",
            "--action",
            "review_planning_readiness",
            "--result",
            "blocked",
            "--readiness-verdict",
            "blocking",
            "--summary",
            "验收标准仍不可测试",
        )
        self.assertEqual(recorded["item_status"], "blocked")

    def test_stale_brief_refresh_enters_start_without_confirmation(self) -> None:
        """brief 刷新后直接进入 start_task，不再返回 confirm_brief。"""
        self.write_planning_task("")
        prd = self.root / ".trellis/tasks/task-planning/prd.md"
        prd.write_text(prd.read_text(encoding="utf-8") + "\nNew requirement\n", encoding="utf-8")
        brief = self.root / ".trellis/tasks/task-planning/brief.md"
        os.utime(brief, ns=(1, 1))
        self.start_planning()
        self.record_planning_ready()

        refresh = self.runner("next")
        self.assertEqual(refresh["action"], "refresh_brief")
        brief.write_text("# Brief\n\nUpdated\n", encoding="utf-8")
        self.runner("record", "--action", "refresh_brief", "--result", "ok")

        self.assertEqual(self.runner("next")["action"], "start_task")

    def test_manifest_artifact_drift_blocks_current_item(self) -> None:
        """manifest 冻结后无 decision 的 artifact 变化必须阻塞。"""
        self.write_planning_task("")
        self.start_planning()
        self.record_planning_ready()
        self.assertEqual(self.runner("next")["action"], "start_task")
        brief = self.root / ".trellis/tasks/task-planning/brief.md"
        brief.write_text("# Brief\n\nChanged after display\n", encoding="utf-8")

        recorded = self.runner(
            "record",
            "--action",
            "start_task",
            "--result",
            "ok",
        )
        self.assertEqual(recorded["item_status"], "blocked")
        state = json.loads(self.state_path().read_text(encoding="utf-8"))
        self.assertEqual(state["queue"][0]["blocked"]["reason"], "artifact-drift")

    def test_check_doc_remediation_rebinds_manifest(self) -> None:
        """Check-All 声明的 implement 文档修复会生成可审计 manifest revision。"""
        self.advance_to_check()
        task_ref = ".trellis/tasks/task-one"
        implement = self.root / task_ref / "implement.md"
        implement.write_text("# Implement\n\n- [x] 已完成\n", encoding="utf-8")

        recorded = self.runner(
            "record",
            "--action",
            "run_check_all",
            "--result",
            "ok",
            "--effective-check-depth",
            "light",
            "--check-depth-reason",
            "仅修复机械实施状态",
            "--doc-remediation-file",
            f".::{task_ref}/implement.md",
        )

        self.assertEqual(recorded["current_step"], "spec_update")
        state = json.loads(self.state_path().read_text(encoding="utf-8"))
        item = state["queue"][0]
        self.assertEqual(state["manifest_revision"], 2)
        self.assertEqual(item["attempts"]["artifact_reconcile"], 0)
        self.assertIn(
            "check_doc_artifacts_rebound",
            [event["type"] for event in item["decision_log"]],
        )
        event = self.manifest_events()[-1]["payload"]
        self.assertEqual(event["change_source"], "check-doc-remediation")
        self.assertEqual(event["files"], [f".::{task_ref}/implement.md"])

    def test_check_doc_remediation_rejects_illegal_or_mismatched_files(self) -> None:
        """DOC 重绑只接受当前任务 implement/brief 且声明必须等于实际变化。"""
        self.advance_to_check()
        task_ref = ".trellis/tasks/task-one"
        implement = self.root / task_ref / "implement.md"
        implement.write_text("# Implement\n\n- [x] 已完成\n", encoding="utf-8")

        illegal = self.runner(
            "record",
            "--action",
            "run_check_all",
            "--result",
            "ok",
            "--effective-check-depth",
            "light",
            "--doc-remediation-file",
            f".::{task_ref}/prd.md",
        )
        self.assertEqual(illegal["reason"], "doc-remediation-file-not-allowed")

        mismatched = self.runner(
            "record",
            "--action",
            "run_check_all",
            "--result",
            "ok",
            "--effective-check-depth",
            "light",
            "--doc-remediation-file",
            f".::{task_ref}/brief.md",
        )
        self.assertEqual(mismatched["reason"], "doc-remediation-files-mismatch")
        state = json.loads(self.state_path().read_text(encoding="utf-8"))
        self.assertEqual(state["queue"][0]["last_action"]["action"], "run_check_all")
        self.assertEqual(state["manifest_revision"], 1)

    def test_check_artifact_drift_is_retryable_then_accepts_doc_declaration(self) -> None:
        """漏报 Check DOC 修复时保留 outstanding action，补充声明后可重录成功。"""
        self.advance_to_check()
        task_ref = ".trellis/tasks/task-one"
        implement = self.root / task_ref / "implement.md"
        implement.write_text("# Implement\n\n- [x] 已完成\n", encoding="utf-8")

        retryable = self.runner(
            "record",
            "--action",
            "run_check_all",
            "--result",
            "ok",
            "--effective-check-depth",
            "light",
        )
        self.assertEqual(retryable["status"], "retryable")
        self.assertEqual(retryable["attempt"], 1)
        self.assertEqual(retryable["outstanding_action"], "run_check_all")

        recorded = self.runner(
            "record",
            "--action",
            "run_check_all",
            "--result",
            "ok",
            "--effective-check-depth",
            "light",
            "--check-depth-reason",
            "补充 DOC 声明后重录",
            "--doc-remediation-file",
            f".::{task_ref}/implement.md",
        )
        self.assertEqual(recorded["current_step"], "spec_update")
        state = json.loads(self.state_path().read_text(encoding="utf-8"))
        self.assertEqual(state["queue"][0]["attempts"]["artifact_reconcile"], 0)

    def test_check_artifact_drift_blocks_after_retry_budget(self) -> None:
        """同一 Check action 连续 4 次无法消解漂移时才进入 blocked。"""
        self.advance_to_check()
        implement = self.root / ".trellis/tasks/task-one/implement.md"
        implement.write_text("# Implement\n\n- [x] 已完成\n", encoding="utf-8")

        for attempt in (1, 2, 3):
            retryable = self.runner(
                "record",
                "--action",
                "run_check_all",
                "--result",
                "ok",
                "--effective-check-depth",
                "light",
            )
            self.assertEqual(retryable["status"], "retryable")
            self.assertEqual(retryable["attempt"], attempt)

        blocked = self.runner(
            "record",
            "--action",
            "run_check_all",
            "--result",
            "ok",
            "--effective-check-depth",
            "light",
        )
        self.assertEqual(blocked["status"], "recorded")
        self.assertEqual(blocked["item_status"], "blocked")
        state = json.loads(self.state_path().read_text(encoding="utf-8"))
        self.assertEqual(state["queue"][0]["attempts"]["artifact_reconcile"], 4)
        self.assertEqual(state["queue"][0]["blocked"]["reason"], "artifact-drift")

    def test_check_artifact_drift_can_be_explicitly_blocked(self) -> None:
        """agent 确认漂移无法安全归因时可立即结束同一 Check action。"""
        self.advance_to_check()
        implement = self.root / ".trellis/tasks/task-one/implement.md"
        implement.write_text("# Implement\n\n外部修改\n", encoding="utf-8")
        self.assertEqual(
            self.runner(
                "record",
                "--action",
                "run_check_all",
                "--result",
                "ok",
                "--effective-check-depth",
                "light",
            )["status"],
            "retryable",
        )

        blocked = self.runner(
            "record",
            "--action",
            "run_check_all",
            "--result",
            "blocked",
            "--failure-type",
            "artifact-drift",
            "--summary",
            "无法确认外部修改归属",
            "--effective-check-depth",
            "light",
        )
        self.assertEqual(blocked["item_status"], "blocked")

    def test_planning_repair_rechecks_with_independent_budget(self) -> None:
        """repairable planning 会进入修复 action 并重新执行 readiness。"""
        self.write_planning_task("")
        self.start_planning()
        self.assertEqual(self.runner("next")["action"], "review_planning_readiness")
        self.runner(
            "record",
            "--action",
            "review_planning_readiness",
            "--result",
            "ok",
            "--readiness-verdict",
            "repairable",
            "--summary",
            "验收标准需要改为可测试表达",
        )
        self.assertEqual(self.runner("next")["action"], "run_planning_repair")
        prd = self.root / ".trellis/tasks/task-planning/prd.md"
        prd.write_text(prd.read_text(encoding="utf-8") + "\n## Acceptance\n\n- [ ] 可验证\n", encoding="utf-8")
        self.runner(
            "record",
            "--action",
            "run_planning_repair",
            "--result",
            "ok",
            "--summary",
            "补齐可测试验收标准",
        )

        self.assertEqual(self.runner("next")["action"], "review_planning_readiness")
        state = json.loads(self.state_path().read_text(encoding="utf-8"))
        self.assertEqual(state["queue"][0]["planning_attempts"], 1)

    def test_explicit_dependencies_stably_reorder_queue(self) -> None:
        """显式依赖冲突时稳定拓扑排序，不把原顺序当依赖。"""
        self.start(
            "--depends-on",
            ".trellis/tasks/task-two=.trellis/tasks/task-one",
            tasks=("task-two", "task-one"),
        )

        action = self.runner("next")
        state = json.loads(self.state_path().read_text(encoding="utf-8"))

        self.assertEqual(action["task"], ".trellis/tasks/task-one")
        self.assertEqual(
            [item["task"] for item in state["queue"]],
            [".trellis/tasks/task-one", ".trellis/tasks/task-two"],
        )
        self.assertEqual(state["queue_reordered"]["reason"], "explicit-dependencies")

    def test_dependency_failure_blocks_only_dependents(self) -> None:
        """前置任务失败只传播到显式依赖项，独立任务继续。"""
        third = self.root / ".trellis/tasks/task-three"
        third.mkdir()
        (third / "task.json").write_text(json.dumps({"status": "in_progress"}), encoding="utf-8")
        self.start(
            "--depends-on",
            ".trellis/tasks/task-two=.trellis/tasks/task-one",
            tasks=("task-one", "task-two", "task-three"),
        )
        self.assertEqual(self.runner("next")["task"], ".trellis/tasks/task-one")
        self.runner(
            "record",
            "--action",
            "run_implement",
            "--result",
            "blocked",
            "--failure-type",
            "product-decision",
            "--summary",
            "高风险事项需要人工处理",
        )

        action = self.runner("next")
        state = json.loads(self.state_path().read_text(encoding="utf-8"))

        self.assertEqual(action["task"], ".trellis/tasks/task-three")
        dependent = next(item for item in state["queue"] if item["task"].endswith("task-two"))
        self.assertEqual(dependent["blocked"]["reason"], "blocked-dependency")

    def test_dependency_cycle_globally_blocks_before_running(self) -> None:
        """循环依赖在 running 前进入稳定全局阻断。"""
        self.start(
            "--depends-on",
            ".trellis/tasks/task-one=.trellis/tasks/task-two",
            "--depends-on",
            ".trellis/tasks/task-two=.trellis/tasks/task-one",
            tasks=("task-one", "task-two"),
        )

        action = self.runner("next")

        self.assertEqual(action["status"], "globally_blocked")
        self.assertEqual(action["reason"], "invalid-task-dependencies")

    def test_dirty_baseline_protects_unrelated_file(self) -> None:
        """无关 dirty 文件可保留，但涉及它的任务 action 必须阻塞。"""
        self.init_git_repo()
        protected = self.root / "notes.txt"
        protected.write_text("user work\n", encoding="utf-8")
        self.start()
        classify = self.runner("next")
        self.assertEqual(classify["action"], "classify_dirty_baseline")
        baseline = classify["dirty"][0]
        key = f"{baseline['repository']}::{baseline['path']}"
        recorded_classification = self.runner(
            "record",
            "--action",
            "classify_dirty_baseline",
            "--result",
            "ok",
            "--protected-retained",
            key,
        )
        self.assertEqual(recorded_classification["status"], "recorded", recorded_classification)
        self.assertEqual(self.runner("next")["action"], "run_implement")

        recorded = self.runner(
            "record",
            "--action",
            "run_implement",
            "--result",
            "ok",
            "--files",
            "notes.txt",
        )

        self.assertEqual(recorded["item_status"], "blocked")
        self.assertEqual(protected.read_text(encoding="utf-8"), "user work\n")

    def test_protected_baseline_drift_blocks_current_action(self) -> None:
        """protected 文件即使未上报到 files，也会通过 hash 漂移阻塞当前任务。"""
        self.init_git_repo()
        protected = self.root / "notes.txt"
        protected.write_text("user work\n", encoding="utf-8")
        self.start()
        classify = self.runner("next")
        baseline = classify["dirty"][0]
        key = f"{baseline['repository']}::{baseline['path']}"
        self.runner(
            "record",
            "--action",
            "classify_dirty_baseline",
            "--result",
            "ok",
            "--protected-retained",
            key,
        )
        self.assertEqual(self.runner("next")["action"], "run_implement")
        protected.write_text("changed during action\n", encoding="utf-8")

        recorded = self.runner(
            "record",
            "--action",
            "run_implement",
            "--result",
            "ok",
        )

        state = json.loads(self.state_path().read_text(encoding="utf-8"))
        self.assertEqual(recorded["item_status"], "blocked")
        self.assertEqual(state["queue"][0]["blocked"]["reason"], "protected-baseline-drift")
        self.assertEqual(state["protected_drifts"][0]["files"][0]["actual_sha256"], state["repositories"][0]["protected_retained"][0]["current_sha256"])

    def test_protected_paths_keep_repository_identity(self) -> None:
        """主仓与子仓同名路径只匹配各自的 repository::path。"""
        module = self.load_runner_module()
        state = {
            "repositories": [
                {"root": "vendor/module", "protected_retained": [{"path": "notes.txt"}]},
            ],
        }

        self.assertEqual(module._protected_path_conflicts(state, ["notes.txt"]), [])
        self.assertEqual(
            module._protected_path_conflicts(state, ["vendor/module::notes.txt"]),
            ["vendor/module::notes.txt"],
        )

    def test_staged_git_state_blocks_start(self) -> None:
        """启动前存在 staged 文件时不得创建 runtime。"""
        self.init_git_repo()
        staged = self.root / "staged.txt"
        staged.write_text("staged\n", encoding="utf-8")
        subprocess.run(["git", "add", "staged.txt"], cwd=self.root, check=True)

        result = self.start()

        self.assertEqual(result["reason"], "git-global-safety-block")
        self.assertFalse(self.state_path().exists())

    def test_decision_persists_and_revises_manifest(self) -> None:
        """自主决策同时进入任务 JSONL、runtime 摘要和新 manifest revision。"""
        self.start()
        self.assertEqual(self.runner("next")["action"], "run_implement")

        decided = self.runner(
            "decide",
            "--task",
            ".trellis/tasks/task-one",
            "--topic",
            "错误消息格式",
            "--option",
            "沿用现有格式",
            "--option",
            "新增格式",
            "--choice",
            "沿用现有格式",
            "--summary",
            "仓库既有输出保持一致",
            "--evidence",
            "src/example.py",
            "--risk",
            "low",
            "--confidence",
            "high",
            "--requirement",
            "R4",
        )

        state = json.loads(self.state_path().read_text(encoding="utf-8"))
        events = (self.root / ".trellis/tasks/task-one/decisions.jsonl").read_text(encoding="utf-8").splitlines()
        self.assertEqual(decided["decision"]["decision_id"], "DEC-0001")
        self.assertEqual(len(events), 1)
        self.assertEqual(state["queue"][0]["decision_count"], 1)
        self.assertEqual(state["manifest_revision"], 1)

    def test_decision_authorizes_artifact_rebind_on_next_record(self) -> None:
        """决策列明的 planning/handoff 修改在下一次 record 生成新 manifest revision。"""
        self.write_planning_task("")
        self.start_planning()
        self.advance_planning_to_start()
        self.runner("record", "--action", "start_task", "--result", "ok")
        self.assertEqual(self.runner("next")["action"], "run_implement")
        task_ref = ".trellis/tasks/task-planning"
        decided = self.runner(
            "decide",
            "--task",
            task_ref,
            "--topic",
            "验收表达",
            "--option",
            "沿用现状",
            "--option",
            "补充边界",
            "--choice",
            "补充边界",
            "--summary",
            "现有需求已明确边界",
            "--risk",
            "low",
            "--confidence",
            "high",
            "--file",
            f"{task_ref}/prd.md",
            "--file",
            f"{task_ref}/brief.md",
        )
        self.assertTrue(decided["artifact_rebind_pending"])
        task_dir = self.root / task_ref
        (task_dir / "prd.md").write_text(
            (task_dir / "prd.md").read_text(encoding="utf-8") + "\n## Acceptance\n\n- [ ] 覆盖边界\n",
            encoding="utf-8",
        )
        (task_dir / "brief.md").write_text("# Brief\n\n已补充边界。\n", encoding="utf-8")

        recorded = self.runner(
            "record",
            "--action",
            "run_implement",
            "--result",
            "ok",
        )

        state = json.loads(self.state_path().read_text(encoding="utf-8"))
        self.assertEqual(recorded["item_status"], "running")
        self.assertEqual(state["manifest_revision"], 2)
        self.assertNotIn("manifest_revisions", state)
        self.assertEqual(self.manifest_events()[-1]["payload"]["decision_id"], "DEC-0001")
        self.assertEqual(state["queue"][0]["decision_ids"], ["DEC-0001"])
        self.assertIsNone(state["queue"][0]["pending_artifact_decision"])

    def test_cross_repo_jsonl_entries_remain_valid(self) -> None:
        """相对越过仓库根和绝对外部路径继续可作为 context。"""
        module = self.load_runner_module()
        outside = self.root.parent / f"{self.root.name}-outside.md"
        outside.write_text("context\n", encoding="utf-8")
        self.addCleanup(outside.unlink)
        manifest = self.root / "context.jsonl"
        for file_value in (os.path.relpath(outside, self.root), str(outside)):
            manifest.write_text(json.dumps({"file": file_value}) + "\n", encoding="utf-8")
            self.assertTrue(module._has_real_jsonl_entries(manifest, self.root))

    def test_atomic_runtime_write_preserves_old_file_when_replace_fails(self) -> None:
        """原子替换失败时旧 runtime 文件保持不变。"""
        module = self.load_runner_module()
        target = self.root / ".trellis/.runtime/auto-loop/atomic.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text('{"old": true}\n', encoding="utf-8")
        with mock.patch.object(module.os, "replace", side_effect=OSError("replace failed")):
            with self.assertRaises(OSError):
                module._write_json(target, {"new": True})
        self.assertEqual(target.read_text(encoding="utf-8"), '{"old": true}\n')

    def test_corrupt_pointer_recovers_unique_healthy_running_run(self) -> None:
        """current pointer 损坏但仅有一个健康 run 时自动重建指针。"""
        self.start()
        pointer = self.root / ".trellis/.runtime/auto-loop/current.json"
        pointer.write_text("{broken", encoding="utf-8")

        status = self.runner("status")

        self.assertEqual(status["run_status"], "preparing")
        self.assertEqual(json.loads(pointer.read_text(encoding="utf-8"))["run_id"], "auto-test")

    def test_corrupt_current_run_blocks_new_run(self) -> None:
        """current run 损坏时非 force start 不得创建第二个 run。"""
        self.start()
        self.state_path().write_text("{broken", encoding="utf-8")

        result = self.runner(
            "start",
            "--run-id",
            "auto-second",
            "--tasks",
            ".trellis/tasks/task-one",
        )

        self.assertEqual(result["reason"], "current-auto-state-invalid")
        self.assertFalse((self.root / ".trellis/.runtime/auto-loop/auto-second.json").exists())
        status = self.runner("status")
        self.assertEqual(status["run_status"], "invalid-current-run")
        self.assertEqual(status["reason"], "runtime-state-invalid")

    def test_auto_depth_records_light_pass_and_advances(self) -> None:
        """默认 auto 可记录 light 通过并进入 spec_update。"""
        check = self.advance_to_check()

        self.assertEqual(check["requested_check_depth"], "auto")
        self.assertIsNone(check["minimum_check_depth"])
        recorded = self.runner(
            "record",
            "--action",
            "run_check_all",
            "--result",
            "ok",
            "--route-mode",
            "check-all-inline",
            "--route-source",
            "trellis-route",
            "--effective-check-depth",
            "light",
            "--check-depth-reason",
            "局部低风险且定向验证通过",
        )
        self.assertEqual(recorded["current_step"], "spec_update")
        self.assertEqual(self.runner("next")["action"], "run_spec_update")

        state = json.loads(self.state_path().read_text(encoding="utf-8"))
        self.assertEqual(state["check_depth"], "auto")
        self.assertEqual(state["queue"][0]["last_check"]["effective_depth"], "light")

    def test_legacy_state_defaults_full_and_legacy_record_is_full(self) -> None:
        """旧 run 缺深度字段时 action 与旧 record 都按 full。"""
        self.start()
        state = json.loads(self.state_path().read_text(encoding="utf-8"))
        state["schema_version"] = 1
        state["status"] = "running"
        state.pop("check_depth")
        state["queue"][0]["current_step"] = "check"
        self.state_path().write_text(json.dumps(state), encoding="utf-8")

        check = self.runner("next")
        self.assertEqual(check["requested_check_depth"], "full")
        recorded = self.runner(
            "record",
            "--action",
            "run_check_all",
            "--result",
            "ok",
            "--check-depth-reason",
            "旧调用不应覆盖兼容原因",
        )
        self.assertEqual(recorded["summary"]["check_depth"], "full")
        state = json.loads(self.state_path().read_text(encoding="utf-8"))
        last_check = state["queue"][0]["last_check"]
        self.assertEqual(last_check["effective_depth"], "full")
        self.assertEqual(last_check["reason"], "legacy-default-full")

    def test_full_failure_recheck_rejects_light_downgrade(self) -> None:
        """首次检查升级 full 后，修复重检不得降回 light。"""
        self.advance_to_check("--check-depth", "light")
        self.runner(
            "record",
            "--action",
            "run_check_all",
            "--result",
            "failed",
            "--failure-type",
            "hard-full-risk",
            "--summary",
            "CHK-001 控制面变更需完整检查",
            "--effective-check-depth",
            "full",
            "--check-depth-reason",
            "命中工作流控制面 hard-full",
        )
        self.assertEqual(self.runner("next")["action"], "run_fix")
        self.runner("record", "--action", "run_fix", "--result", "ok")
        recheck = self.runner("next")
        self.assertEqual(recheck["action"], "run_recheck")
        self.assertEqual(recheck["requested_check_depth"], "light")
        self.assertEqual(recheck["minimum_check_depth"], "full")

        rejected = self.runner(
            "record",
            "--action",
            "run_recheck",
            "--result",
            "ok",
            "--effective-check-depth",
            "light",
            "--check-depth-reason",
            "错误降级",
        )
        self.assertEqual(rejected["reason"], "check-depth-below-minimum")
        accepted = self.runner(
            "record",
            "--action",
            "run_recheck",
            "--result",
            "ok",
            "--effective-check-depth",
            "full",
            "--check-depth-reason",
            "沿用 full 重检下限",
        )
        self.assertEqual(accepted["current_step"], "spec_update")

    def test_fix_budget_allows_three_run_fix_actions(self) -> None:
        """默认 3 轮预算必须实际发出 3 次 run_fix。"""
        self.advance_to_check()
        self.runner(
            "record",
            "--action",
            "run_check_all",
            "--result",
            "failed",
            "--failure-type",
            "check-failed",
            "--summary",
            "首次检查失败",
            "--effective-check-depth",
            "full",
            "--check-depth-reason",
            "测试失败预算",
        )

        for attempt in (1, 2, 3):
            with self.subTest(attempt=attempt):
                fix = self.runner("next")
                self.assertEqual(fix["action"], "run_fix")
                self.assertEqual(fix["attempt"], attempt)
                self.runner("record", "--action", "run_fix", "--result", "ok")
                recheck = self.runner("next")
                self.assertEqual(recheck["action"], "run_recheck")
                recorded = self.runner(
                    "record",
                    "--action",
                    "run_recheck",
                    "--result",
                    "failed",
                    "--failure-type",
                    "check-failed",
                    "--summary",
                    f"第 {attempt} 次重检失败",
                    "--effective-check-depth",
                    "full",
                    "--check-depth-reason",
                    "测试失败预算",
                )
                if attempt < 3:
                    self.assertEqual(recorded["current_step"], "fix")
                else:
                    self.assertEqual(recorded["item_status"], "blocked")

        state = json.loads(self.state_path().read_text(encoding="utf-8"))
        self.assertEqual(state["queue"][0]["attempts"]["fix_recheck"], 4)
        self.assertEqual(state["queue"][0]["blocked"]["reason"], "retry-budget-exhausted")

    def test_retry_blocked_resets_exhausted_fix_budget(self) -> None:
        """预算耗尽项显式恢复后必须获得新预算。"""
        self.start()
        state = json.loads(self.state_path().read_text(encoding="utf-8"))
        item = state["queue"][0]
        item["status"] = "blocked"
        item["current_step"] = "fix"
        item["attempts"] = {"fix_recheck": 4}
        item["blocked"] = {"reason": "retry-budget-exhausted", "summary": "预算耗尽"}
        state["status"] = "completed_with_blocked"
        self.state_path().write_text(json.dumps(state), encoding="utf-8")

        retried = self.runner("retry-blocked", "--run-id", "auto-test")

        self.assertEqual(retried["status"], "retry-ready")
        state = json.loads(self.state_path().read_text(encoding="utf-8"))
        self.assertEqual(state["queue"][0]["attempts"]["fix_recheck"], 0)
        fix = self.runner("next")
        self.assertEqual(fix["action"], "run_fix")
        self.assertEqual(fix["attempt"], 0)

    def test_retry_blocked_resets_artifact_reconcile_budget(self) -> None:
        """terminal artifact drift 经用户显式恢复后获得新的 Check 自纠预算。"""
        self.start()
        state = json.loads(self.state_path().read_text(encoding="utf-8"))
        item = state["queue"][0]
        item["status"] = "blocked"
        item["current_step"] = "check"
        item["attempts"] = {"fix_recheck": 0, "artifact_reconcile": 4}
        item["blocked"] = {"reason": "artifact-drift", "summary": "自纠预算耗尽"}
        state["status"] = "completed_with_blocked"
        self.state_path().write_text(json.dumps(state), encoding="utf-8")

        retried = self.runner("retry-blocked", "--run-id", "auto-test")

        self.assertEqual(retried["status"], "retry-ready")
        state = json.loads(self.state_path().read_text(encoding="utf-8"))
        self.assertEqual(state["queue"][0]["attempts"]["artifact_reconcile"], 0)

    def test_manifest_revisions_are_moved_to_audit_jsonl(self) -> None:
        """主 runtime 只保留热状态，完整 manifest 进入 audit JSONL。"""
        self.start()

        action = self.runner("next")

        self.assertEqual(action["action"], "run_implement")
        state = json.loads(self.state_path().read_text(encoding="utf-8"))
        self.assertNotIn("manifest_revisions", state)
        self.assertEqual(state["manifest_revision"], 1)
        self.assertEqual(
            state["manifest_audit_path"],
            ".trellis/.runtime/auto-loop/auto-test.manifest.jsonl",
        )
        events = self.manifest_events()
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["type"], "manifest_revision")
        self.assertEqual(events[0]["revision"], 1)
        self.assertEqual(events[0]["sha256"], state["manifest_sha256"])
        self.assertEqual(events[0]["payload"]["revision"], 1)

    def test_legacy_manifest_revisions_migrate_on_retry_write(self) -> None:
        """旧 runtime 的 manifest_revisions 在下一次写入时迁移到 audit JSONL。"""
        self.start()
        state = json.loads(self.state_path().read_text(encoding="utf-8"))
        item = state["queue"][0]
        item["status"] = "blocked"
        item["blocked"] = {"reason": "missing-check-context", "summary": "缺少检查上下文"}
        state["status"] = "blocked"
        state["manifest_revision"] = 2
        state["manifest_sha256"] = "b" * 64
        state["manifest_revisions"] = [
            {
                "revision": 1,
                "created_at": "2026-07-23T00:00:00Z",
                "sha256": "a" * 64,
                "tasks": [{"task": ".trellis/tasks/task-one"}],
            },
            {
                "revision": 2,
                "created_at": "2026-07-23T00:01:00Z",
                "sha256": "b" * 64,
                "tasks": [{"task": ".trellis/tasks/task-one"}],
            },
        ]
        self.state_path().write_text(json.dumps(state), encoding="utf-8")

        retried = self.runner("retry-blocked", "--run-id", "auto-test")

        self.assertEqual(retried["status"], "retry-ready")
        migrated = json.loads(self.state_path().read_text(encoding="utf-8"))
        self.assertNotIn("manifest_revisions", migrated)
        self.assertEqual(migrated["manifest_revision"], 2)
        self.assertIsNone(migrated["manifest_sha256"])
        events = self.manifest_events()
        self.assertEqual([event["revision"] for event in events], [1, 2])
        self.assertEqual([event["sha256"] for event in events], ["a" * 64, "b" * 64])
        status = self.runner("status", "--run-id", "auto-test", "--verbose")
        self.assertEqual(status["run_status"], "preparing")
        self.assertNotIn("manifest_revisions", status)

    def test_retry_blocked_can_update_run_check_depth(self) -> None:
        """retry-blocked 可在同一 run 更新深度策略。"""
        self.start("--check-depth", "auto")
        state = json.loads(self.state_path().read_text(encoding="utf-8"))
        item = state["queue"][0]
        item["status"] = "blocked"
        item["blocked"] = {"reason": "missing-check-context", "summary": "缺少检查上下文"}
        state["status"] = "blocked"
        self.state_path().write_text(json.dumps(state), encoding="utf-8")

        retried = self.runner(
            "retry-blocked",
            "--run-id",
            "auto-test",
            "--task",
            ".trellis/tasks/task-one",
            "--check-depth",
            "full",
        )
        self.assertEqual(retried["status"], "retry-ready")
        self.assertEqual(retried["summary"]["check_depth"], "full")

    def test_blocked_full_check_keeps_full_minimum_after_retry(self) -> None:
        """full 检查 blocked 后在同一 action 重试仍保留 full 下限。"""
        self.advance_to_check("--check-depth", "light")
        self.runner(
            "record",
            "--action",
            "run_check_all",
            "--result",
            "blocked",
            "--failure-type",
            "product-decision",
            "--summary",
            "需要用户确认破坏性行为",
            "--effective-check-depth",
            "full",
            "--check-depth-reason",
            "命中破坏性安全边界",
        )
        self.runner(
            "retry-blocked",
            "--run-id",
            "auto-test",
            "--task",
            ".trellis/tasks/task-one",
        )

        check = self.runner("next")
        self.assertEqual(check["action"], "run_check_all")
        self.assertEqual(check["requested_check_depth"], "light")
        self.assertEqual(check["minimum_check_depth"], "full")

    def test_check_pass_continues_to_next_task_without_confirmation(self) -> None:
        """首任务检查通过后可完成提交并直接返回下一任务 action。"""
        self.start(tasks=("task-one", "task-two"))
        self.assertEqual(self.runner("next")["task"], ".trellis/tasks/task-one")
        self.runner("record", "--action", "run_implement", "--result", "ok")
        self.runner("next")
        self.runner(
            "record",
            "--action",
            "run_check_all",
            "--result",
            "ok",
            "--effective-check-depth",
            "light",
            "--check-depth-reason",
            "定向检查通过",
        )
        self.runner("next")
        self.runner("record", "--action", "run_spec_update", "--result", "ok")
        self.runner("next")
        self.runner(
            "record",
            "--action",
            "commit_only",
            "--result",
            "ok",
            "--commit",
            "abc1234",
        )

        next_task = self.runner("next")
        self.assertEqual(next_task["action"], "run_implement")
        self.assertEqual(next_task["task"], ".trellis/tasks/task-two")

    def test_commit_only_success_writes_recoverable_task_progress(self) -> None:
        """commit-only 成功后写入 progress，但不改变 task 生命周期状态。"""
        self.advance_to_check()
        self.runner(
            "record",
            "--action",
            "run_check_all",
            "--result",
            "ok",
            "--effective-check-depth",
            "light",
            "--check-depth-reason",
            "定向检查通过",
        )
        self.runner("next")
        self.runner("record", "--action", "run_spec_update", "--result", "ok")
        self.runner("next")

        recorded = self.runner(
            "record",
            "--action",
            "commit_only",
            "--result",
            "ok",
            "--commit",
            "abc1234def",
            "--summary",
            "本地提交完成",
        )

        self.assertEqual(recorded["item_status"], "completed")
        metadata = self.task_json()
        self.assertEqual(metadata["status"], "in_progress")
        progress = metadata["progress"]
        self.assertIn("auto-loop: 本地提交完成 abc1234", progress["completedSteps"])
        self.assertIsNone(progress["partialStep"])
        self.assertIn("finish-work/archive", progress["nextStep"])
        self.assertIn("run_id=auto-test", progress["notes"])
        status = self.progress_status()
        self.assertEqual(status["status"], "ok")
        self.assertIn("finish-work/archive", status["summary"]["nextStep"])

    def test_blocked_item_writes_recoverable_task_progress(self) -> None:
        """blocked 终态必须写入可扫描的下一步。"""
        self.advance_to_check()

        recorded = self.runner(
            "record",
            "--action",
            "run_check_all",
            "--result",
            "blocked",
            "--failure-type",
            "product-decision",
            "--summary",
            "需要用户确认破坏性行为",
            "--effective-check-depth",
            "full",
            "--check-depth-reason",
            "命中破坏性安全边界",
        )

        self.assertEqual(recorded["item_status"], "blocked")
        metadata = self.task_json()
        self.assertEqual(metadata["status"], "in_progress")
        progress = metadata["progress"]
        self.assertEqual(progress["partialStep"], "auto-loop blocked: product-decision")
        self.assertIn("retry-blocked --run-id auto-test", progress["nextStep"])
        self.assertIn("--task .trellis/tasks/task-one", progress["nextStep"])
        status = self.progress_status()
        self.assertEqual(status["status"], "ok")
        self.assertEqual(status["summary"]["partialStep"], "auto-loop blocked: product-decision")

    def test_healthy_create_active_start_and_record_chain(self) -> None:
        """健康 create、active、start_task、record/next 链路保持兼容。"""
        create = subprocess.run(
            [
                "python3",
                ".trellis/scripts/task.py",
                "create",
                "Healthy chain",
                "--slug",
                "healthy-chain",
            ],
            cwd=self.root,
            env=self.env,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(create.returncode, 0, create.stdout + create.stderr)
        task_dir = next((self.root / ".trellis/tasks").glob("*-healthy-chain"))
        prd = task_dir / "prd.md"
        prd.write_text("# Healthy chain\n\n## Goal\n\nTest\n", encoding="utf-8")
        brief = task_dir / "brief.md"
        brief.write_text("# Brief\n", encoding="utf-8")
        task_ref = task_dir.relative_to(self.root).as_posix()

        self.runner(
            "start",
            "--run-id",
            "auto-test",
            "--tasks",
            task_ref,
            "--route-implement",
            "inline",
            "--route-check",
            "check-all-inline",
        )
        self.advance_planning_to_start()
        started = subprocess.run(
            ["python3", ".trellis/scripts/task.py", "start", task_ref],
            cwd=self.root,
            env=self.env,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(started.returncode, 0, started.stdout + started.stderr)

        recorded = self.runner(
            "record",
            "--action",
            "start_task",
            "--result",
            "ok",
        )

        self.assertEqual(recorded["current_step"], "implement")
        self.assertEqual(self.runner("next")["action"], "run_implement")
        session = self.root / ".trellis/.runtime/sessions/auto-loop-test.json"
        self.assertEqual(json.loads(session.read_text(encoding="utf-8"))["current_task"], task_ref)

    def test_spec_update_needs_review_blocks_current_item(self) -> None:
        """Update-Spec needs-review 必须阻塞，不能推进到 commit-only。"""
        self.advance_to_check()
        self.runner(
            "record",
            "--action",
            "run_check_all",
            "--result",
            "ok",
            "--effective-check-depth",
            "light",
            "--check-depth-reason",
            "定向检查通过",
        )
        action = self.runner("next")
        self.assertEqual(action["action"], "run_spec_update")

        recorded = self.runner(
            "record",
            "--action",
            "run_spec_update",
            "--result",
            "blocked",
            "--failure-type",
            "spec-needs-review",
            "--summary",
            "目标规范不唯一",
        )
        self.assertEqual(recorded["item_status"], "blocked")
        self.assertEqual(recorded["current_step"], "spec_update")

        state = json.loads(self.state_path().read_text(encoding="utf-8"))
        self.assertEqual(state["queue"][0]["blocked"]["reason"], "spec-needs-review")


if __name__ == "__main__":
    unittest.main()
