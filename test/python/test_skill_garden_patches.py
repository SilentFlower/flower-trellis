"""Skill-Garden Patch Python consumer 测试。"""

from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
RUNNER = ROOT / "vendor/skill-garden/scripts/apply-trellis-patches.py"
OVERRIDES = ROOT / "vendor/skill-garden/.trellis/0.6/overrides"
SHARED_CORE_FIXTURE = ROOT / "test/fixtures/patch-engine/core"


def _load_runner():
    spec = importlib.util.spec_from_file_location("skill_garden_patches", RUNNER)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _write(root: Path, relative: str, value: str) -> Path:
    file = root.joinpath(*relative.split("/"))
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(value, encoding="utf-8")
    return file


class PatchConsumerTest(unittest.TestCase):
    """验证 Python runner 的 Core Patch、迁移、预检和幂等。"""

    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="skill-garden-patch-")
        self.root = Path(self.temp.name)
        self.target = self.root / "target"
        self.overrides = self.root / "overrides"
        (self.target / ".trellis").mkdir(parents=True)
        _write(self.target, ".trellis/.version", "0.6.5\n")
        _write(
            self.overrides,
            "compatibility.json",
            (OVERRIDES / "compatibility.json").read_text(encoding="utf-8"),
        )
        _write(
            self.overrides,
            "conflicts.json",
            json.dumps({"schemaVersion": 1, "rules": []}) + "\n",
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def add_patch(
        self,
        ref: str,
        declaration: dict,
        sources: dict[str, str],
    ) -> None:
        leaf = self.overrides / "patches" / ref
        _write(leaf, "patch.json", json.dumps(declaration, indent=2) + "\n")
        for name, value in sources.items():
            _write(leaf, name, value)

    def add_bundle(self, declaration: dict) -> None:
        _write(
            self.overrides / "bundles",
            f"{declaration['id']}.json",
            json.dumps(declaration, indent=2) + "\n",
        )

    def run_runner(self, *skills: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["python3", str(RUNNER), str(self.overrides), str(self.target), *skills],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )

    def load_shared_core_fixture(self) -> None:
        """把 JS/Python 共用的 Core Patch catalog 与目标复制到临时目录。"""
        shutil.copytree(
            SHARED_CORE_FIXTURE / "catalog",
            self.overrides,
            dirs_exist_ok=True,
        )
        shutil.copytree(
            SHARED_CORE_FIXTURE / "target",
            self.target,
            dirs_exist_ok=True,
        )

    def use_real_conflicts(self) -> None:
        """把生产 conflicts policy 写入当前临时 overrides。"""
        _write(
            self.overrides,
            "conflicts.json",
            (OVERRIDES / "conflicts.json").read_text(encoding="utf-8"),
        )

    def test_literal_three_operations_legacy_migration_and_idempotency(self) -> None:
        self.load_shared_core_fixture()

        first = self.run_runner("alias")
        self.assertEqual(first.returncode, 0, first.stderr)
        once = (self.target / "sample.md").read_text(encoding="utf-8")
        self.assertIn("skill-garden patch replace-rule", once)
        self.assertIn("INSERT A\nINSERT B", once)
        self.assertNotIn("\nREMOVE\n", once)

        second = self.run_runner("alias")
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertIn("changed=0", second.stdout)
        self.assertEqual((self.target / "sample.md").read_text(encoding="utf-8"), once)

        (self.target / "sample.md").write_text(
            once.replace(
                "skill-garden patch replace-rule",
                "skill-garden transform replace-rule",
            ),
            encoding="utf-8",
        )
        migrated = self.run_runner()
        self.assertEqual(migrated.returncode, 0, migrated.stderr)
        value = (self.target / "sample.md").read_text(encoding="utf-8")
        self.assertIn("skill-garden patch replace-rule", value)
        self.assertNotIn("skill-garden transform replace-rule", value)

    def test_required_drift_is_zero_write(self) -> None:
        _write(self.target, "valid.md", "VALID\n")
        _write(self.target, "drift.md", "DRIFT\n")
        self.add_patch(
            "atomic",
            {
                "schemaVersion": 2,
                "id": "atomic",
                "purpose": "test",
                "operations": [
                    {
                        "id": "valid-rule",
                        "operation": "replace",
                        "targets": [
                            {"kind": "markdown", "path": "valid.md", "missing": "error"}
                        ],
                        "selector": {"type": "literal", "source": "valid.selector.md"},
                        "content": {"source": "valid.content.md"},
                    },
                    {
                        "id": "drift-rule",
                        "operation": "replace",
                        "targets": [
                            {"kind": "markdown", "path": "drift.md", "missing": "error"}
                        ],
                        "selector": {"type": "literal", "source": "drift.selector.md"},
                        "content": {"source": "drift.content.md"},
                    },
                ],
            },
            {
                "valid.selector.md": "VALID",
                "valid.content.md": "CHANGED",
                "drift.selector.md": "EXPECTED",
                "drift.content.md": "REPLACED",
            },
        )
        self.add_bundle({"schemaVersion": 1, "id": "atomic", "patches": ["atomic"]})

        result = self.run_runner()
        self.assertEqual(result.returncode, 1)
        self.assertIn("Patch 预检失败", result.stderr)
        self.assertEqual((self.target / "valid.md").read_text(encoding="utf-8"), "VALID\n")

    def test_optional_target_policy_and_missing_create(self) -> None:
        """验证 optional skip、at-least-one 与受控文件创建。"""
        _write(self.target, ".trellis/.version", "0.6.6\n")
        _write(self.target, "existing.md", "KEEP\n")
        (self.target / "generated").mkdir()
        self.add_patch(
            "targets/policies",
            {
                "schemaVersion": 2,
                "id": "target-policies",
                "purpose": "test",
                "operations": [
                    {
                        "id": "optional-drift",
                        "operation": "replace",
                        "required": False,
                        "targets": [
                            {"kind": "markdown", "path": "existing.md", "missing": "error"}
                        ],
                        "selector": {"type": "literal", "source": "missing.selector.md"},
                        "content": {"source": "optional.content.md"},
                    },
                    {
                        "id": "one-existing",
                        "operation": "replace",
                        "targetPolicy": "at-least-one",
                        "targets": [
                            {
                                "kind": "json",
                                "path": "generated/result.json",
                                "missing": "create",
                                "markerStyle": "none",
                            },
                            {
                                "kind": "file",
                                "path": "absent/result.txt",
                                "missing": "skip",
                                "markerStyle": "none",
                            },
                        ],
                        "selector": {"type": "whole-file"},
                        "content": {"source": "generated.content.txt"},
                    },
                ],
            },
            {
                "missing.selector.md": "MISSING",
                "optional.content.md": "IGNORED",
                "generated.content.txt": '{"created":true}',
            },
        )
        self.add_bundle(
            {"schemaVersion": 1, "id": "policies", "patches": ["targets/policies"]}
        )

        result = self.run_runner()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("optional Patch 跳过:optional-drift@existing.md", result.stdout)
        self.assertEqual((self.target / "existing.md").read_text(), "KEEP\n")
        self.assertEqual(
            (self.target / "generated/result.json").read_text(),
            '{"created":true}\n',
        )
        self.assertIn("missing-target=1 optional-skip=1", result.stdout)
        self.assertIn("Patch 信息:1 个目标入口未安装", result.stdout)
        self.assertIn("Patch 警告:untested-upstream@.trellis/.version", result.stdout)
        self.assertIn("证据:0.6.6", result.stdout)
        self.assertLess(result.stdout.index("Patch 警告"), result.stdout.index("✓ Patch"))

    def test_shared_policy_version_and_conflict_report(self) -> None:
        """验证版本分级、最终产物断言和 error 零写入。"""
        runner = _load_runner()
        self.use_real_conflicts()
        policy = runner.load_patch_policy(self.overrides)
        plan = {
            "files": [
                {
                    "target": ".trellis/workflow.md",
                    "next": "Never push to remote in this step.\n",
                    "operations": ["workflow-phase-3-commit"],
                }
            ],
            "results": [],
        }
        report = runner.build_patch_conflict_report("0.6.6", plan, policy)
        self.assertEqual(report["version"]["status"], "untested-compatible")
        self.assertEqual(report["summary"], {"errors": 1, "warnings": 1, "info": 0})
        self.assertEqual(
            [item["id"] for item in report["diagnostics"]],
            ["workflow-no-local-only-commit", "untested-upstream"],
        )
        with self.assertRaisesRegex(runner.PatchError, "Patch 冲突检查失败"):
            runner.assert_no_patch_conflict_errors(report)

    def test_policy_reference_and_boolean_schema_are_strict(self) -> None:
        """验证错误 catalog 引用与 Python bool/int 差异都会阻断。"""
        runner = _load_runner()
        compatibility_file = self.overrides / "compatibility.json"
        compatibility_file.write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "variant": "0.6",
                    "compatibleLine": {"major": True, "minor": 6},
                    "testedVersions": ["0.6.5"],
                    "untestedPatchPolicy": "warning",
                    "newLinePolicy": "error",
                }
            ),
            encoding="utf-8",
        )
        with self.assertRaisesRegex(runner.PatchError, "非负整数 major/minor"):
            runner.load_patch_policy(self.overrides)

        compatibility_file.write_text(
            (OVERRIDES / "compatibility.json").read_text(encoding="utf-8"),
            encoding="utf-8",
        )
        _write(
            self.overrides,
            "conflicts.json",
            json.dumps(
                {
                    "schemaVersion": 1,
                    "rules": [
                        {
                            "id": "windows-drive",
                            "severity": "error",
                            "target": "C:/outside.md",
                            "whenOperations": ["known-operation"],
                            "assertion": {
                                "type": "required-literal",
                                "values": ["FINAL"],
                            },
                            "owner": "test",
                            "reason": "test",
                        }
                    ],
                }
            ),
        )
        with self.assertRaisesRegex(runner.PatchError, "POSIX 相对路径"):
            runner.load_patch_policy(self.overrides)

        plan = {
            "files": [],
            "results": [],
            "catalogOperations": [
                {"id": "known-operation", "targets": [".trellis/workflow.md"]}
            ],
        }
        conflicts = {
            "schemaVersion": 1,
            "rules": [
                {
                    "id": "reference-check",
                    "severity": "error",
                    "target": ".trellis/workflow.md",
                    "whenOperations": ["missing-operation"],
                    "assertion": {"type": "required-literal", "values": ["FINAL"]},
                    "owner": "test",
                    "reason": "test",
                }
            ],
        }
        with self.assertRaisesRegex(runner.PatchError, "引用未知 operation"):
            runner.evaluate_patch_conflicts(plan, conflicts)

    def test_unsupported_version_is_zero_write(self) -> None:
        """验证跨兼容线时在 Patch 应用前退出。"""
        _write(self.target, ".trellis/.version", "0.7.0\n")
        _write(self.target, "sample.md", "UPSTREAM 0.7\n")
        self.add_patch(
            "version/guard",
            {
                "schemaVersion": 2,
                "id": "version-guard",
                "purpose": "test",
                "operations": [
                    {
                        "id": "version-guard-replace",
                        "operation": "replace",
                        "targets": [
                            {"kind": "markdown", "path": "sample.md", "missing": "error"}
                        ],
                        "selector": {"type": "literal", "source": "selector.md"},
                        "content": {"source": "content.md"},
                    }
                ],
            },
            {"selector.md": "OLD", "content.md": "NEW"},
        )
        self.add_bundle(
            {"schemaVersion": 1, "id": "version-guard", "patches": ["version/guard"]}
        )

        result = self.run_runner()
        self.assertEqual(result.returncode, 1)
        self.assertIn("unsupported-upstream-line", result.stderr)
        self.assertIn("--no-enhance", result.stderr)
        self.assertEqual((self.target / "sample.md").read_text(), "UPSTREAM 0.7\n")

    def test_missing_create_rejects_non_config_target(self) -> None:
        """验证独立 consumer 不允许用 create 新建普通文件。"""
        self.add_patch(
            "targets/invalid-create",
            {
                "schemaVersion": 2,
                "id": "invalid-create",
                "purpose": "test",
                "operations": [
                    {
                        "id": "invalid-create-file",
                        "operation": "replace",
                        "targets": [
                            {"kind": "file", "path": "result.txt", "missing": "create"}
                        ],
                        "selector": {"type": "whole-file"},
                        "content": {"source": "content.txt"},
                    }
                ],
            },
            {"content.txt": "NOPE"},
        )
        self.add_bundle(
            {
                "schemaVersion": 1,
                "id": "invalid-create",
                "patches": ["targets/invalid-create"],
            }
        )

        result = self.run_runner()
        self.assertEqual(result.returncode, 1)
        self.assertIn("missing=create 只允许 json/yaml/toml target", result.stderr)

    def test_create_parent_symlink_escape_is_rejected(self) -> None:
        """验证新建配置不会沿项目内软链写到项目外。"""
        with tempfile.TemporaryDirectory(prefix="patch-outside-") as outside:
            (self.target / "generated").symlink_to(outside, target_is_directory=True)
            self.add_patch(
                "targets/symlink-create",
                {
                    "schemaVersion": 2,
                    "id": "symlink-create",
                    "purpose": "test",
                    "operations": [
                        {
                            "id": "symlink-create-json",
                            "operation": "replace",
                            "targets": [
                                {
                                    "kind": "json",
                                    "path": "generated/result.json",
                                    "missing": "create",
                                }
                            ],
                            "selector": {"type": "whole-file"},
                            "content": {"source": "content.json"},
                        }
                    ],
                },
                {"content.json": '{"unsafe":false}'},
            )
            self.add_bundle(
                {
                    "schemaVersion": 1,
                    "id": "symlink-create",
                    "patches": ["targets/symlink-create"],
                }
            )

            result = self.run_runner()
            self.assertEqual(result.returncode, 1)
            self.assertIn("target.parent 通过软链逃逸根目录", result.stderr)
            self.assertFalse((Path(outside) / "result.json").exists())

    def test_create_parent_symlink_swap_after_preflight_is_rejected(self) -> None:
        """验证 apply 会复核预检后被替换的配置父目录。"""
        with tempfile.TemporaryDirectory(prefix="apply-outside-") as outside:
            (self.target / "generated").mkdir()
            self.add_patch(
                "targets/symlink-swap",
                {
                    "schemaVersion": 2,
                    "id": "symlink-swap",
                    "purpose": "test",
                    "operations": [
                        {
                            "id": "symlink-swap-json",
                            "operation": "replace",
                            "targets": [
                                {
                                    "kind": "json",
                                    "path": "generated/result.json",
                                    "missing": "create",
                                }
                            ],
                            "selector": {"type": "whole-file"},
                            "content": {"source": "content.json"},
                        }
                    ],
                },
                {"content.json": '{"unsafe":false}'},
            )
            self.add_bundle(
                {
                    "schemaVersion": 1,
                    "id": "symlink-swap",
                    "patches": ["targets/symlink-swap"],
                }
            )
            runner = _load_runner()
            plan = runner.prepare_patches(self.overrides, self.target)
            (self.target / "generated").rmdir()
            (self.target / "generated").symlink_to(outside, target_is_directory=True)

            with self.assertRaisesRegex(
                runner.PatchError,
                "Patch 目标父目录:generated/result.json 通过软链逃逸根目录",
            ):
                runner.apply_prepared(self.target, plan)
            self.assertFalse((Path(outside) / "result.json").exists())

    def test_backup_symlink_escape_is_rejected(self) -> None:
        """验证首次备份不会沿 `.backup-flower` 软链写到项目外。"""
        with tempfile.TemporaryDirectory(prefix="backup-outside-") as outside:
            _write(self.target, "sample.md", "OLD\n")
            (self.target / ".trellis/.backup-flower").symlink_to(
                outside,
                target_is_directory=True,
            )
            self.add_patch(
                "targets/symlink-backup",
                {
                    "schemaVersion": 2,
                    "id": "symlink-backup",
                    "purpose": "test",
                    "operations": [
                        {
                            "id": "symlink-backup-file",
                            "operation": "replace",
                            "targets": [
                                {"kind": "markdown", "path": "sample.md", "missing": "error"}
                            ],
                            "selector": {"type": "literal", "source": "selector.md"},
                            "content": {"source": "content.md"},
                        }
                    ],
                },
                {"selector.md": "OLD", "content.md": "NEW"},
            )
            self.add_bundle(
                {
                    "schemaVersion": 1,
                    "id": "symlink-backup",
                    "patches": ["targets/symlink-backup"],
                }
            )

            result = self.run_runner()
            self.assertEqual(result.returncode, 1)
            self.assertIn("Patch backup parent 通过软链逃逸根目录", result.stderr)
            self.assertEqual((self.target / "sample.md").read_text(), "OLD\n")
            self.assertEqual(list(Path(outside).iterdir()), [])

    def test_workflow_state_section_document_and_whole_file(self) -> None:
        _write(
            self.target,
            ".trellis/workflow.md",
            "## Phase Index\n\n[workflow-state:planning]\nBASE\n[/workflow-state:planning]\n",
        )
        _write(
            self.target,
            "update.md",
            "---\nname: update\n---\n\n# Update\n\n## Interactive Mode\n\nASK\n\n## Keep\n\nKEEP\n",
        )
        _write(self.target, "finish.md", "---\nname: finish\n---\n\n# Old\n\nBODY\n")
        _write(self.target, "hook.py", "UPSTREAM\n")
        self.add_patch(
            "workflow/state",
            {
                "schemaVersion": 2,
                "id": "workflow-state",
                "purpose": "workflow_state",
                "operations": [
                    {
                        "id": "workflow-state-planning",
                        "operation": "replace",
                        "scope": "body",
                        "targets": [
                            {
                                "kind": "workflow",
                                "path": ".trellis/workflow.md",
                                "missing": "error",
                            }
                        ],
                        "selector": {"type": "workflow-state", "name": "planning"},
                        "baselines": ["baseline.md"],
                        "content": {
                            "sources": ["common-content.md", "subagent-content.md"]
                        },
                    }
                ],
            },
            {
                "baseline.md": "BASE",
                "common-content.md": "COMMON",
                "subagent-content.md": "SUBAGENT",
            },
        )
        self.add_patch(
            "skills/update",
            {
                "schemaVersion": 2,
                "id": "update",
                "purpose": "skill_override",
                "operations": [
                    {
                        "id": "update-mode",
                        "operation": "replace",
                        "targets": [
                            {"kind": "skill", "path": "update.md", "missing": "error"}
                        ],
                        "selector": {
                            "type": "markdown-section",
                            "heading": "## Interactive Mode",
                        },
                        "baselines": ["baseline.md"],
                        "content": {"source": "content.md"},
                    }
                ],
            },
            {"baseline.md": "## Interactive Mode\n\nASK", "content.md": "## Auto\n\nDECIDE"},
        )
        self.add_patch(
            "skills/finish",
            {
                "schemaVersion": 2,
                "id": "finish",
                "purpose": "skill_override",
                "operations": [
                    {
                        "id": "finish-body",
                        "operation": "replace",
                        "scope": "body",
                        "targets": [
                            {"kind": "skill", "path": "finish.md", "missing": "error"}
                        ],
                        "selector": {"type": "markdown-document", "preserveFrontmatter": True},
                        "baselines": ["baseline.md"],
                        "content": {"source": "content.md"},
                    }
                ],
            },
            {"baseline.md": "# Old\n\nBODY", "content.md": "# Finish\n\nNEW"},
        )
        self.add_patch(
            "hooks/file",
            {
                "schemaVersion": 2,
                "id": "hook",
                "purpose": "hook_override",
                "operations": [
                    {
                        "id": "hook-file",
                        "operation": "replace",
                        "targets": [
                            {
                                "kind": "file",
                                "path": "hook.py",
                                "missing": "error",
                                "markerStyle": "none",
                            }
                        ],
                        "selector": {"type": "whole-file"},
                        "baselines": ["baseline.py"],
                        "content": {"source": "content.py"},
                    }
                ],
            },
            {"baseline.py": "UPSTREAM\n", "content.py": "PATCHED\n"},
        )
        self.add_bundle(
            {
                "schemaVersion": 1,
                "id": "all",
                "patches": [
                    "workflow/state",
                    "skills/update",
                    "skills/finish",
                    "hooks/file",
                ],
            }
        )

        result = self.run_runner()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("COMMON\nSUBAGENT", (self.target / ".trellis/workflow.md").read_text())
        self.assertNotIn("Interactive Mode", (self.target / "update.md").read_text())
        self.assertIn("## Keep", (self.target / "update.md").read_text())
        self.assertIn("# Finish", (self.target / "finish.md").read_text())
        self.assertEqual((self.target / "hook.py").read_text(), "PATCHED\n")

    def test_real_catalog_preflight_matches_current_dogfood(self) -> None:
        runner = _load_runner()
        plan = runner.prepare_patches(OVERRIDES, ROOT)
        self.assertEqual(len(plan["patches"]), 24)
        self.assertGreaterEqual(len(plan["files"]), 10)
        self.assertGreaterEqual(
            sum(item["status"] == "ready" for item in plan["results"]),
            24,
        )

    def test_real_catalog_task_intent_selects_complete_stale_recovery(self) -> None:
        """验证 Python consumer 的精细安装包含完整 stale recovery Patch。"""
        runner = _load_runner()
        plan = runner.prepare_patches(OVERRIDES, ROOT, ["task-intent"])

        self.assertEqual(plan["bundles"], ["intent-routing"])
        self.assertTrue(
            {
                "workflow-state-missing-task",
                "workflow-runtime-contract-reference",
                "inject-workflow-state-shared-runtime",
                "codex-session-start-missing-task",
                "claude-session-start-missing-task",
            }.issubset(set(plan["patches"]))
        )


if __name__ == "__main__":
    unittest.main()
