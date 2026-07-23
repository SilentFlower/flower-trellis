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
        shutil.copy2(SOURCE_SCRIPTS / "task.py", scripts / "task.py")
        shutil.copytree(SOURCE_SCRIPTS / "common", scripts / "common")
        (self.root / ".trellis/.developer").write_text("name=tester\n", encoding="utf-8")
        (self.root / ".trellis/config.yaml").write_text(
            "project:\n  type: single\n",
            encoding="utf-8",
        )
        self.env = {**os.environ, "TRELLIS_CONTEXT_ID": "auto-loop-test"}
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

    def test_open_questions_checkbox_contract(self) -> None:
        """unchecked 阻塞，checked、空章节和无章节放行。"""
        for content, expected in (
            ("- [ ] 待确认", "blocked"),
            ("- [x] 已确认", "start_task"),
            ("", "start_task"),
        ):
            with self.subTest(content=content):
                shutil.rmtree(self.root / ".trellis/.runtime/auto-loop", ignore_errors=True)
                self.write_planning_task(content)
                self.start_planning()
                action = self.runner("next")
                if expected == "blocked":
                    self.assertEqual(action["status"], "blocked")
                    state = json.loads(self.state_path().read_text(encoding="utf-8"))
                    self.assertEqual(state["queue"][0]["blocked"]["reason"], "open-questions")
                else:
                    self.assertEqual(action["action"], expected)

    def test_missing_open_questions_section_passes(self) -> None:
        """PRD 不包含 Open Questions 章节时直接进入 start_task。"""
        self.write_planning_task("")
        prd = self.root / ".trellis/tasks/task-planning/prd.md"
        prd.write_text("# Planning\n\n## Goal\n\nTest\n", encoding="utf-8")
        self.start_planning()

        self.assertEqual(self.runner("next")["action"], "start_task")

    def test_bare_open_questions_require_hash_bound_review(self) -> None:
        """历史裸列表先复核，resolved 后才进入 start gate。"""
        self.write_planning_task("- 无。当前实现口径已确认。")
        self.start_planning()

        review = self.runner("next")

        self.assertEqual(review["action"], "review_open_questions")
        self.assertEqual(review["questions"], ["无。当前实现口径已确认。"])
        recorded = self.runner(
            "record",
            "--action",
            "review_open_questions",
            "--result",
            "ok",
            "--review-verdict",
            "resolved",
            "--summary",
            "语义明确表示无开放问题",
        )
        self.assertEqual(recorded["current_step"], "start_task")
        self.assertEqual(self.runner("next")["action"], "start_task")

    def test_tbd_is_not_silently_ignored_and_stale_review_is_rejected(self) -> None:
        """TBD 进入复核，PRD 变化后旧 action hash 失效。"""
        self.write_planning_task("- TBD")
        self.start_planning()
        self.assertEqual(self.runner("next")["action"], "review_open_questions")
        prd = self.root / ".trellis/tasks/task-planning/prd.md"
        prd.write_text(prd.read_text(encoding="utf-8") + "\nUpdated\n", encoding="utf-8")

        rejected = self.runner(
            "record",
            "--action",
            "review_open_questions",
            "--result",
            "ok",
            "--review-verdict",
            "resolved",
            "--summary",
            "旧判断",
        )

        self.assertEqual(rejected["reason"], "stale-open-questions-review")

    def test_ambiguous_review_blocks_conservatively(self) -> None:
        """无法确定的历史裸列表必须保守阻塞。"""
        self.write_planning_task("- 可能需要再确认")
        self.start_planning()
        self.runner("next")

        recorded = self.runner(
            "record",
            "--action",
            "review_open_questions",
            "--result",
            "blocked",
            "--review-verdict",
            "ambiguous",
            "--summary",
            "语义不足",
        )

        self.assertEqual(recorded["item_status"], "blocked")
        state = json.loads(self.state_path().read_text(encoding="utf-8"))
        self.assertEqual(state["queue"][0]["blocked"]["reason"], "open-questions-ambiguous")

    def test_retry_blocked_rechecks_updated_open_questions(self) -> None:
        """修正文档后 retry-blocked 必须重新执行 Open Questions 门禁。"""
        self.write_planning_task("- 可能需要再确认")
        self.start_planning()
        self.runner("next")
        self.runner(
            "record",
            "--action",
            "review_open_questions",
            "--result",
            "blocked",
            "--review-verdict",
            "ambiguous",
            "--summary",
            "语义不足",
        )
        prd = self.root / ".trellis/tasks/task-planning/prd.md"
        prd.write_text("# Planning\n\n## Goal\n\nTest\n", encoding="utf-8")

        retried = self.runner(
            "retry-blocked",
            "--run-id",
            "auto-test",
            "--task",
            ".trellis/tasks/task-planning",
        )

        self.assertEqual(retried["status"], "retry-ready")
        self.assertEqual(self.runner("next")["action"], "start_task")

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

        self.assertEqual(status["run_status"], "running")
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
        self.assertEqual(self.runner("next")["action"], "start_task")
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
