"""shared workflow-state Hook 的 stale recovery 测试。"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
HOOK_SOURCE = (
    ROOT
    / "vendor/skill-garden/.trellis/0.6/overrides/patches/hooks/"
    "inject-workflow-state/shared-runtime/content.py"
)
STALE_STATE_SOURCE = (
    ROOT
    / "vendor/skill-garden/.trellis/0.6/overrides/patches/workflow/"
    "state-missing-task/content.md"
)


def _load_hook_module() -> types.ModuleType:
    """从真实 Patch 源加载 Hook，且不在 catalog 目录生成 pycache。

    Returns:
        已执行的 Hook 模块。
    """
    module = types.ModuleType("flower_workflow_state_hook")
    module.__file__ = str(HOOK_SOURCE)
    source = HOOK_SOURCE.read_text(encoding="utf-8")
    exec(compile(source, str(HOOK_SOURCE), "exec"), module.__dict__)
    return module


class WorkflowStateHookTest(unittest.TestCase):
    """验证 stale 来源归一和 workflow 权威 breadcrumb。"""

    def setUp(self) -> None:
        """创建隔离 Trellis 根目录并加载真实 Hook 源。"""
        self.temp = tempfile.TemporaryDirectory(prefix="flower-workflow-hook-")
        self.root = Path(self.temp.name)
        (self.root / ".trellis").mkdir()
        self.hook = _load_hook_module()

    def tearDown(self) -> None:
        """删除隔离目录。"""
        self.temp.cleanup()

    def _run_hook(self, input_data: dict) -> str:
        """执行完整 Hook 并返回 additionalContext。

        Args:
            input_data: Hook stdin JSON。

        Returns:
            Hook 输出中的 additionalContext。
        """
        result = subprocess.run(
            [sys.executable, str(HOOK_SOURCE)],
            cwd=self.root,
            input=json.dumps(input_data),
            text=True,
            capture_output=True,
            check=True,
        )
        output = json.loads(result.stdout)
        return output["hookSpecificOutput"]["additionalContext"]

    def test_stale_session_sources_share_stable_status(self) -> None:
        """验证 session 与 session-fallback 都归一为 missing_task。"""
        for source_type in ("session", "session-fallback"):
            with self.subTest(source_type=source_type):
                active = types.SimpleNamespace(
                    task_path=".trellis/tasks/missing-task",
                    stale=True,
                    source_type=source_type,
                    source=f"{source_type}:context-id",
                )
                with mock.patch.object(self.hook, "_resolve_active_task", return_value=active):
                    task = self.hook.get_active_task(self.root, {})

                self.assertEqual(
                    task,
                    ("missing-task", "missing_task", f"{source_type}:context-id"),
                )

    def test_real_stale_runtime_sources_emit_stable_breadcrumb(self) -> None:
        """验证真实 session runtime 的两种 stale 来源都输出权威恢复正文。"""
        scripts = self.root / ".trellis/scripts"
        scripts.mkdir()
        shutil.copytree(ROOT / ".trellis/scripts/common", scripts / "common")
        (self.root / ".trellis/workflow.md").write_text(
            STALE_STATE_SOURCE.read_text(encoding="utf-8"),
            encoding="utf-8",
        )
        sessions = self.root / ".trellis/.runtime/sessions"
        sessions.mkdir(parents=True)
        (sessions / "codex_context-id.json").write_text(
            json.dumps({"current_task": ".trellis/tasks/missing-task"}),
            encoding="utf-8",
        )

        cases = (
            {"cwd": str(self.root), "platform": "codex", "session_id": "context-id"},
            {"cwd": str(self.root)},
        )
        for input_data in cases:
            with self.subTest(input_data=input_data):
                breadcrumb = self._run_hook(input_data)
                self.assertIn("Task: missing-task (missing_task)", breadcrumb)
                self.assertIn("python3 ./.trellis/scripts/task.py finish", breadcrumb)
                self.assertIn("in the same turn", breadcrumb)
                self.assertNotIn("Refer to workflow.md for current step.", breadcrumb)

    def test_stale_breadcrumb_uses_workflow_contract(self) -> None:
        """验证 stale breadcrumb 加载恢复正文而不是泛化 fallback。"""
        workflow = self.root / ".trellis/workflow.md"
        workflow.write_text(STALE_STATE_SOURCE.read_text(encoding="utf-8"), encoding="utf-8")

        templates = self.hook.load_breadcrumbs(self.root)
        breadcrumb = self.hook.build_breadcrumb(
            "missing-task",
            "missing_task",
            templates,
        )

        self.assertIn("python3 ./.trellis/scripts/task.py finish", breadcrumb)
        self.assertIn("If it fails, report the failure and stop", breadcrumb)
        self.assertIn("in the same turn", breadcrumb)
        self.assertIn("`no_task`", breadcrumb)
        self.assertIn("before any edit or task action", breadcrumb)
        self.assertNotIn("Refer to workflow.md for current step.", breadcrumb)

    def test_ordinary_status_breadcrumbs_remain_unchanged(self) -> None:
        """验证普通 no_task、planning 与 in_progress 状态仍按模板输出。"""
        templates = {
            "no_task": "NO TASK BODY",
            "planning": "PLANNING BODY",
            "in_progress": "IN PROGRESS BODY",
        }

        self.assertIn(
            "NO TASK BODY",
            self.hook.build_breadcrumb(None, "no_task", templates),
        )
        self.assertIn(
            "PLANNING BODY",
            self.hook.build_breadcrumb("task", "planning", templates),
        )
        self.assertIn(
            "IN PROGRESS BODY",
            self.hook.build_breadcrumb("task", "in_progress", templates),
        )


if __name__ == "__main__":
    unittest.main()
