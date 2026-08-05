"""shared workflow-state Hook 的 stale recovery 测试。"""

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
HOOK_SOURCE = (
    ROOT
    / "vendor/skill-garden/compiled-targets/0.6.12/full/targets/"
    ".codex/hooks/inject-workflow-state.py"
)
STALE_STATE_SOURCE = (
    ROOT
    / "vendor/skill-garden/.trellis/0.6/overrides/patches/workflow/"
    "state-missing-task/content.md"
)
UNTRACKED_STATE_SOURCE = (
    ROOT
    / "vendor/skill-garden/.trellis/0.6/overrides/patches/workflow/"
    "state-untracked/content.md"
)
SESSION_ENV_KEYS = (
    "TRELLIS_CONTEXT_ID",
    "CLAUDE_SESSION_ID",
    "CLAUDE_CODE_SESSION_ID",
    "CODEX_SESSION_ID",
    "CODEX_THREAD_ID",
    "CURSOR_SESSION_ID",
    "OPENCODE_SESSION_ID",
    "OPENCODE_SESSIONID",
    "OPENCODE_RUN_ID",
    "GEMINI_SESSION_ID",
    "FACTORY_SESSION_ID",
    "DROID_SESSION_ID",
    "QODER_SESSION_ID",
    "CODEBUDDY_SESSION_ID",
    "KIRO_SESSION_ID",
    "COPILOT_SESSION_ID",
    "COPILOT_SESSIONID",
    "PI_SESSION_ID",
    "PI_SESSIONID",
    "TRAE_SESSION_ID",
    "SNOW_SESSION_ID",
    "CURSOR_CONVERSATION_ID",
    "CURSOR_CONVERSATIONID",
    "CLAUDE_TRANSCRIPT_PATH",
    "CODEX_TRANSCRIPT_PATH",
    "CURSOR_TRANSCRIPT_PATH",
    "GEMINI_TRANSCRIPT_PATH",
    "FACTORY_TRANSCRIPT_PATH",
    "DROID_TRANSCRIPT_PATH",
    "QODER_TRANSCRIPT_PATH",
    "CODEBUDDY_TRANSCRIPT_PATH",
)


def _load_hook_module() -> types.ModuleType:
    """从真实 compiled target 加载 Hook，且不生成 pycache。

    Returns:
        已执行的 Hook 模块。
    """
    module = types.ModuleType("flower_workflow_state_hook")
    module.__file__ = str(HOOK_SOURCE)
    source = HOOK_SOURCE.read_text(encoding="utf-8")
    exec(compile(source, str(HOOK_SOURCE), "exec"), module.__dict__)
    return module


def _sessionless_env() -> dict[str, str]:
    """返回移除平台会话身份后的环境副本。

    Returns:
        可用于验证 session-fallback 的子进程环境。
    """
    env = os.environ.copy()
    for key in SESSION_ENV_KEYS:
        env.pop(key, None)
    env["PYTHONIOENCODING"] = "utf-8"
    return env


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

    def _install_task_scripts(self) -> Path:
        """安装当前 dogfood 的任务脚本到隔离目录。

        Returns:
            隔离目录中的 task.py 路径。
        """
        scripts = self.root / ".trellis/scripts"
        scripts.mkdir()
        shutil.copytree(ROOT / ".trellis/scripts/common", scripts / "common")
        shutil.copy2(ROOT / ".trellis/scripts/task.py", scripts / "task.py")
        shutil.copy2(ROOT / ".trellis/scripts/decision_log.py", scripts / "decision_log.py")
        shutil.copy2(
            ROOT / "vendor/skill-garden/.trellis/0.6/scripts/untracked_flow.py",
            scripts / "untracked_flow.py",
        )
        return scripts / "task.py"

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

    def test_shared_platform_hooks_are_byte_identical(self) -> None:
        """共享 Hook 副本必须保留局部 Patch 与 0.6.12 上游能力。"""
        target_root = HOOK_SOURCE.parents[2]
        relatives = (
            ".codex/hooks/inject-workflow-state.py",
            ".claude/hooks/inject-workflow-state.py",
            ".gemini/hooks/inject-workflow-state.py",
            ".qoder/hooks/inject-workflow-state.py",
            ".github/copilot/hooks/inject-workflow-state.py",
            ".codebuddy/hooks/inject-workflow-state.py",
            ".factory/hooks/inject-workflow-state.py",
            ".kiro/hooks/inject-workflow-state.py",
            ".trae/hooks/inject-workflow-state.py",
            ".zcode/hooks/inject-workflow-state.py",
        )
        values = [target_root.joinpath(*relative.split("/")).read_bytes() for relative in relatives]

        self.assertTrue(all(value == values[0] for value in values[1:]))
        text = values[0].decode("utf-8")
        for marker in (
            "workflow-state-codex-session-start-guard",
            "workflow-state-stale-task-status",
            "workflow-state-untracked-helper",
            "workflow-state-breadcrumb-subject",
            "workflow-state-main-subject-routing",
        ):
            self.assertIn(marker, text)
        self.assertIn('DEFAULT_PROMPT_INJECTION_SKIP_KEYWORD = "no-trellis"', text)
        self.assertIn('"ZCODE_PROJECT_DIR": "zcode"', text)
        self.assertIn('"auto" or "inline"', text)

    def test_real_stale_runtime_sources_emit_stable_breadcrumb(self) -> None:
        """验证真实 session runtime 的两种 stale 来源都输出权威恢复正文。"""
        self._install_task_scripts()
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

    def test_task_finish_clears_only_unique_session_fallback(self) -> None:
        """验证 finish 清理唯一 fallback，但不跨多个 session 猜测。"""
        task_script = self._install_task_scripts()
        sessions = self.root / ".trellis/.runtime/sessions"
        sessions.mkdir(parents=True)
        fallback = sessions / "codex_context-id.json"
        fallback.write_text(
            json.dumps({"current_task": ".trellis/tasks/missing-task"}),
            encoding="utf-8",
        )

        result = subprocess.run(
            [sys.executable, str(task_script), "finish"],
            cwd=self.root,
            env=_sessionless_env(),
            text=True,
            capture_output=True,
            check=True,
        )

        self.assertFalse(fallback.exists())
        self.assertIn("Cleared current task", result.stdout)
        self.assertIn("session-fallback:codex_context-id", result.stdout)

        first = sessions / "codex_first.json"
        second = sessions / "codex_second.json"
        for session in (first, second):
            session.write_text(
                json.dumps({"current_task": ".trellis/tasks/missing-task"}),
                encoding="utf-8",
            )

        result = subprocess.run(
            [sys.executable, str(task_script), "finish"],
            cwd=self.root,
            env=_sessionless_env(),
            text=True,
            capture_output=True,
            check=True,
        )

        self.assertTrue(first.exists())
        self.assertTrue(second.exists())
        self.assertIn("No current task set", result.stdout)

    def test_task_finish_preserves_corrupt_unique_session_and_fails(self) -> None:
        """唯一 fallback session 损坏时不得把它当成无任务或删除证据。"""
        task_script = self._install_task_scripts()
        corrupt = self.root / ".trellis/.runtime/sessions/codex_corrupt.json"
        corrupt.parent.mkdir(parents=True)
        corrupt.write_text("{broken", encoding="utf-8")

        result = subprocess.run(
            [sys.executable, str(task_script), "finish"],
            cwd=self.root,
            env=_sessionless_env(),
            text=True,
            capture_output=True,
            check=False,
        )

        self.assertEqual(result.returncode, 1)
        self.assertTrue(corrupt.exists())
        self.assertEqual(corrupt.read_text(encoding="utf-8"), "{broken")
        self.assertIn("session-runtime-corrupt", result.stdout)

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

    def test_untracked_stage_selects_one_hop_breadcrumb(self) -> None:
        """合法 untracked 状态优先于 no_task，并按阶段选择单一 owner。"""
        self._install_task_scripts()
        (self.root / ".trellis/workflow.md").write_text(
            UNTRACKED_STATE_SOURCE.read_text(encoding="utf-8"),
            encoding="utf-8",
        )
        session = self.root / ".trellis/.runtime/sessions/codex_work-id.json"
        session.parent.mkdir(parents=True)
        cases = {
            "implement": "trellis-route(target=implement)",
            "check": "trellis-check-all",
            "spec": "trellis-update-spec",
            "push": "load `trellis-push`",
        }
        for stage, owner in cases.items():
            with self.subTest(stage=stage):
                session.write_text(
                    json.dumps(
                        {
                            "current_task": None,
                            "untracked_flow": {
                                "version": 2,
                                "id": "work-123",
                                "source": "user-explicit",
                                "summary": "修复路由偏好",
                                "stage": stage,
                                "createdAt": "2026-08-03T00:00:00Z",
                                "updatedAt": "2026-08-03T00:00:00Z",
                            },
                        }
                    ),
                    encoding="utf-8",
                )

                breadcrumb = self._run_hook(
                    {"cwd": str(self.root), "platform": "codex", "session_id": "work-id"}
                )

                self.assertIn(f"Untracked work: work-123 ({stage})", breadcrumb)
                self.assertIn("Summary: 修复路由偏好", breadcrumb)
                self.assertIn("untracked_flow.py status", breadcrumb)
                self.assertIn(owner, breadcrumb)
                self.assertNotIn("Status: no_task", breadcrumb)
                if stage == "push":
                    self.assertIn("`stage=push` is only a route cursor", breadcrumb)
                    self.assertNotIn("trellis-check-all", breadcrumb)
                    self.assertNotIn("trellis-update-spec", breadcrumb)

    def test_legacy_inspect_state_routes_to_implement(self) -> None:
        """旧 v1 inspect 状态经 helper 映射后进入 implement breadcrumb。"""
        self._install_task_scripts()
        (self.root / ".trellis/workflow.md").write_text(
            UNTRACKED_STATE_SOURCE.read_text(encoding="utf-8"),
            encoding="utf-8",
        )
        session = self.root / ".trellis/.runtime/sessions/codex_legacy.json"
        session.parent.mkdir(parents=True)
        session.write_text(
            json.dumps(
                {
                    "untracked_flow": {
                        "version": 1,
                        "id": "work-legacy",
                        "mode": "direct_edit",
                        "source": "inferred",
                        "summary": "旧事项",
                        "stage": "inspect",
                        "scope": ["src/old.py"],
                        "evidence": {},
                    }
                }
            ),
            encoding="utf-8",
        )

        breadcrumb = self._run_hook(
            {"cwd": str(self.root), "platform": "codex", "session_id": "legacy"}
        )

        self.assertIn("Untracked work: work-legacy (implement)", breadcrumb)
        self.assertIn("trellis-route(target=implement)", breadcrumb)

    def test_linked_worktree_cwd_reports_missing_local_trellis(self) -> None:
        """Hook 已运行时只报告本地 Trellis 缺失，不读取主 worktree 状态。"""
        with tempfile.TemporaryDirectory(prefix="flower-hook-worktree-") as temp:
            base = Path(temp)
            main = base / "main"
            linked = base / "linked"
            main.mkdir()
            (main / ".trellis/scripts").mkdir(parents=True)
            shutil.copytree(ROOT / ".trellis/scripts/common", main / ".trellis/scripts/common")
            shutil.copy2(
                ROOT / "vendor/skill-garden/.trellis/0.6/scripts/untracked_flow.py",
                main / ".trellis/scripts/untracked_flow.py",
            )
            (main / ".trellis/workflow.md").write_text(
                UNTRACKED_STATE_SOURCE.read_text(encoding="utf-8"),
                encoding="utf-8",
            )
            session = main / ".trellis/.runtime/sessions/codex_linked.json"
            session.parent.mkdir(parents=True)
            session.write_text(
                json.dumps(
                    {
                        "current_task": None,
                        "untracked_flow": {
                            "version": 2,
                            "id": "work-linked",
                            "source": "user-explicit",
                            "summary": "linked worktree",
                            "stage": "implement",
                            "createdAt": "2026-08-03T00:00:00Z",
                            "updatedAt": "2026-08-03T00:00:00Z",
                        },
                    }
                ),
                encoding="utf-8",
            )

            subprocess.run(["git", "-C", str(main), "init"], check=True, capture_output=True, text=True)
            subprocess.run(
                ["git", "-C", str(main), "config", "user.email", "test@example.invalid"],
                check=True,
                capture_output=True,
                text=True,
            )
            subprocess.run(
                ["git", "-C", str(main), "config", "user.name", "Test User"],
                check=True,
                capture_output=True,
                text=True,
            )
            (main / "README.md").write_text("main\n", encoding="utf-8")
            subprocess.run(["git", "-C", str(main), "add", "README.md"], check=True, capture_output=True, text=True)
            subprocess.run(
                ["git", "-C", str(main), "commit", "-m", "init"],
                check=True,
                capture_output=True,
                text=True,
            )
            subprocess.run(
                ["git", "-C", str(main), "worktree", "add", "--detach", str(linked), "HEAD"],
                check=True,
                capture_output=True,
                text=True,
            )

            result = subprocess.run(
                [sys.executable, str(HOOK_SOURCE)],
                cwd=linked,
                input=json.dumps({"cwd": str(linked), "platform": "codex", "session_id": "linked"}),
                text=True,
                capture_output=True,
                check=True,
            )

        output = json.loads(result.stdout)
        breadcrumb = output["hookSpecificOutput"]["additionalContext"]
        self.assertIn("<worktree-local-trellis-missing>", breadcrumb)
        self.assertIn("flower-trellis worktree status", breadcrumb)
        self.assertNotIn("work-linked", breadcrumb)
        self.assertNotIn("linked worktree", breadcrumb)

    def test_find_trellis_root_stops_at_nested_git_boundary(self) -> None:
        """Hook 根解析遇到当前 `.git` 边界后不得命中父 Trellis。"""
        nested = self.root / "nested-linked"
        nested.mkdir()
        (nested / ".git").write_text("gitdir: /tmp/example\n", encoding="utf-8")

        self.assertIsNone(self.hook.find_trellis_root(nested))

    def test_invalid_untracked_state_falls_back_to_no_task(self) -> None:
        """损坏的 untracked 字段不得伪造恢复 breadcrumb。"""
        self._install_task_scripts()
        (self.root / ".trellis/workflow.md").write_text(
            "[workflow-state:no_task]\nNO TASK BODY\n[/workflow-state:no_task]\n"
            + UNTRACKED_STATE_SOURCE.read_text(encoding="utf-8"),
            encoding="utf-8",
        )
        session = self.root / ".trellis/.runtime/sessions/codex_invalid.json"
        session.parent.mkdir(parents=True)
        session.write_text(
            json.dumps({"current_task": None, "untracked_flow": {"version": 1}}),
            encoding="utf-8",
        )

        breadcrumb = self._run_hook(
            {"cwd": str(self.root), "platform": "codex", "session_id": "invalid"}
        )

        self.assertIn("Status: no_task", breadcrumb)
        self.assertIn("NO TASK BODY", breadcrumb)

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
