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
    / "vendor/skill-garden/compiled-targets/0.6.14/full/targets/"
    ".codex/hooks/inject-workflow-state.py"
)
HOOK_SOURCES = {
    platform: (
        ROOT
        / "vendor/skill-garden/compiled-targets/0.6.14/full/targets"
        / relative
    )
    for platform, relative in {
        "codex": ".codex/hooks/inject-workflow-state.py",
        "claude": ".claude/hooks/inject-workflow-state.py",
        "gemini": ".gemini/hooks/inject-workflow-state.py",
    }.items()
}
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

    def _run_hook_output(
        self,
        input_data: dict,
        platform: str = "codex",
        *extra_args: str,
    ) -> dict | None:
        """执行完整 Hook 并返回解析后的标准输出。

        会话身份必须完全由 input_data 决定,因此显式传入剔除会话变量的环境:
        Hook 内部的 read_untracked_state 会优先采信 TRELLIS_CONTEXT_ID /
        CLAUDE_CODE_SESSION_ID 等环境变量解析 contextKey。若继承宿主环境,在
        Claude Code、Codex 等 AI 会话里运行时会解析出宿主自身的 contextKey,
        读不到用例写入的 session 文件而误判为无活动工作 —— 表现为 CI 绿、本地红。

        Args:
            input_data: Hook stdin JSON。
            platform: 要执行的真实平台 Hook 路径。
            extra_args: 传给 Hook 的内部参数。

        Returns:
            Hook JSON 对象；静默轮次返回 None。
        """
        result = subprocess.run(
            [sys.executable, str(HOOK_SOURCES[platform]), *extra_args],
            cwd=self.root,
            input=json.dumps(input_data),
            text=True,
            capture_output=True,
            check=True,
            env=_sessionless_env(),
        )
        return json.loads(result.stdout) if result.stdout.strip() else None

    def _run_hook(
        self,
        input_data: dict,
        platform: str = "codex",
        *extra_args: str,
    ) -> str | None:
        """执行完整 Hook 并返回 additionalContext。

        Args:
            input_data: Hook stdin JSON。
            platform: 要执行的真实平台 Hook 路径。
            extra_args: 传给 Hook 的内部参数。

        Returns:
            Hook 输出中的 additionalContext；静默轮次返回 None。
        """
        output = self._run_hook_output(input_data, platform, *extra_args)
        if output is None:
            return None
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

    def _prepare_conditional_state(self, body: str = "Do the current action.") -> None:
        """安装会话解析依赖并写入最小 no_task 状态。

        Args:
            body: workflow-state 的当前动作正文。
        """
        self._install_task_scripts()
        (self.root / ".trellis/workflow.md").write_text(
            f"[workflow-state:no_task]\n{body}\n[/workflow-state:no_task]\n",
            encoding="utf-8",
        )

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
        """共享 Hook 副本必须保留局部 Patch 与 0.6.14 上游能力。"""
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
            "workflow-state-conditional-heartbeat",
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
                shutil.rmtree(
                    self.root / ".trellis/.runtime/workflow-state",
                    ignore_errors=True,
                )

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

    def test_codex_and_claude_emit_heartbeat_on_fifth_unchanged_turn(self) -> None:
        """Codex 与 Claude 在五次未变化输入后只发送可执行心跳。"""
        self._prepare_conditional_state("Do the current action.")
        for platform in ("codex", "claude"):
            with self.subTest(platform=platform):
                input_data = {
                    "cwd": str(self.root),
                    "session_id": f"heartbeat-{platform}",
                }
                first = self._run_hook(input_data, platform)
                self.assertIsNotNone(first)
                self.assertIn("<workflow-state>\n", first)
                for _ in range(4):
                    self.assertIsNone(self._run_hook(input_data, platform))
                heartbeat = self._run_hook(input_data, platform)
                self.assertIsNotNone(heartbeat)
                self.assertIn("<workflow-state-heartbeat>", heartbeat)
                self.assertIn("Status: no_task", heartbeat)
                self.assertIn("Action: Do the current action.", heartbeat)
                self.assertIn("State unchanged for 5 user turns", heartbeat)
                self.assertNotIn("<workflow-state>\n", heartbeat)
                self.assertIsNone(self._run_hook(input_data, platform))

    def test_state_change_emits_full_context_and_restarts_counter(self) -> None:
        """状态正文变化立即完整注入，并从零重新累计心跳。"""
        self._prepare_conditional_state("First action.")
        input_data = {"cwd": str(self.root), "session_id": "state-change"}
        self.assertIn("First action.", self._run_hook(input_data))
        self.assertIsNone(self._run_hook(input_data))
        self.assertIsNone(self._run_hook(input_data))

        (self.root / ".trellis/workflow.md").write_text(
            "[workflow-state:no_task]\nSecond action.\n[/workflow-state:no_task]\n",
            encoding="utf-8",
        )
        changed = self._run_hook(input_data)
        self.assertIsNotNone(changed)
        self.assertIn("<workflow-state>\n", changed)
        self.assertIn("Second action.", changed)
        for _ in range(4):
            self.assertIsNone(self._run_hook(input_data))
        self.assertIn("Action: Second action.", self._run_hook(input_data))

    def test_task_status_and_dispatch_mode_changes_select_new_full_context(self) -> None:
        """任务状态或 Codex mode 变化时完整注入实际选中的 inline 正文。"""
        self._install_task_scripts()
        (self.root / ".trellis/workflow.md").write_text(
            "[workflow-state:planning]\nAuto planning action.\n[/workflow-state:planning]\n"
            "[workflow-state:planning-inline]\nInline planning action.\n[/workflow-state:planning-inline]\n"
            "[workflow-state:in_progress]\nAuto implement action.\n[/workflow-state:in_progress]\n"
            "[workflow-state:in_progress-inline]\nInline implement action.\n[/workflow-state:in_progress-inline]\n",
            encoding="utf-8",
        )
        task_dir = self.root / ".trellis/tasks/route-task"
        task_dir.mkdir(parents=True)
        task_file = task_dir / "task.json"
        task_file.write_text(
            json.dumps({"id": "route-task", "status": "planning"}),
            encoding="utf-8",
        )
        sessions = self.root / ".trellis/.runtime/sessions"
        sessions.mkdir(parents=True)
        (sessions / "codex_route-change.json").write_text(
            json.dumps({"current_task": ".trellis/tasks/route-task"}),
            encoding="utf-8",
        )
        config = self.root / ".trellis/config.yaml"
        config.write_text("codex:\n  dispatch_mode: auto\n", encoding="utf-8")
        input_data = {"cwd": str(self.root), "session_id": "route-change"}

        first = self._run_hook(input_data)
        self.assertIn("Auto planning action.", first)
        self.assertIsNone(self._run_hook(input_data))

        config.write_text("codex:\n  dispatch_mode: inline\n", encoding="utf-8")
        inline = self._run_hook(input_data)
        self.assertIn("<workflow-state>\n", inline)
        self.assertIn("Inline planning action.", inline)
        self.assertIsNone(self._run_hook(input_data))

        task_file.write_text(
            json.dumps({"id": "route-task", "status": "in_progress"}),
            encoding="utf-8",
        )
        changed = self._run_hook(input_data)
        self.assertIn("Task: route-task (in_progress)", changed)
        self.assertIn("Inline implement action.", changed)
        for _ in range(4):
            self.assertIsNone(self._run_hook(input_data))
        heartbeat = self._run_hook(input_data)
        self.assertIn("Action: Inline implement action.", heartbeat)

    def test_task_and_untracked_heartbeats_keep_actionable_subjects(self) -> None:
        """任务与 untracked 心跳保留主体、阶段动作及事项摘要。"""
        self._install_task_scripts()
        (self.root / ".trellis/workflow.md").write_text(
            "[workflow-state:planning]\nPlan the active task.\n[/workflow-state:planning]\n"
            "[workflow-state:untracked]\nImplement the scoped change.\n[/workflow-state:untracked]\n",
            encoding="utf-8",
        )
        task_dir = self.root / ".trellis/tasks/heartbeat-task"
        task_dir.mkdir(parents=True)
        (task_dir / "task.json").write_text(
            json.dumps({"id": "heartbeat-task", "status": "planning"}),
            encoding="utf-8",
        )
        sessions = self.root / ".trellis/.runtime/sessions"
        sessions.mkdir(parents=True)
        (sessions / "codex_task-heartbeat.json").write_text(
            json.dumps({"current_task": ".trellis/tasks/heartbeat-task"}),
            encoding="utf-8",
        )
        task_input = {
            "cwd": str(self.root),
            "session_id": "task-heartbeat",
        }
        self.assertIsNotNone(self._run_hook(task_input))
        for _ in range(4):
            self.assertIsNone(self._run_hook(task_input))
        task_heartbeat = self._run_hook(task_input)
        self.assertIn("Task: heartbeat-task (planning)", task_heartbeat)
        self.assertIn("Action: Plan the active task.", task_heartbeat)

        (sessions / "codex_untracked-heartbeat.json").write_text(
            json.dumps(
                {
                    "current_task": None,
                    "untracked_flow": {
                        "version": 2,
                        "id": "work-heartbeat",
                        "source": "user-explicit",
                        "summary": "修复状态提示",
                        "stage": "implement",
                        "createdAt": "2026-09-17T00:00:00Z",
                        "updatedAt": "2026-09-17T00:00:00Z",
                    },
                }
            ),
            encoding="utf-8",
        )
        untracked_input = {
            "cwd": str(self.root),
            "session_id": "untracked-heartbeat",
        }
        self.assertIsNotNone(self._run_hook(untracked_input))
        for _ in range(4):
            self.assertIsNone(self._run_hook(untracked_input))
        untracked_heartbeat = self._run_hook(untracked_input)
        self.assertIn("Untracked work: work-heartbeat (implement)", untracked_heartbeat)
        self.assertIn("Summary: 修复状态提示", untracked_heartbeat)
        self.assertIn("Action: Implement the scoped change.", untracked_heartbeat)

    def test_missing_task_heartbeat_keeps_recovery_action(self) -> None:
        """missing-task 心跳继续提供权威恢复动作而不是泛化引用。"""
        self._install_task_scripts()
        (self.root / ".trellis/workflow.md").write_text(
            STALE_STATE_SOURCE.read_text(encoding="utf-8"),
            encoding="utf-8",
        )
        sessions = self.root / ".trellis/.runtime/sessions"
        sessions.mkdir(parents=True)
        (sessions / "codex_missing-heartbeat.json").write_text(
            json.dumps({"current_task": ".trellis/tasks/missing-heartbeat"}),
            encoding="utf-8",
        )
        input_data = {"cwd": str(self.root), "session_id": "missing-heartbeat"}

        self.assertIn("Task: missing-heartbeat (missing_task)", self._run_hook(input_data))
        for _ in range(4):
            self.assertIsNone(self._run_hook(input_data))
        heartbeat = self._run_hook(input_data)
        self.assertIn("Task: missing-heartbeat (missing_task)", heartbeat)
        self.assertIn("Action: An active task pointer that points to a missing task directory", heartbeat)

    def test_heartbeat_configuration_supports_zero_and_invalid_fallback(self) -> None:
        """0 关闭心跳，非法值回退到默认五轮。"""
        self._prepare_conditional_state()
        config = self.root / ".trellis/config.yaml"
        config.write_text("prompt_injection:\n  heartbeat_turns: 0\n", encoding="utf-8")
        disabled = {"cwd": str(self.root), "session_id": "heartbeat-disabled"}
        self.assertIsNotNone(self._run_hook(disabled))
        for _ in range(7):
            self.assertIsNone(self._run_hook(disabled))

        config.write_text("prompt_injection:\n  heartbeat_turns: -2\n", encoding="utf-8")
        invalid = {"cwd": str(self.root), "session_id": "heartbeat-invalid"}
        self.assertIsNotNone(self._run_hook(invalid))
        for _ in range(4):
            self.assertIsNone(self._run_hook(invalid))
        heartbeat = self._run_hook(invalid)
        self.assertIsNotNone(heartbeat)
        self.assertIn("State unchanged for 5 user turns", heartbeat)

    def test_interval_change_resets_counter_without_repeating_full_state(self) -> None:
        """心跳间隔变化只重置计数，不改变完整状态指纹。"""
        self._prepare_conditional_state()
        config = self.root / ".trellis/config.yaml"
        input_data = {"cwd": str(self.root), "session_id": "interval-change"}
        self.assertIsNotNone(self._run_hook(input_data))
        self.assertIsNone(self._run_hook(input_data))

        config.write_text("prompt_injection:\n  heartbeat_turns: 2\n", encoding="utf-8")
        self.assertIsNone(self._run_hook(input_data))
        self.assertIsNone(self._run_hook(input_data))
        heartbeat = self._run_hook(input_data)
        self.assertIsNotNone(heartbeat)
        self.assertIn("State unchanged for 2 user turns", heartbeat)

    def test_trackers_are_session_isolated_and_corruption_recovers(self) -> None:
        """不同会话独立计数，损坏记录通过完整注入重建。"""
        self._prepare_conditional_state()
        tracker_root = self.root / ".trellis/.runtime/workflow-state"
        for platform in ("codex", "claude"):
            with self.subTest(platform=platform):
                shutil.rmtree(tracker_root, ignore_errors=True)
                first_session = {
                    "cwd": str(self.root),
                    "session_id": f"{platform}-session-a",
                }
                second_session = {
                    "cwd": str(self.root),
                    "session_id": f"{platform}-session-b",
                }
                self.assertIsNotNone(self._run_hook(first_session, platform))
                self.assertIsNotNone(self._run_hook(second_session, platform))
                for _ in range(4):
                    self.assertIsNone(self._run_hook(first_session, platform))
                self.assertIsNone(self._run_hook(second_session, platform))
                self.assertIn(
                    "workflow-state-heartbeat",
                    self._run_hook(first_session, platform),
                )
                self.assertIsNone(self._run_hook(second_session, platform))

                trackers = sorted(tracker_root.glob("*.json"))
                self.assertEqual(len(trackers), 2)
                first_tracker = next(
                    path
                    for path in trackers
                    if json.loads(path.read_text(encoding="utf-8"))["unchangedTurns"] == 0
                )
                first_tracker.write_text("{broken", encoding="utf-8")
                recovered = self._run_hook(first_session, platform)
                self.assertIsNotNone(recovered)
                self.assertIn("<workflow-state>\n", recovered)
                self.assertEqual(
                    json.loads(first_tracker.read_text(encoding="utf-8"))["unchangedTurns"],
                    0,
                )

    def test_semantically_invalid_trackers_fall_back_to_full_context(self) -> None:
        """结构合法但违反版本 schema 的 tracker 必须完整恢复并重建。"""
        self._prepare_conditional_state()
        input_data = {"cwd": str(self.root), "session_id": "invalid-tracker"}
        self.assertIn("<workflow-state>\n", self._run_hook(input_data))
        tracker = next((self.root / ".trellis/.runtime/workflow-state").glob("*.json"))
        baseline = json.loads(tracker.read_text(encoding="utf-8"))
        cases = {
            "counter-at-threshold": {"unchangedTurns": 5},
            "disabled-with-counter": {"heartbeatTurns": 0, "unchangedTurns": 1},
            "invalid-timestamp": {"updatedAt": "not-a-utc-timestamp"},
            "unknown-field": {"unexpected": True},
        }
        for name, changes in cases.items():
            with self.subTest(name=name):
                tracker.write_text(
                    json.dumps({**baseline, **changes}),
                    encoding="utf-8",
                )
                recovered = self._run_hook(input_data)
                self.assertIn("<workflow-state>\n", recovered)
                rebuilt = json.loads(tracker.read_text(encoding="utf-8"))
                self.assertEqual(rebuilt["unchangedTurns"], 0)
                self.assertEqual(rebuilt["heartbeatTurns"], 5)
                self.assertEqual(set(rebuilt), set(baseline))

    def test_no_trellis_does_not_advance_heartbeat_counter(self) -> None:
        """跳过轮次不读写 tracker，也不进入五轮计数。"""
        self._prepare_conditional_state()
        input_data = {"cwd": str(self.root), "session_id": "skip-turn"}
        self.assertIsNotNone(self._run_hook(input_data))
        tracker = next((self.root / ".trellis/.runtime/workflow-state").glob("*.json"))
        before = tracker.read_bytes()
        self.assertIsNone(self._run_hook({**input_data, "prompt": "please no-trellis now"}))
        self.assertEqual(tracker.read_bytes(), before)
        (self.root / ".trellis/workflow.md").write_text(
            "[workflow-state:no_task]\nChanged after skip.\n[/workflow-state:no_task]\n",
            encoding="utf-8",
        )
        changed = self._run_hook(input_data)
        self.assertIn("<workflow-state>\n", changed)
        self.assertIn("Changed after skip.", changed)
        for _ in range(4):
            self.assertIsNone(self._run_hook(input_data))
        heartbeat = self._run_hook(input_data)
        self.assertIn("workflow-state-heartbeat", heartbeat)
        self.assertIn("Action: Changed after skip.", heartbeat)

    def test_missing_context_and_other_platforms_keep_full_output(self) -> None:
        """无会话身份降级完整注入，非目标平台维持逐轮完整注入。"""
        self._prepare_conditional_state()
        no_context = {"cwd": str(self.root)}
        self.assertIn("<workflow-state>\n", self._run_hook(no_context))
        self.assertIn("<workflow-state>\n", self._run_hook(no_context))
        gemini = {"cwd": str(self.root), "session_id": "gemini-session"}
        self.assertIn("<workflow-state>\n", self._run_hook(gemini, "gemini"))
        self.assertIn("<workflow-state>\n", self._run_hook(gemini, "gemini"))

    def test_session_start_refresh_forces_full_state_and_resets_baseline(self) -> None:
        """内部 SessionStart 刷新总是完整输出并将后续计数归零。"""
        self._prepare_conditional_state()
        input_data = {"cwd": str(self.root), "session_id": "refresh-session"}
        refreshed = self._run_hook(
            input_data,
            "codex",
            "--trellis-session-start-refresh",
        )
        self.assertIsNotNone(refreshed)
        self.assertIn("<workflow-state>\n", refreshed)
        for _ in range(4):
            self.assertIsNone(self._run_hook(input_data))
        self.assertIn("workflow-state-heartbeat", self._run_hook(input_data))

        refreshed = self._run_hook(
            input_data,
            "codex",
            "--trellis-session-start-refresh",
        )
        self.assertIn("<workflow-state>\n", refreshed)
        self.assertIsNone(self._run_hook(input_data))

    def test_tracker_write_failure_falls_back_to_full_context(self) -> None:
        """tracker 写入失败时仍交付完整上下文。"""
        with mock.patch.object(
            self.hook,
            "_resolve_workflow_state_context_key",
            return_value="codex_test",
        ), mock.patch.object(
            self.hook,
            "_write_workflow_state_tracker",
            return_value=False,
        ):
            output = self.hook._conditional_workflow_state_context(
                self.root,
                {},
                "codex",
                {},
                "FULL STATE",
                "HEARTBEAT",
                False,
            )
        self.assertEqual(output, "FULL STATE")

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
