"""任务 Close、legacy reconciliation 与物理 GC 回归测试。"""

from __future__ import annotations

from argparse import Namespace
from contextlib import ExitStack, redirect_stderr, redirect_stdout
from importlib import util as importlib_util
from io import StringIO
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
SCRIPT_DIR = ROOT / "vendor/skill-garden/.trellis/0.6/scripts"
COMMON_DIR = ROOT / ".trellis/scripts"
SOURCE = SCRIPT_DIR / "task_lifecycle.py"

for import_path in (str(COMMON_DIR), str(SCRIPT_DIR)):
    if import_path not in sys.path:
        sys.path.insert(0, import_path)

SPEC = importlib_util.spec_from_file_location("task_lifecycle_test", SOURCE)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("无法加载 task_lifecycle.py")
MODULE = importlib_util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

from common.tasks import (
    iter_active_tasks,
    iter_closed_tasks,
    iter_task_records,
    normalize_closeout,
    task_closeout_view,
)
from decision_log import append_decision, decision_review_status, review_decisions


class TaskLifecycleTest(unittest.TestCase):
    """验证逻辑关闭与物理位置整理互不混用。"""

    def setUp(self) -> None:
        """创建带初始提交的隔离 Git/Trellis 项目。"""
        self.temp = tempfile.TemporaryDirectory(prefix="flower-task-lifecycle-")
        self.root = Path(self.temp.name)
        (self.root / ".trellis/tasks").mkdir(parents=True)
        (self.root / ".trellis/config.yaml").write_text("project:\n  type: single\n", encoding="utf-8")
        (self.root / "README.md").write_text("baseline\n", encoding="utf-8")
        self.git("init", "-q")
        self.git("config", "user.name", "Flower Test")
        self.git("config", "user.email", "flower@example.test")
        self.git("add", ".")
        self.git("commit", "-qm", "initial")

    def tearDown(self) -> None:
        """删除隔离项目。"""
        self.temp.cleanup()

    def git(self, *args: str) -> str:
        """运行 Git 并返回 stdout。"""
        result = subprocess.run(
            ["git", *args],
            cwd=self.root,
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            self.fail(f"git {' '.join(args)} 失败：{result.stderr}")
        return result.stdout.strip()

    def write_task(self, name: str, data: dict, *, commit: bool = True) -> Path:
        """写入一个任务，可选创建基线提交。"""
        task_dir = self.root / ".trellis/tasks" / name
        task_dir.mkdir(parents=True, exist_ok=True)
        (task_dir / "task.json").write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        if commit:
            self.git("add", "--", task_dir.relative_to(self.root).as_posix())
            self.git("commit", "-qm", f"add {name}")
        return task_dir

    def closed_task(self, closed_at: str = "2026-09-18T00:00:00Z") -> dict:
        """构造合法 closed 任务数据。"""
        return {
            "status": "completed",
            "completedAt": "2026-09-18",
            "children": [],
            "closeout": {"status": "closed", "closedAt": closed_at, "blockers": []},
        }

    def append_task_decision(self, task_dir: Path) -> dict:
        """追加一条合法的低风险决策，供生命周期联动验证。

        Args:
            task_dir: 隔离任务目录。

        Returns:
            已写入的决策事件。
        """
        return append_decision(
            task_dir, run_id="lifecycle-test", topic="实现方案", options=["现有模式"],
            choice="现有模式", summary="沿用仓库模式", evidence=["README.md"],
            risk="low", confidence="high", requirements=[], files=[],
        )

    def stage_unrelated_change(self) -> str:
        """创建一个与任务候选无关的 staged 差异。

        Returns:
            staged 文件的完整 diff 文本。
        """
        path = self.root / "unrelated-staged.txt"
        path.write_text("base\n", encoding="utf-8")
        self.git("add", path.name)
        self.git("commit", "-qm", "add unrelated staged fixture")
        path.write_text("staged change\n", encoding="utf-8")
        self.git("add", path.name)
        return self.git("diff", "--cached", "--", path.name)

    def test_lifecycle_spec_uses_supported_list_commands(self) -> None:
        """生命周期规范只展示真实存在的默认、closed 与 all 列表入口。"""
        spec_path = ROOT / ".trellis/spec/flower-trellis/cli/enhancements-model.md"
        spec_text = spec_path.read_text(encoding="utf-8")
        self.assertNotIn("task.py list --view", spec_text)
        self.assertIn("task.py list [--mine] [--json]", spec_text)
        self.assertIn("task.py list --closed [--mine] [--json]", spec_text)
        self.assertIn("task.py list --all [--mine] [--json]", spec_text)

        task_script = ROOT / ".trellis/scripts/task.py"
        for flags in ([], ["--closed"], ["--all"]):
            result = subprocess.run(
                [sys.executable, "-X", "utf8", str(task_script), "list", *flags, "--json"],
                cwd=self.root,
                capture_output=True,
                text=True,
                encoding="utf-8",
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_close_is_idempotent_and_runs_post_write_effects(self) -> None:
        """Close 固定首次时间，并在持久化后执行 Session/Hook 副作用。"""
        task_dir = self.write_task("09-22-close", {"status": "completed", "children": []})
        with ExitStack() as stack:
            hooks = stack.enter_context(mock.patch.object(MODULE, "run_task_hooks"))
            clear = stack.enter_context(
                mock.patch("common.active_task.clear_task_from_sessions", return_value=2),
            )
            first = MODULE.apply_close(
                task_dir,
                self.root,
                delivery_verified=True,
                closed_at="2026-09-22T01:02:03Z",
            )
            second = MODULE.apply_close(
                task_dir,
                self.root,
                delivery_verified=True,
                closed_at="2026-09-23T01:02:03Z",
            )

        self.assertEqual(first["status"], "closed")
        self.assertEqual(first["sessionsCleared"], 2)
        self.assertEqual(second["status"], "already-closed")
        data = json.loads((task_dir / "task.json").read_text(encoding="utf-8"))
        self.assertEqual(data["closeout"]["closedAt"], "2026-09-22T01:02:03Z")
        clear.assert_called_once()
        hooks.assert_called_once_with("after_close", task_dir / "task.json", self.root)

    def test_close_reports_structured_child_and_delivery_blockers(self) -> None:
        """显式 Close 不猜测缺失 child，也不跳过未闭合交付差异。"""
        task_dir = self.write_task(
            "09-22-parent",
            {"status": "completed", "children": ["09-22-missing"]},
        )
        (task_dir / "notes.md").write_text("dirty\n", encoding="utf-8")

        result = MODULE.apply_close(task_dir, self.root)

        self.assertEqual(result["status"], "blocked")
        self.assertEqual(
            {item["code"] for item in result["blockers"]},
            {"missing-child", "delivery-recovery-required"},
        )
        persisted = json.loads((task_dir / "task.json").read_text(encoding="utf-8"))
        self.assertEqual(persisted["closeout"]["status"], "blocked")

    def test_close_preserves_semantic_blocker_until_owner_resolves_it(self) -> None:
        """重复 Close 不能清除持久化语义 blocker，显式解除入口处理后才可关闭。"""
        blocker = {
            "code": "release-review-required",
            "owner": "trellis-release",
            "message": "上线审查尚未完成",
        }
        task_dir = self.write_task(
            "09-22-release-blocked",
            {
                "status": "completed",
                "children": [],
                "closeout": {"status": "blocked", "closedAt": None, "blockers": [blocker]},
            },
        )

        retried = MODULE.apply_close(task_dir, self.root, delivery_verified=True)
        output = StringIO()
        with ExitStack() as stack:
            stack.enter_context(mock.patch.object(MODULE, "get_repo_root", return_value=self.root))
            stack.enter_context(mock.patch.object(MODULE, "run_task_hooks"))
            stack.enter_context(redirect_stdout(output))
            exit_code = MODULE.cmd_close(Namespace(
                task=task_dir.relative_to(self.root).as_posix(),
                resolve_blocker=["release-review-required"],
                json=True,
            ))
        resolved = json.loads(output.getvalue())

        self.assertEqual(retried["status"], "blocked")
        self.assertEqual(retried["blockers"], [blocker])
        self.assertEqual(exit_code, 0)
        self.assertEqual(resolved["status"], "closed")

    def test_unreviewed_decisions_close_archive_and_remain_reviewable(self) -> None:
        """未审查任务可关闭并延迟归档，归档后人工返工审查不自动重开。"""
        task_dir = self.write_task("09-18-unreviewed", {"status": "completed", "children": []})
        self.append_task_decision(task_dir)
        task_ref = task_dir.relative_to(self.root).as_posix()
        self.git("add", "--", task_ref)
        self.git("commit", "-qm", "record unreviewed decision")
        before_log = (task_dir / "decisions.jsonl").read_bytes()

        closed = MODULE.apply_close(task_dir, self.root, closed_at="2026-09-18T00:00:00Z")

        self.assertEqual(closed["status"], "closed")
        self.assertNotIn(task_dir.name, {task.dir_name for task in iter_active_tasks(self.root / ".trellis/tasks")})
        self.assertEqual((task_dir / "decisions.jsonl").read_bytes(), before_log)
        self.assertTrue(decision_review_status(task_dir)["needs_review"])
        self.git("add", "--", task_ref)
        self.git("commit", "-qm", "record task close")
        shutil.copytree(COMMON_DIR / "common", self.root / ".trellis/scripts/common")
        review_command = [
            sys.executable, "-X", "utf8", str(SCRIPT_DIR / "decision_log.py"), "review",
            "--task", task_dir.name, "--verdict", "changes-requested", "--decision-id", "DEC-0001",
        ]
        with MODULE.maintenance_lock(self.root) as acquired:
            self.assertTrue(acquired)
            busy = subprocess.run(
                review_command, cwd=self.root, capture_output=True, text=True, encoding="utf-8", check=False,
            )
            self.assertNotEqual(busy.returncode, 0)
            self.assertIn("任务维护正在执行", json.loads(busy.stdout)["message"])
            self.assertEqual((task_dir / "decisions.jsonl").read_bytes(), before_log)
            gc = MODULE.gc_closed_tasks(self.root, "3d", now=datetime(2026, 9, 22, tzinfo=timezone.utc))
        archived = self.root / ".trellis/tasks/archive/2026-09" / task_dir.name
        self.assertTrue(gc["commit"])
        self.assertFalse(task_dir.exists())
        self.assertEqual((archived / "decisions.jsonl").read_bytes(), before_log)
        task_json_before = (archived / "task.json").read_bytes()

        reviewed = subprocess.run(
            review_command, cwd=self.root, capture_output=True, text=True, encoding="utf-8", check=False,
        )

        self.assertEqual(reviewed.returncode, 0, reviewed.stderr)
        self.assertEqual(json.loads(reviewed.stdout)["status"], "reviewed")
        self.assertEqual((archived / "task.json").read_bytes(), task_json_before)
        self.assertEqual(decision_review_status(archived)["pending_change_ids"], ["DEC-0001"])
        self.assertFalse(task_dir.exists())
        self.assertNotIn(archived.name, {task.dir_name for task in iter_active_tasks(self.root / ".trellis/tasks")})

    def test_close_recomputes_requested_changes_after_new_decision(self) -> None:
        """明确返工不会被新增决策或旧 blocker 解除参数绕过，接受后可重新关闭。"""
        task_dir = self.write_task("09-22-rework", {"status": "completed", "children": []})
        self.append_task_decision(task_dir)
        review_decisions(task_dir, verdict="changes-requested", decision_ids=["DEC-0001"])
        self.append_task_decision(task_dir)

        blocked = MODULE.apply_close(
            task_dir, self.root, delivery_verified=True,
            resolved_blocker_codes={"decision-changes-requested"},
        )

        self.assertEqual(blocked["status"], "blocked")
        self.assertEqual([item["code"] for item in blocked["blockers"]], ["decision-changes-requested"])
        self.assertEqual(blocked["blockers"][0]["detail"]["decisionIds"], ["DEC-0001"])
        review_decisions(task_dir, verdict="accepted")
        closed = MODULE.apply_close(task_dir, self.root, delivery_verified=True)
        self.assertEqual(closed["status"], "closed")

    def test_retry_old_review_blocker_keeps_real_semantic_blocker(self) -> None:
        """重试清除旧的待审查门槛，但保留尚未解除的交付语义阻塞。"""
        release = {"code": "release-review-required", "owner": "trellis-release", "message": "交付未核验"}
        old_review = {"code": "decision-review-required", "owner": "decision_log.py", "message": "旧人工审查门槛"}
        task_dir = self.write_task("09-22-old-review", {
            "status": "completed", "children": [],
            "closeout": {"status": "blocked", "closedAt": None, "blockers": [old_review, release]},
        })
        self.append_task_decision(task_dir)

        blocked = MODULE.apply_close(task_dir, self.root, delivery_verified=True)

        self.assertEqual(blocked["blockers"], [release])
        closed = MODULE.apply_close(
            task_dir, self.root, delivery_verified=True, resolved_blocker_codes={"release-review-required"},
        )
        self.assertEqual(closed["status"], "closed")
        self.assertTrue(decision_review_status(task_dir)["needs_review"])
        self.assertEqual(len((task_dir / "decisions.jsonl").read_text().splitlines()), 1)

    def test_unreviewed_decision_preserves_delivery_and_child_checks(self) -> None:
        """放行待审查状态仍要求子任务完成、交付差异闭合。"""
        child = self.write_task("09-22-child-open", {"status": "in_progress", "children": []})
        task_dir = self.write_task("09-22-parent-unreviewed", {"status": "completed", "children": [child.name]})
        self.append_task_decision(task_dir)

        result = MODULE.apply_close(task_dir, self.root)

        self.assertEqual(result["status"], "blocked")
        self.assertEqual({item["code"] for item in result["blockers"]}, {"open-children", "delivery-recovery-required"})

    def test_corrupt_decision_log_still_blocks_close(self) -> None:
        """损坏决策日志继续阻塞 Close，并完整保留原始失败证据。"""
        task_dir = self.write_task("09-22-corrupt-decision", {"status": "completed", "children": []})
        log = task_dir / "decisions.jsonl"
        log.write_text("{broken\n", encoding="utf-8")

        result = MODULE.apply_close(task_dir, self.root, delivery_verified=True)

        self.assertEqual(result["status"], "blocked")
        self.assertEqual([item["code"] for item in result["blockers"]], ["decision-log-invalid"])
        self.assertEqual(log.read_text(encoding="utf-8"), "{broken\n")

    def test_explicit_retirement_preserves_rejected_review_through_gc(self) -> None:
        """用户终止旧任务可归档，但原拒绝、未完返工和业务未通过结论保持。"""
        task_dir = self.write_task("09-22-retired-rework", {"status": "completed", "children": [], "meta": {"kept": "原记录"}})
        self.append_task_decision(task_dir)
        review_decisions(task_dir, verdict="changes-requested", decision_ids=["DEC-0001"])
        before_log = (task_dir / "decisions.jsonl").read_bytes()
        rejected_digest = decision_review_status(task_dir)["decision_digest"]
        MODULE.apply_close(task_dir, self.root, delivery_verified=True)

        result = MODULE.apply_close(
            task_dir, self.root, delivery_verified=True, closed_at="2026-09-18T00:00:00Z",
            retire_reason=" 用户明确结束旧阶段并保留原拒绝 ",
        )

        self.assertEqual(result["status"], "closed")
        persisted = json.loads((task_dir / "task.json").read_text(encoding="utf-8"))
        retirement = persisted["meta"]["retirement"]
        self.assertEqual(retirement["reason"], "用户明确结束旧阶段并保留原拒绝")
        self.assertEqual(retirement["decisionDigest"], rejected_digest)
        self.assertEqual(retirement["reviewVerdict"], "changes-requested")
        self.assertEqual(retirement["pendingChangeIds"], ["DEC-0001"])
        self.assertFalse(retirement["businessAcceptancePassed"])
        self.assertEqual(persisted["meta"]["kept"], "原记录")
        self.assertEqual((task_dir / "decisions.jsonl").read_bytes(), before_log)
        self.assertFalse(decision_review_status(task_dir)["close_allowed"])
        before_task = (task_dir / "task.json").read_bytes()
        again = MODULE.apply_close(task_dir, self.root, retire_reason="另一个原因")
        self.assertEqual(again["status"], "already-closed")
        self.assertEqual((task_dir / "task.json").read_bytes(), before_task)
        self.git("add", "--", task_dir.relative_to(self.root).as_posix())
        self.git("commit", "-qm", "record explicit retirement")
        with MODULE.maintenance_lock(self.root) as acquired:
            self.assertTrue(acquired)
            gc = MODULE.gc_closed_tasks(self.root, "3d", now=datetime(2026, 9, 22, tzinfo=timezone.utc))
        archived = self.root / ".trellis/tasks/archive/2026-09" / task_dir.name
        self.assertEqual(len(gc["moved"]), 1)
        self.assertFalse(task_dir.exists())
        self.assertEqual((archived / "decisions.jsonl").read_bytes(), before_log)
        self.assertEqual((archived / "task.json").read_bytes(), before_task)

    def test_retirement_requires_nonempty_explicit_reason(self) -> None:
        """空白或错误类型的终止原因失败关闭，不写任务或审查记录。"""
        task_dir = self.write_task("09-22-empty-retirement", {"status": "completed", "children": []})
        before = (task_dir / "task.json").read_bytes()
        for reason in ("", " \n ", False, 1):
            with self.subTest(reason=reason):
                result = MODULE.apply_close(task_dir, self.root, retire_reason=reason)
                self.assertEqual(result["status"], "error")
                self.assertEqual(result["reason"], "invalid-retire-reason")
                self.assertEqual((task_dir / "task.json").read_bytes(), before)

    def test_retirement_metadata_does_not_waive_normal_close(self) -> None:
        """普通 Close 不从既有元数据推断本次已获终止授权。"""
        task_dir = self.write_task("09-22-old-retirement", {
            "status": "completed", "children": [], "meta": {"retirement": {"reason": "旧说明"}},
        })
        self.append_task_decision(task_dir)
        review_decisions(task_dir, verdict="changes-requested", decision_ids=["DEC-0001"])

        result = MODULE.apply_close(task_dir, self.root, delivery_verified=True)

        self.assertEqual(result["status"], "blocked")
        self.assertEqual([row["code"] for row in result["blockers"]], ["decision-changes-requested"])

    def test_retirement_preserves_other_close_blockers(self) -> None:
        """显式终止不绕过开放子项、未闭合交付、语义阻塞或损坏日志。"""
        child = self.write_task("09-22-retirement-child", {"status": "in_progress", "children": []})
        release = {"code": "release-review-required", "owner": "trellis-release", "message": "交付未核验"}
        parent = self.write_task("09-22-retirement-parent", {
            "status": "completed", "children": [child.name],
            "closeout": {"status": "blocked", "closedAt": None, "blockers": [release]},
        })
        self.append_task_decision(parent)
        review_decisions(parent, verdict="changes-requested", decision_ids=["DEC-0001"])
        result = MODULE.apply_close(parent, self.root, retire_reason="结束旧阶段")
        self.assertEqual({row["code"] for row in result["blockers"]}, {
            "release-review-required", "open-children", "delivery-recovery-required",
        })
        self.assertNotIn("retirement", json.loads((parent / "task.json").read_text()).get("meta", {}))
        (parent / "decisions.jsonl").write_text("{broken\n", encoding="utf-8")
        corrupt = MODULE.apply_close(parent, self.root, delivery_verified=True, retire_reason="结束旧阶段")
        self.assertIn("decision-log-invalid", {row["code"] for row in corrupt["blockers"]})
        unfinished = MODULE.apply_close(child, self.root, delivery_verified=True, retire_reason="尚未完成的工作")
        self.assertEqual([row["code"] for row in unfinished["blockers"]], ["work-not-completed"])

    def test_retirement_rejects_invalid_meta_without_overwriting_it(self) -> None:
        """异常 meta 不被终止写入覆盖，保留原文件供恢复。"""
        task_dir = self.write_task("09-22-invalid-retirement-meta", {"status": "completed", "children": [], "meta": ["原记录"]})
        before = (task_dir / "task.json").read_bytes()
        result = MODULE.apply_close(task_dir, self.root, retire_reason="结束旧阶段")
        self.assertEqual(result["status"], "error")
        self.assertEqual(result["reason"], "invalid-task-meta")
        self.assertEqual((task_dir / "task.json").read_bytes(), before)

    def test_close_cli_records_retirement_and_respects_maintenance_lock(self) -> None:
        """CLI 显式终止原子记录原因，维护锁忙时保持任务原字节。"""
        task_dir = self.write_task("09-22-cli-retirement", {"status": "completed", "children": []})
        self.append_task_decision(task_dir)
        review_decisions(task_dir, verdict="changes-requested", decision_ids=["DEC-0001"])
        self.git("add", "--", task_dir.relative_to(self.root).as_posix())
        self.git("commit", "-qm", "record rejected decision")
        args = Namespace(task=task_dir.name, retire_reason="用户结束旧任务", json=True)
        before = (task_dir / "task.json").read_bytes()
        with mock.patch.object(MODULE, "get_repo_root", return_value=self.root):
            output = StringIO()
            with MODULE.maintenance_lock(self.root) as acquired:
                self.assertTrue(acquired)
                with redirect_stdout(output):
                    self.assertEqual(MODULE.cmd_close(args), 1)
            self.assertEqual(json.loads(output.getvalue())["reason"], "maintenance-busy")
            self.assertEqual((task_dir / "task.json").read_bytes(), before)
            output = StringIO()
            with redirect_stdout(output):
                self.assertEqual(MODULE.cmd_close(args), 0)
            self.assertEqual(json.loads(output.getvalue())["retirement"]["reviewVerdict"], "changes-requested")

    def test_malformed_closeout_status_isolated_from_healthy_tasks(self) -> None:
        """数组、对象、数字和 null 状态只标记无效，不击穿其它共享任务读取。"""
        for index, status in enumerate(([], {}, 1, None)):
            task_dir = self.write_task(
                f"09-22-malformed-{index}",
                {
                    "status": "completed",
                    "children": [],
                    "closeout": {"status": status, "closedAt": None, "blockers": []},
                },
                commit=False,
            )
            data = json.loads((task_dir / "task.json").read_text(encoding="utf-8"))
            self.assertFalse(normalize_closeout(data)["valid"])
        healthy = self.write_task("09-22-healthy", {"status": "planning", "children": []}, commit=False)

        active = {task.dir_name for task in iter_active_tasks(self.root / ".trellis/tasks")}

        self.assertIn(healthy.name, active)
        self.assertEqual(len(active), 5)

    def test_reconciliation_commits_only_legacy_task_metadata(self) -> None:
        """首次收敛为旧任务写入 pending/closed，并使用迁移时刻。"""
        planning = self.write_task("09-20-planning", {"status": "planning", "children": []})
        completed = self.write_task("09-20-completed", {"status": "completed", "children": []})
        old_head = self.git("rev-parse", "HEAD")

        result = MODULE.reconcile_legacy_tasks(self.root, "2026-09-22T02:00:00Z")

        self.assertNotEqual(result["commit"], old_head)
        self.assertEqual(
            json.loads((planning / "task.json").read_text(encoding="utf-8"))["closeout"]["status"],
            "pending",
        )
        completed_data = json.loads((completed / "task.json").read_text(encoding="utf-8"))
        self.assertEqual(completed_data["closeout"]["status"], "closed")
        self.assertEqual(completed_data["closeout"]["closedAt"], "2026-09-22T02:00:00Z")
        self.assertEqual(
            set(self.git("show", "--format=", "--name-only", "HEAD").splitlines()),
            {
                ".trellis/tasks/09-20-planning/task.json",
                ".trellis/tasks/09-20-completed/task.json",
            },
        )

    def test_reconciliation_commits_entire_untracked_task_with_tracked_batch(self) -> None:
        """完整未跟踪任务与普通旧任务同批精确提交，且保留候选外状态。"""
        tracked = self.write_task("09-20-tracked", {"status": "planning", "children": []})
        untracked = self.write_task(
            "09-20-untracked",
            {"status": "planning", "children": []},
            commit=False,
        )
        (untracked / "prd.md").write_text("# 未跟踪任务\n", encoding="utf-8")
        (self.root / "dirty.txt").write_text("dirty\n", encoding="utf-8")
        self.git("add", "dirty.txt")
        self.git("commit", "-qm", "add dirty fixture")
        staged_before = self.stage_unrelated_change()
        (self.root / "dirty.txt").write_text("dirty changed\n", encoding="utf-8")
        (self.root / "outside-untracked.txt").write_text("outside\n", encoding="utf-8")
        dirty_before = self.git("diff", "--", "dirty.txt")

        first = MODULE.reconcile_legacy_tasks(self.root, "2026-09-22T03:00:00Z")
        second = MODULE.reconcile_legacy_tasks(self.root, "2026-09-22T04:00:00Z")

        self.assertEqual(
            first["migrated"],
            [
                {"task": tracked.relative_to(self.root).as_posix(), "closeout": "pending"},
                {"task": untracked.relative_to(self.root).as_posix(), "closeout": "pending"},
            ],
        )
        self.assertEqual(first["deferred"], [])
        self.assertEqual(second, {"migrated": [], "blocked": [], "deferred": [], "commit": None})
        committed = set(self.git("show", "--format=", "--name-only", "--no-renames", "HEAD").splitlines())
        self.assertEqual(
            committed,
            {
                ".trellis/tasks/09-20-tracked/task.json",
                ".trellis/tasks/09-20-untracked/prd.md",
                ".trellis/tasks/09-20-untracked/task.json",
            },
        )
        self.assertEqual(self.git("diff", "--cached", "--", "unrelated-staged.txt"), staged_before)
        self.assertEqual(self.git("diff", "--", "dirty.txt"), dirty_before)
        self.assertEqual(
            self.git("status", "--short", "--", "outside-untracked.txt"),
            "?? outside-untracked.txt",
        )

    def test_reconciliation_closes_entirely_untracked_completed_task(self) -> None:
        """完整未跟踪的 completed 任务按既有 Close 规则收敛并提交全部记录。"""
        task_dir = self.write_task(
            "09-20-untracked-completed",
            {"status": "completed", "completedAt": "2026-09-20", "children": []},
            commit=False,
        )
        (task_dir / "notes.md").write_text("完成记录\n", encoding="utf-8")

        result = MODULE.reconcile_legacy_tasks(self.root, "2026-09-22T03:00:00Z")

        task_ref = task_dir.relative_to(self.root).as_posix()
        data = json.loads((task_dir / "task.json").read_text(encoding="utf-8"))
        self.assertEqual(result["migrated"], [{"task": task_ref, "closeout": "closed"}])
        self.assertEqual(data["closeout"]["status"], "closed")
        self.assertEqual(
            set(self.git("show", "--format=", "--name-only", "--no-renames", "HEAD").splitlines()),
            {f"{task_ref}/notes.md", f"{task_ref}/task.json"},
        )

    def test_reconciliation_rejects_mixed_tracked_and_untracked_task(self) -> None:
        """已跟踪任务新增未跟踪文件仍属于无法归属的 candidate-dirty。"""
        task_dir = self.write_task("09-20-mixed", {"status": "planning", "children": []})
        (task_dir / "notes.md").write_text("人工编辑\n", encoding="utf-8")
        head = self.git("rev-parse", "HEAD")

        result = MODULE.reconcile_legacy_tasks(self.root, "2026-09-22T03:00:00Z")

        task_ref = task_dir.relative_to(self.root).as_posix()
        self.assertEqual(result["migrated"], [])
        self.assertEqual(result["deferred"], [{"task": task_ref, "reason": "candidate-dirty"}])
        self.assertEqual(result["commit"], None)
        self.assertEqual(self.git("rev-parse", "HEAD"), head)
        self.assertNotIn("closeout", json.loads((task_dir / "task.json").read_text(encoding="utf-8")))

    def test_reconciliation_without_legacy_writes_does_not_require_attached_head(self) -> None:
        """无迁移候选时 detached HEAD 不制造 SessionStart 噪音。"""
        self.write_task("09-22-current", self.closed_task())
        head = self.git("rev-parse", "HEAD")
        self.git("checkout", "--detach", "-q", head)

        result = MODULE.reconcile_legacy_tasks(self.root)

        self.assertEqual(result, {"migrated": [], "blocked": [], "deferred": [], "commit": None})

    def test_reconciliation_accepts_verified_legacy_auto_loop_bookkeeping(self) -> None:
        """旧 runtime 无摘要时按原提交与允许字段重建证据，并保持重复运行幂等。"""
        task_dir = self.write_task(
            "09-22-legacy-loop",
            {"status": "in_progress", "children": [], "last_push_snapshot": {"legacy": True}},
        )
        task_ref = task_dir.relative_to(self.root).as_posix()
        commit = self.git("rev-parse", "HEAD")
        progress = {
            "updatedAt": "2026-09-22T01:00:00Z",
            "completedSteps": [f"auto-loop: 本地提交完成 {commit[:7]}"],
            "partialStep": None,
            "nextStep": "auto-loop 已本地提交并置为本地完成态；需要用户显式运行 finish-work/archive 完成归档",
            "notes": f"run_id=legacy-run; task={task_ref}; commit={commit}; status=running",
        }
        (task_dir / "task.json").write_text(
            json.dumps({
                "status": "completed",
                "completedAt": "2026-09-22",
                "children": [],
                "progress": progress,
            }, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        runtime = self.root / ".trellis/.runtime/auto-loop"
        runtime.mkdir(parents=True)
        (runtime / "legacy-run.json").write_text(
            json.dumps({
                "run_id": "legacy-run",
                "status": "completed",
                "queue": [{"task": task_ref, "status": "completed", "commit": commit}],
                "pending_archive": {"tasks_awaiting_archive": [task_ref]},
            }),
            encoding="utf-8",
        )

        first = MODULE.reconcile_legacy_tasks(self.root, "2026-09-22T04:00:00Z")
        second = MODULE.reconcile_legacy_tasks(self.root, "2026-09-22T05:00:00Z")

        self.assertEqual(first["migrated"], [{"task": task_ref, "closeout": "closed"}])
        self.assertTrue(first["commit"])
        self.assertEqual(second, {"migrated": [], "blocked": [], "deferred": [], "commit": None})

    def test_reconciliation_rejects_extra_legacy_runner_edit(self) -> None:
        """旧 runner 证据不能授权 progress/完成态以外的人工字段修改。"""
        task_dir = self.write_task("09-22-legacy-edited", {"status": "in_progress", "children": []})
        task_ref = task_dir.relative_to(self.root).as_posix()
        commit = self.git("rev-parse", "HEAD")
        (task_dir / "task.json").write_text(
            json.dumps({
                "status": "completed",
                "completedAt": "2026-09-22",
                "children": [],
                "title": "人工修改",
                "progress": {
                    "updatedAt": "2026-09-22T01:00:00Z",
                    "completedSteps": [f"auto-loop: 本地提交完成 {commit[:7]}"],
                    "partialStep": None,
                    "nextStep": "auto-loop 已本地提交并置为本地完成态；需要用户显式运行 finish-work/archive 完成归档",
                    "notes": f"run_id=legacy-run; task={task_ref}; commit={commit}; status=running",
                },
            }, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        runtime = self.root / ".trellis/.runtime/auto-loop"
        runtime.mkdir(parents=True)
        (runtime / "legacy-run.json").write_text(
            json.dumps({
                "run_id": "legacy-run",
                "queue": [{"task": task_ref, "status": "completed", "commit": commit}],
                "pending_archive": {"tasks_awaiting_archive": [task_ref]},
            }),
            encoding="utf-8",
        )

        result = MODULE.reconcile_legacy_tasks(self.root, "2026-09-22T04:00:00Z")

        self.assertEqual(result["migrated"], [])
        self.assertEqual(result["deferred"], [{"task": task_ref, "reason": "candidate-dirty"}])

    def test_reconciliation_recovers_interrupt_after_ref_update_and_repairs_index(self) -> None:
        """迁移引用更新后中断时，重跑会收敛候选 index 并保留无关 staged。"""
        task_dir = self.write_task("09-20-reconcile-interrupt", {"status": "planning", "children": []})
        task_ref = task_dir.relative_to(self.root).as_posix()
        staged_before = self.stage_unrelated_change()
        original_run_git = MODULE.run_git
        interrupted = False

        def run_git_then_interrupt(args: list[str], cwd: Path) -> tuple[int, str, str]:
            nonlocal interrupted
            result = original_run_git(args, cwd=cwd)
            if args and args[0] == "update-ref" and not interrupted:
                interrupted = True
                raise KeyboardInterrupt("模拟迁移提交后中断")
            return result

        with mock.patch.object(MODULE, "run_git", side_effect=run_git_then_interrupt):
            with self.assertRaises(KeyboardInterrupt):
                MODULE.reconcile_legacy_tasks(self.root, "2026-09-22T06:00:00Z")

        self.assertTrue((self.root / MODULE.EXACT_COMMIT_JOURNAL_RELATIVE).is_file())
        self.assertTrue(self.git("diff", "--cached", "--name-only", "--", task_ref))

        result = MODULE.reconcile_legacy_tasks(self.root, "2026-09-22T07:00:00Z")

        self.assertEqual(result["recovery"], "committed")
        self.assertEqual(result["migrated"], [{"task": task_ref, "closeout": "pending"}])
        self.assertEqual(self.git("diff", "--cached", "--name-only", "--", task_ref), "")
        self.assertEqual(self.git("diff", "--cached", "--", "unrelated-staged.txt"), staged_before)
        self.assertFalse((self.root / MODULE.EXACT_COMMIT_JOURNAL_RELATIVE).exists())

    def test_untracked_reconciliation_recovers_interrupt_after_ref_update(self) -> None:
        """完整未跟踪任务的目录级提交在引用更新中断后可精确收尾。"""
        task_dir = self.write_task(
            "09-20-untracked-interrupt",
            {"status": "planning", "children": []},
            commit=False,
        )
        (task_dir / "prd.md").write_text("# 中断恢复\n", encoding="utf-8")
        task_ref = task_dir.relative_to(self.root).as_posix()
        staged_before = self.stage_unrelated_change()
        original_run_git = MODULE.run_git
        interrupted = False

        def run_git_then_interrupt(args: list[str], cwd: Path) -> tuple[int, str, str]:
            nonlocal interrupted
            result = original_run_git(args, cwd=cwd)
            if args and args[0] == "update-ref" and not interrupted:
                interrupted = True
                raise KeyboardInterrupt("模拟未跟踪任务迁移提交后中断")
            return result

        with mock.patch.object(MODULE, "run_git", side_effect=run_git_then_interrupt):
            with self.assertRaises(KeyboardInterrupt):
                MODULE.reconcile_legacy_tasks(self.root, "2026-09-22T06:00:00Z")

        result = MODULE.reconcile_legacy_tasks(self.root, "2026-09-22T07:00:00Z")

        self.assertEqual(result["recovery"], "committed")
        self.assertEqual(result["migrated"], [{"task": task_ref, "closeout": "pending"}])
        self.assertEqual(self.git("diff", "--cached", "--name-only", "--", task_ref), "")
        self.assertEqual(self.git("diff", "--cached", "--", "unrelated-staged.txt"), staged_before)
        self.assertFalse((self.root / MODULE.EXACT_COMMIT_JOURNAL_RELATIVE).exists())

    def test_gc_preserves_unrelated_staged_and_dirty_content(self) -> None:
        """GC 只提交候选 source/destination，保留无关 index 与工作区内容。"""
        task_dir = self.write_task("09-18-closed", self.closed_task())
        (self.root / "staged.txt").write_text("base\n", encoding="utf-8")
        (self.root / "dirty.txt").write_text("base\n", encoding="utf-8")
        self.git("add", "staged.txt", "dirty.txt")
        self.git("commit", "-qm", "add unrelated files")
        (self.root / "staged.txt").write_text("staged change\n", encoding="utf-8")
        self.git("add", "staged.txt")
        (self.root / "dirty.txt").write_text("dirty change\n", encoding="utf-8")
        staged_before = self.git("diff", "--cached", "--", "staged.txt")
        dirty_before = self.git("diff", "--", "dirty.txt")

        result = MODULE.gc_closed_tasks(
            self.root,
            "3d",
            now=datetime(2026, 9, 22, tzinfo=timezone.utc),
        )

        destination = self.root / ".trellis/tasks/archive/2026-09" / task_dir.name
        self.assertFalse(task_dir.exists())
        self.assertTrue(destination.is_dir())
        self.assertTrue(result["commit"])
        self.assertEqual(self.git("diff", "--cached", "--", "staged.txt"), staged_before)
        self.assertEqual(self.git("diff", "--", "dirty.txt"), dirty_before)
        committed = set(self.git("show", "--format=", "--name-only", "--no-renames", "HEAD").splitlines())
        self.assertEqual(
            committed,
            {
                ".trellis/tasks/09-18-closed/task.json",
                ".trellis/tasks/archive/2026-09/09-18-closed/task.json",
            },
        )

    def test_gc_uses_nul_delimited_paths_for_unicode_and_space(self) -> None:
        """中文和空格任务路径均按原始 Git 路径完成精确提交校验。"""
        names = ["09-18-中文任务", "09-18-space task"]
        for name in names:
            self.write_task(name, self.closed_task())

        result = MODULE.gc_closed_tasks(
            self.root,
            "3d",
            now=datetime(2026, 9, 22, tzinfo=timezone.utc),
        )

        self.assertEqual({item["task"].split("/")[-1] for item in result["moved"]}, set(names))
        committed = self.git(
            "-c", "core.quotepath=false", "show", "--format=", "--name-only", "--no-renames", "-z", "HEAD",
        )
        committed_paths = {path for path in committed.split("\0") if path}
        for name in names:
            self.assertIn(f".trellis/tasks/{name}/task.json", committed_paths)
            self.assertIn(f".trellis/tasks/archive/2026-09/{name}/task.json", committed_paths)

    def test_gc_preserves_tracked_files_when_destination_ignore_rules_change(self) -> None:
        """原路径白名单失效仍保留跟踪文件，并排除忽略的本地产物。"""
        task_dir = self.write_task("09-18-ignore-move", self.closed_task())
        task_ref = task_dir.relative_to(self.root).as_posix()
        tracked = task_dir / "AGENTS.md"
        tracked.write_text("需要保留的源码说明\n", encoding="utf-8")
        literal = task_dir / "笔记 [1].md"
        literal.write_text("需要按字面处理的路径\n", encoding="utf-8")
        (self.root / ".gitignore").write_text(
            f"AGENTS.md\n*.cache\n.trellis/.runtime/\n.trellis/tasks/archive/\n!/{task_ref}/AGENTS.md\n", encoding="utf-8",
        )
        self.git("add", "--", ".gitignore", task_ref)
        self.git("commit", "-qm", "add source-only ignore exception")
        (task_dir / "local.cache").write_text("不进入提交\n", encoding="utf-8")
        staged_before = self.stage_unrelated_change()

        result = MODULE.gc_closed_tasks(self.root, "3d", now=datetime(2026, 9, 22, tzinfo=timezone.utc))

        archived = self.root / ".trellis/tasks/archive/2026-09" / task_dir.name
        archive_ref = archived.relative_to(self.root).as_posix()
        self.assertTrue(result["commit"])
        self.assertEqual(self.git("show", f"HEAD:{archive_ref}/AGENTS.md"), "需要保留的源码说明")
        self.assertEqual(self.git("show", f"HEAD:{archive_ref}/笔记 [1].md"), "需要按字面处理的路径")
        self.assertNotIn("local.cache", self.git("ls-tree", "-r", "--name-only", "HEAD", "--", archive_ref))
        self.assertTrue((archived / "local.cache").is_file())
        self.assertEqual(self.git("diff", "--cached", "--", "unrelated-staged.txt"), staged_before)
        self.assertFalse((self.root / MODULE.EXACT_COMMIT_JOURNAL_RELATIVE).exists())

        restored = MODULE.restore_task(self.root, task_dir.name)

        self.assertEqual(restored["status"], "restored")
        self.assertEqual(tracked.read_text(encoding="utf-8"), "需要保留的源码说明\n")
        self.assertEqual(self.git("diff", "--cached", "--", "unrelated-staged.txt"), staged_before)

    def test_fileset_error_reports_bounded_differences_and_full_local_evidence(self) -> None:
        """大量缺失项只显示少量样例，完整差集落盘且目录与 HEAD 回滚。"""
        task_dir = self.write_task("09-18-fileset-error", self.closed_task())
        head = self.git("rev-parse", "HEAD")
        original = MODULE._gc_candidates
        missing = {f".trellis/tasks/archive/2026-09/{task_dir.name}/missing-{index}.md" for index in range(3000)}

        def candidates_with_missing(*args):
            """模拟文件集与暂存结果不一致的真实防护入口。"""
            candidates, deferred = original(*args)
            candidates[0]["expected"].update(missing)
            (task_dir / "unexpected.md").write_text("候选扫描后并发新增\n", encoding="utf-8")
            return candidates, deferred

        with mock.patch.object(MODULE, "_gc_candidates", side_effect=candidates_with_missing):
            with self.assertRaises(MODULE.TaskLifecycleError) as failure:
                MODULE.gc_closed_tasks(self.root, "3d", now=datetime(2026, 9, 22, tzinfo=timezone.utc))

        self.assertEqual(failure.exception.reason, "git-fileset-mismatch")
        self.assertLess(len(str(failure.exception)), 1400)
        self.assertIn("缺失 3000 项", str(failure.exception))
        evidence = json.loads((self.root / MODULE.FILESET_DIAGNOSTIC_RELATIVE).read_text(encoding="utf-8"))
        self.assertEqual(set(evidence["missing"]), missing)
        self.assertEqual(evidence["extra"], [f".trellis/tasks/archive/2026-09/{task_dir.name}/unexpected.md"])
        self.assertEqual(self.git("rev-parse", "HEAD"), head)
        self.assertTrue(task_dir.is_dir())
        self.assertTrue((task_dir / "unexpected.md").is_file())
        self.assertFalse((self.root / ".trellis/tasks/archive/2026-09" / task_dir.name).exists())
        self.assertFalse((self.root / MODULE.GC_JOURNAL_RELATIVE).exists())

    def test_maintenance_updates_only_paths_already_known_to_the_index(self) -> None:
        """严格 Git 路径校验下，归档、恢复和全新旧任务迁移都能完成。"""
        task_dir = self.write_task("09-18-strict-index", self.closed_task())
        original = MODULE._run_git_with_index

        def strict_git(args, repo_root, index_file):
            """在旧版 Git 上复现新版 Git 对 add -u 路径的拒绝行为。"""
            if args[:2] == ["add", "-u"]:
                for path in args[3:]:
                    code, tracked, error = original(["ls-files", "-z", "--", path], repo_root, index_file)
                    if code != 0 or not tracked:
                        return 1, "", error or f"pathspec {path} did not match any file(s) known to git"
            return original(args, repo_root, index_file)

        with mock.patch.object(MODULE, "_run_git_with_index", side_effect=strict_git):
            archived = MODULE.gc_closed_tasks(self.root, "3d", now=datetime(2026, 9, 22, tzinfo=timezone.utc))
            restored = MODULE.restore_task(self.root, task_dir.name)
            legacy = self.write_task("09-20-untracked-strict", {"status": "planning", "children": []}, commit=False)
            migrated = MODULE.reconcile_legacy_tasks(self.root)

        self.assertTrue(archived["commit"])
        self.assertEqual(restored["status"], "restored")
        self.assertTrue(migrated["commit"])
        self.assertEqual(json.loads((legacy / "task.json").read_text())["closeout"]["status"], "pending")

    def test_commit_files_preserves_tab_in_nul_delimited_output(self) -> None:
        """Windows 无法创建含制表符的路径，因此直接验证 Git NUL 输出解析。"""
        paths = [
            ".trellis/tasks/09-18-中文任务/task.json",
            ".trellis/tasks/09-18-space task/task.json",
            ".trellis/tasks/09-18-tab\ttask/task.json",
        ]
        with mock.patch.object(MODULE, "run_git", return_value=(0, "\0".join(paths) + "\0", "")) as run_git:
            committed = MODULE._commit_files(self.root, "abc123")

        self.assertEqual(committed, set(paths))
        run_git.assert_called_once_with(
            ["diff-tree", "--no-commit-id", "--name-only", "--no-renames", "-r", "-z", "abc123"],
            cwd=self.root,
        )

    def test_gc_converges_identical_destination_and_restore_is_auditable(self) -> None:
        """相同目标可幂等收敛，随后 restore 以精确反向提交恢复位置。"""
        task_dir = self.write_task("09-18-identical", self.closed_task())
        archived = self.root / ".trellis/tasks/archive/2026-09" / task_dir.name
        archived.parent.mkdir(parents=True)
        shutil.copytree(task_dir, archived)

        gc_result = MODULE.gc_closed_tasks(
            self.root,
            "3d",
            now=datetime(2026, 9, 22, tzinfo=timezone.utc),
        )
        restore_result = MODULE.restore_task(self.root, task_dir.name)

        self.assertTrue(gc_result["commit"])
        self.assertEqual(restore_result["status"], "restored")
        self.assertTrue(task_dir.is_dir())
        self.assertFalse(archived.exists())
        restored = json.loads((task_dir / "task.json").read_text(encoding="utf-8"))
        self.assertEqual(restored["closeout"]["status"], "closed")

    def test_restore_materializes_legacy_archive_as_closed_until_reopen(self) -> None:
        """旧物理归档恢复后仍退出 active 视图，显式 reopen 才负责重新激活。"""
        archived = self.root / ".trellis/tasks/archive/2026-08/08-01-legacy"
        archived.mkdir(parents=True)
        (archived / "task.json").write_text(
            json.dumps({"status": "completed", "completedAt": "2026-08-01", "children": []}) + "\n",
            encoding="utf-8",
        )
        self.git("add", "--", archived.relative_to(self.root).as_posix())
        self.git("commit", "-qm", "add legacy archive")

        with mock.patch.object(MODULE, "utc_now", return_value="2026-09-22T06:00:00Z"):
            result = MODULE.restore_task(self.root, archived.name)

        restored = self.root / ".trellis/tasks" / archived.name
        data = json.loads((restored / "task.json").read_text(encoding="utf-8"))
        self.assertEqual(result["status"], "restored")
        self.assertEqual(data["closeout"], {
            "status": "closed",
            "closedAt": "2026-09-22T06:00:00Z",
            "blockers": [],
        })
        self.assertNotIn(restored.name, {task.dir_name for task in iter_active_tasks(restored.parent)})
        self.assertIn(restored.name, {task.dir_name for task in iter_closed_tasks(restored.parent)})

    def test_restore_retries_index_refresh_failure_without_losing_staged_content(self) -> None:
        """restore 提交后的 index 刷新失败可重试，且无关 staged 保持不变。"""
        task_dir = self.write_task("09-18-restore-index", self.closed_task())
        MODULE.gc_closed_tasks(
            self.root,
            "3d",
            now=datetime(2026, 9, 22, tzinfo=timezone.utc),
        )
        task_ref = task_dir.relative_to(self.root).as_posix()
        archive_ref = f".trellis/tasks/archive/2026-09/{task_dir.name}"
        staged_before = self.stage_unrelated_change()
        original_run_git = MODULE.run_git

        def fail_index_refresh(args: list[str], cwd: Path) -> tuple[int, str, str]:
            if args and args[0] == "reset":
                return 1, "", "模拟 restore index.lock 冲突"
            return original_run_git(args, cwd=cwd)

        with mock.patch.object(MODULE, "run_git", side_effect=fail_index_refresh):
            with self.assertRaises(MODULE.TaskLifecycleError) as failure:
                MODULE.restore_task(self.root, task_dir.name)

        self.assertEqual(failure.exception.reason, "git-index-refresh-failed")
        self.assertTrue((self.root / MODULE.EXACT_COMMIT_JOURNAL_RELATIVE).is_file())
        self.assertTrue(self.git("diff", "--cached", "--name-only", "--", task_ref, archive_ref))

        result = MODULE.restore_task(self.root, task_dir.name)

        self.assertEqual(result["status"], "restored")
        self.assertEqual(result["recovery"], "committed")
        self.assertTrue(task_dir.is_dir())
        self.assertFalse((self.root / archive_ref).exists())
        self.assertFalse((self.root / MODULE.EXACT_COMMIT_JOURNAL_RELATIVE).exists())
        self.assertEqual(self.git("diff", "--cached", "--name-only", "--", task_ref, archive_ref), "")
        self.assertEqual(self.git("diff", "--cached", "--", "unrelated-staged.txt"), staged_before)

    def test_gc_dry_run_at_exact_boundary_has_no_commit(self) -> None:
        """关闭恰满三天进入候选，dry-run 不改变 HEAD 或目录。"""
        task_dir = self.write_task("09-19-boundary", self.closed_task("2026-09-19T00:00:00Z"))
        head = self.git("rev-parse", "HEAD")

        result = MODULE.gc_closed_tasks(
            self.root,
            "3d",
            dry_run=True,
            now=datetime(2026, 9, 22, tzinfo=timezone.utc),
        )

        self.assertEqual(result["commit"], None)
        self.assertEqual(len(result["candidates"]), 1)
        self.assertEqual(self.git("rev-parse", "HEAD"), head)
        self.assertTrue(task_dir.is_dir())

    def test_session_maintenance_defers_when_lock_is_busy(self) -> None:
        """已有新鲜 maintenance 锁时 SessionStart 不并发执行迁移或 GC。"""
        lock_path = self.root / ".trellis/.runtime/task-gc.lock"
        lock_path.parent.mkdir(parents=True)
        lock_path.write_text("{}\n", encoding="utf-8")

        result = MODULE.run_session_maintenance(self.root)

        self.assertEqual(result, {"status": "busy", "reconciliation": None, "gc": None})
        self.assertTrue(lock_path.is_file())

    def test_session_maintenance_skips_gc_after_reconciliation_error(self) -> None:
        """旧数据收敛失败后不得在同一锁内继续移动任务目录。"""
        with ExitStack() as stack:
            stack.enter_context(mock.patch.object(
                MODULE,
                "reconcile_legacy_tasks",
                side_effect=MODULE.TaskLifecycleError("reconcile-failed", "模拟收敛失败"),
            ))
            gc = stack.enter_context(mock.patch.object(MODULE, "gc_closed_tasks"))
            result = MODULE.run_session_maintenance(self.root)

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["reconciliation"]["deferred"], [{"reason": "reconcile-failed"}])
        self.assertIsNone(result["gc"])
        gc.assert_not_called()

    def test_session_maintenance_recovers_gc_before_reconciliation_commit(self) -> None:
        """遗留 GC journal 必须先恢复，避免 reconciliation 推进其固定 HEAD。"""
        task_dir = self.write_task("09-18-maintenance-recovery", self.closed_task())
        destination = self.root / ".trellis/tasks/archive/2026-09" / task_dir.name
        self.write_task("09-20-maintenance-legacy", {"status": "in_progress", "children": []})
        original_move = MODULE.shutil.move
        interrupted = False

        def move_then_interrupt(source: str, target: str) -> str:
            nonlocal interrupted
            result = original_move(source, target)
            if not interrupted:
                interrupted = True
                raise KeyboardInterrupt("模拟移动后中断")
            return result

        with mock.patch.object(MODULE.shutil, "move", side_effect=move_then_interrupt):
            with self.assertRaises(KeyboardInterrupt):
                MODULE.gc_closed_tasks(self.root, "3d", now=datetime(2026, 9, 23, tzinfo=timezone.utc))

        first = MODULE.run_session_maintenance(self.root)
        second = MODULE.run_session_maintenance(self.root)

        self.assertEqual(first["reconciliation"]["migrated"][0]["closeout"], "pending")
        self.assertEqual(first["gc"]["recovery"], "rolled-back")
        self.assertTrue(first["gc"]["commit"])
        self.assertFalse(task_dir.exists())
        self.assertTrue(destination.is_dir())
        self.assertFalse((self.root / MODULE.GC_JOURNAL_RELATIVE).exists())
        self.assertNotIn("error", second["reconciliation"])
        self.assertNotIn("error", second["gc"])

    def test_gc_rejects_detached_head_and_active_git_integration(self) -> None:
        """存在候选时 detached HEAD 与 Git 集成状态都禁止创建 GC 提交。"""
        task_dir = self.write_task("09-18-preflight", self.closed_task())
        head = self.git("rev-parse", "HEAD")
        branch = self.git("symbolic-ref", "--short", "HEAD")
        self.git("checkout", "--detach", "-q", head)

        with self.assertRaisesRegex(MODULE.TaskLifecycleError, "detached HEAD") as detached:
            MODULE.gc_closed_tasks(
                self.root,
                "3d",
                now=datetime(2026, 9, 22, tzinfo=timezone.utc),
            )

        self.assertEqual(detached.exception.reason, "detached-head")
        self.assertTrue(task_dir.is_dir())
        self.assertEqual(self.git("rev-parse", "HEAD"), head)
        self.git("checkout", "-q", branch)

        with mock.patch.object(MODULE, "_integration_in_progress", return_value=["merge_head"]):
            with self.assertRaisesRegex(MODULE.TaskLifecycleError, "Git 集成") as integration:
                MODULE.gc_closed_tasks(
                    self.root,
                    "3d",
                    now=datetime(2026, 9, 22, tzinfo=timezone.utc),
                )

        self.assertEqual(integration.exception.reason, "git-integration-active")
        self.assertTrue(task_dir.is_dir())
        self.assertEqual(self.git("rev-parse", "HEAD"), head)

    def test_gc_defers_active_session_and_outstanding_auto_loop(self) -> None:
        """活动 session 引用和未闭合 auto-loop action 都会延后物理 GC。"""
        session_task = self.write_task("09-18-session", self.closed_task())
        loop_task = self.write_task("09-18-loop", self.closed_task())
        session_ref = session_task.relative_to(self.root).as_posix()
        loop_ref = loop_task.relative_to(self.root).as_posix()
        runtime = self.root / ".trellis/.runtime/auto-loop"
        runtime.mkdir(parents=True)
        (runtime / "runner.json").write_text(
            json.dumps({
                "queue": [{
                    "task": loop_ref,
                    "status": "running",
                    "last_action": {"type": "implement"},
                }],
            }),
            encoding="utf-8",
        )

        with mock.patch.object(MODULE, "_active_session_refs", return_value=({session_ref}, False)):
            result = MODULE.gc_closed_tasks(
                self.root,
                "3d",
                dry_run=True,
                now=datetime(2026, 9, 22, tzinfo=timezone.utc),
            )

        reasons = {item["task"]: item["reason"] for item in result["deferred"]}
        self.assertEqual(reasons[session_ref], "active-session-reference")
        self.assertEqual(reasons[loop_ref], "auto-loop-action-outstanding")
        self.assertEqual(result["candidates"], [])

    def test_gc_accepts_only_exact_runner_recorded_task_json_content(self) -> None:
        """runner-owned 脏 task.json 必须同时匹配 commit 证据和 record 时摘要。"""
        task_dir = self.write_task(
            "09-18-runner-owned",
            {
                "status": "completed",
                "completedAt": "2026-09-18",
                "children": [],
                "closeout": {"status": "pending", "closedAt": None, "blockers": []},
            },
        )
        task_json = task_dir / "task.json"
        task_data = self.closed_task()
        task_json.write_text(
            json.dumps(task_data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        task_ref = task_dir.relative_to(self.root).as_posix()
        runtime = self.root / ".trellis/.runtime/auto-loop"
        runtime.mkdir(parents=True)
        digest = hashlib.sha256(task_json.read_bytes()).hexdigest()
        (runtime / "runner.json").write_text(
            json.dumps({
                "queue": [{
                    "task": task_ref,
                    "status": "completed",
                    "commits": [{"repository": ".", "commit": self.git("rev-parse", "HEAD")}],
                    "close_result": "closed",
                    "close_blockers": [],
                    "task_json_sha256": digest,
                }],
            }),
            encoding="utf-8",
        )

        accepted = MODULE.gc_closed_tasks(
            self.root,
            "3d",
            dry_run=True,
            now=datetime(2026, 9, 22, tzinfo=timezone.utc),
        )
        task_data["title"] = "人工修改"
        task_json.write_text(
            json.dumps(task_data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        rejected = MODULE.gc_closed_tasks(
            self.root,
            "3d",
            dry_run=True,
            now=datetime(2026, 9, 22, tzinfo=timezone.utc),
        )

        self.assertEqual([item["task"] for item in accepted["candidates"]], [task_ref])
        self.assertEqual(rejected["candidates"], [])
        self.assertEqual(rejected["deferred"][0]["reason"], "candidate-dirty")

    def test_gc_reports_malformed_invalid_and_future_closeout_times(self) -> None:
        """畸形 closeout、非法时间和未来时间分别返回稳定延后原因。"""
        malformed = self.write_task(
            "09-18-malformed",
            {
                "status": "completed",
                "children": [],
                "closeout": {"status": "closed", "closedAt": None, "blockers": []},
            },
        )
        invalid_time = self.write_task("09-18-invalid-time", self.closed_task("not-a-time"))
        future_time = self.write_task("09-18-future-time", self.closed_task("2026-09-23T00:00:00Z"))

        result = MODULE.gc_closed_tasks(
            self.root,
            "3d",
            dry_run=True,
            now=datetime(2026, 9, 22, tzinfo=timezone.utc),
        )

        reasons = {item["task"]: item["reason"] for item in result["deferred"]}
        self.assertEqual(reasons[malformed.relative_to(self.root).as_posix()], "invalid-closeout")
        self.assertEqual(reasons[invalid_time.relative_to(self.root).as_posix()], "invalid-closed-at")
        self.assertEqual(reasons[future_time.relative_to(self.root).as_posix()], "future-closed-at")

    def test_gc_defers_destination_collision_without_mutation(self) -> None:
        """目标目录内容不一致时延后任务，并完整保留源与冲突目标。"""
        task_dir = self.write_task("09-18-collision", self.closed_task())
        destination = self.root / ".trellis/tasks/archive/2026-09" / task_dir.name
        destination.mkdir(parents=True)
        (destination / "task.json").write_text('{"different": true}\n', encoding="utf-8")
        head = self.git("rev-parse", "HEAD")

        result = MODULE.gc_closed_tasks(
            self.root,
            "3d",
            dry_run=True,
            now=datetime(2026, 9, 22, tzinfo=timezone.utc),
        )

        self.assertEqual(result["candidates"], [])
        self.assertEqual(result["deferred"][0]["reason"], "destination-conflict")
        self.assertTrue(task_dir.is_dir())
        self.assertTrue(destination.is_dir())
        self.assertEqual(self.git("rev-parse", "HEAD"), head)

    def test_gc_commit_failure_restores_source_directory(self) -> None:
        """精确提交失败且 HEAD 未变化时，GC 补偿恢复已移动的源目录。"""
        task_dir = self.write_task("09-18-compensation", self.closed_task())
        destination = self.root / ".trellis/tasks/archive/2026-09" / task_dir.name
        head = self.git("rev-parse", "HEAD")

        with mock.patch.object(
            MODULE,
            "_commit_exact_paths",
            side_effect=MODULE.TaskLifecycleError("git-commit-failed", "模拟提交失败"),
        ):
            with self.assertRaisesRegex(MODULE.TaskLifecycleError, "模拟提交失败"):
                MODULE.gc_closed_tasks(
                    self.root,
                    "3d",
                    now=datetime(2026, 9, 22, tzinfo=timezone.utc),
                )

        self.assertTrue(task_dir.is_dir())
        self.assertFalse(destination.exists())
        self.assertEqual(self.git("rev-parse", "HEAD"), head)

    def test_gc_rerun_recovers_interrupt_after_directory_move(self) -> None:
        """目录移动后进程中断会留下 journal，下一次 GC 先补偿再确定性完成。"""
        task_dir = self.write_task("09-18-interrupt-move", self.closed_task())
        destination = self.root / ".trellis/tasks/archive/2026-09" / task_dir.name
        original_move = MODULE.shutil.move
        interrupted = False

        def move_then_interrupt(source: str, target: str) -> str:
            nonlocal interrupted
            result = original_move(source, target)
            if not interrupted:
                interrupted = True
                raise KeyboardInterrupt("模拟移动后中断")
            return result

        with mock.patch.object(MODULE.shutil, "move", side_effect=move_then_interrupt):
            with self.assertRaises(KeyboardInterrupt):
                MODULE.gc_closed_tasks(self.root, "3d", now=datetime(2026, 9, 22, tzinfo=timezone.utc))

        self.assertFalse(task_dir.exists())
        self.assertTrue(destination.exists())
        self.assertTrue((self.root / MODULE.GC_JOURNAL_RELATIVE).is_file())

        result = MODULE.gc_closed_tasks(self.root, "3d", now=datetime(2026, 9, 22, tzinfo=timezone.utc))

        self.assertEqual(result["recovery"], "rolled-back")
        self.assertTrue(result["commit"])
        self.assertFalse((self.root / MODULE.GC_JOURNAL_RELATIVE).exists())

    def test_gc_rerun_recovers_interrupt_after_staging(self) -> None:
        """临时 index 暂存后中断会在下一次 GC 恢复目录并完成提交。"""
        task_dir = self.write_task("09-18-interrupt-stage", self.closed_task())
        original_run_git = MODULE._run_git_with_index
        interrupted = False

        def run_git_then_interrupt(
            args: list[str],
            repo_root: Path,
            index_file: Path,
        ) -> tuple[int, str, str]:
            nonlocal interrupted
            result = original_run_git(args, repo_root, index_file)
            if args[:2] == ["add", "-u"] and not interrupted:
                interrupted = True
                raise KeyboardInterrupt("模拟暂存后中断")
            return result

        with mock.patch.object(MODULE, "_run_git_with_index", side_effect=run_git_then_interrupt):
            with self.assertRaises(KeyboardInterrupt):
                MODULE.gc_closed_tasks(self.root, "3d", now=datetime(2026, 9, 22, tzinfo=timezone.utc))

        self.assertEqual(self.git("diff", "--cached", "--name-only"), "")
        result = MODULE.gc_closed_tasks(self.root, "3d", now=datetime(2026, 9, 22, tzinfo=timezone.utc))

        self.assertEqual(result["recovery"], "rolled-back")
        self.assertTrue(result["commit"])
        self.assertFalse(task_dir.exists())

    def test_gc_rerun_recognizes_interrupt_after_commit(self) -> None:
        """commit 已成功但 index 未刷新时，重跑补齐收尾且保留无关 staged。"""
        task_dir = self.write_task("09-18-interrupt-commit", self.closed_task())
        task_ref = task_dir.relative_to(self.root).as_posix()
        destination_ref = f".trellis/tasks/archive/2026-09/{task_dir.name}"
        staged_before = self.stage_unrelated_change()
        original_run_git = MODULE.run_git
        interrupted = False

        def run_git_then_interrupt(args: list[str], cwd: Path) -> tuple[int, str, str]:
            nonlocal interrupted
            result = original_run_git(args, cwd=cwd)
            if args and args[0] == "update-ref" and not interrupted:
                interrupted = True
                raise KeyboardInterrupt("模拟提交后中断")
            return result

        with mock.patch.object(MODULE, "run_git", side_effect=run_git_then_interrupt):
            with self.assertRaises(KeyboardInterrupt):
                MODULE.gc_closed_tasks(self.root, "3d", now=datetime(2026, 9, 22, tzinfo=timezone.utc))
        committed_head = self.git("rev-parse", "HEAD")
        self.assertTrue((self.root / MODULE.EXACT_COMMIT_JOURNAL_RELATIVE).is_file())
        self.assertTrue(
            self.git("diff", "--cached", "--name-only", "--", task_ref, destination_ref),
        )

        result = MODULE.gc_closed_tasks(self.root, "3d", now=datetime(2026, 9, 22, tzinfo=timezone.utc))

        self.assertEqual(result["recovery"], "committed")
        self.assertEqual(result["commit"], committed_head)
        self.assertFalse(task_dir.exists())
        self.assertFalse((self.root / MODULE.GC_JOURNAL_RELATIVE).exists())
        self.assertFalse((self.root / MODULE.EXACT_COMMIT_JOURNAL_RELATIVE).exists())
        self.assertEqual(
            self.git("diff", "--cached", "--name-only", "--", task_ref, destination_ref),
            "",
        )
        self.assertEqual(self.git("diff", "--cached", "--", "unrelated-staged.txt"), staged_before)

    def test_gc_retries_index_refresh_failure_before_clearing_journals(self) -> None:
        """真实 index 刷新失败时保留双 journal，重跑后才报告恢复成功。"""
        task_dir = self.write_task("09-18-index-refresh", self.closed_task())
        task_ref = task_dir.relative_to(self.root).as_posix()
        destination_ref = f".trellis/tasks/archive/2026-09/{task_dir.name}"
        staged_before = self.stage_unrelated_change()
        original_run_git = MODULE.run_git

        def fail_index_refresh(args: list[str], cwd: Path) -> tuple[int, str, str]:
            if args and args[0] == "reset":
                return 1, "", "模拟 index.lock 冲突"
            return original_run_git(args, cwd=cwd)

        with mock.patch.object(MODULE, "run_git", side_effect=fail_index_refresh):
            with self.assertRaises(MODULE.TaskLifecycleError) as failure:
                MODULE.gc_closed_tasks(self.root, "3d", now=datetime(2026, 9, 22, tzinfo=timezone.utc))

        self.assertEqual(failure.exception.reason, "git-index-refresh-failed")
        self.assertTrue((self.root / MODULE.GC_JOURNAL_RELATIVE).is_file())
        self.assertTrue((self.root / MODULE.EXACT_COMMIT_JOURNAL_RELATIVE).is_file())
        self.assertTrue(
            self.git("diff", "--cached", "--name-only", "--", task_ref, destination_ref),
        )

        result = MODULE.gc_closed_tasks(self.root, "3d", now=datetime(2026, 9, 22, tzinfo=timezone.utc))

        self.assertEqual(result["recovery"], "committed")
        self.assertFalse((self.root / MODULE.GC_JOURNAL_RELATIVE).exists())
        self.assertFalse((self.root / MODULE.EXACT_COMMIT_JOURNAL_RELATIVE).exists())
        self.assertEqual(
            self.git("diff", "--cached", "--name-only", "--", task_ref, destination_ref),
            "",
        )
        self.assertEqual(self.git("diff", "--cached", "--", "unrelated-staged.txt"), staged_before)

    def test_gc_detects_same_head_branch_switch_before_commit(self) -> None:
        """暂存期间切到同一 HEAD 的其它分支时，不得把 GC commit 写到新分支。"""
        self.write_task("09-18-branch-switch", self.closed_task())
        original_branch = self.git("symbolic-ref", "--short", "HEAD")
        old_head = self.git("rev-parse", "HEAD")
        original_run_git = MODULE._run_git_with_index
        switched = False

        def run_git_then_switch(
            args: list[str],
            repo_root: Path,
            index_file: Path,
        ) -> tuple[int, str, str]:
            nonlocal switched
            result = original_run_git(args, repo_root, index_file)
            if args[:2] == ["add", "-u"] and not switched:
                switched = True
                self.git("switch", "-q", "-c", "gc-other")
            return result

        with mock.patch.object(MODULE, "_run_git_with_index", side_effect=run_git_then_switch):
            with self.assertRaises(MODULE.TaskLifecycleError) as failure:
                MODULE.gc_closed_tasks(self.root, "3d", now=datetime(2026, 9, 22, tzinfo=timezone.utc))

        self.assertEqual(failure.exception.reason, "gc-recovery-branch-changed")
        self.assertEqual(self.git("rev-parse", "HEAD"), old_head)
        self.assertEqual(self.git("symbolic-ref", "--short", "HEAD"), "gc-other")
        self.assertTrue((self.root / MODULE.GC_JOURNAL_RELATIVE).is_file())
        self.git("switch", "-q", original_branch)
        recovered = MODULE.gc_closed_tasks(self.root, "3d", now=datetime(2026, 9, 22, tzinfo=timezone.utc))
        self.assertTrue(recovered["commit"])

    def test_gc_binds_commit_to_original_branch_during_final_switch_window(self) -> None:
        """最终检查后切分支时，CAS 只更新事务开始时的固定分支。"""
        task_dir = self.write_task("09-18-final-branch-window", self.closed_task())
        destination = self.root / ".trellis/tasks/archive/2026-09" / task_dir.name
        original_branch = self.git("symbolic-ref", "--short", "HEAD")
        original_ref = self.git("symbolic-ref", "HEAD")
        old_head = self.git("rev-parse", "HEAD")
        original_run_git = MODULE.run_git
        switched = False

        def run_git_then_switch(args: list[str], cwd: Path) -> tuple[int, str, str]:
            nonlocal switched
            if args and args[0] == "update-ref" and not switched:
                switched = True
                self.git("switch", "-q", "-c", "gc-final-other")
            return original_run_git(args, cwd=cwd)

        with mock.patch.object(MODULE, "run_git", side_effect=run_git_then_switch):
            with self.assertRaises(MODULE.TaskLifecycleError) as failure:
                MODULE.gc_closed_tasks(self.root, "3d", now=datetime(2026, 9, 22, tzinfo=timezone.utc))

        self.assertEqual(failure.exception.reason, "gc-recovery-branch-changed")
        self.assertEqual(self.git("symbolic-ref", "--short", "HEAD"), "gc-final-other")
        self.assertEqual(self.git("rev-parse", "HEAD"), old_head)
        original_commit = self.git("rev-parse", original_ref)
        self.assertNotEqual(original_commit, old_head)
        self.assertEqual(self.git("rev-parse", f"{original_commit}^"), old_head)
        self.assertTrue((self.root / MODULE.GC_JOURNAL_RELATIVE).is_file())
        self.assertTrue(task_dir.is_dir())
        self.assertFalse(destination.exists())
        self.assertNotEqual(original_branch, "gc-final-other")
        self.git("switch", "-q", original_branch)

        recovered = MODULE.gc_closed_tasks(self.root, "3d", now=datetime(2026, 9, 22, tzinfo=timezone.utc))

        self.assertEqual(recovered["recovery"], "committed")
        self.assertEqual(recovered["commit"], original_commit)
        self.assertFalse(task_dir.exists())
        self.assertTrue(destination.is_dir())
        self.assertFalse((self.root / MODULE.GC_JOURNAL_RELATIVE).exists())

    def test_gc_detects_head_change_before_commit(self) -> None:
        """暂存期间同分支 HEAD 变化时保留 journal 并拒绝覆盖并发提交。"""
        self.write_task("09-18-head-change", self.closed_task())
        old_head = self.git("rev-parse", "HEAD")
        original_run_git = MODULE._run_git_with_index
        changed = False

        def run_git_then_commit(
            args: list[str],
            repo_root: Path,
            index_file: Path,
        ) -> tuple[int, str, str]:
            nonlocal changed
            result = original_run_git(args, repo_root, index_file)
            if args[:2] == ["add", "-u"] and not changed:
                changed = True
                (self.root / "README.md").write_text("concurrent\n", encoding="utf-8")
                self.git("add", "README.md")
                self.git("commit", "-qm", "concurrent", "--", "README.md")
            return result

        with mock.patch.object(MODULE, "_run_git_with_index", side_effect=run_git_then_commit):
            with self.assertRaises(MODULE.TaskLifecycleError) as failure:
                MODULE.gc_closed_tasks(self.root, "3d", now=datetime(2026, 9, 22, tzinfo=timezone.utc))

        self.assertEqual(failure.exception.reason, "gc-recovery-head-changed")
        self.assertNotEqual(self.git("rev-parse", "HEAD"), old_head)
        self.assertTrue((self.root / MODULE.GC_JOURNAL_RELATIVE).is_file())

    def test_gc_and_restore_dry_run_outputs_are_truthful(self) -> None:
        """dry-run 文本与 JSON 都展示候选，restore 文本不声称已经恢复。"""
        task_dir = self.write_task("09-18-dry-output", self.closed_task())
        gc_args = Namespace(closed=True, before="3d", dry_run=True, json=False)
        output = StringIO()
        with ExitStack() as stack:
            stack.enter_context(mock.patch.object(MODULE, "get_repo_root", return_value=self.root))
            clock = stack.enter_context(mock.patch.object(MODULE, "datetime", wraps=datetime))
            stack.enter_context(redirect_stdout(output))
            stack.enter_context(redirect_stderr(StringIO()))
            clock.now.return_value = datetime(2026, 9, 22, tzinfo=timezone.utc)
            result = MODULE.cmd_gc(gc_args)

        self.assertEqual(result, 0)
        self.assertIn("候选 GC", output.getvalue())
        self.assertIn(task_dir.name, output.getvalue())

        gc_args.json = True
        output = StringIO()
        with ExitStack() as stack:
            stack.enter_context(mock.patch.object(MODULE, "get_repo_root", return_value=self.root))
            clock = stack.enter_context(mock.patch.object(MODULE, "datetime", wraps=datetime))
            stack.enter_context(redirect_stdout(output))
            clock.now.return_value = datetime(2026, 9, 22, tzinfo=timezone.utc)
            result = MODULE.cmd_gc(gc_args)

        self.assertEqual(result, 0)
        self.assertEqual(json.loads(output.getvalue())["candidates"][0]["task"], task_dir.relative_to(self.root).as_posix())

        MODULE.gc_closed_tasks(
            self.root,
            "3d",
            now=datetime(2026, 9, 22, tzinfo=timezone.utc),
        )
        restore_args = Namespace(task=task_dir.name, dry_run=True, json=False)
        output = StringIO()
        with mock.patch.object(MODULE, "get_repo_root", return_value=self.root), redirect_stdout(output):
            result = MODULE.cmd_restore(restore_args)

        self.assertEqual(result, 0)
        self.assertIn("候选恢复", output.getvalue())
        self.assertNotIn("已恢复", output.getvalue())

        restore_args.json = True
        output = StringIO()
        with mock.patch.object(MODULE, "get_repo_root", return_value=self.root), redirect_stdout(output):
            result = MODULE.cmd_restore(restore_args)

        self.assertEqual(result, 0)
        self.assertEqual(json.loads(output.getvalue())["status"], "dry-run")

    def test_active_consumers_do_not_bypass_shared_task_views(self) -> None:
        """活动任务消费方不得重新直接扫描 tasks 根目录或导入旧宽松解析器。"""
        consumers = [
            ROOT / ".trellis/scripts/task.py",
            ROOT / ".trellis/scripts/common/active_task.py",
            ROOT / ".trellis/scripts/common/session_context.py",
            ROOT / "vendor/skill-garden/.trellis/0.6/scripts/task_progress.py",
            ROOT / "vendor/skill-garden/.trellis/0.6/scripts/task_intent.py",
            ROOT / "vendor/skill-garden/.trellis/0.6/scripts/decision_log.py",
        ]

        for path in consumers:
            with self.subTest(path=path.relative_to(ROOT).as_posix()):
                source = path.read_text(encoding="utf-8")
                self.assertNotRegex(source, r"\btasks_dir\.(?:iterdir|glob|rglob)\(")
                self.assertNotIn("from common.task_utils import resolve_task_dir", source)

        task_source = consumers[0].read_text(encoding="utf-8")
        self.assertIn("resolve_active_task_reference", task_source)
        progress_source = consumers[3].read_text(encoding="utf-8")
        self.assertIn("resolve_active_task_reference", progress_source)
        self.assertIn("resolve_top_level_task_reference", progress_source)

    def test_shared_views_separate_logical_close_from_physical_location(self) -> None:
        """active/closed/all 共享 closeout 语义，物理位置只影响历史 closed。"""
        tasks_dir = self.root / ".trellis/tasks"
        self.write_task("09-22-planning", {"status": "planning", "children": []}, commit=False)
        self.write_task(
            "09-22-blocked",
            {
                "status": "completed",
                "children": [],
                "closeout": {
                    "status": "blocked",
                    "closedAt": None,
                    "blockers": [{
                        "code": "delivery-recovery-required",
                        "owner": "trellis-push",
                        "message": "交付证据尚未闭合",
                    }],
                },
            },
            commit=False,
        )
        self.write_task("09-22-closed", self.closed_task(), commit=False)
        self.write_task(
            "09-22-closed-invalid-time",
            {
                "status": "completed",
                "children": [],
                "closeout": {"status": "closed", "closedAt": None, "blockers": []},
            },
            commit=False,
        )
        archived = tasks_dir / "archive/2026-09/09-19-historical"
        archived.mkdir(parents=True)
        (archived / "task.json").write_text(
            json.dumps({"status": "completed", "children": []}) + "\n",
            encoding="utf-8",
        )
        invalid_archived = tasks_dir / "archive/2026-09/09-18-invalid-historical"
        invalid_archived.mkdir(parents=True)
        (invalid_archived / "task.json").write_text(
            json.dumps({
                "status": "completed",
                "children": [],
                "closeout": {"status": "pending", "closedAt": None, "blockers": []},
            }) + "\n",
            encoding="utf-8",
        )

        active_records = list(iter_active_tasks(tasks_dir))
        closed_records = list(iter_closed_tasks(tasks_dir))
        active = {task.dir_name for task in active_records}
        closed = {task.dir_name for task in closed_records}
        all_tasks = {task.dir_name for task in iter_task_records(tasks_dir)}

        self.assertEqual(active, {"09-22-planning", "09-22-blocked", "09-22-closed-invalid-time"})
        self.assertEqual(
            closed,
            {"09-22-closed", "09-19-historical", "09-18-invalid-historical"},
        )
        self.assertEqual(all_tasks, active | closed)
        invalid_view = task_closeout_view(
            next(task for task in closed_records if task.dir_name == "09-18-invalid-historical"),
            tasks_dir,
        )
        self.assertEqual(invalid_view["status"], "closed")
        self.assertFalse(invalid_view["valid"])
        self.assertTrue(invalid_view["historical"])

    def test_shared_all_view_rejects_duplicate_task_identity(self) -> None:
        """顶层与物理 archive 同名时拒绝静默重复计数。"""
        tasks_dir = self.root / ".trellis/tasks"
        task_dir = self.write_task("09-22-duplicate", self.closed_task(), commit=False)
        archived = tasks_dir / "archive/2026-09" / task_dir.name
        archived.parent.mkdir(parents=True)
        shutil.copytree(task_dir, archived)

        with self.assertRaisesRegex(ValueError, "Duplicate task identity"):
            list(iter_task_records(tasks_dir))


if __name__ == "__main__":
    unittest.main()
