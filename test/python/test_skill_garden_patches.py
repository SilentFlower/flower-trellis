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

    def test_operation_order_qualified_provenance_and_bundle_membership(self) -> None:
        """验证 Python consumer 的稳定排序、qualified identity 与多 Bundle provenance。"""
        _write(self.target, "sample.md", "AUTH\nAUTO\n")
        self.add_patch(
            "ordering/flow",
            {
                "schemaVersion": 2,
                "id": "ordering-flow",
                "purpose": "test",
                "operations": [
                    {
                        "id": "auto-task-create",
                        "dependsOn": ["planning-authorization"],
                        "operation": "replace",
                        "targets": [
                            {"kind": "markdown", "path": "sample.md", "missing": "error"}
                        ],
                        "selector": {"type": "literal", "source": "auto-selector.md"},
                        "content": {"source": "auto-content.md"},
                    },
                    {
                        "id": "planning-authorization",
                        "operation": "replace",
                        "targets": [
                            {"kind": "markdown", "path": "sample.md", "missing": "error"}
                        ],
                        "selector": {"type": "literal", "source": "auth-selector.md"},
                        "content": {"source": "auth-content.md"},
                    },
                    {
                        "id": "planning-handoff",
                        "operation": "replace",
                        "targets": [
                            {"kind": "file", "path": "missing-handoff.txt", "missing": "skip"}
                        ],
                        "selector": {"type": "whole-file"},
                        "content": {"value": "handoff"},
                    },
                    {
                        "id": "planning-readiness",
                        "after": ["planning-handoff"],
                        "operation": "replace",
                        "targets": [
                            {"kind": "file", "path": "missing-readiness.txt", "missing": "skip"}
                        ],
                        "selector": {"type": "whole-file"},
                        "content": {"value": "readiness"},
                    },
                ],
            },
            {
                "auto-selector.md": "AUTO",
                "auto-content.md": "AUTO UPDATED",
                "auth-selector.md": "AUTH",
                "auth-content.md": "AUTH UPDATED",
            },
        )
        self.add_bundle(
            {"schemaVersion": 1, "id": "first", "patches": ["ordering/flow"]}
        )
        self.add_bundle(
            {"schemaVersion": 1, "id": "second", "patches": ["ordering/flow"]}
        )

        runner = _load_runner()
        plan = runner.prepare_patches(self.overrides, self.target)
        self.assertEqual(
            [item["id"] for item in plan["operationOrder"]],
            [
                "planning-authorization",
                "auto-task-create",
                "planning-handoff",
                "planning-readiness",
            ],
        )
        self.assertEqual(
            plan["selectedPatches"][0]["bundles"],
            ["skill-garden/first", "skill-garden/second"],
        )
        result = runner.apply_prepared(self.target, plan)
        self.assertEqual(result["provenance"]["schemaVersion"], 2)
        self.assertEqual(
            [item["qualifiedId"] for item in result["provenance"]["applied"]],
            [
                "skill-garden/planning-authorization",
                "skill-garden/auto-task-create",
            ],
        )
        self.assertEqual(
            result["provenance"]["applied"][0]["bundles"],
            ["skill-garden/first", "skill-garden/second"],
        )

    def test_operation_dependency_errors_fail_before_write(self) -> None:
        """验证未知 qualified catalog、自依赖和循环不会写入目标。"""
        _write(self.target, "sample.md", "KEEP\n")
        self.add_patch(
            "invalid/dependency",
            {
                "schemaVersion": 2,
                "id": "invalid-dependency",
                "purpose": "test",
                "operations": [
                    {
                        "id": "invalid-dependency",
                        "after": ["plugin/missing-operation"],
                        "operation": "replace",
                        "targets": [
                            {"kind": "markdown", "path": "sample.md", "missing": "error"}
                        ],
                        "selector": {"type": "literal", "source": "selector.md"},
                        "content": {"source": "content.md"},
                    }
                ],
            },
            {"selector.md": "KEEP", "content.md": "CHANGED"},
        )
        self.add_bundle(
            {"schemaVersion": 1, "id": "invalid", "patches": ["invalid/dependency"]}
        )

        runner = _load_runner()
        with self.assertRaisesRegex(runner.PatchError, "引用未知 operation"):
            runner.prepare_patches(self.overrides, self.target)
        self.assertEqual((self.target / "sample.md").read_text(encoding="utf-8"), "KEEP\n")

        self.add_patch(
            "invalid/dependency",
            {
                "schemaVersion": 2,
                "id": "invalid-dependency",
                "purpose": "test",
                "operations": [
                    {
                        "id": "base-operation",
                        "operation": "replace",
                        "targets": [
                            {"kind": "file", "path": "base.txt", "missing": "skip"}
                        ],
                        "selector": {"type": "whole-file"},
                        "content": {"value": "base"},
                    },
                    {
                        "id": "consumer-operation",
                        "after": ["base-operation"],
                        "dependsOn": ["skill-garden/base-operation"],
                        "operation": "replace",
                        "targets": [
                            {"kind": "file", "path": "consumer.txt", "missing": "skip"}
                        ],
                        "selector": {"type": "whole-file"},
                        "content": {"value": "consumer"},
                    },
                ],
            },
            {},
        )
        with self.assertRaisesRegex(runner.PatchError, "同一依赖不能同时声明"):
            runner.prepare_patches(self.overrides, self.target)

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
        self.assertIn(
            "Patch 警告:skill-garden/untested-upstream@.trellis/.version",
            result.stdout,
        )
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
        self.assertEqual(len(plan["patches"]), 32)
        self.assertGreaterEqual(len(plan["files"]), 10)
        self.assertGreaterEqual(
            sum(item["status"] == "ready" for item in plan["results"]),
            27,
        )
        operation_ids = {item["id"] for item in plan["results"]}
        self.assertIn("task-start-session-write-gate", operation_ids)
        self.assertIn("task-finish-clear-result", operation_ids)
        self.assertIn("active-task-runtime-json-io", operation_ids)
        self.assertIn("task-create-parent-link", operation_ids)
        self.assertIn("codex-session-start-pre-check-hold", operation_ids)
        self.assertIn("claude-session-start-pre-check-hold", operation_ids)
        self.assertIn("runtime-state-integrity", set(plan["patches"]))
        self.assertIn("before-dev-project-knowledge-discovery", operation_ids)
        self.assertIn("trellis-continue-task-progress-recovery", operation_ids)

    def test_real_conflicts_cover_new_control_plane_operations(self) -> None:
        """新增控制面 operation 必须进入最终产物冲突断言。"""
        conflicts = json.loads((OVERRIDES / "conflicts.json").read_text(encoding="utf-8"))
        covered = {
            operation
            for rule in conflicts["rules"]
            for operation in rule.get("whenOperations", [])
        }

        self.assertTrue({
            "task-create-active-warning",
            "task-store-decision-log-import",
            "task-archive-metadata-guard",
            "task-set-branch-write",
            "task-set-base-branch-write",
            "task-set-scope-write",
            "paths-clear-current-result",
        }.issubset(covered))

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
                "workflow-task-brief-review",
                "brainstorm-planning-handoff",
                "task-start-brief-gate",
            }.issubset(set(plan["patches"]))
        )
        self.assertIn(
            "active-task-clear-session-fallback",
            {item["id"] for item in plan["results"]},
        )
        self.assertIn(
            "active-task-clear-read-result",
            {item["id"] for item in plan["results"]},
        )
        self.assertNotIn(
            "active-task-runtime-json-io",
            {item["id"] for item in plan["results"]},
        )
        self.assertNotIn("task-store-write-integrity", set(plan["patches"]))
        self.assertNotIn("runtime-state-integrity", set(plan["patches"]))
        workflow = next(
            item["next"]
            for item in plan["files"]
            if item["target"] == ".trellis/workflow.md"
        )
        self.assertIn(
            "Repair authorization and permission to skip task planning are separate",
            workflow,
        )
        self.assertIn(
            "repair scope is unknown, use `inspect` first and reclassify from evidence",
            workflow,
        )
        self.assertIn(
            "Asking for an opinion, expressing discomfort, rejecting a proposal",
            workflow,
        )
        self.assertIn(
            "Asking to inspect, explain, verify, or locate a cause is `inspect`",
            workflow,
        )
        self.assertIn(
            "`direct_edit` requires known, bounded, low-risk, reversible scope",
            workflow,
        )
        self.assertIn(
            "risk signals, not automatic `task_plan` outcomes",
            workflow,
        )
        self.assertIn(
            "exact rollback or mechanically synchronized known change",
            workflow,
        )
        self.assertIn("`fix item 1`, `change that`, `修一下`, `改一下`", workflow)
        self.assertIn("Only an explicit current-request workflow instruction", workflow)
        self.assertIn("python3 ./.trellis/scripts/spec_router.py", workflow)
        self.assertIn("follow `load_strategy`", workflow)
        self.assertIn("`sections` reads the listed ranges", workflow)
        self.assertIn(
            "apply the Active Task Scope Guard before artifact ownership",
            workflow,
        )
        self.assertIn("skill-garden patch workflow-phase-1-activate", workflow)
        self.assertIn(
            "display the full brief in chat, then stop the current turn",
            workflow,
        )
        self.assertIn("### Skill-Garden Workflow Owner Index", workflow)
        self.assertNotIn("#### Request Intent Routing", workflow)
        self.assertLess(
            workflow.index("| Task Brief Handoff |"),
            workflow.index("| Project Knowledge Discovery |"),
        )
        before_dev = next(
            item["next"]
            for item in plan["files"]
            if item["target"] == ".agents/skills/trellis-before-dev/SKILL.md"
        )
        self.assertIn(
            "skill-garden patch before-dev-project-knowledge-discovery",
            before_dev,
        )
        self.assertIn(
            "Follow the workflow `Request Triage` Project Knowledge Discovery contract",
            before_dev,
        )
        self.assertNotIn("spec_router.py", before_dev)
        self.assertNotIn("load_strategy", before_dev)
        brainstorm = next(
            item["next"]
            for item in plan["files"]
            if item["target"] == ".agents/skills/trellis-brainstorm/SKILL.md"
        )
        self.assertIn("skill-garden patch brainstorm-planning-handoff", brainstorm)
        self.assertIn("skill-garden patch brainstorm-planning-readiness", brainstorm)
        self.assertNotIn(
            "The user has reviewed the final planning artifacts",
            brainstorm,
        )
        self.assertIn(
            "Implementation intent expressed before the final artifacts",
            brainstorm,
        )
        claude_brainstorm = next(
            item["next"]
            for item in plan["files"]
            if item["target"] == ".claude/skills/trellis-brainstorm/SKILL.md"
        )
        self.assertIn(
            "skill-garden patch brainstorm-planning-readiness",
            claude_brainstorm,
        )
        self.assertNotIn(
            "The user has reviewed the final planning artifacts",
            claude_brainstorm,
        )
        task_script = next(
            item["next"]
            for item in plan["files"]
            if item["target"] == ".trellis/scripts/task.py"
        )
        self.assertIn("skill-garden patch task-start-brief-validator", task_script)
        self.assertIn("skill-garden patch task-start-brief-guard", task_script)
        self.assertIn("Planning task brief.md is stale", task_script)
        self.assertIn("Failed to persist task status before start", task_script)
        self.assertIn("Task status rollback also failed", task_script)

    def test_real_catalog_continue_selects_progress_recovery(self) -> None:
        """验证 Python consumer 的 continue 精细安装先恢复 progress 再判断 Phase。"""
        runner = _load_runner()
        plan = runner.prepare_patches(OVERRIDES, ROOT, ["trellis-continue"])

        self.assertEqual(plan["bundles"], ["trellis-continue"])
        self.assertEqual(
            plan["patches"],
            ["trellis-continue-task-progress-recovery"],
        )
        self.assertIn(
            "trellis-continue-task-progress-recovery",
            {item["id"] for item in plan["results"]},
        )
        for target in (
            ".agents/skills/trellis-continue/SKILL.md",
            ".claude/commands/trellis/continue.md",
        ):
            value = next(
                item["next"]
                for item in plan["files"]
                if item["target"] == target
            )
            self.assertIn("task_progress.py status --json", value)
            self.assertLess(
                value.index("task_progress.py status --json"),
                value.index("## Step 2: Load the Phase Index"),
            )
            self.assertIn("Never rebind the session or task automatically", value)
            self.assertIn("Do not infer a Phase from progress", value)


if __name__ == "__main__":
    unittest.main()
