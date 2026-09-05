"""验证两平台分段交付的内容完整性、运行隔离与失败诊断。"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
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
        for name in ["workflow.md", "config.yaml", ".developer"]:
            shutil.copy2(ROOT / ".trellis" / name, self.root / ".trellis" / name)
        for platform in ["codex", "claude"]:
            target = self.root / f".{platform}/hooks/session-start.py"
            target.parent.mkdir(parents=True)
            shutil.copy2(ROOT / f".{platform}/hooks/session-start.py", target)
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
        return subprocess.run(["python3", *args], cwd=self.root, env=env or self.env,
                              input=json.dumps({"cwd": str(self.root), "session_id": "session-parts-test",
                                                "source": source, **(hook_input or {})}),
                              text=True, capture_output=True, timeout=20)

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
                self.assertEqual(texts["state"], SESSION.WORKFLOW_BLOCK.sub("", context))
                self.assertEqual(texts["rules"] + texts["stages"], workflow)
                self.assertIn("Request Triage", texts["rules"])
                self.assertIn("Phase 3: Finish", texts["stages"])
                self.assertNotIn("<current-state>", texts["rules"] + texts["stages"])
        self.assertEqual((self.root / "shell.env").read_text(encoding="utf-8").count("export TRELLIS_CONTEXT_ID="), 1)

    def test_workflow_parts_never_run_native_state_side_effects(self) -> None:
        """规则分段不执行会话绑定或原生主入口。"""
        summary = "### Request Triage\n规则\n### Planning Artifacts\n阶段"
        native = SimpleNamespace(should_skip_injection=lambda: False, main=Mock(),
                                 _build_workflow_toc=lambda path: summary)
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

    def test_astra_only_in_codex_state_for_supported_starts(self) -> None:
        """三种启动来源都只追加一次，其余平台和分段的原文保持。"""
        for source in ("startup", "clear", "compact"):
            for platform in ("codex", "claude"):
                for part in SESSION.PARTS:
                    with self.subTest(source=source, platform=platform, part=part):
                        baseline = json.loads(self.run_hook(platform, part, source).stdout)
                        result = self.run_hook(platform, part, source, hook_input={"model": "gpt-6-astra"})
                        data = json.loads(result.stdout)
                        context = data["hookSpecificOutput"]["additionalContext"]
                        if platform == "codex" and part == "state":
                            self.assertEqual(context.count("<trellis-astra-workflow-hint "), 1)
                            self.assertIn(SESSION.ASTRA_WORKFLOW_HINT, context)
                            original = baseline["hookSpecificOutput"]["additionalContext"]
                            self.assertEqual(context.replace("\n" + SESSION.ASTRA_WORKFLOW_HINT, ""), original)
                            self.assertLessEqual(len(SESSION.ASTRA_WORKFLOW_HINT.encode("utf-8")), 2048)
                        else:
                            self.assertEqual(data, baseline)
                        self.assertNotIn("systemMessage", data)

    def test_model_switch_and_unknown_values_use_event_input_only(self) -> None:
        """同一会话的连续启动事件重新判断模型，别名和非法值不推断。"""
        baseline = self.run_hook("codex", "state").stdout
        models = ["gpt-6-astra", "gpt-5.6-sol", None, 6, [], {}, "GPT-6-ASTRA",
                  "gpt-6-astra-latest", " gpt-6-astra", "gpt-6-astra ", "gpt-6-astra"]
        for model in models:
            with self.subTest(model=model):
                result = self.run_hook("codex", "state", hook_input={"model": model})
                if model == "gpt-6-astra":
                    self.assertIn("<trellis-astra-workflow-hint ", json.loads(result.stdout)["hookSpecificOutput"]["additionalContext"])
                else:
                    self.assertEqual(result.stdout, baseline)
        for source in ("unknown", "", None):
            self.assertNotIn("trellis-astra-workflow-hint", self.run_hook(
                "codex", "state", hook_input={"model": "gpt-6-astra", "source": source}).stdout)

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

    def test_astra_generation_failure_preserves_native_diagnostics(self) -> None:
        """可选提示异常和超预算均不能丢掉原生状态及既有诊断。"""
        def native_main():
            """输出具有已有诊断的原生夹具。"""
            print(json.dumps({"systemMessage": "已有诊断", "hookSpecificOutput": {
                "hookEventName": "SessionStart", "additionalContext": "原生状态\n<trellis-workflow>\n规则\n</trellis-workflow>\n"}}))
        native = SimpleNamespace(should_skip_injection=lambda: False, main=native_main)
        with patch.object(SESSION, "_load_hook", return_value=native):
            for error in (ImportError("配置读取器不可用"), ValueError("提示超预算")):
                with patch.object(SESSION, "_astra_workflow_hint", side_effect=error):
                    result = SESSION.render_part(self.root, SESSION.HOOKS[0], "state",
                                                 {"source": "startup", "model": "gpt-6-astra"})
                    self.assertIn("原生状态", result["hookSpecificOutput"]["additionalContext"])
                    self.assertIn("已有诊断", result["systemMessage"])
                    self.assertIn("Astra 工作流提示未注入", result["systemMessage"])

    def test_oversized_astra_prompt_fails_without_losing_native_state(self) -> None:
        """真实 UTF-8 预算门禁拒绝超限正文，保留工作流状态。"""
        baseline = SESSION.render_part(self.root, SESSION.HOOKS[0], "state", {"source": "startup"})
        with patch.object(SESSION, "ASTRA_WORKFLOW_HINT", "中" * 683):
            result = SESSION.render_part(self.root, SESSION.HOOKS[0], "state",
                                         {"source": "startup", "model": "gpt-6-astra"})
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
            "def should_skip_injection(): return False\ndef main(): print('invalid json')\n",
        ]:
            hook.write_text(source, encoding="utf-8")
            result = self.run_hook("codex", "state")
            self.assertEqual(result.returncode, 0)
            self.assertIn("注入失败", json.loads(result.stdout)["systemMessage"])
            self.assertIn("trellis-injection-error", result.stdout)

    def test_oversized_part_keeps_tail_and_reports_growth(self) -> None:
        """超预算不静默截掉尾部规则，并提供诊断。"""
        summary = "### Request Triage\n" + "规则" * 4500 + "重要尾部\n### Planning Artifacts\n阶段"
        native = SimpleNamespace(should_skip_injection=lambda: False, _build_workflow_toc=lambda path: summary)
        with patch.object(SESSION, "_load_hook", return_value=native):
            result = SESSION.render_part(self.root, SESSION.HOOKS[0], "rules", {})
        self.assertIn("重要尾部", result["hookSpecificOutput"]["additionalContext"])
        self.assertIn("超过", result["systemMessage"])


if __name__ == "__main__":
    unittest.main()
