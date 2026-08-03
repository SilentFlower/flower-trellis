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
COMPILED_TARGETS = ROOT / "vendor/skill-garden/compiled-targets/0.6.12/full/targets"
META_PATCHES = {
    "trellis-meta-managed-mode-precedence",
    "trellis-meta-managed-architecture-and-ownership",
    "trellis-meta-managed-customization-routing",
    "trellis-meta-managed-workflow-owners",
}
META_OPERATIONS = {
    "trellis-meta-trigger-description",
    "trellis-meta-managed-scope",
    "trellis-meta-managed-usage",
    "trellis-meta-managed-current-rules",
    "trellis-meta-managed-system-model",
    "trellis-meta-managed-customization-principles",
    "trellis-meta-managed-template-hashes",
    "trellis-meta-managed-file-boundaries",
    "trellis-meta-managed-skill-taxonomy",
    "trellis-meta-managed-platform-skill-roots",
    "trellis-meta-managed-bundled-overrides",
    "trellis-meta-managed-customization-entry",
    "trellis-meta-managed-customization-order",
    "trellis-meta-managed-workflow-entry",
    "trellis-meta-managed-workflow-edit-route",
    "trellis-meta-managed-skill-classification",
    "trellis-meta-managed-skill-edit-route",
    "trellis-meta-managed-common-paths",
    "trellis-meta-managed-shared-skill-consumers",
    "trellis-meta-managed-platform-edit-route",
    "trellis-meta-managed-workflow-source",
    "trellis-meta-managed-owner-routing",
    "trellis-meta-managed-state-boundary",
    "trellis-meta-managed-workflow-change-map",
    "trellis-meta-managed-task-artifacts",
    "trellis-meta-managed-task-readiness",
    "trellis-meta-managed-active-task-lifecycle",
    "trellis-meta-managed-lifecycle-entry-points",
    "trellis-meta-managed-lifecycle-modification-steps",
    "trellis-meta-managed-continue-recovery",
    "trellis-meta-managed-workflow-notes",
    "trellis-meta-managed-check-all-agent-route",
}


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

    def load_compiled_targets(self) -> None:
        """把 0.6.12 全平台 canonical 最终产物复制到临时目标。"""
        shutil.copytree(COMPILED_TARGETS, self.target, dirs_exist_ok=True)
        _write(self.target, ".trellis/.version", "0.6.12\n")

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

    def test_target_python_command_materializes_selector_content_and_baseline(self) -> None:
        """验证 Python runner 对 Windows 命令执行严格且等价的文本物化。"""
        runner = _load_runner()
        for slug, command in (("python", "python"), ("py-launcher", "py -3")):
            with self.subTest(command=command):
                target = self.root / slug / "target"
                overrides = self.root / slug / "overrides"
                _write(
                    target,
                    ".trellis/workflow.md",
                    f"Run {command} ./.trellis/scripts/task.py current\n",
                )
                _write(
                    target,
                    "whole.md",
                    f"Check {command} ./.trellis/scripts/task.py list\n",
                )
                leaf = overrides / "patches/python/materialization"
                _write(
                    leaf,
                    "patch.json",
                    json.dumps({
                        "schemaVersion": 2,
                        "id": "python-materialization",
                        "purpose": "test",
                        "operations": [
                            {
                                "id": "python-literal",
                                "operation": "replace",
                                "targets": [{
                                    "kind": "workflow",
                                    "path": ".trellis/workflow.md",
                                    "missing": "error",
                                }],
                                "selector": {
                                    "type": "literal",
                                    "source": "literal-selector.md",
                                },
                                "content": {"source": "literal-content.md"},
                            },
                            {
                                "id": "python-baseline",
                                "operation": "replace",
                                "targets": [{
                                    "kind": "file",
                                    "path": "whole.md",
                                    "missing": "error",
                                    "markerStyle": "none",
                                }],
                                "selector": {"type": "whole-file"},
                                "baselines": ["whole-baseline.md"],
                                "content": {"source": "whole-content.md"},
                            },
                        ],
                    }, indent=2) + "\n",
                )
                _write(
                    leaf,
                    "literal-selector.md",
                    "Run python3 ./.trellis/scripts/task.py current\n",
                )
                _write(
                    leaf,
                    "literal-content.md",
                    "Run python3 ./.trellis/scripts/task.py start\n",
                )
                _write(
                    leaf,
                    "whole-baseline.md",
                    "Check python3 ./.trellis/scripts/task.py list\n",
                )
                _write(
                    leaf,
                    "whole-content.md",
                    "Check python3 ./.trellis/scripts/task.py current\n",
                )
                _write(
                    overrides / "bundles",
                    "python-materialization.json",
                    json.dumps({
                        "schemaVersion": 1,
                        "id": "python-materialization",
                        "patches": ["python/materialization"],
                    }, indent=2) + "\n",
                )
                _write(
                    overrides,
                    "compatibility.json",
                    (OVERRIDES / "compatibility.json").read_text(encoding="utf-8"),
                )
                _write(
                    overrides,
                    "conflicts.json",
                    json.dumps({
                        "schemaVersion": 1,
                        "rules": [{
                            "id": "python-command-required",
                            "severity": "error",
                            "target": ".trellis/workflow.md",
                            "whenOperations": ["python-literal"],
                            "assertion": {
                                "type": "required-literal",
                                "values": [
                                    "Run python3 ./.trellis/scripts/task.py start"
                                ],
                            },
                            "owner": "test",
                            "reason": "test",
                        }],
                    }, indent=2) + "\n",
                )

                plan = runner.prepare_patches(overrides, target)
                policy = runner.load_patch_policy(overrides, command)
                report = runner.build_patch_conflict_report("0.6.5", plan, policy)
                self.assertEqual(report["summary"]["errors"], 0)
                runner.apply_prepared(target, plan)
                self.assertIn(
                    f"Run {command} ./.trellis/scripts/task.py start",
                    (target / ".trellis/workflow.md").read_text(encoding="utf-8"),
                )
                self.assertEqual(
                    (target / "whole.md").read_text(encoding="utf-8"),
                    f"Check {command} ./.trellis/scripts/task.py current\n",
                )

    def test_unmarked_literal_with_selector_and_desired_content_still_replaces(self) -> None:
        """目标同时含 selector 和目标内容时，Python consumer 仍执行替换。"""
        _write(self.target, "agent.txt", "OLD\nNEW\n")
        self.add_patch(
            "agents/unmarked",
            {
                "schemaVersion": 2,
                "id": "agents-unmarked",
                "purpose": "test",
                "operations": [
                    {
                        "id": "replace-unmarked-agent",
                        "operation": "replace",
                        "targets": [
                            {
                                "kind": "file",
                                "path": "agent.txt",
                                "missing": "error",
                                "markerStyle": "none",
                            }
                        ],
                        "selector": {"type": "literal", "source": "selector.txt"},
                        "content": {"source": "content.txt"},
                    }
                ],
            },
            {"selector.txt": "OLD", "content.txt": "NEW"},
        )
        self.add_bundle(
            {"schemaVersion": 1, "id": "agents", "patches": ["agents/unmarked"]}
        )

        result = self.run_runner()

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.target / "agent.txt").read_text(encoding="utf-8"), "NEW\nNEW\n")

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

    def test_real_catalog_preflight_matches_compiled_0612_target(self) -> None:
        self.load_compiled_targets()
        runner = _load_runner()
        plan = runner.prepare_patches(OVERRIDES, self.target)
        self.assertEqual(len(plan["patches"]), 39)
        self.assertGreaterEqual(len(plan["files"]), 300)
        self.assertGreaterEqual(
            sum(item["status"] == "ready" for item in plan["results"]),
            700,
        )
        operation_ids = {item["id"] for item in plan["results"]}
        self.assertIn("task-start-session-write-gate", operation_ids)
        self.assertIn("task-finish-clear-result", operation_ids)
        self.assertIn("active-task-runtime-json-io", operation_ids)
        self.assertIn("task-create-parent-link", operation_ids)
        self.assertIn("codex-session-start-pre-check-hold", operation_ids)
        self.assertIn("claude-session-start-pre-check-hold", operation_ids)
        self.assertIn("runtime-state-integrity", set(plan["patches"]))
        self.assertIn("session-context-update-boundary", set(plan["patches"]))
        self.assertIn("session-context-update-output", operation_ids)
        self.assertIn("before-dev-project-knowledge-discovery", operation_ids)
        self.assertIn("trellis-continue-task-progress-recovery", operation_ids)
        self.assertIn("workflow-state-untracked", operation_ids)
        self.assertIn("markdown-agents-untracked-context", operation_ids)
        self.assertIn("markdown-implement-agents-untracked-context", operation_ids)
        self.assertIn("markdown-check-agents-untracked-context", operation_ids)
        self.assertIn("codex-agents-untracked-context", operation_ids)
        self.assertIn("kiro-agents-untracked-context", operation_ids)
        self.assertTrue(META_OPERATIONS.issubset(operation_ids))

    def test_real_conflicts_cover_new_control_plane_operations(self) -> None:
        """新增控制面 operation 必须进入最终产物冲突断言。"""
        conflicts = json.loads((OVERRIDES / "conflicts.json").read_text(encoding="utf-8"))
        covered = {
            operation
            for rule in conflicts["rules"]
            for operation in rule.get("whenOperations", [])
        }

        self.assertTrue({
            "task-store-decision-log-import",
            "task-archive-metadata-guard",
            "task-set-branch-write",
            "task-set-base-branch-write",
            "task-set-scope-write",
            "task-set-meta-write",
            "paths-clear-current-result",
            "session-context-update-imports",
            "session-context-update-constants",
            "session-context-update-helpers",
            "session-context-update-output",
            "workflow-state-codex-session-start-guard",
            "workflow-state-stale-task-status",
            "workflow-state-untracked-helper",
            "workflow-state-breadcrumb-subject",
            "workflow-state-main-subject-routing",
        }.issubset(covered))
        self.assertTrue(META_OPERATIONS.issubset(covered))

    def test_real_catalog_trellis_meta_aliases_select_only_meta_patches(self) -> None:
        """验证 meta 与 create-command 入口只选择依赖的四个 Patch。"""
        self.load_compiled_targets()
        runner = _load_runner()

        for alias in (
            "trellis-meta",
            "meta-architecture",
            "trellis-create-command",
            "create-command",
        ):
            with self.subTest(alias=alias):
                plan = runner.prepare_patches(OVERRIDES, self.target, [alias])
                self.assertEqual(set(plan["patches"]), META_PATCHES)
                operation_ids = {item["id"] for item in plan["results"]}
                self.assertEqual(operation_ids, META_OPERATIONS)
                self.assertEqual(plan["bundles"], ["trellis-meta"])
                skill = next(
                    item["next"]
                    for item in plan["files"]
                    if item["target"] == ".agents/skills/trellis-meta/SKILL.md"
                )
                workflow = next(
                    item["next"]
                    for item in plan["files"]
                    if item["target"].endswith(
                        "trellis-meta/references/local-architecture/workflow.md"
                    )
                    and item["target"].startswith(".agents/")
                )
                task_system = next(
                    item["next"]
                    for item in plan["files"]
                    if item["target"]
                    == ".agents/skills/trellis-meta/references/local-architecture/task-system.md"
                )
                workflow_change = next(
                    item["next"]
                    for item in plan["files"]
                    if item["target"]
                    == ".agents/skills/trellis-meta/references/customize-local/change-workflow.md"
                )
                lifecycle_change = next(
                    item["next"]
                    for item in plan["files"]
                    if item["target"]
                    == ".agents/skills/trellis-meta/references/customize-local/change-task-lifecycle.md"
                )
                bundled = next(
                    item["next"]
                    for item in plan["files"]
                    if item["target"]
                    == ".agents/skills/trellis-meta/references/local-architecture/bundled-skills.md"
                )
                skill_route = next(
                    item["next"]
                    for item in plan["files"]
                    if item["target"]
                    == ".agents/skills/trellis-meta/references/customize-local/change-skills-or-commands.md"
                )
                self.assertIn("Flower/Skill-Garden managed Plugin overlays", skill)
                self.assertIn("Do not choose implementation or checking behavior", workflow)
                self.assertIn("Untracked work completion", workflow)
                self.assertIn(
                    "| Untracked task adoption | `workflow-state:untracked`, "
                    "`trellis-brainstorm`, and `task_intent.py adopt` |",
                    workflow,
                )
                self.assertIn("Commit/push safety and completion activation", workflow)
                self.assertIn(
                    "| Cross-session task progress discovery and recovery | "
                    "`trellis-continue` owns the recovery decision, `task_progress.py` "
                    "owns candidate evidence and completed-task reopen, and "
                    "`task.py start` with `.trellis/scripts/common/active_task.py` owns "
                    "explicit session binding |",
                    workflow,
                )
                self.assertIn(
                    "| Change explicit candidate rebind | `trellis-continue` owns the "
                    "decision, and `task.py start` with "
                    "`.trellis/scripts/common/active_task.py` owns the session pointer "
                    "write |",
                    workflow,
                )
                self.assertIn(
                    "| Change completed-task reopen | The explicit "
                    "`task_progress.py reopen` path |",
                    workflow,
                )
                self.assertIn("| `brief.md` | Generated planning handoff", task_system)
                self.assertIn("## Active Task And Lifecycle", task_system)
                self.assertIn("never bind a session automatically", task_system)
                self.assertIn("## `/trellis:continue` Recovery Ownership", workflow_change)
                self.assertNotIn("## `/trellis:continue` Route Table", workflow_change)
                self.assertIn("Change normal completion activation", lifecycle_change)
                self.assertIn(
                    "| Change interruption recovery or candidate rebinding | "
                    "`trellis-continue` owns the user decision, `task_progress.py` owns "
                    "candidate evidence, and `task.py start` with "
                    "`.trellis/scripts/common/active_task.py` owns the explicit session "
                    "bind; never bind a candidate automatically. |",
                    lifecycle_change,
                )
                self.assertIn("final progress synchronization before local completion", lifecycle_change)
                self.assertIn(".omp/skills/<skill>/", bundled)
                self.assertIn(".grok/skills/<skill>/", bundled)
                self.assertIn(".snow/skills/<skill>/", bundled)
                self.assertIn("Codex, Gemini CLI, Pi Agent, and Kimi Code", bundled)
                self.assertIn("Codex, Gemini CLI, Pi Agent, Kimi Code", skill_route)
                self.assertNotIn("dispatch `trellis-implement` by default", workflow)
                self.assertNotIn(
                    "| Untracked task adoption | Request Triage, `trellis-brainstorm`, "
                    "and `task_intent.py adopt` |",
                    workflow,
                )
                self.assertNotIn(
                    "| Cross-session task progress discovery and recovery | "
                    "`trellis-continue` and `task_progress.py` |",
                    workflow,
                )
                self.assertNotIn(
                    "| Change recovery, explicit rebind, or completed-task reopen | "
                    "`trellis-continue` and `task_progress.py` |",
                    workflow,
                )
                self.assertNotIn(
                    "| Change interruption recovery or candidate rebinding | "
                    "`trellis-continue` and `task_progress.py`; never bind a candidate "
                    "automatically. |",
                    lifecycle_change,
                )

    def test_real_catalog_task_intent_selects_complete_stale_recovery(self) -> None:
        """验证 Python consumer 的精细安装包含完整 stale recovery Patch。"""
        self.load_compiled_targets()
        runner = _load_runner()
        plan = runner.prepare_patches(OVERRIDES, self.target, ["task-intent"])

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
            "Selecting a repair does not authorize editing while scope is unknown or permission to skip task planning",
            workflow,
        )
        self.assertIn(
            "Both are read-only unless the current request explicitly authorizes a concrete edit",
            workflow,
        )
        self.assertIn(
            "Treat requests for an opinion, expressions of discomfort, rejected proposals",
            workflow,
        )
        self.assertIn(
            "treat requests to inspect, explain, verify, or locate a cause as `inspect`",
            workflow,
        )
        self.assertIn(
            "`direct_edit` requires known, bounded, low-risk, reversible scope",
            workflow,
        )
        self.assertIn(
            "do not automatically require `task_plan`",
            workflow,
        )
        self.assertIn(
            "exact rollback or mechanically synchronized known change",
            workflow,
        )
        self.assertIn(
            "build a short query from the request, intended commands, affected files or systems, package/layer, and domain terms",
            workflow,
        )
        self.assertIn("Only an explicit current-request workflow instruction", workflow)
        self.assertIn("python3 ./.trellis/scripts/spec_router.py", workflow)
        self.assertIn("follow its returned `load_strategy` and `action`", workflow)
        self.assertIn(
            "apply the Active Task Scope Guard before artifact ownership",
            workflow,
        )
        self.assertIn("untracked_flow.py begin --summary", workflow)
        self.assertIn("A same-item hit resumes the existing state", workflow)
        self.assertIn("`active-work-conflict` blocks unrelated code writes", workflow)
        self.assertIn(
            "Unrelated read-only requests may continue without mutating the state",
            workflow,
        )
        self.assertIn(
            "Do not edit when baseline capture or workspace validation fails",
            workflow,
        )
        self.assertIn(
            "Do not edit when baseline capture, scope extension, or workspace validation fails",
            workflow,
        )
        self.assertIn("task_intent.py adopt", workflow)
        self.assertIn(
            "Entering untracked `direct_edit`, creating or resuming a task, or switching intent gets one non-blocking status line",
            workflow,
        )
        self.assertIn(
            "the owning workflow state or capability owns its commands and transition details",
            workflow,
        )
        self.assertIn("skill-garden patch workflow-phase-1-activate", workflow)
        self.assertIn(
            "Unless `trellis-task-brief` validates an explicit preauthorization",
            workflow,
        )
        self.assertIn(
            "After a later confirmation, or in the same turn",
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
        self.load_compiled_targets()
        runner = _load_runner()
        plan = runner.prepare_patches(OVERRIDES, self.target, ["trellis-continue"])

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
