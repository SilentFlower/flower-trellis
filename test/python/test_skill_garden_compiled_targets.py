import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
GENERATOR = ROOT / "vendor/skill-garden/scripts/generate-compiled-targets.py"


def _load_generator():
    """加载 Skill-Garden compiled target generator。

    Returns:
        已加载的 generator 模块。
    """
    spec = importlib.util.spec_from_file_location("skill_garden_compiled_targets", GENERATOR)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class CompiledTargetPathTest(unittest.TestCase):
    """验证最终文件与 diff sidecar 的输出路径边界。"""

    def test_rejects_exact_sidecar_collision(self) -> None:
        """真实 `.diff` target 不得覆盖另一 target 的 sidecar。"""
        generator = _load_generator()
        plan = {
            "files": [
                {"target": "docs/guide.md", "changed": True},
                {"target": "docs/guide.md.diff", "changed": False},
            ]
        }
        with self.assertRaisesRegex(generator.CompiledTargetError, "输出路径冲突"):
            generator._assert_target_output_paths(plan)

    def test_rejects_sidecar_directory_collision(self) -> None:
        """sidecar 文件不得同时成为另一 target 的父目录。"""
        generator = _load_generator()
        plan = {
            "files": [
                {"target": "docs/guide.md", "changed": True},
                {"target": "docs/guide.md.diff/detail.txt", "changed": False},
            ]
        }
        with self.assertRaisesRegex(generator.CompiledTargetError, "文件/目录路径冲突"):
            generator._assert_target_output_paths(plan)

    def test_accepts_adjacent_final_and_sidecar_paths(self) -> None:
        """普通 changed target 可以安全生成相邻 sidecar。"""
        generator = _load_generator()
        generator._assert_target_output_paths(
            {
                "files": [
                    {"target": "docs/guide.md", "changed": True},
                    {"target": "docs/other.md", "changed": False},
                ]
            }
        )


class CompiledTargetProfileTest(unittest.TestCase):
    """验证 canonical fixture 覆盖 0.6.14 全平台矩阵。"""

    def test_canonical_init_uses_all_current_platforms(self) -> None:
        """生成器必须启用新增平台并排除已废弃的 Windsurf 别名。"""
        generator = _load_generator()
        arguments = set(generator.CANONICAL_INIT_ARGS)
        for flag in ("--omp", "--grok", "--kimi", "--snow", "--pi", "--zcode"):
            self.assertIn(flag, arguments)
        self.assertNotIn("--windsurf", arguments)

    def test_serialized_profile_declares_all_platform_roots(self) -> None:
        """审阅 plan 必须明确记录全平台 profile 与迁移后的 Skill roots。"""
        generator = _load_generator()
        plan = {
            "catalogHash": "hash",
            "catalogs": [],
            "selectedBundles": [],
            "selectedPatches": [],
            "operationOrder": [],
            "catalogOperations": [],
            "files": [],
            "results": [],
        }
        report = {
            "version": {"value": "0.6.14", "status": "tested"},
            "summary": {"errors": 0, "warnings": 0, "info": 0},
            "diagnostics": [],
        }

        profile = generator._serialize_plan("0.6.14", plan, report)["profile"]

        self.assertEqual(profile["id"], "all-platforms")
        self.assertIn("pi", profile["platforms"])
        self.assertIn("kimi", profile["platforms"])
        self.assertIn(".agents", profile["roots"])
        self.assertIn(".kimi-code", profile["roots"])
        self.assertIn(".zcode", profile["roots"])


class CompiledTargetOutputTest(unittest.TestCase):
    """验证 compiled target 的 diff 与目录替换异常语义。"""

    def test_unified_diff_marks_missing_final_newlines(self) -> None:
        """缺少结尾换行的删除行与新增行必须保持独立并带标准标记。"""
        generator = _load_generator()
        cases = [
            ("old", "new", 2),
            ("old", "new\n", 1),
            ("old\n", "new", 1),
        ]
        for original, next_value, marker_count in cases:
            with self.subTest(original=original, next_value=next_value):
                value = generator._unified_diff("sample.txt", original, next_value)
                self.assertEqual(
                    value.count("\\ No newline at end of file"),
                    marker_count,
                )
                self.assertIn("-old\n", value)
                self.assertIn("+new\n", value)
                self.assertNotIn("-old+new", value)

    def test_backup_cleanup_failure_keeps_committed_output(self) -> None:
        """新树换入后清理旧备份失败只返回警告，不得报告替换失败。"""
        generator = _load_generator()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            output_root = root / "compiled-targets"
            staging = root / "staging"
            old_version = output_root / "0.6.5"
            new_version = staging / "0.6.5"
            old_version.mkdir(parents=True)
            new_version.mkdir(parents=True)
            (old_version / "old.txt").write_text("old\n", encoding="utf-8")
            (new_version / "new.txt").write_text("new\n", encoding="utf-8")
            backup = root / f"compiled-targets.backup-{generator.os.getpid()}"

            with mock.patch.object(
                generator.shutil,
                "rmtree",
                side_effect=OSError("injected cleanup failure"),
            ):
                warnings = generator._replace_output(staging, output_root)

            self.assertEqual(len(warnings), 1)
            self.assertIn("旧 compiled targets 备份清理失败", warnings[0])
            self.assertTrue((output_root / "0.6.5/new.txt").is_file())
            self.assertFalse((output_root / "0.6.5/old.txt").exists())
            self.assertTrue((backup / "0.6.5/old.txt").is_file())


if __name__ == "__main__":
    unittest.main()
