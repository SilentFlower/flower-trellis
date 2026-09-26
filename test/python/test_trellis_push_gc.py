"""Trellis Push 自动 GC ahead 提交的只读审计回归。"""

from __future__ import annotations

from datetime import datetime, timezone
from importlib import util as importlib_util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
LIFECYCLE_ROOT = ROOT / "vendor/skill-garden/.trellis/0.6/scripts"
AUDITOR = ROOT / "vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-push/scripts/verify_gc_commit.py"

for import_path in (str(ROOT / ".trellis/scripts"), str(LIFECYCLE_ROOT)):
    if import_path not in sys.path:
        sys.path.insert(0, import_path)

SPEC = importlib_util.spec_from_file_location("task_lifecycle_for_push_gc_test", LIFECYCLE_ROOT / "task_lifecycle.py")
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("无法加载 task_lifecycle.py")
LIFECYCLE = importlib_util.module_from_spec(SPEC)
SPEC.loader.exec_module(LIFECYCLE)


class TrellisPushGcTest(unittest.TestCase):
    """用真实 GC 和伪造提交验证默认许可只覆盖纯归档移动。"""

    def setUp(self) -> None:
        """创建独立且带初始提交的 Git/Trellis 项目。"""
        self.temporary = tempfile.TemporaryDirectory(prefix="flower-push-gc-")
        self.root = Path(self.temporary.name)
        (self.root / ".trellis/tasks").mkdir(parents=True)
        (self.root / ".trellis/config.yaml").write_text("project:\n  type: single\n", encoding="utf-8")
        (self.root / "README.md").write_text("baseline\n", encoding="utf-8")
        self.git("init", "-q")
        self.git("config", "user.name", "Flower Test")
        self.git("config", "user.email", "flower@example.test")
        self.git("add", "--", ".trellis/config.yaml", "README.md")
        self.git("commit", "-qm", "initial")

    def tearDown(self) -> None:
        """删除隔离项目。"""
        self.temporary.cleanup()

    def git(self, *args: str) -> str:
        """执行隔离仓库的 Git 命令并返回 stdout。"""
        result = subprocess.run(["git", *args], cwd=self.root, capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def task(self, name: str, closed_at: str = "2026-09-18T00:00:00Z", *, closed: bool = True) -> Path:
        """写入可用于真实 GC 或反例的任务目录。"""
        directory = self.root / ".trellis/tasks" / name
        directory.mkdir(parents=True)
        data = {
            "status": "completed" if closed else "in_progress",
            "closeout": {
                "status": "closed" if closed else "pending",
                "closedAt": closed_at if closed else None,
                "blockers": [],
            },
        }
        (directory / "task.json").write_text(json.dumps(data, ensure_ascii=False) + "\n", encoding="utf-8")
        (directory / "brief.md").write_text(f"# {name}\n", encoding="utf-8")
        self.git("add", "--", directory.relative_to(self.root).as_posix())
        self.git("commit", "-qm", f"add {name}")
        return directory

    def audit(self, commit: str) -> tuple[int, dict]:
        """通过部署脚本的真实 CLI 读取结构化审计结果。"""
        result = subprocess.run(
            [sys.executable, "-X", "utf8", str(AUDITOR), "--repo", str(self.root), "--commit", commit],
            cwd=self.root,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        self.assertFalse(result.stderr, result.stderr)
        return result.returncode, json.loads(result.stdout)

    def move_and_commit(self, directory: Path, bucket: str) -> str:
        """把一个任务手工移入指定月份并生成与自动 GC 同名的提交。"""
        destination = self.root / ".trellis/tasks/archive" / bucket / directory.name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(directory), str(destination))
        self.git("add", "-u", "--", directory.relative_to(self.root).as_posix())
        self.git("add", "--", destination.relative_to(self.root).as_posix())
        self.git("commit", "-qm", "chore(task): gc closed tasks")
        return self.git("rev-parse", "HEAD")

    def test_real_gc_accepts_multiple_tasks_unicode_and_utc_bucket(self) -> None:
        """真实 GC 同批移动多任务，特殊路径和时区边界均可识别。"""
        self.task("09-18-中文任务")
        self.task("09-01-space task", "2026-09-01T00:30:00+01:00")
        names = {"09-18-中文任务", "09-01-space task"}
        if sys.platform != "win32":
            self.task("09-18-tab\tname")
            names.add("09-18-tab\tname")
        result = LIFECYCLE.gc_closed_tasks(
            self.root,
            "3d",
            now=datetime(2026, 9, 22, tzinfo=timezone.utc),
        )
        before_status = self.git("status", "--porcelain")
        code, audit = self.audit(result["commit"])
        self.assertEqual(code, 0, audit)
        self.assertEqual(audit["status"], "verified")
        self.assertEqual(audit["files"], len(names) * 2)
        self.assertEqual(set(audit["tasks"]), names)
        self.assertTrue((self.root / ".trellis/tasks/archive/2026-08/09-01-space task/task.json").exists())
        self.assertEqual(self.git("status", "--porcelain"), before_status)

    def test_real_gc_accepts_identical_existing_archive(self) -> None:
        """归档目标已存在且字节相同时，只删除顶层副本仍是有效 GC。"""
        directory = self.task("09-18-dedupe")
        destination = self.root / ".trellis/tasks/archive/2026-09" / directory.name
        destination.parent.mkdir(parents=True)
        shutil.copytree(directory, destination)
        self.git("add", "--", destination.relative_to(self.root).as_posix())
        self.git("commit", "-qm", "add archive copy")
        result = LIFECYCLE.gc_closed_tasks(
            self.root,
            "3d",
            now=datetime(2026, 9, 22, tzinfo=timezone.utc),
        )
        code, audit = self.audit(result["commit"])
        self.assertEqual(code, 0, audit)
        self.assertEqual(audit["tasks"], ["09-18-dedupe"])

    def test_same_message_with_unrelated_file_is_rejected(self) -> None:
        """固定消息无法授权同时修改业务文件的提交。"""
        directory = self.task("09-18-extra")
        destination = self.root / ".trellis/tasks/archive/2026-09" / directory.name
        destination.parent.mkdir(parents=True)
        shutil.move(str(directory), str(destination))
        (self.root / "README.md").write_text("changed\n", encoding="utf-8")
        self.git("add", "-u", "--", ".trellis/tasks", "README.md")
        self.git("add", "--", destination.relative_to(self.root).as_posix())
        self.git("commit", "-qm", "chore(task): gc closed tasks")
        code, audit = self.audit(self.git("rev-parse", "HEAD"))
        self.assertEqual(code, 1)
        self.assertEqual(audit["status"], "rejected")

    def test_submodule_pointer_change_is_rejected_even_if_diff_config_ignores_it(self) -> None:
        """本地 diff 配置不能隐藏 GC 提交中的额外子模块指针。"""
        directory = self.task("09-18-gitlink")
        destination = self.root / ".trellis/tasks/archive/2026-09" / directory.name
        destination.parent.mkdir(parents=True)
        shutil.move(str(directory), str(destination))
        self.git("add", "-u", "--", directory.relative_to(self.root).as_posix())
        self.git("add", "--", destination.relative_to(self.root).as_posix())
        self.git("config", "diff.ignoreSubmodules", "all")
        self.git("update-index", "--add", "--cacheinfo", f"160000,{self.git('rev-parse', 'HEAD')},external/submodule")
        self.git("commit", "-qm", "chore(task): gc closed tasks")
        code, audit = self.audit(self.git("rev-parse", "HEAD"))
        self.assertEqual(code, 1, audit)

    def test_message_with_body_and_merge_commit_are_rejected(self) -> None:
        """主题相同但完整消息不同或含多个父节点时均拒绝。"""
        directory = self.task("09-18-message")
        destination = self.root / ".trellis/tasks/archive/2026-09" / directory.name
        destination.parent.mkdir(parents=True)
        shutil.move(str(directory), str(destination))
        self.git("add", "-u", "--", directory.relative_to(self.root).as_posix())
        self.git("add", "--", destination.relative_to(self.root).as_posix())
        self.git("commit", "-qm", "chore(task): gc closed tasks\n\nmanual note")
        code, audit = self.audit(self.git("rev-parse", "HEAD"))
        self.assertEqual(code, 1, audit)

        tree = self.git("rev-parse", "HEAD^{tree}")
        parent = self.git("rev-parse", "HEAD^")
        second_parent = self.git("rev-parse", "HEAD~2")
        merge = self.git("commit-tree", tree, "-p", parent, "-p", second_parent, "-m", "chore(task): gc closed tasks")
        code, audit = self.audit(merge)
        self.assertEqual(code, 1, audit)

    def test_changed_archive_content_is_rejected(self) -> None:
        """任务移动期间改写内容不能获得纯 GC 许可。"""
        directory = self.task("09-18-changed")
        destination = self.root / ".trellis/tasks/archive/2026-09" / directory.name
        destination.parent.mkdir(parents=True)
        shutil.move(str(directory), str(destination))
        (destination / "brief.md").write_text("# changed\n", encoding="utf-8")
        self.git("add", "-u", "--", directory.relative_to(self.root).as_posix())
        self.git("add", "--", destination.relative_to(self.root).as_posix())
        self.git("commit", "-qm", "chore(task): gc closed tasks")
        code, audit = self.audit(self.git("rev-parse", "HEAD"))
        self.assertEqual(code, 1)
        self.assertEqual(audit["status"], "rejected")

    def test_wrong_bucket_and_open_task_are_rejected(self) -> None:
        """错误月份和未关闭任务都不能借用自动 GC 消息放行。"""
        wrong_bucket = self.task("09-18-wrong-bucket")
        code, audit = self.audit(self.move_and_commit(wrong_bucket, "2026-08"))
        self.assertEqual(code, 1, audit)
        open_task = self.task("09-18-open", closed=False)
        code, audit = self.audit(self.move_and_commit(open_task, "2026-09"))
        self.assertEqual(code, 1, audit)

    def test_incomplete_move_and_short_hash_are_rejected(self) -> None:
        """只移动部分任务文件或使用非完整哈希均不能通过审计。"""
        directory = self.task("09-18-incomplete")
        destination = self.root / ".trellis/tasks/archive/2026-09" / directory.name
        destination.mkdir(parents=True)
        shutil.move(str(directory / "task.json"), str(destination / "task.json"))
        self.git("add", "-u", "--", directory.relative_to(self.root).as_posix())
        self.git("add", "--", destination.relative_to(self.root).as_posix())
        self.git("commit", "-qm", "chore(task): gc closed tasks")
        commit = self.git("rev-parse", "HEAD")
        code, audit = self.audit(commit)
        self.assertEqual(code, 1, audit)
        code, audit = self.audit(commit[:7])
        self.assertEqual(code, 1, audit)


if __name__ == "__main__":
    unittest.main()
