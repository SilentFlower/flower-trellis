"""验证两平台分段交付的内容完整性、运行隔离与失败诊断。"""

from __future__ import annotations

import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import redirect_stdout
from hashlib import sha256
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch


ROOT = Path(__file__).resolve().parents[2]
SPEC = spec_from_file_location("flower_session", ROOT / "src/assets/flower_session_start.py")
SESSION = module_from_spec(SPEC)
SPEC.loader.exec_module(SESSION)


class FlowerSessionStartTest(unittest.TestCase):
    """在隔离项目上运行实际原生 hook 与三个 handler。"""

    def setUp(self) -> None:
        """准备包含当前工作流和原生 hook 的临时项目。"""
        self.temp = tempfile.TemporaryDirectory(prefix="flower-session-parts-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ["scripts", "spec"]:
            shutil.copytree(ROOT / ".trellis" / name, self.root / ".trellis" / name,
                            ignore=shutil.ignore_patterns("__pycache__"))
        for name in ["workflow.md", "config.yaml"]:
            shutil.copy2(ROOT / ".trellis" / name, self.root / ".trellis" / name)
        # `.developer` 是本地忽略文件；夹具必须自行创建，避免依赖开发者工作区。
        (self.root / ".trellis/.developer").write_text("name=tester\n", encoding="utf-8")
        for platform in ["codex", "claude"]:
            target = self.root / f".{platform}/hooks/session-start.py"
            target.parent.mkdir(parents=True)
            shutil.copy2(ROOT / f".{platform}/hooks/session-start.py", target)
            workflow_hook = self.root / f".{platform}/hooks/inject-workflow-state.py"
            shutil.copy2(
                ROOT
                / "vendor/skill-garden/compiled-targets/0.6.14/full/targets"
                / f".{platform}/hooks/inject-workflow-state.py",
                workflow_hook,
            )
        shutil.copy2(ROOT / "src/assets/flower_session_start.py", self.root / ".trellis/scripts")
        self.env = {
            **os.environ, "TRELLIS_HOOKS": "1", "TRELLIS_DISABLE_HOOKS": "0",
            "CODEX_NON_INTERACTIVE": "0", "TRELLIS_CONTEXT_ID": "session-parts-test",
            "CLAUDE_PROJECT_DIR": str(self.root), "PYTHONDONTWRITEBYTECODE": "1",
            "CLAUDE_ENV_FILE": str(self.root / "shell.env"),
        }

    def run_hook(self, platform: str, part: str | None = None, source: str = "startup", env: dict | None = None,
                 hook_input: dict | None = None):
        """执行原生或分段入口。

        @param platform: codex 或 claude。
        @param part: 分段名；None 表示原生 hook。
        @param source: 会话事件来源。
        @param env: 可选的独立环境变量。
        @param hook_input: 模型等事件字段；覆盖默认输入以验证宿主边界。
        @return: 捕获 stdout / stderr 的子进程结果。
        """
        hook = f".{platform}/hooks/session-start.py"
        args = [hook] if part is None else [".trellis/scripts/flower_session_start.py", "--hook", hook, "--part", part]
        return subprocess.run([sys.executable, "-X", "utf8", *args], cwd=self.root, env=env or self.env,
                              input=json.dumps({"cwd": str(self.root), "session_id": "session-parts-test",
                                                "source": source, **(hook_input or {})}, ensure_ascii=False),
                              text=True, encoding="utf-8", errors="strict", capture_output=True, timeout=20)

    def run_prompt_hook(self, platform: str, hook_input: dict | None = None):
        """执行目标平台的 UserPromptSubmit workflow-state Hook。

        @param platform: codex 或 claude。
        @param hook_input: 覆盖默认会话输入的字段。
        @return: 捕获 stdout / stderr 的子进程结果。
        """
        environment = self.env.copy()
        if platform == "codex":
            # 共享夹具为 Claude 原生 SessionStart 设置了该变量；Codex 真实宿主不会携带它。
            environment.pop("CLAUDE_PROJECT_DIR", None)
        return subprocess.run(
            [sys.executable, "-X", "utf8", f".{platform}/hooks/inject-workflow-state.py"],
            cwd=self.root,
            env=environment,
            input=json.dumps(
                {
                    "cwd": str(self.root),
                    "session_id": "session-parts-test",
                    **(hook_input or {}),
                },
                ensure_ascii=False,
            ),
            text=True,
            encoding="utf-8",
            errors="strict",
            capture_output=True,
            timeout=20,
        )

    def test_state_uses_real_stdio_boundary_for_native_reconfiguration(self) -> None:
        """原生入口可重配真实标准流，不再对包装器的内存流执行 detach。"""
        hook = self.root / ".codex/hooks/session-start.py"
        hook.write_text(
            """import io
import json
import sys

def should_skip_injection():
    return False

def main():
    sys.stdout = io.TextIOWrapper(sys.stdout.detach(), encoding="utf-8", errors="replace")
    hook_input = json.loads(sys.stdin.read())
    context = (
        f"原生状态:{hook_input.get('session_id')}\\n"
        "<trellis-workflow>\\n"
        "### Request Triage\\n规则\\n"
        "### Planning Artifacts\\n阶段\\n"
        "</trellis-workflow>\\n"
    )
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "SessionStart", "additionalContext": context,
    }}, ensure_ascii=False))

if __name__ == "__main__":
    main()
""",
            encoding="utf-8",
        )
        native = SESSION._load_hook(self.root, SESSION.HOOKS[0])
        # 先证明该夹具会稳定击中旧版同进程 StringIO 捕获的真实故障。
        with self.assertRaises(io.UnsupportedOperation):
            with redirect_stdout(io.StringIO()):
                native.main()

        result = self.run_hook("codex", "state")
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        context = data["hookSpecificOutput"]["additionalContext"]
        self.assertIn("原生状态:session-parts-test", context)
        self.assertNotIn("trellis-workflow", context)
        self.assertNotIn("trellis-injection-error", context)

    def test_parallel_parts_preserve_native_content_and_fit_budget(self) -> None:
        """三段正文无损保留原始规则，独立并行运行且低于预算。"""
        for platform in ["codex", "claude"]:
            with self.subTest(platform=platform):
                original = self.run_hook(platform)
                self.assertEqual(original.returncode, 0, original.stderr)
                context = json.loads(original.stdout)["hookSpecificOutput"]["additionalContext"]
                workflow = SESSION.WORKFLOW_BLOCK.search(context).group(1)
                with ThreadPoolExecutor(max_workers=3) as executor:
                    results = list(executor.map(lambda part: self.run_hook(platform, part), SESSION.PARTS))
                texts = {}
                for part, result in zip(SESSION.PARTS, results):
                    self.assertEqual(result.returncode, 0, result.stderr)
                    data = json.loads(result.stdout)
                    self.assertNotIn("systemMessage", data)
                    self.assertNotIn("additional_context", data)
                    text = data["hookSpecificOutput"]["additionalContext"]
                    self.assertLessEqual(len(text), 8000)
                    texts[part] = re.fullmatch(r'<trellis-session-part name="\w+">\n(.*)\n</trellis-session-part>', text, re.DOTALL).group(1)
                native_state = SESSION.WORKFLOW_BLOCK.sub("", context)
                self.assertTrue(texts["state"].startswith(native_state))
                self.assertIn("<workflow-state>\n", texts["state"])
                self.assertEqual(texts["rules"] + texts["stages"], workflow)
                self.assertIn("Request Triage", texts["rules"])
                self.assertIn("Phase 3: Finish", texts["stages"])
                self.assertNotIn("<current-state>", texts["rules"] + texts["stages"])
        self.assertEqual((self.root / "shell.env").read_text(encoding="utf-8").count("export TRELLIS_CONTEXT_ID="), 1)

    def test_native_output_trims_ready_and_keeps_platform_dispatch_contracts(self) -> None:
        """原生输出删除重复 ready，并按平台保留共同规则与自身特例。"""
        common = "Every sub-agent dispatch prompt, including `trellis-research`"
        for platform in ("codex", "claude"):
            with self.subTest(platform=platform):
                result = self.run_hook(platform)
                self.assertEqual(result.returncode, 0, result.stderr)
                context = json.loads(result.stdout)["hookSpecificOutput"]["additionalContext"]
                workflow = SESSION.WORKFLOW_BLOCK.search(context).group(1)
                self.assertNotIn("<ready>", context)
                self.assertIn(common, workflow)
                self.assertIn("enter `trellis-route` first", workflow)
                if platform == "codex":
                    self.assertIn("Codex uses native `SubagentStart`", workflow)
                else:
                    self.assertNotIn("Codex uses native `SubagentStart`", workflow)
                self.assertNotIn("On Grok Build", workflow)
                self.assertNotIn("On Kimi Code", workflow)

        shared = SESSION._load_hook(self.root, SESSION.HOOKS[1])
        workflow_path = self.root / ".trellis/workflow.md"
        for platform, own_detail, other_detail in (
            ("grok", "On Grok Build", "On Kimi Code"),
            ("kimi", "On Kimi Code", "On Grok Build"),
        ):
            with self.subTest(platform=platform):
                summary = shared._build_workflow_overview(workflow_path, platform)
                self.assertIn(common, summary)
                self.assertIn(own_detail, summary)
                self.assertNotIn(other_detail, summary)
        for platform in (None, "unknown-host"):
            with self.subTest(platform=platform):
                summary = shared._build_workflow_overview(workflow_path, platform)
                self.assertIn("Sub-agent dispatch protocol applies to all platforms", summary)
                self.assertIn("On Grok Build", summary)
                self.assertIn("On Kimi Code", summary)

    def test_startup_clear_and_compact_refresh_full_state_and_baseline(self) -> None:
        """三类重建事件完整注入状态，随后首轮未变化输入保持静默。"""
        for platform in ("codex", "claude"):
            for source in ("startup", "clear", "compact"):
                with self.subTest(platform=platform, source=source):
                    result = self.run_hook(platform, "state", source)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    context = json.loads(result.stdout)["hookSpecificOutput"]["additionalContext"]
                    self.assertIn("<workflow-state>\n", context)
                    prompt = self.run_prompt_hook(platform)
                    self.assertEqual(prompt.returncode, 0, prompt.stderr)
                    self.assertEqual(prompt.stdout, "")

    def test_workflow_state_refresh_failure_preserves_native_state(self) -> None:
        """刷新脚本失败时保留原生 state，并输出可见诊断。"""
        (self.root / ".codex/hooks/inject-workflow-state.py").unlink()
        result = self.run_hook("codex", "state")
        self.assertEqual(result.returncode, 0)
        data = json.loads(result.stdout)
        context = data["hookSpecificOutput"]["additionalContext"]
        self.assertIn("<current-state>", context)
        self.assertNotIn("<trellis-injection-error", context)
        self.assertIn("workflow-state 基线未刷新", data["systemMessage"])
        self.assertIn("workflow-state 基线未刷新", result.stderr)

    def test_workflow_parts_never_run_native_state_side_effects(self) -> None:
        """规则分段不执行会话绑定或原生主入口。"""
        summary = "### Request Triage\n规则\n### Planning Artifacts\n阶段"
        native = SimpleNamespace(should_skip_injection=lambda: False, main=Mock(),
                                 _build_workflow_toc=lambda path, platform: summary)
        with patch.object(SESSION, "_load_hook", return_value=native):
            for part in ["rules", "stages"]:
                SESSION.render_part(self.root, SESSION.HOOKS[0], part, {})
        native.main.assert_not_called()

    def test_resume_and_disabled_hooks_emit_nothing(self) -> None:
        """恢复会话和显式禁用不重复注入。"""
        for platform in ["codex", "claude"]:
            for part in SESSION.PARTS:
                self.assertEqual(self.run_hook(platform, part, "resume").stdout, "")
                self.assertEqual(self.run_hook(platform, part, env={**self.env, "TRELLIS_HOOKS": "0"}).stdout, "")
        self.assertEqual(self.run_hook("codex", "state", env={**self.env, "CODEX_NON_INTERACTIVE": "1"}).stdout, "")

    def test_maintenance_runs_only_for_state_startup_and_resume(self) -> None:
        """两平台仅在 state 的 startup/resume 执行同一 maintenance 入口。"""
        script = self.root / ".trellis/scripts/task_lifecycle.py"
        script.write_text(
            """#!/usr/bin/env python3
import json
from pathlib import Path

log = Path('.trellis/maintenance-calls.log')
with log.open('a', encoding='utf-8') as handle:
    handle.write('called\\n')
print(json.dumps({
    'status': 'ok',
    'reconciliation': {'migrated': [], 'blocked': [], 'deferred': [], 'commit': None},
    'gc': {'moved': [{'task': '.trellis/tasks/closed'}], 'deferred': [], 'commit': 'abc'},
}))
""",
            encoding="utf-8",
        )
        log = self.root / ".trellis/maintenance-calls.log"

        for platform in ("codex", "claude"):
            startup = json.loads(self.run_hook(platform, "state", "startup").stdout)
            resume = json.loads(self.run_hook(platform, "state", "resume").stdout)
            self.run_hook(platform, "state", "clear")
            self.run_hook(platform, "state", "compact")
            self.run_hook(platform, "rules", "startup")
            self.run_hook(platform, "stages", "resume")

            self.assertIn("物理 GC 1 个", startup["systemMessage"])
            self.assertIn("物理 GC 1 个", resume["systemMessage"])
            self.assertEqual(resume["hookSpecificOutput"]["additionalContext"], "")

        self.assertEqual(log.read_text(encoding="utf-8").splitlines(), ["called"] * 4)

    def test_maintenance_uses_platform_timeout_as_the_only_deadline(self) -> None:
        """包装器不再用内部硬超时杀死正在执行 Git 事务的 maintenance 子进程。"""
        script = self.root / ".trellis/scripts/task_lifecycle.py"
        script.write_text("# fixture\n", encoding="utf-8")
        completed = SimpleNamespace(
            returncode=0,
            stderr=b"",
            stdout=json.dumps({
                "status": "ok",
                "reconciliation": {"migrated": [], "blocked": [], "deferred": [], "commit": None},
                "gc": {"moved": [], "deferred": [], "commit": None},
            }).encode("utf-8"),
        )

        with patch.object(SESSION.subprocess, "run", return_value=completed) as run:
            self.assertEqual(SESSION._run_task_maintenance(self.root), "")

        self.assertNotIn("timeout", run.call_args.kwargs)

    def test_model_hints_only_in_codex_state_for_supported_starts(self) -> None:
        """两个模型在三类启动来源各追加一次，其余平台和分段保持原文。"""
        for model, hint, name, other in (
            (SESSION.ASTRA_MODEL, SESSION.ASTRA_WORKFLOW_HINT, "astra", "sol"),
            (SESSION.SOL_MODEL, SESSION.SOL_WORKFLOW_HINT, "sol", "astra"),
        ):
            for source in ("startup", "clear", "compact"):
                for platform in ("codex", "claude"):
                    for part in SESSION.PARTS:
                        with self.subTest(model=model, source=source, platform=platform, part=part):
                            baseline = json.loads(self.run_hook(platform, part, source).stdout)
                            result = self.run_hook(platform, part, source, hook_input={"model": model})
                            data = json.loads(result.stdout)
                            context = data["hookSpecificOutput"]["additionalContext"]
                            self.assertNotIn(f"<trellis-{other}-workflow-hint ", context)
                            if platform == "codex" and part == "state":
                                self.assertEqual(context.count(f"<trellis-{name}-workflow-hint "), 1)
                                self.assertIn(hint, context)
                                original = baseline["hookSpecificOutput"]["additionalContext"]
                                self.assertEqual(context.replace("\n" + hint, ""), original)
                                self.assertLessEqual(len(hint.encode("utf-8")), 2048)
                            else:
                                self.assertEqual(data, baseline)
                            self.assertNotIn("systemMessage", data)

    def test_sol_reuses_unchanged_astra_body(self) -> None:
        """Astra 最终原文不漂移，Sol 仅替换模型标识和标签。"""
        self.assertEqual(sha256(SESSION.ASTRA_WORKFLOW_HINT.encode("utf-8")).hexdigest(),
                         "50da76355fe333285e691706479784c06dec3e868fd1f42858671531cc51eb6f")
        self.assertEqual(SESSION.SOL_WORKFLOW_HINT.replace("trellis-sol-workflow-hint", "trellis-astra-workflow-hint")
                         .replace(SESSION.SOL_MODEL, SESSION.ASTRA_MODEL), SESSION.ASTRA_WORKFLOW_HINT)

    def test_model_switch_and_unknown_values_use_event_input_only(self) -> None:
        """同一会话的连续启动事件重新判断模型，别名和非法值不推断。"""
        baseline = self.run_hook("codex", "state").stdout
        models = ["gpt-6-astra", "gpt-6-sol", "gpt-5.6-sol", None, 6, [], {},
                  "GPT-6-ASTRA", "GPT-6-SOL", "gpt-6-astra-latest", "gpt-6-sol-latest",
                  " gpt-6-astra", "gpt-6-astra ", " gpt-6-sol", "gpt-6-sol "]
        for model in models:
            with self.subTest(model=model):
                result = self.run_hook("codex", "state", hook_input={"model": model})
                if model == "gpt-6-astra":
                    self.assertIn("<trellis-astra-workflow-hint ", json.loads(result.stdout)["hookSpecificOutput"]["additionalContext"])
                elif model == "gpt-6-sol":
                    self.assertIn("<trellis-sol-workflow-hint ", json.loads(result.stdout)["hookSpecificOutput"]["additionalContext"])
                else:
                    self.assertEqual(result.stdout, baseline)
        for model, name in ((SESSION.ASTRA_MODEL, "astra"), (SESSION.SOL_MODEL, "sol")):
            for source in ("unknown", "", None):
                self.assertNotIn(f"trellis-{name}-workflow-hint", self.run_hook(
                    "codex", "state", hook_input={"model": model, "source": source}).stdout)

    def test_sol_config_is_independent_and_preserves_skip_contract(self) -> None:
        """Sol 开关只控制 Sol；全局禁用、resume 和普通轮次保持原语义。"""
        config = self.root / ".trellis/config.yaml"
        baseline = json.loads(self.run_hook("codex", "state").stdout)
        for raw in ("false", '"false"', "FALSE"):
            config.write_text(f"codex:\n  astra_workflow_hint: true\n  sol_workflow_hint: {raw}\n", encoding="utf-8")
            result = json.loads(self.run_hook("codex", "state", hook_input={"model": SESSION.SOL_MODEL}).stdout)
            self.assertEqual(result, baseline)
            self.assertIn("trellis-astra-workflow-hint", self.run_hook(
                "codex", "state", hook_input={"model": SESSION.ASTRA_MODEL}).stdout)
        for raw in ("true", '"true"', "TRUE"):
            config.write_text(f"codex:\n  astra_workflow_hint: false\n  sol_workflow_hint: {raw}\n", encoding="utf-8")
            self.assertIn("trellis-sol-workflow-hint", self.run_hook(
                "codex", "state", hook_input={"model": SESSION.SOL_MODEL}).stdout)
            result = json.loads(self.run_hook("codex", "state", hook_input={"model": SESSION.ASTRA_MODEL}).stdout)
            self.assertEqual(result, baseline)
        for env in ({"TRELLIS_HOOKS": "0"}, {"TRELLIS_DISABLE_HOOKS": "1"}, {"CODEX_NON_INTERACTIVE": "1"}):
            self.assertEqual(self.run_hook("codex", "state", env={**self.env, **env},
                                           hook_input={"model": SESSION.SOL_MODEL}).stdout, "")
        self.assertEqual(self.run_hook("codex", "state", "resume",
                                       hook_input={"model": SESSION.SOL_MODEL}).stdout, "")
        self.assertNotIn("trellis-sol-workflow-hint", self.run_prompt_hook(
            "codex", {"model": SESSION.SOL_MODEL, "prompt": "no-trellis"}).stdout)

    def test_astra_config_and_global_disables_preserve_original_contract(self) -> None:
        """关闭模型提示仍保留原上下文，全局禁用和 resume 保持零输出。"""
        config = self.root / ".trellis/config.yaml"
        baseline = json.loads(self.run_hook("codex", "state").stdout)
        for raw in ("false", '"false"', "FALSE"):
            config.write_text(f"codex:\n  dispatch_mode: auto\n  astra_workflow_hint: {raw}\n", encoding="utf-8")
            result = json.loads(self.run_hook("codex", "state", hook_input={"model": "gpt-6-astra"}).stdout)
            self.assertEqual(result, baseline)
        for raw in ("true", '"true"', "TRUE"):
            config.write_text(f"codex:\n  astra_workflow_hint: {raw}\n", encoding="utf-8")
            result = self.run_hook("codex", "state", hook_input={"model": "gpt-6-astra"})
            self.assertIn("trellis-astra-workflow-hint", result.stdout)
        for env in ({"TRELLIS_HOOKS": "0"}, {"TRELLIS_DISABLE_HOOKS": "1"}, {"CODEX_NON_INTERACTIVE": "1"}):
            for part in SESSION.PARTS:
                self.assertEqual(self.run_hook("codex", part, env={**self.env, **env},
                                               hook_input={"model": "gpt-6-astra"}).stdout, "")
        self.assertEqual(self.run_hook("codex", "state", "resume", hook_input={"model": "gpt-6-astra"}).stdout, "")

    def test_invalid_astra_config_is_diagnosed_without_losing_state(self) -> None:
        """非法开关停用增强并保留原生上下文，不冒充整个启动失败。"""
        baseline = json.loads(self.run_hook("codex", "state").stdout)["hookSpecificOutput"]
        for config in ("codex: invalid\n", "codex:\n  astra_workflow_hint: yes\n",
                       "codex:\n  astra_workflow_hint: 1\n", "codex:\n  astra_workflow_hint:\n"):
            (self.root / ".trellis/config.yaml").write_text(config, encoding="utf-8")
            result = self.run_hook("codex", "state", hook_input={"model": "gpt-6-astra"})
            data = json.loads(result.stdout)
            self.assertEqual(data["hookSpecificOutput"], baseline)
            self.assertIn("Astra 工作流提示未注入", data["systemMessage"])
            self.assertIn("Astra 工作流提示未注入", result.stderr)

    def test_invalid_sol_config_is_diagnosed_without_losing_state(self) -> None:
        """非法 Sol 开关只停用可选提示，原生 state 继续输出。"""
        baseline = json.loads(self.run_hook("codex", "state").stdout)["hookSpecificOutput"]
        for config in ("codex: invalid\n", "codex:\n  sol_workflow_hint: yes\n",
                       "codex:\n  sol_workflow_hint: 1\n", "codex:\n  sol_workflow_hint:\n"):
            (self.root / ".trellis/config.yaml").write_text(config, encoding="utf-8")
            result = self.run_hook("codex", "state", hook_input={"model": SESSION.SOL_MODEL})
            data = json.loads(result.stdout)
            self.assertEqual(data["hookSpecificOutput"], baseline)
            self.assertIn("Sol 工作流提示未注入", data["systemMessage"])
            self.assertIn("Sol 工作流提示未注入", result.stderr)

    def test_astra_generation_failure_preserves_native_diagnostics(self) -> None:
        """可选提示异常和超预算均不能丢掉原生状态及既有诊断。"""
        def native_result(*_args):
            """返回具有已有诊断的原生夹具。"""
            return {"systemMessage": "已有诊断", "hookSpecificOutput": {
                "hookEventName": "SessionStart", "additionalContext": "原生状态\n<trellis-workflow>\n规则\n</trellis-workflow>\n"}}
        with patch.object(SESSION, "_run_native_hook", side_effect=native_result):
            for model, builder, label in ((SESSION.ASTRA_MODEL, "_astra_workflow_hint", "Astra"),
                                          (SESSION.SOL_MODEL, "_sol_workflow_hint", "Sol")):
                for error in (ImportError("配置读取器不可用"), ValueError("提示超预算")):
                    with patch.object(SESSION, builder, side_effect=error):
                        result = SESSION.render_part(self.root, SESSION.HOOKS[0], "state",
                                                     {"source": "startup", "model": model})
                        self.assertIn("原生状态", result["hookSpecificOutput"]["additionalContext"])
                        self.assertIn("已有诊断", result["systemMessage"])
                        self.assertIn(f"{label} 工作流提示未注入", result["systemMessage"])

    def test_oversized_astra_prompt_fails_without_losing_native_state(self) -> None:
        """真实 UTF-8 预算门禁拒绝超限正文，保留工作流状态。"""
        baseline = SESSION.render_part(self.root, SESSION.HOOKS[0], "state", {"source": "startup"})
        for model, constant in ((SESSION.ASTRA_MODEL, "ASTRA_WORKFLOW_HINT"),
                                (SESSION.SOL_MODEL, "SOL_WORKFLOW_HINT")):
            with patch.object(SESSION, constant, "中" * 683):
                result = SESSION.render_part(self.root, SESSION.HOOKS[0], "state",
                                             {"source": "startup", "model": model})
            self.assertEqual(result["hookSpecificOutput"], baseline["hookSpecificOutput"])
            self.assertIn("超过 2048 字节预算", result["systemMessage"])

    def test_missing_hook_and_boundary_have_visible_diagnostics(self) -> None:
        """源缺失或结构变化不被当作完整注入。"""
        (self.root / ".codex/hooks/session-start.py").unlink()
        result = self.run_hook("codex", "state")
        self.assertIn("注入失败", json.loads(result.stdout)["systemMessage"])
        self.assertIn("trellis-injection-error", result.stdout)
        (self.root / ".trellis/workflow.md").write_text("# 不兼容模板\n", encoding="utf-8")
        result = self.run_hook("claude", "rules")
        self.assertIn("分段边界", json.loads(result.stdout)["systemMessage"])

    def test_corrupt_native_output_and_source_have_visible_diagnostics(self) -> None:
        """原生入口损坏或输出不是 JSON 时保留可见错误。"""
        hook = self.root / ".codex/hooks/session-start.py"
        for source in [
            "def broken(\n",
            "def main(): print('invalid json')\nif __name__ == '__main__': main()\n",
        ]:
            hook.write_text(source, encoding="utf-8")
            result = self.run_hook("codex", "state")
            self.assertEqual(result.returncode, 0)
            self.assertIn("注入失败", json.loads(result.stdout)["systemMessage"])
            self.assertIn("trellis-injection-error", result.stdout)

    def test_native_empty_output_and_failure_preserve_process_contract(self) -> None:
        """原生跳过保持零输出，失败退出码与 stderr 进入可见诊断。"""
        hook = self.root / ".codex/hooks/session-start.py"
        hook.write_text("raise SystemExit(0)\n", encoding="utf-8")
        skipped = self.run_hook("codex", "state")
        self.assertEqual(skipped.returncode, 0)
        self.assertEqual(skipped.stdout, "")
        self.assertEqual(skipped.stderr, "")

        hook.write_text(
            "import sys\nprint('原生子进程诊断', file=sys.stderr)\nraise SystemExit(7)\n",
            encoding="utf-8",
        )
        failed = self.run_hook("codex", "state")
        self.assertEqual(failed.returncode, 0)
        self.assertIn("原生子进程诊断", failed.stderr)
        data = json.loads(failed.stdout)
        self.assertIn("退出码 7", data["systemMessage"])
        self.assertIn("trellis-injection-error", failed.stdout)

    def test_oversized_part_keeps_tail_and_reports_growth(self) -> None:
        """超预算不静默截掉尾部规则，并提供诊断。"""
        summary = "### Request Triage\n" + "规则" * 4500 + "重要尾部\n### Planning Artifacts\n阶段"
        native = SimpleNamespace(should_skip_injection=lambda: False,
                                 _build_workflow_toc=lambda path, platform: summary)
        with patch.object(SESSION, "_load_hook", return_value=native):
            result = SESSION.render_part(self.root, SESSION.HOOKS[0], "rules", {})
        self.assertIn("重要尾部", result["hookSpecificOutput"]["additionalContext"])
        self.assertIn("超过", result["systemMessage"])


if __name__ == "__main__":
    unittest.main()
