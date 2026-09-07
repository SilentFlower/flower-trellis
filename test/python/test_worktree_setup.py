"""分支本地化 worktree engine 的真实 Git 回归测试。"""

from __future__ import annotations

import json
import hashlib
import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "vendor/skill-garden/.trellis/0.6/scripts/worktree_setup.py"


class WorktreeSetupTest(unittest.TestCase):
    """验证 branch-local readiness、迁移和生命周期。"""

    def setUp(self) -> None:
        """创建包含版本化 Trellis 入口的隔离仓库和 linked worktree。"""
        self.temp = tempfile.TemporaryDirectory(prefix="flower-worktree-")
        self.base = Path(self.temp.name)
        self.main = self.base / "main"
        self.linked = self.base / "linked"
        self.main.mkdir()
        self._git(self.main, "init")
        self._git(self.main, "config", "user.email", "test@example.invalid")
        self._git(self.main, "config", "user.name", "Test User")
        self._install_versioned_entries()
        (self.main / "README.md").write_text("main\n", encoding="utf-8")
        self._git(self.main, "add", ".trellis", ".agents", ".codex", ".claude", "README.md")
        self._git(self.main, "commit", "-m", "init")
        self._git(self.main, "worktree", "add", "-b", "feature/local", str(self.linked), "HEAD")
        (self.main / ".trellis/.developer").write_text(
            "name=tester\ninitialized_at=2026-08-05T00:00:00Z\n",
            encoding="utf-8",
        )
        (self.main / ".trellis/.runtime/sessions").mkdir(parents=True)

    def tearDown(self) -> None:
        """删除隔离仓库。"""
        self.temp.cleanup()

    def _git(self, cwd: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
        """运行 Git 命令。"""
        return subprocess.run(
            ["git", "-C", str(cwd), *args],
            text=True,
            capture_output=True,
            check=check,
        )

    def _install_versioned_entries(self) -> None:
        """安装测试所需的最小版本化 Trellis 和平台内容。"""
        scripts = self.main / ".trellis/scripts"
        scripts.mkdir(parents=True)
        for source in (ROOT / ".trellis/scripts").glob("*.py"):
            shutil.copy2(source, scripts / source.name)
        shutil.copytree(ROOT / ".trellis/scripts/common", scripts / "common")
        (self.main / ".trellis/.gitignore").write_text(
            ".developer\n.runtime/\n**/__pycache__/\n**/*.pyc\n",
            encoding="utf-8",
        )
        (self.main / ".trellis/.version").write_text("0.6.14\n", encoding="utf-8")
        (self.main / ".trellis/workflow.md").write_text("workflow=main\n", encoding="utf-8")
        (self.main / ".trellis/.template-hashes.json").write_text(
            json.dumps({"__version": 2, "hashes": {".codex/hooks.json": "hash", ".claude/settings.json": "hash"}}),
            encoding="utf-8",
        )
        (self.main / ".agents/skills/example").mkdir(parents=True)
        (self.main / ".agents/skills/example/SKILL.md").write_text("main agent\n", encoding="utf-8")
        (self.main / ".codex").mkdir()
        (self.main / ".codex/hooks.json").write_text("{}\n", encoding="utf-8")
        (self.main / ".claude").mkdir()
        (self.main / ".claude/settings.json").write_text("{}\n", encoding="utf-8")

    def _helper(
        self,
        command: str,
        *extra: str,
        target: Path | None = None,
        check: bool = True,
    ) -> tuple[subprocess.CompletedProcess[str], dict]:
        """运行随包 engine 并解析 JSON。"""
        result = subprocess.run(
            [sys.executable, str(SOURCE), command, "--target", str(target or self.linked), *extra, "--json"],
            cwd=self.main,
            text=True,
            capture_output=True,
            check=False,
        )
        payload = json.loads(result.stdout)
        if check and result.returncode != 0:
            self.fail(f"helper failed: {payload}\n{result.stderr}")
        return result, payload

    def _create_helper(
        self,
        *extra: str,
        target: Path,
        check: bool = True,
    ) -> tuple[subprocess.CompletedProcess[str], dict]:
        """先获取只读计划，再携带原指纹确认 create。"""
        _, plan = self._helper("create", *extra, target=target)
        self.assertEqual(plan["status"], "confirmation-required")
        return self._helper(
            "create",
            *extra,
            "--yes",
            "--plan-fingerprint",
            plan["confirmation"]["fingerprint"],
            target=target,
            check=check,
        )

    def _install_legacy_projection(self, paths: tuple[str, ...] = (".trellis", ".agents", ".codex", ".claude")) -> None:
        """把 linked 中的真实目录替换成 schema v1 受管 symlink。"""
        links = []
        for relative in paths:
            target = self.linked / relative
            if target.is_dir() and not target.is_symlink():
                shutil.rmtree(target)
            os.symlink(self.main / relative, target, target_is_directory=True)
            links.append(
                {
                    "path": relative,
                    "source": str((self.main / relative).resolve()),
                    "target": str(target.absolute()),
                }
            )
        (self.linked / ".trellis-worktree.json").write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "sourceRoot": str(self.main.resolve()),
                    "targetRoot": str(self.linked.resolve()),
                    "links": links,
                    "updatedAt": "2026-08-05T00:00:00Z",
                }
            ),
            encoding="utf-8",
        )

    def test_real_local_entries_prepare_runtime_without_symlink_manifest(self) -> None:
        """真实入口只准备本地运行态和 registry，不创建整目录 symlink。"""
        _, status = self._helper("status")
        self.assertEqual(status["status"], "needs-prepare")
        self.assertEqual(status["reason"], "local-runtime-missing")

        _, prepared = self._helper("prepare", "--developer", "tester")
        self.assertEqual(prepared["status"], "prepared")
        self.assertTrue((self.linked / ".trellis/.developer").is_file())
        self.assertTrue((self.linked / ".trellis/.runtime/sessions").is_dir())
        for relative in (".trellis", ".agents", ".codex", ".claude"):
            self.assertTrue((self.linked / relative).is_dir())
            self.assertFalse((self.linked / relative).is_symlink())
        self.assertFalse((self.linked / ".trellis-worktree.json").exists())

        registry_path = Path(prepared["registry"]["path"])
        registry = json.loads(registry_path.read_text(encoding="utf-8"))
        self.assertEqual(registry["schemaVersion"], 1)
        self.assertEqual(
            registry["worktrees"][prepared["worktreeId"]]["path"],
            str(self.linked.resolve()),
        )

        _, ready = self._helper("prepare")
        self.assertEqual(ready["status"], "ready-local")
        self.assertFalse(ready["changed"])

    def test_two_branches_keep_workflow_and_platform_content_local(self) -> None:
        """linked 分支修改 workflow/skill 后不会改变 main worktree。"""
        (self.linked / ".trellis/workflow.md").write_text("workflow=feature\n", encoding="utf-8")
        (self.linked / ".agents/skills/example/SKILL.md").write_text("feature agent\n", encoding="utf-8")
        self._git(self.linked, "add", ".trellis/workflow.md", ".agents/skills/example/SKILL.md")
        self._git(self.linked, "commit", "-m", "feature trellis")

        self.assertEqual((self.main / ".trellis/workflow.md").read_text(encoding="utf-8"), "workflow=main\n")
        self.assertEqual((self.main / ".agents/skills/example/SKILL.md").read_text(encoding="utf-8"), "main agent\n")
        self.assertEqual((self.linked / ".trellis/workflow.md").read_text(encoding="utf-8"), "workflow=feature\n")
        self.assertFalse((self.linked / ".trellis").is_symlink())

    def test_missing_local_trellis_does_not_scan_other_worktrees(self) -> None:
        """目标分支缺少 `.trellis` 时返回 needs-init，不选择 main 作为 source。"""
        shutil.rmtree(self.linked / ".trellis")

        _, payload = self._helper("status")

        self.assertEqual(payload["status"], "needs-init")
        self.assertEqual(payload["reason"], "local-trellis-missing")
        self.assertNotIn("sourceRoot", payload)

    def test_legacy_projection_migrates_only_from_target_head(self) -> None:
        """有效 v1 投影从 linked 自己的 HEAD 重建成真实目录并删除 manifest。"""
        (self.linked / ".trellis/workflow.md").write_text("workflow=feature-head\n", encoding="utf-8")
        self._git(self.linked, "add", ".trellis/workflow.md")
        self._git(self.linked, "commit", "-m", "feature workflow")
        self._install_legacy_projection()

        _, status = self._helper("status")
        self.assertEqual(status["status"], "needs-migration")

        _, dry_run = self._helper("migrate", "--dry-run")
        self.assertEqual(dry_run["status"], "migration-ready")
        self.assertTrue((self.linked / ".trellis").is_symlink())

        _, migrated = self._helper("migrate")
        self.assertEqual(migrated["status"], "migrated")
        self.assertFalse((self.linked / ".trellis").is_symlink())
        self.assertFalse((self.linked / ".trellis-worktree.json").exists())
        self.assertEqual(
            (self.linked / ".trellis/workflow.md").read_text(encoding="utf-8"),
            "workflow=feature-head\n",
        )
        self.assertEqual((self.main / ".trellis/workflow.md").read_text(encoding="utf-8"), "workflow=main\n")

        _, repeated = self._helper("migrate")
        self.assertFalse(repeated["changed"])

    def test_legacy_status_does_not_read_source_template_hashes(self) -> None:
        """legacy `.trellis` symlink 只能用于验证链接，不能读取 source 分支配置。"""
        (self.main / ".trellis/.template-hashes.json").write_text(
            json.dumps({"__version": 2, "hashes": {".flower/plugin-lock.json": "source-only"}}),
            encoding="utf-8",
        )
        self._install_legacy_projection()

        _, payload = self._helper("status")

        flower = next(item for item in payload["entries"] if item["path"] == ".flower")
        self.assertFalse(flower["configured"])

    def test_legacy_migration_fails_closed_when_head_cannot_rebuild(self) -> None:
        """目标 HEAD 缺入口时不读取旧 sourceRoot，也不改动 symlink。"""
        self._git(self.linked, "rm", "-r", ".agents")
        self._git(self.linked, "commit", "-m", "remove agents")
        self._install_legacy_projection()

        result, payload = self._helper("migrate", check=False)

        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(payload["reason"], "migration-source-unavailable")
        self.assertIn(".agents", payload["paths"])
        self.assertTrue((self.linked / ".trellis").is_symlink())
        self.assertTrue((self.linked / ".trellis-worktree.json").is_file())

    def test_drifted_legacy_symlink_is_blocked_without_writes(self) -> None:
        """manifest 受管 symlink 漂移后进入 blocked，迁移不覆盖。"""
        self._install_legacy_projection()
        (self.linked / ".codex").unlink()
        os.symlink(self.base / "elsewhere", self.linked / ".codex", target_is_directory=True)

        _, status = self._helper("status")
        self.assertEqual(status["status"], "blocked")
        result, payload = self._helper("migrate", check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(payload["reason"], "migration-not-available")
        self.assertTrue((self.linked / ".trellis").is_symlink())

    def test_registry_lock_blocks_prepare(self) -> None:
        """已有 registry 锁时 prepare 失败关闭。"""
        common_value = Path(self._git(self.main, "rev-parse", "--git-common-dir").stdout.strip())
        common = common_value.resolve() if common_value.is_absolute() else (self.main / common_value).resolve()
        lock = common / "trellis/locks/registry.lock"
        lock.mkdir(parents=True)

        result, payload = self._helper("prepare", "--developer", "tester", check=False)

        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(payload["reason"], "registry-lock-held")
        self.assertFalse((self.linked / ".trellis/.developer").exists())
        self.assertFalse((self.linked / ".trellis/.runtime").exists())

    def test_invalid_registry_blocks_status_without_overwrite(self) -> None:
        """损坏 registry 进入 blocked，status 不覆盖原字节。"""
        common_value = Path(self._git(self.main, "rev-parse", "--git-common-dir").stdout.strip())
        common = common_value.resolve() if common_value.is_absolute() else (self.main / common_value).resolve()
        registry_path = common / "trellis/registry-v1.json"
        registry_path.parent.mkdir(parents=True)
        registry_path.write_text("{broken\n", encoding="utf-8")

        _, payload = self._helper("status")

        self.assertEqual(payload["status"], "blocked")
        self.assertEqual(payload["reason"], "worktree-local-conflict")
        self.assertEqual(registry_path.read_text(encoding="utf-8"), "{broken\n")

    def test_registry_drift_blocks_prepare_before_local_writes(self) -> None:
        """当前 worktree registry 路径漂移时，prepare 不先创建本地状态。"""
        _, status = self._helper("status")
        registry_path = Path(status["registry"]["path"])
        registry_path.parent.mkdir(parents=True, exist_ok=True)
        registry_path.write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "developer": "tester",
                    "worktrees": {
                        status["worktreeId"]: {
                            "path": str(self.base / "wrong"),
                            "gitDir": status["gitDir"],
                            "branch": status["branch"],
                            "head": status["head"],
                            "task": None,
                            "trellisVersion": "0.6.14",
                            "updatedAt": "2026-08-05T00:00:00Z",
                        }
                    },
                }
            ),
            encoding="utf-8",
        )

        _, blocked = self._helper("status")
        result, payload = self._helper("prepare", check=False)

        self.assertEqual(blocked["status"], "blocked")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(payload["reason"], "worktree-local-conflict")
        self.assertFalse((self.linked / ".trellis/.developer").exists())
        self.assertFalse((self.linked / ".trellis/.runtime").exists())

    def test_create_preflight_is_read_only_and_reports_current_branch_dirty_state(self) -> None:
        """create 首次调用只返回当前分支基线计划，不创建 branch/worktree。"""
        target = self.base / "planned"
        route_path = self.main / ".trellis/.route-prefs.tmp"
        route_path.write_text(
            "check=check-all-inline\nunknown=value\nimplement=inline\ncheck=invalid\n",
            encoding="utf-8",
        )
        (self.main / ".claude/settings.local.json").write_text("{}\n", encoding="utf-8")
        (self.main / "README.md").write_text("dirty\n", encoding="utf-8")
        (self.main / "UNTRACKED.md").write_text("local\n", encoding="utf-8")
        branch = self._git(self.main, "branch", "--show-current").stdout.strip()

        _, plan = self._helper(
            "create",
            "--source",
            str(self.main),
            "--branch",
            "feature/planned",
            "--task-title",
            "预检任务",
            "--task-slug",
            "planned-task",
            target=target,
        )

        self.assertEqual(plan["status"], "confirmation-required")
        self.assertFalse(plan["changed"])
        self.assertTrue(plan["requiresConfirmation"])
        self.assertEqual(plan["base"]["ref"], branch)
        self.assertTrue(plan["base"]["defaultedFromCurrentBranch"])
        self.assertFalse(plan["source"]["workingTree"]["includedInBase"])
        dirty_paths = {entry["path"] for entry in plan["source"]["workingTree"]["entries"]}
        self.assertIn("README.md", dirty_paths)
        self.assertIn("UNTRACKED.md", dirty_paths)
        self.assertEqual(
            plan["localStateTransfer"]["routePreferences"],
            {
                "action": "inherited",
                "values": {"implement": "inline", "check": "check-all-inline"},
            },
        )
        self.assertIn("platform-local-settings", plan["localStateTransfer"]["notInherited"])
        self.assertFalse(target.exists())
        self.assertNotEqual(
            self._git(self.main, "show-ref", "--verify", "refs/heads/feature/planned", check=False).returncode,
            0,
        )

    def test_create_confirmation_inherits_only_normalized_route_preferences(self) -> None:
        """确认 create 只继承同开发者的合法 route 值，不复制平台本地设置。"""
        target = self.base / "route-created"
        (self.main / ".trellis/.route-prefs.tmp").write_text(
            "check=check-all-subagent\nignored=value\nimplement=subagent\n",
            encoding="utf-8",
        )
        (self.main / ".claude/settings.local.json").write_text("{\"private\":true}\n", encoding="utf-8")

        _, created = self._create_helper(
            "--source",
            str(self.main),
            "--branch",
            "feature/route-created",
            "--task-title",
            "继承偏好",
            "--task-slug",
            "route-created",
            target=target,
        )

        self.assertEqual(created["localStateTransfer"]["routePreferences"]["action"], "inherited")
        self.assertEqual(
            (target / ".trellis/.route-prefs.tmp").read_text(encoding="utf-8"),
            "implement=subagent\ncheck=check-all-subagent\n",
        )
        self.assertFalse((target / ".claude/settings.local.json").exists())
        self.assertTrue(created["handoff"]["requiresNewSession"])
        self.assertEqual(created["handoff"]["workspaceRoot"], str(target.resolve()))

    def test_create_different_developer_does_not_inherit_route_preferences(self) -> None:
        """显式切换开发者时 create 不继承来源个人 route 偏好。"""
        target = self.base / "other-developer"
        (self.main / ".trellis/.route-prefs.tmp").write_text("implement=inline\n", encoding="utf-8")

        _, created = self._create_helper(
            "--source",
            str(self.main),
            "--branch",
            "feature/other-developer",
            "--task-title",
            "其他开发者",
            "--task-slug",
            "other-developer",
            "--developer",
            "other",
            target=target,
        )

        transfer = created["localStateTransfer"]["routePreferences"]
        self.assertEqual(transfer["action"], "notInherited")
        self.assertEqual(transfer["reason"], "developer-mismatch")
        self.assertFalse((target / ".trellis/.route-prefs.tmp").exists())

    def test_create_rejects_stale_plan_fingerprint_without_writes(self) -> None:
        """来源状态变化后旧指纹失效，且不创建 branch/worktree。"""
        target = self.base / "stale-plan"
        create_args = (
            "--source",
            str(self.main),
            "--branch",
            "feature/stale-plan",
            "--task-title",
            "过期计划",
            "--task-slug",
            "stale-plan",
        )
        _, plan = self._helper("create", *create_args, target=target)
        (self.main / "README.md").write_text("changed after plan\n", encoding="utf-8")

        result, payload = self._helper(
            "create",
            *create_args,
            "--yes",
            "--plan-fingerprint",
            plan["confirmation"]["fingerprint"],
            target=target,
            check=False,
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(payload["reason"], "create-plan-changed")
        self.assertEqual(payload["plan"]["status"], "confirmation-required")
        self.assertFalse(target.exists())
        self.assertNotEqual(
            self._git(self.main, "show-ref", "--verify", "refs/heads/feature/stale-plan", check=False).returncode,
            0,
        )

    def test_create_yes_requires_plan_fingerprint(self) -> None:
        """create --yes 缺少计划指纹时保持零写入并返回稳定错误。"""
        target = self.base / "missing-fingerprint"

        result, payload = self._helper(
            "create",
            "--source",
            str(self.main),
            "--branch",
            "feature/missing-fingerprint",
            "--task-title",
            "缺少指纹",
            "--task-slug",
            "missing-fingerprint",
            "--yes",
            target=target,
            check=False,
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(payload["reason"], "create-plan-fingerprint-required")
        self.assertEqual(payload["plan"]["status"], "confirmation-required")
        self.assertFalse(target.exists())

    def test_create_detached_source_defaults_base_to_head(self) -> None:
        """来源 detached HEAD 时默认基线明确回退为 HEAD。"""
        self._git(self.main, "checkout", "--detach")
        target = self.base / "detached-plan"

        _, plan = self._helper(
            "create",
            "--source",
            str(self.main),
            "--branch",
            "feature/detached-plan",
            "--task-title",
            "Detached 计划",
            "--task-slug",
            "detached-plan",
            target=target,
        )

        self.assertIsNone(plan["source"]["branch"])
        self.assertEqual(plan["base"]["ref"], "HEAD")
        self.assertFalse(plan["base"]["defaultedFromCurrentBranch"])
        self.assertEqual(plan["base"]["resolvedCommit"], plan["source"]["head"])

    def test_create_plan_inventories_initialized_submodule_commit(self) -> None:
        """预检盘点基线 gitlink，并报告来源 submodule 的分支和 HEAD。"""
        module = self.base / "module-source"
        module.mkdir()
        self._git(module, "init")
        self._git(module, "config", "user.email", "module@example.invalid")
        self._git(module, "config", "user.name", "Module User")
        (module / "MODULE.md").write_text("module\n", encoding="utf-8")
        self._git(module, "add", "MODULE.md")
        self._git(module, "commit", "-m", "module init")
        module_head = self._git(module, "rev-parse", "HEAD").stdout.strip()
        self._git(
            self.main,
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            str(module),
            "modules/sample",
        )
        self._git(self.main, "commit", "-am", "add submodule")
        target = self.base / "submodule-plan"

        _, plan = self._helper(
            "create",
            "--source",
            str(self.main),
            "--branch",
            "feature/submodule-plan",
            "--task-title",
            "Submodule 计划",
            "--task-slug",
            "submodule-plan",
            target=target,
        )

        submodule = next(item for item in plan["repositories"] if item["path"] == "modules/sample")
        root = next(item for item in plan["repositories"] if item["path"] == ".")
        self.assertTrue(root["selected"])
        self.assertTrue(root["createsBranch"])
        self.assertEqual(root["targetBranch"], "feature/submodule-plan")
        self.assertEqual(submodule["name"], "modules/sample")
        self.assertFalse(submodule["selected"])
        self.assertFalse(submodule["createsBranch"])
        self.assertIsNone(submodule["targetBranch"])
        self.assertEqual(submodule["baseCommit"], module_head)
        self.assertTrue(submodule["initialized"])
        self.assertEqual(submodule["sourceHead"], module_head)

    def test_create_does_not_follow_route_preference_symlink(self) -> None:
        """来源 route 偏好为 symlink 时不读取目标内容。"""
        target = self.base / "unsafe-route"
        external = self.base / "external-prefs"
        external.write_text("implement=subagent\n", encoding="utf-8")
        os.symlink(external, self.main / ".trellis/.route-prefs.tmp")

        _, plan = self._helper(
            "create",
            "--source",
            str(self.main),
            "--branch",
            "feature/unsafe-route",
            "--task-title",
            "不安全偏好",
            "--task-slug",
            "unsafe-route",
            target=target,
        )

        transfer = plan["localStateTransfer"]["routePreferences"]
        self.assertEqual(transfer["action"], "notInherited")
        self.assertEqual(transfer["reason"], "source-type-invalid")

    def test_prepare_inherits_route_preferences_only_when_explicit(self) -> None:
        """prepare 只有显式请求时才从同仓同开发者控制端继承偏好。"""
        (self.main / ".trellis/.route-prefs.tmp").write_text(
            "check=check-all-inline\nimplement=inline\n",
            encoding="utf-8",
        )

        _, prepared = self._helper(
            "prepare",
            "--developer",
            "tester",
            "--source",
            str(self.main),
            "--inherit-route-prefs",
        )

        self.assertEqual(prepared["localStateTransfer"]["routePreferences"]["action"], "inherited")
        self.assertEqual(
            (self.linked / ".trellis/.route-prefs.tmp").read_text(encoding="utf-8"),
            "implement=inline\ncheck=check-all-inline\n",
        )

    def test_prepare_preserves_existing_target_route_preferences(self) -> None:
        """prepare 显式继承也不覆盖目标已经存在的个人偏好。"""
        (self.main / ".trellis/.route-prefs.tmp").write_text("implement=inline\n", encoding="utf-8")
        target_route = self.linked / ".trellis/.route-prefs.tmp"
        target_route.write_text("implement=subagent\n", encoding="utf-8")

        _, prepared = self._helper(
            "prepare",
            "--developer",
            "tester",
            "--source",
            str(self.main),
            "--inherit-route-prefs",
        )

        self.assertEqual(prepared["localStateTransfer"]["routePreferences"]["action"], "preserved")
        self.assertEqual(target_route.read_text(encoding="utf-8"), "implement=subagent\n")

    def test_prepare_rejects_route_preferences_from_other_repository_before_writes(self) -> None:
        """prepare 显式继承拒绝其它仓库来源，并且不先创建目标运行态。"""
        other = self.base / "other-repository"
        other.mkdir()
        self._git(other, "init")
        (other / ".trellis").mkdir()
        (other / ".trellis/.developer").write_text("name=tester\n", encoding="utf-8")
        (other / ".trellis/.route-prefs.tmp").write_text("implement=inline\n", encoding="utf-8")

        result, payload = self._helper(
            "prepare",
            "--developer",
            "tester",
            "--source",
            str(other),
            "--inherit-route-prefs",
            check=False,
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(payload["reason"], "route-preferences-repository-mismatch")
        self.assertFalse((self.linked / ".trellis/.developer").exists())
        self.assertFalse((self.linked / ".trellis/.runtime").exists())

    def test_duplicate_task_registry_rolls_back_create(self) -> None:
        """同一 task 路径已被其它 worktree 注册时，create 回滚新 branch/worktree。"""
        _, status = self._helper("status")
        registry_path = Path(status["registry"]["path"])
        registry_path.parent.mkdir(parents=True, exist_ok=True)
        task_relative = f".trellis/tasks/{datetime.now().strftime('%m-%d')}-duplicate-task"
        registry_path.write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "developer": "tester",
                    "worktrees": {
                        "existing": {
                            "path": str(self.linked.resolve()),
                            "gitDir": status["gitDir"],
                            "branch": status["branch"],
                            "head": status["head"],
                            "task": task_relative,
                            "trellisVersion": "0.6.14",
                            "updatedAt": "2026-08-05T00:00:00Z",
                        }
                    },
                }
            ),
            encoding="utf-8",
        )
        target = self.base / "duplicate"

        result, payload = self._create_helper(
            "--source",
            str(self.main),
            "--branch",
            "feature/duplicate",
            "--task-title",
            "重复任务",
            "--task-slug",
            "duplicate-task",
            target=target,
            check=False,
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(payload["reason"], "task-already-registered")
        self.assertFalse(target.exists())
        self.assertNotEqual(
            self._git(self.main, "show-ref", "--verify", "refs/heads/feature/duplicate", check=False).returncode,
            0,
        )

    def test_create_and_remove_manage_task_registry_and_preserve_branch(self) -> None:
        """create 创建 planning task；完成并提交后 remove 只移除 worktree。"""
        target = self.base / "created"
        _, created = self._create_helper(
            "--source",
            str(self.main),
            "--branch",
            "feature/created",
            "--base",
            "HEAD",
            "--task-title",
            "并行任务",
            "--task-slug",
            "parallel-task",
            target=target,
        )
        self.assertEqual(created["status"], "created")
        task_path = target / created["task"] / "task.json"
        task = json.loads(task_path.read_text(encoding="utf-8"))
        self.assertEqual(task["status"], "planning")
        self.assertEqual(task["branch"], "feature/created")
        self.assertIsNone(task["worktree_path"])

        dirty_result, dirty_payload = self._helper("remove", target=target, check=False)
        self.assertNotEqual(dirty_result.returncode, 0)
        self.assertEqual(dirty_payload["reason"], "worktree-dirty")

        task["status"] = "completed"
        task["completedAt"] = "2026-08-05"
        task_path.write_text(json.dumps(task, indent=2) + "\n", encoding="utf-8")
        self._git(target, "add", created["task"])
        self._git(target, "commit", "-m", "complete task")

        _, removed = self._helper("remove", target=target)
        self.assertEqual(removed["status"], "removed")
        self.assertFalse(target.exists())
        self.assertIsNotNone(self._git(self.main, "show-ref", "--verify", "refs/heads/feature/created", check=False).stdout)

    def test_remove_rejects_main_worktree(self) -> None:
        """remove 拒绝删除仓库主 worktree。"""
        result, payload = self._helper("remove", target=self.main, check=False)

        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(payload["reason"], "remove-main-worktree-forbidden")
        self.assertTrue(self.main.is_dir())

    def test_create_failure_rolls_back_new_branch_and_worktree(self) -> None:
        """base 分支没有 Trellis 时 create 不残留新 path 或 branch。"""
        plain_branch = "plain-base"
        self._git(self.main, "checkout", "--orphan", plain_branch)
        for relative in (".trellis", ".agents", ".codex", ".claude", "README.md"):
            path = self.main / relative
            if path.is_dir() and not path.is_symlink():
                shutil.rmtree(path)
            elif path.exists() or path.is_symlink():
                path.unlink()
        (self.main / "PLAIN.md").write_text("plain\n", encoding="utf-8")
        self._git(self.main, "add", "-A")
        self._git(self.main, "commit", "-m", "plain base")
        target = self.base / "failed"

        result, payload = self._helper(
            "create",
            "--source",
            str(self.main),
            "--branch",
            "feature/failed",
            "--base",
            plain_branch,
            "--task-title",
            "失败任务",
            "--task-slug",
            "failed-task",
            "--developer",
            "tester",
            target=target,
            check=False,
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(payload["reason"], "local-trellis-missing")
        self.assertFalse(target.exists())
        self.assertNotEqual(
            self._git(self.main, "show-ref", "--verify", "refs/heads/feature/failed", check=False).returncode,
            0,
        )

    def test_remove_registry_failure_restores_worktree_and_local_state(self) -> None:
        """Git remove 后 registry 写入失败时恢复 worktree、task 和忽略运行态。"""
        target = self.base / "restore-remove"
        _, created = self._create_helper(
            "--source",
            str(self.main),
            "--branch",
            "feature/restore-remove",
            "--base",
            "HEAD",
            "--task-title",
            "回滚删除",
            "--task-slug",
            "restore-remove",
            target=target,
        )
        task_path = target / created["task"] / "task.json"
        task = json.loads(task_path.read_text(encoding="utf-8"))
        task["status"] = "completed"
        task["completedAt"] = "2026-08-05"
        task_path.write_text(json.dumps(task, indent=2) + "\n", encoding="utf-8")
        self._git(target, "add", created["task"])
        self._git(target, "commit", "-m", "complete task")
        runtime_marker = target / ".trellis/.runtime/restore-marker.txt"
        runtime_marker.parent.mkdir(parents=True, exist_ok=True)
        runtime_marker.write_text("local\n", encoding="utf-8")

        spec = importlib.util.spec_from_file_location("flower_worktree_remove_test", SOURCE)
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        original_write = module._write_json_atomic

        def fail_registry_write(path: Path, data: dict) -> None:
            """只故障注入最终 registry 提交。"""
            if path.name == "registry-v1.json":
                raise OSError("injected registry failure")
            original_write(path, data)

        with mock.patch.object(module, "_write_json_atomic", side_effect=fail_registry_write):
            with self.assertRaises(module.WorktreeSetupError) as captured:
                module._remove(str(target))

        self.assertEqual(captured.exception.reason, "registry-write-failed")
        self.assertTrue(target.is_dir())
        self.assertTrue(task_path.is_file())
        self.assertEqual(runtime_marker.read_text(encoding="utf-8"), "local\n")
        self.assertEqual(self._git(target, "status", "--porcelain").stdout, "")

    def test_non_git_target_reports_error(self) -> None:
        """非 Git worktree 返回稳定错误。"""
        other = self.base / "plain"
        other.mkdir()

        result, payload = self._helper("status", target=other, check=False)

        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(payload["reason"], "not-git-worktree")

    def _flower_fixture(self) -> dict[str, str]:
        """准备被忽略的真实安装记录及随包适配器环境。"""
        (self.main / ".gitignore").write_text(".flower/\n", encoding="utf-8")
        self._git(self.main, "add", ".gitignore")
        self._git(self.main, "commit", "-m", "ignore Flower local records")
        self._git(self.linked, "merge", "--ff-only", self._git(self.main, "rev-parse", "HEAD").stdout.strip())
        flower = self.main / ".flower"
        flower.mkdir()
        version = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
        relative = ".agents/skills/example/SKILL.md"
        digest = "sha256:" + hashlib.sha256((self.main / relative).read_bytes()).hexdigest()
        records = {
            "plugins.json": {"schemaVersion": 1, "plugins": [{"id": "flower/skill-garden", "source": "flower", "version": version}]},
            "plugin-lock.json": {
                "schemaVersion": 1, "roots": ["flower/skill-garden"], "plugins": [{
                    "id": "flower/skill-garden", "version": version,
                    "source": {"id": "flower", "type": "builtin", "reference": "package:skill-garden"},
                    "commit": None, "integrity": "sha256:" + "a" * 64, "dependencies": {},
                    "compatibility": {"flower": ">=0.5.0"},
                    "capabilities": {"profile": "standard", "granted": ["content.skills"], "denied": [], "approvalDigest": None},
                }],
            },
            "state.json": {"schemaVersion": 1, "transactionVersion": 1, "plugins": [{
                "id": "flower/skill-garden", "version": version, "platforms": ["codex"],
                "paths": [{"path": relative, "kind": "file", "hash": digest, "ownership": "exclusive"}], "patches": [],
            }]},
        }
        for name, value in records.items():
            (flower / name).write_text(json.dumps(value), encoding="utf-8")
        return {"FLOWER_WORKTREE_NODE": shutil.which("node"), "FLOWER_WORKTREE_HELPER": str(ROOT / "src/lib/worktree-flower-state.js")}

    def test_flower_prepare_repairs_ready_worktree_and_is_idempotent(self) -> None:
        """已就绪 worktree 仍可补齐被忽略的 Flower，重复运行保持不变。"""
        environment = self._flower_fixture()
        with mock.patch.dict(os.environ, environment):
            self._helper("prepare", "--developer", "tester")
            _, before = self._helper("status")
            self.assertEqual(before["status"], "ready-local")
            self.assertEqual(before["flower"]["installation"], "incomplete")
            _, prepared = self._helper("prepare", "--inherit-flower", "--source", str(self.main))
            self.assertEqual(prepared["localStateTransfer"]["flower"]["action"], "inherited")
            self.assertEqual(prepared["flower"]["installation"], "complete")
            _, repeated = self._helper("prepare", "--inherit-flower", "--source", str(self.main))
            self.assertFalse(repeated["changed"])
            self.assertEqual(repeated["localStateTransfer"]["flower"]["action"], "preserved")
        self.assertEqual(self._git(self.linked, "status", "--porcelain").stdout, "")

    def test_flower_create_inherits_records_and_fingerprints_source(self) -> None:
        """创建计划只读并包含安装信息；忽略文件变化也使原指纹失效。"""
        environment = self._flower_fixture()
        target = self.base / "flower-created"
        args = ("--source", str(self.main), "--branch", "feature/flower", "--task-title", "Flower 任务", "--task-slug", "flower")
        with mock.patch.dict(os.environ, environment):
            _, plan = self._helper("create", *args, target=target)
            self.assertFalse(target.exists())
            self.assertIn(".flower/state.json", plan["localStateTransfer"]["flower"]["paths"])
            lock = self.main / ".flower/plugin-lock.json"
            lock.write_text(lock.read_text(encoding="utf-8") + "\n", encoding="utf-8")
            result, stale = self._helper("create", *args, "--yes", "--plan-fingerprint", plan["confirmation"]["fingerprint"], target=target, check=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(stale["reason"], "create-plan-changed")
            self.assertFalse(target.exists())
            _, created = self._create_helper(*args, target=target)
            self.assertEqual(created["localStateTransfer"]["flower"]["action"], "inherited")
            self.assertFalse(created["localStateTransfer"]["flower"]["validationPending"])
            _, status = self._helper("status", target=target)
            self.assertEqual(status["flower"]["installation"], "complete")

    def test_flower_create_rolls_back_if_source_content_is_not_in_base(self) -> None:
        """来源未提交插件内容不能靠复制记录成为目标已安装内容。"""
        environment = self._flower_fixture()
        relative = ".agents/skills/example/SKILL.md"
        (self.main / relative).write_text("未提交安装内容\n", encoding="utf-8")
        state_path = self.main / ".flower/state.json"
        state = json.loads(state_path.read_text(encoding="utf-8"))
        state["plugins"][0]["paths"][0]["hash"] = "sha256:" + hashlib.sha256((self.main / relative).read_bytes()).hexdigest()
        state_path.write_text(json.dumps(state), encoding="utf-8")
        target = self.base / "flower-drift"
        with mock.patch.dict(os.environ, environment):
            result, payload = self._create_helper("--source", str(self.main), "--branch", "feature/flower-drift", "--task-title", "漂移", "--task-slug", "drift", target=target, check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(target.exists())
        self.assertEqual(payload["rollbackErrors"], [])
        self.assertNotEqual(self._git(self.main, "show-ref", "--verify", "refs/heads/feature/flower-drift", check=False).returncode, 0)

    def test_flower_prepare_rolls_back_after_adapter_loses_response(self) -> None:
        """适配器写入后未能返回时，可通过项目外回执清理记录。"""
        environment = self._flower_fixture()
        spec = importlib.util.spec_from_file_location("flower_worktree_transfer_test", SOURCE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        original = module._flower_call

        def lose_response(operation: str, **values) -> dict:
            """模拟写入完成后适配器输出丢失。"""
            result = original(operation, **values)
            if operation == "apply":
                raise module.WorktreeSetupError("flower-adapter-failed", "模拟输出丢失")
            return result

        with mock.patch.dict(os.environ, environment), mock.patch.object(module, "_flower_call", side_effect=lose_response):
            plan = module._analyze(str(self.linked))
            with self.assertRaises(module.WorktreeSetupError):
                module._prepare_local(plan, "tester", source=str(self.main), inherit_flower=True)
        self.assertFalse((self.linked / ".flower").exists())

    def test_flower_missing_configured_directory_requires_prepare_not_init(self) -> None:
        """版本化模板声明 .flower 时，其缺失也不要求重装 Trellis。"""
        hashes = self.linked / ".trellis/.template-hashes.json"
        value = json.loads(hashes.read_text(encoding="utf-8"))
        value["hashes"][".flower/plugins.json"] = "hash"
        hashes.write_text(json.dumps(value), encoding="utf-8")
        _, status = self._helper("status")
        self.assertEqual(status["status"], "needs-prepare")

    def test_flower_real_cli_uses_bundled_adapter_for_create_and_prepare(self) -> None:
        """真实 CLI 使用随包 engine 和适配器完成创建及补配。"""
        self._flower_fixture()

        def cli(*args: str) -> dict:
            """在来源工作树调用真实 Flower CLI 并解析唯一 JSON。"""
            result = subprocess.run(
                [shutil.which("node"), str(ROOT / "bin/flower-trellis.js"), "worktree", *args, "--json"],
                cwd=self.main, text=True, capture_output=True,
                env={**os.environ, "FLOWER_NO_TELEMETRY": "1", "FLOWER_WORKTREE_HELPER": "/missing/adapter", "FLOWER_WORKTREE_NODE": "/missing/node"},
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(result.stderr, "")
            return json.loads(result.stdout)

        prepared = cli("prepare", "--target", str(self.linked), "--developer", "tester", "--inherit-flower", "--source", str(self.main))
        self.assertEqual(prepared["flower"]["installation"], "complete")
        target = self.base / "flower-cli"
        args = ("create", "--target", str(target), "--branch", "feature/flower-cli", "--task-title", "CLI 任务", "--task-slug", "flower-cli")
        plan = cli(*args)
        self.assertFalse(target.exists())
        result = cli(*args, "--yes", "--plan-fingerprint", plan["confirmation"]["fingerprint"])
        self.assertEqual(result["status"], "created")
        self.assertEqual(cli("status", "--target", str(target))["flower"]["installation"], "complete")

    def test_flower_adapter_rejects_empty_payload_and_timeout(self) -> None:
        """适配器空结果、非法 JSON 或超时不能退化为继承成功。"""
        spec = importlib.util.spec_from_file_location("flower_worktree_adapter_test", SOURCE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        environment = {"FLOWER_WORKTREE_NODE": "node", "FLOWER_WORKTREE_HELPER": "helper.js"}
        for output in ('{"ok":true,"result":{}}', 'not-json', '{"ok":"true","result":{}}'):
            with mock.patch.dict(os.environ, environment), mock.patch.object(module.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, output, "")):
                with self.assertRaises(module.WorktreeSetupError) as captured:
                    module._flower_call("plan", source=str(self.main), target=str(self.linked))
                self.assertEqual(captured.exception.reason, "flower-adapter-failed")
        with mock.patch.dict(os.environ, environment), mock.patch.object(module.subprocess, "run", side_effect=subprocess.TimeoutExpired("node", 60)):
            with self.assertRaises(module.WorktreeSetupError) as captured:
                module._flower_call("apply", source=str(self.main), target=str(self.linked))
            self.assertEqual(captured.exception.reason, "flower-adapter-failed")


if __name__ == "__main__":
    unittest.main()
