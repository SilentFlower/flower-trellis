"""auto_loop.py 检查深度与自动续跑回归测试。"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
SOURCE_RUNNER = PROJECT_ROOT / "vendor/skill-garden/.trellis/0.6/scripts/auto_loop.py"


class AutoLoopCheckDepthTest(unittest.TestCase):
    """在隔离 Trellis 目录中验证检查深度状态机。"""

    def setUp(self) -> None:
        """创建 runner 与两个 in_progress 任务。"""
        self.temp = tempfile.TemporaryDirectory(prefix="flower-auto-loop-")
        self.root = Path(self.temp.name)
        scripts = self.root / ".trellis/scripts"
        scripts.mkdir(parents=True)
        shutil.copy2(SOURCE_RUNNER, scripts / "auto_loop.py")
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
