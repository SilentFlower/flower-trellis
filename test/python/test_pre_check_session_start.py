"""Codex / Claude SessionStart 的 Pre-Check 条件注入测试。"""

from __future__ import annotations

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
SCRIPTS_DIR = ROOT / ".trellis/scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from common.active_task import resolve_context_key


HINT = "Pre-check: deferred for current task; latest user intent may override."
HOOKS = (
    ("codex", ROOT / ".codex/hooks/session-start.py"),
    ("claude", ROOT / ".claude/hooks/session-start.py"),
)


class PreCheckSessionStartTest(unittest.TestCase):
    """验证仅匹配当前 session/task 的 hold 会进入 compact current-state。"""

    def setUp(self) -> None:
        """创建可运行真实 SessionStart hook 的最小 Trellis 项目。"""
        self.temp = tempfile.TemporaryDirectory(prefix="flower-pre-check-session-")
        self.root = Path(self.temp.name)
        scripts = self.root / ".trellis/scripts"
        scripts.mkdir(parents=True)
        shutil.copytree(ROOT / ".trellis/scripts/common", scripts / "common")
        shutil.copy2(ROOT / ".trellis/scripts/pre_check_state.py", scripts / "pre_check_state.py")
        task = self.root / ".trellis/tasks/task-a"
        task.mkdir(parents=True)
        (task / "task.json").write_text(
            json.dumps({"status": "in_progress"}),
            encoding="utf-8",
        )
        (self.root / ".trellis/workflow.md").write_text(
            "## Phase Index\n\n## Phase 1: Plan\n",
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        """删除隔离项目。"""
        self.temp.cleanup()

    def _context_key(self, platform: str, session_id: str) -> str:
        """按真实 active-task 规则计算 hook context key。

        Args:
            platform: 平台名。
            session_id: 测试 session ID。

        Returns:
            经过清洗或哈希的 context key。
        """
        with mock.patch.dict(os.environ, {}, clear=True):
            key = resolve_context_key({"session_id": session_id}, platform=platform)
        self.assertIsNotNone(key)
        return str(key)

    def _write_runtime(self, context_key: str, *, hold: bool) -> None:
        """写入当前任务及可选 hold。

        Args:
            context_key: session context key。
            hold: 是否写入 pre-check 偏好。
        """
        runtime = {
            "platform": context_key.split("_", 1)[0],
            "current_task": ".trellis/tasks/task-a",
            "current_run": None,
        }
        if hold:
            runtime["pre_check_preference"] = {
                "version": 1,
                "task": ".trellis/tasks/task-a",
                "mode": "hold",
                "source": "follow-up-edit",
                "updated_at": "2026-07-23T00:00:00Z",
            }
        path = self.root / ".trellis/.runtime/sessions" / f"{context_key}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(runtime), encoding="utf-8")

    def _run_hook(self, hook: Path, platform: str, session_id: str) -> str:
        """执行真实 hook 并返回 additionalContext。

        Args:
            hook: SessionStart hook 路径。
            platform: 平台名。
            session_id: hook 输入 session ID。

        Returns:
            Hook JSON 中的 additionalContext。
        """
        env = os.environ.copy()
        for key in (
            "TRELLIS_CONTEXT_ID",
            "CODEX_SESSION_ID",
            "CODEX_THREAD_ID",
            "CLAUDE_SESSION_ID",
            "CLAUDE_CODE_SESSION_ID",
            "CODEX_NON_INTERACTIVE",
            "CLAUDE_NON_INTERACTIVE",
            "CLAUDE_PROJECT_DIR",
        ):
            env.pop(key, None)
        input_data = {
            "cwd": str(self.root),
            "platform": platform,
            "session_id": session_id,
        }
        result = subprocess.run(
            [sys.executable, str(hook)],
            cwd=self.root,
            input=json.dumps(input_data),
            env=env,
            text=True,
            capture_output=True,
            check=True,
        )
        payload = json.loads(result.stdout)
        return payload["hookSpecificOutput"]["additionalContext"]

    def test_matching_hold_adds_one_line_and_default_adds_none(self) -> None:
        """匹配 hold 注入一行，清除后没有动态提示。"""
        for platform, hook in HOOKS:
            with self.subTest(platform=platform):
                context_key = self._context_key(platform, f"{platform}-hold")
                self._write_runtime(context_key, hold=True)
                held = self._run_hook(hook, platform, f"{platform}-hold")
                self.assertEqual(held.count(HINT), 1)

                self._write_runtime(context_key, hold=False)
                default = self._run_hook(hook, platform, f"{platform}-hold")
                self.assertNotIn(HINT, default)

    def test_new_session_does_not_inherit_unique_old_session_hold(self) -> None:
        """新 session 即使触发 active-task fallback 也不继承旧 hold。"""
        for platform, hook in HOOKS:
            with self.subTest(platform=platform):
                old_key = self._context_key(platform, f"{platform}-old")
                self._write_runtime(old_key, hold=True)
                current = self._run_hook(hook, platform, f"{platform}-new")
                self.assertNotIn(HINT, current)


if __name__ == "__main__":
    unittest.main()
