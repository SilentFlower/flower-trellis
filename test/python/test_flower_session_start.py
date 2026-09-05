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

    def run_hook(self, platform: str, part: str | None = None, source: str = "startup", env: dict | None = None):
        """执行原生或分段入口。

        @param platform: codex 或 claude。
        @param part: 分段名；None 表示原生 hook。
        @param source: 会话事件来源。
        @param env: 可选的独立环境变量。
        @return: 捕获 stdout / stderr 的子进程结果。
        """
        hook = f".{platform}/hooks/session-start.py"
        args = [hook] if part is None else [".trellis/scripts/flower_session_start.py", "--hook", hook, "--part", part]
        return subprocess.run(["python3", *args], cwd=self.root, env=env or self.env,
                              input=json.dumps({"cwd": str(self.root), "session_id": "session-parts-test", "source": source}),
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
