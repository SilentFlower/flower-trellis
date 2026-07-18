"""skill-garden 独立安装器声明式变换测试。"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
GARDEN_ROOT = PROJECT_ROOT / "vendor/skill-garden"
RUNNER = GARDEN_ROOT / "scripts/apply-trellis-transforms.py"
TRANSFORMS = GARDEN_ROOT / ".trellis/0.6/overrides/transforms"


def _write(root: Path, relative: str, value: str) -> Path:
    file = root / relative
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(value, encoding="utf-8")
    return file


def _match(name: str) -> str:
    return (TRANSFORMS / "matches" / name).read_text(encoding="utf-8").rstrip()


def _minimal_workflow() -> str:
    return "\n".join(
        [
            "## Phase Index",
            "",
            "```",
            _match("workflow-phase-summary.md"),
            "Phase 2: Execute",
            "Phase 3: Finish",
            "```",
            "",
            "### Request Triage",
            "",
            _match("workflow-request-triage.md"),
            "",
            "[workflow-state:no_task]",
            _match("workflow-no-task-body.md"),
            "[/workflow-state:no_task]",
            "",
            "### Phase 1: Plan",
            _match("workflow-phase-index-create-task.md"),
            "",
            "[workflow-state:planning]",
            "Planning body.",
            "[/workflow-state:planning]",
            "",
            "[workflow-state:planning-inline]",
            "Planning inline body.",
            "[/workflow-state:planning-inline]",
            "",
            "[workflow-state:in_progress]",
            "In progress body.",
            "[/workflow-state:in_progress]",
            "",
            "[workflow-state:in_progress-inline]",
            "In progress inline body.",
            "[/workflow-state:in_progress-inline]",
            "",
            "## Phase 1: Plan",
            "",
            _match("workflow-phase-one-goal.md"),
            "",
            "#### 1.0 Create task `[required · once]`",
            "",
            _match("workflow-create-task-rule.md"),
            "",
            _match("workflow-create-task-command.md"),
            "",
            "## Customizing Trellis (for forks)",
            "",
            "Critical invariants:",
            _match("workflow-customization-intent-invariant.md"),
            "",
        ]
    )


def _snapshot(root: Path) -> dict[str, bytes]:
    return {
        file.relative_to(root).as_posix(): file.read_bytes()
        for file in sorted(root.rglob("*"))
        if file.is_file()
    }


class StandaloneTransformRunnerTest(unittest.TestCase):
    """验证 Python runner 与 JS transform 协议保持一致。"""

    def setUp(self) -> None:
        """创建隔离声明目录和目标项目。"""
        self.temp = tempfile.TemporaryDirectory(prefix="skill-garden-transform-")
        self.root = Path(self.temp.name)
        self.transforms = self.root / "transforms"
        self.target = self.root / "target"
        self.transforms.mkdir()
        self.target.mkdir()

    def tearDown(self) -> None:
        """删除隔离目录。"""
        self.temp.cleanup()

    def _run(self, *skills: str, check: bool = True) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(
            ["python3", str(RUNNER), str(self.transforms), str(self.target), *skills],
            capture_output=True,
            text=True,
            check=False,
        )
        if check and result.returncode != 0:
            self.fail(f"runner failed:\n{result.stdout}\n{result.stderr}")
        return result

    def test_insert_replace_remove_and_idempotence(self) -> None:
        """三种 operation 首次生效，重复运行不新增 diff。"""
        declaration = {
            "schemaVersion": 1,
            "id": "example",
            "aliases": ["workflow-enhancement"],
            "operations": [
                {
                    "id": "replace-rule",
                    "operation": "replace",
                    "targets": [{"kind": "workflow", "path": ".trellis/workflow.md"}],
                    "selector": {"source": "matches/replace.txt", "expectedMatches": 1},
                    "content": {"source": "content/replace.txt"},
                },
                {
                    "id": "insert-rule",
                    "operation": "insert",
                    "position": "after",
                    "targets": [{"kind": "workflow", "path": ".trellis/workflow.md"}],
                    "selector": {"source": "matches/insert.txt", "expectedMatches": 1},
                    "content": {"source": "content/insert.txt"},
                },
                {
                    "id": "remove-rule",
                    "operation": "remove",
                    "targets": [{"kind": "workflow", "path": ".trellis/workflow.md"}],
                    "selector": {"source": "matches/remove.txt", "expectedMatches": 1},
                },
            ],
        }
        _write(self.transforms, "example.json", json.dumps(declaration))
        _write(self.transforms, "matches/replace.txt", "OLD")
        _write(self.transforms, "content/replace.txt", "NEW")
        _write(self.transforms, "matches/insert.txt", "ANCHOR")
        _write(self.transforms, "content/insert.txt", "INSERTED")
        _write(self.transforms, "matches/remove.txt", "REMOVE ME")
        workflow = _write(
            self.target,
            ".trellis/workflow.md",
            "prefix\nOLD\nANCHOR\nREMOVE ME\nsuffix\n",
        )
        original = workflow.read_text(encoding="utf-8")

        first = self._run("workflow-enhancement")
        self.assertIn("changed=1", first.stdout)
        once = workflow.read_text(encoding="utf-8")
        self.assertIn("skill-garden transform replace-rule", once)
        self.assertIn("ANCHOR\n<!-- BEGIN skill-garden transform insert-rule", once)
        self.assertNotIn("REMOVE ME", once)
        backup = self.target / ".trellis/.backup-flower/.trellis/workflow.md"
        self.assertEqual(backup.read_text(encoding="utf-8"), original)

        second = self._run("workflow-enhancement")
        self.assertIn("changed=0", second.stdout)
        self.assertEqual(workflow.read_text(encoding="utf-8"), once)

    def test_required_drift_is_zero_write(self) -> None:
        """required selector 漂移时连已就绪目标也不能写入。"""
        declaration = {
            "schemaVersion": 1,
            "id": "example",
            "operations": [
                {
                    "id": "valid-rule",
                    "operation": "replace",
                    "targets": [{"kind": "workflow", "path": ".trellis/workflow.md"}],
                    "selector": {"source": "matches/valid.txt", "expectedMatches": 1},
                    "content": {"source": "content/valid.txt"},
                },
                {
                    "id": "drift-rule",
                    "operation": "replace",
                    "targets": [{"kind": "skill", "path": ".agents/skills/demo/SKILL.md"}],
                    "selector": {"source": "matches/drift.txt", "expectedMatches": 1},
                    "content": {"source": "content/drift.txt"},
                },
            ],
        }
        _write(self.transforms, "example.json", json.dumps(declaration))
        _write(self.transforms, "matches/valid.txt", "VALID")
        _write(self.transforms, "content/valid.txt", "CHANGED")
        _write(self.transforms, "matches/drift.txt", "EXPECTED")
        _write(self.transforms, "content/drift.txt", "REPLACED")
        workflow = _write(self.target, ".trellis/workflow.md", "VALID\n")
        skill = _write(self.target, ".agents/skills/demo/SKILL.md", "OTHER\n")

        result = self._run(check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("drift-rule", result.stderr)
        self.assertEqual(workflow.read_text(encoding="utf-8"), "VALID\n")
        self.assertEqual(skill.read_text(encoding="utf-8"), "OTHER\n")
        self.assertFalse((self.target / ".trellis/.backup-flower").exists())

    def test_optional_skip_reports_reason(self) -> None:
        """独立 runner 必须把 optional skip 原因展示给调用者。"""
        declaration = {
            "schemaVersion": 1,
            "id": "example",
            "operations": [
                {
                    "id": "optional-rule",
                    "operation": "replace",
                    "required": False,
                    "targets": [
                        {
                            "kind": "hook",
                            "path": ".codex/hooks/session-start.py",
                            "markerStyle": "hash",
                        }
                    ],
                    "selector": {"source": "matches/value.txt", "expectedMatches": 1},
                    "content": {"source": "content/value.txt"},
                }
            ],
        }
        _write(self.transforms, "example.json", json.dumps(declaration))
        _write(self.transforms, "matches/value.txt", "EXPECTED")
        _write(self.transforms, "content/value.txt", "REPLACED")
        _write(self.target, ".codex/hooks/session-start.py", "OTHER\n")

        result = self._run()
        self.assertIn("optional transform 跳过:optional-rule", result.stdout)
        self.assertIn("selector 匹配 0 次", result.stdout)

    def test_hook_marker_migrates_from_html_to_hash(self) -> None:
        """Python hook 必须把旧 HTML marker 迁移为可执行的井号注释。"""
        declaration = {
            "schemaVersion": 1,
            "id": "example",
            "operations": [
                {
                    "id": "hook-rule",
                    "operation": "replace",
                    "targets": [
                        {
                            "kind": "hook",
                            "path": ".codex/hooks/session-start.py",
                            "markerStyle": "hash",
                        }
                    ],
                    "selector": {"source": "matches/hook.txt", "expectedMatches": 1},
                    "content": {"source": "content/hook.txt"},
                }
            ],
        }
        _write(self.transforms, "example.json", json.dumps(declaration))
        _write(self.transforms, "matches/hook.txt", "OLD HOOK")
        _write(self.transforms, "content/hook.txt", "NEW HOOK")
        hook = _write(
            self.target,
            ".codex/hooks/session-start.py",
            "<!-- BEGIN skill-garden transform hook-rule v0.6 -->\n"
            "LEGACY HOOK\n"
            "<!-- END skill-garden transform hook-rule v0.6 -->\n",
        )

        self._run()
        value = hook.read_text(encoding="utf-8")
        self.assertIn("# BEGIN skill-garden transform hook-rule", value)
        self.assertIn("NEW HOOK", value)
        self.assertNotIn("<!-- BEGIN skill-garden transform hook-rule", value)

    def test_hook_requires_explicit_marker_style(self) -> None:
        """hook 未声明 markerStyle 时两个 consumer 都必须拒绝。"""
        declaration = {
            "schemaVersion": 1,
            "id": "example",
            "operations": [
                {
                    "id": "hook-rule",
                    "operation": "replace",
                    "targets": [{"kind": "hook", "path": ".codex/hooks/session-start.py"}],
                    "selector": {"source": "matches/hook.txt", "expectedMatches": 1},
                    "content": {"source": "content/hook.txt"},
                }
            ],
        }
        _write(self.transforms, "example.json", json.dumps(declaration))
        _write(self.transforms, "matches/hook.txt", "OLD HOOK")
        _write(self.transforms, "content/hook.txt", "NEW HOOK")
        _write(self.target, ".codex/hooks/session-start.py", "OLD HOOK\n")

        result = self._run(check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("hook target 必须显式声明 markerStyle", result.stderr)


class StandaloneInstallerIntegrationTest(unittest.TestCase):
    """从临时 Git 源执行 install.sh，验证独立安装完整链路。"""

    @classmethod
    def setUpClass(cls) -> None:
        """复制当前 skill-garden working tree 并创建可 clone 的临时提交。"""
        cls.source_temp = tempfile.TemporaryDirectory(prefix="skill-garden-source-")
        cls.source = Path(cls.source_temp.name) / "skill-garden"
        shutil.copytree(
            GARDEN_ROOT,
            cls.source,
            ignore=shutil.ignore_patterns(".git", "__pycache__", "*.pyc"),
        )
        subprocess.run(["git", "init", "-q"], cwd=cls.source, check=True)
        subprocess.run(["git", "config", "user.name", "Tester"], cwd=cls.source, check=True)
        subprocess.run(
            ["git", "config", "user.email", "tester@example.com"],
            cwd=cls.source,
            check=True,
        )
        subprocess.run(["git", "add", "."], cwd=cls.source, check=True)
        subprocess.run(["git", "commit", "-qm", "fixture"], cwd=cls.source, check=True)

    @classmethod
    def tearDownClass(cls) -> None:
        """删除临时 skill-garden Git 源。"""
        cls.source_temp.cleanup()

    def setUp(self) -> None:
        """创建包含 Trellis 0.6 原始片段的目标项目。"""
        self.target_temp = tempfile.TemporaryDirectory(prefix="skill-garden-target-")
        self.target = Path(self.target_temp.name)
        _write(self.target, ".trellis/.version", "0.6.5\n")
        self.workflow = _write(self.target, ".trellis/workflow.md", _minimal_workflow())
        _write(
            self.target,
            ".agents/skills/trellis-start/SKILL.md",
            f"# Start\n\n{_match('start-no-task-routing.md')}\n",
        )
        _write(
            self.target,
            ".agents/skills/trellis-brainstorm/SKILL.md",
            f"# Brainstorm\n\n{_match('brainstorm-planning-authorization.md')}\n\n"
            f"{_match('brainstorm-auto-task-create.md')}\n",
        )
        _write(
            self.target,
            ".claude/skills/trellis-brainstorm/SKILL.md",
            f"# Brainstorm\n\n{_match('brainstorm-planning-authorization.md')}\n\n"
            f"{_match('brainstorm-auto-task-create.md')}\n",
        )
        _write(
            self.target,
            ".codex/hooks/session-start.py",
            f"{_match('codex-session-start-no-task.py')}\n",
        )
        _write(
            self.target,
            ".claude/hooks/session-start.py",
            f"{_match('claude-session-start-no-task.py')}\n",
        )

    def tearDown(self) -> None:
        """删除目标项目。"""
        self.target_temp.cleanup()

    def _install(
        self,
        check: bool = True,
        scope: str = "trellis",
    ) -> subprocess.CompletedProcess[str]:
        env = {**os.environ, "SKILL_GARDEN_BOOTSTRAPPED": "1"}
        result = subprocess.run(
            [
                "bash",
                str(self.source / "scripts/install.sh"),
                "--scope",
                scope,
                "--repo",
                str(self.source),
                str(self.target),
            ],
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        if check and result.returncode != 0:
            self.fail(f"install failed:\n{result.stdout}\n{result.stderr}")
        return result

    def test_full_install_applies_transforms_and_remains_idempotent(self) -> None:
        """完整安装同步 helper，不恢复 no_task additive，第二次文件树稳定。"""
        original = self.workflow.read_text(encoding="utf-8")
        first = self._install()
        self.assertIn("声明式变换 changed=6", first.stdout)
        workflow = self.workflow.read_text(encoding="utf-8")
        self.assertIn("skill-garden transform workflow-no-task-body", workflow)
        self.assertIn("#### Request Intent Routing", workflow)
        self.assertNotIn("ask only whether this turn should create", workflow)
        self.assertNotIn("skill-garden workflow-state no_task", workflow)
        self.assertIn("task_intent.py create --title", workflow)
        self.assertIn("Keep manual or historical tasks unchanged", workflow)
        self.assertNotIn(
            "task-creation consent",
            (self.target / ".codex/hooks/session-start.py").read_text(encoding="utf-8"),
        )
        self.assertNotIn(
            "asks only whether",
            (self.target / ".claude/hooks/session-start.py").read_text(encoding="utf-8"),
        )
        self.assertTrue((self.target / ".trellis/scripts/task_intent.py").is_file())
        backup = self.target / ".trellis/.backup-flower/.trellis/workflow.md"
        self.assertEqual(backup.read_text(encoding="utf-8"), original)
        once = _snapshot(self.target)

        second = self._install()
        self.assertIn("声明式变换 changed=0", second.stdout)
        self.assertEqual(_snapshot(self.target), once)

    def test_transform_drift_stops_before_asset_copy(self) -> None:
        """workflow 漂移时独立安装器在复制 helper 和 skill 前失败。"""
        self.workflow.write_text("upstream drift\n", encoding="utf-8")
        common = _write(
            self.target,
            ".claude/skills/open-idea/SKILL.md",
            "user common skill\n",
        )
        before = _snapshot(self.target)

        result = self._install(check=False, scope="all")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("声明式强化变换预检失败", result.stderr)
        self.assertEqual(_snapshot(self.target), before)
        self.assertEqual(common.read_text(encoding="utf-8"), "user common skill\n")
        self.assertFalse((self.target / ".trellis/scripts/task_intent.py").exists())


if __name__ == "__main__":
    unittest.main()
