"""spec_router.py 章节感知加载计划测试。"""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "vendor/skill-garden/.trellis/0.6/scripts/spec_router.py"
MODULE_NAME = "flower_spec_router"


def load_module():
    """加载 canonical spec_router 模块。

    Returns:
        已加载的 spec_router 模块。
    """
    spec = importlib.util.spec_from_file_location(MODULE_NAME, SOURCE)
    if spec is None or spec.loader is None:
        raise RuntimeError("无法加载 spec_router.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[MODULE_NAME] = module
    spec.loader.exec_module(module)
    return module


SPEC_ROUTER = load_module()


class SpecRouterTest(unittest.TestCase):
    """验证 Markdown 章节解析、加载预算和输出兼容。"""

    def setUp(self) -> None:
        """创建隔离的 Trellis spec 目录。"""
        self.temp = tempfile.TemporaryDirectory(prefix="flower-spec-router-")
        self.root = Path(self.temp.name)
        (self.root / ".trellis/spec").mkdir(parents=True)

    def tearDown(self) -> None:
        """清理隔离目录。"""
        self.temp.cleanup()

    def write_spec(self, relative: str, content: str) -> Path:
        """写入测试 spec。

        Args:
            relative: 相对 `.trellis/spec` 的路径。
            content: Markdown 内容。

        Returns:
            已写入的文件路径。
        """
        path = self.root / ".trellis/spec" / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return path

    @staticmethod
    def neutral_filler(min_bytes: int = 16 * 1024) -> str:
        """生成不包含查询关键词的长文本。

        Args:
            min_bytes: 期望的最小 UTF-8 字节数。

        Returns:
            长度达到要求的中性文本。
        """
        line = "neutral material without routing vocabulary\n"
        count = (min_bytes // len(line.encode("utf-8"))) + 1
        return line * count

    def first_candidate(self, query: str):
        """返回查询的首个候选。

        Args:
            query: 知识发现查询。

        Returns:
            首个候选；没有候选时使测试失败。
        """
        candidates = SPEC_ROUTER.find_candidates(self.root, query, 3)
        self.assertTrue(candidates, f"query returned no candidates: {query}")
        return candidates[0]

    def test_parse_sections_preserves_original_lines_and_ignores_fences(self) -> None:
        """章节解析保留 frontmatter 后的原始行号，并忽略代码围栏伪标题。"""
        text = """---
kind: spec
---
# Root

```md
## Fake Heading
```

## Real Section
real body

### Child Section
child body

## Next Section
next body
"""

        sections = SPEC_ROUTER.parse_sections(text)
        headings = [section.heading for section in sections]
        real_line = text.splitlines().index("## Real Section") + 1
        next_line = text.splitlines().index("## Next Section") + 1
        real = next(section for section in sections if section.heading == "Real Section")
        child = next(section for section in sections if section.heading == "Child Section")

        self.assertEqual(headings, ["Root", "Real Section", "Child Section", "Next Section"])
        self.assertEqual(real.heading_path, "Root > Real Section")
        self.assertEqual(real.start_line, real_line)
        self.assertEqual(real.end_line, next_line - 1)
        self.assertEqual(child.heading_path, "Root > Real Section > Child Section")

    def test_small_document_uses_full_strategy(self) -> None:
        """小于预算的相关文档直接读取全文。"""
        self.write_spec(
            "release.md",
            "# Release Guide\n\n## Beta Publish\n\nbeta release publish tag changelog npm\n",
        )

        candidate = self.first_candidate("beta release publish tag changelog npm")

        self.assertEqual(candidate.load_strategy, "full")
        self.assertEqual(candidate.sections, [])
        self.assertEqual(candidate.action, "read full file before acting")

    def test_long_document_selects_late_matching_section(self) -> None:
        """长文档后半部分的相关章节可独立形成加载计划。"""
        content = (
            "# Operations\n\n## Background\n\n"
            + self.neutral_filler()
            + "\n## Release Pipeline\n\nbeta release publish tag changelog npm\n"
            + "validation and rollback notes\n"
        )
        self.write_spec("operations.md", content)
        release_line = content.splitlines().index("## Release Pipeline") + 1

        candidate = self.first_candidate("beta release publish tag changelog npm")

        self.assertEqual(candidate.load_strategy, "sections")
        self.assertEqual(len(candidate.sections), 1)
        self.assertEqual(candidate.sections[0].heading, "Operations > Release Pipeline")
        self.assertEqual(candidate.sections[0].start_line, release_line)
        self.assertLessEqual(candidate.sections[0].estimated_bytes, 12 * 1024)

    def test_late_body_only_section_can_form_medium_candidate(self) -> None:
        """长文档后段的同章节正文强证据可以救回中置信候选。"""
        content = (
            "# Notes\n\n## Background\n\n"
            + self.neutral_filler()
            + "\n## Details\n\nalpha bravo charlie delta echo\n"
        )
        self.write_spec("notes.md", content)

        candidate = self.first_candidate("alpha bravo charlie delta echo")

        self.assertEqual(candidate.confidence, "medium")
        self.assertEqual(candidate.load_strategy, "sections")
        self.assertEqual(candidate.sections[0].heading, "Notes > Details")

    def test_section_body_sample_does_not_duplicate_heading_tokens(self) -> None:
        """章节标题 token 不得再次充当正文证据抬高置信度。"""
        sections = SPEC_ROUTER.parse_sections(
            "# Operations\n\n## Release\n\nbeta notes\n"
        )
        release = next(section for section in sections if section.heading == "Release")

        result = SPEC_ROUTER.score_section(
            release,
            SPEC_ROUTER.normalize_tokens("release beta"),
        )

        self.assertIsNotNone(result)
        match, _ = result
        self.assertEqual(match.confidence, "medium")
        self.assertEqual(match.score, 5)

    def test_long_path_only_match_uses_outline_strategy(self) -> None:
        """长文档只有路径证据时先检查目录，不默认读取全文。"""
        self.write_spec(
            "release-publishing.md",
            "# Operations\n\n## Background\n\n" + self.neutral_filler(),
        )

        candidate = self.first_candidate("release publishing")

        self.assertEqual(candidate.load_strategy, "outline")
        self.assertEqual(candidate.sections, [])
        self.assertEqual(
            candidate.action,
            "inspect headings and read relevant sections before acting",
        )

    def test_long_index_only_match_uses_outline_strategy(self) -> None:
        """只有 index 描述证据的长文档先检查目录。"""
        self.write_spec(
            "index.md",
            "# Knowledge Index\n\n"
            "- [Deployment runbook](operations.md): remote rollout safety\n",
        )
        self.write_spec(
            "operations.md",
            "# Operations\n\n## Background\n\n" + self.neutral_filler(),
        )

        candidate = self.first_candidate("remote rollout safety")

        self.assertEqual(candidate.path, ".trellis/spec/operations.md")
        self.assertEqual(candidate.confidence, "high")
        self.assertEqual(candidate.load_strategy, "outline")
        self.assertTrue(
            any(reason.startswith("matched index descriptions") for reason in candidate.reasons)
        )

    def test_document_title_does_not_make_every_child_section_relevant(self) -> None:
        """H1 文档标题只负责文件召回，不能替代子章节证据。"""
        self.write_spec(
            "release-publishing.md",
            "# Release Publishing\n\n## Background\n\n" + self.neutral_filler(),
        )

        candidate = self.first_candidate("release publishing")

        self.assertEqual(candidate.load_strategy, "outline")
        self.assertEqual(candidate.sections, [])

    def test_oversized_matching_section_uses_outline_strategy(self) -> None:
        """单个相关章节超过预算时不得伪装成预算内章节读取。"""
        self.write_spec(
            "operations.md",
            "# Operations\n\n## Release Pipeline\n\n"
            "beta release publish tag changelog npm\n"
            + self.neutral_filler(),
        )

        candidate = self.first_candidate("beta release publish tag changelog npm")

        self.assertEqual(candidate.load_strategy, "outline")
        self.assertEqual(candidate.sections, [])

    def test_section_selection_is_bounded_and_non_overlapping(self) -> None:
        """父子章节重叠时优先具体章节，并保留独立的第二章节。"""
        content = (
            "# Operations\n\n## Background\n\n"
            + self.neutral_filler()
            + "\n## Release\n\nrelease overview\n"
            + "\n### Beta Publish\n\nbeta publish tag npm\n"
            + "\n## Changelog\n\nchangelog validation notes\n"
        )
        self.write_spec("operations.md", content)

        candidate = self.first_candidate("release beta publish tag npm changelog")
        ranges = [(item.start_line, item.end_line) for item in candidate.sections]

        self.assertEqual(candidate.load_strategy, "sections")
        self.assertLessEqual(len(candidate.sections), 2)
        self.assertIn("Operations > Release > Beta Publish", [item.heading for item in candidate.sections])
        self.assertIn("Operations > Changelog", [item.heading for item in candidate.sections])
        self.assertFalse(
            any(
                left_start <= right_start <= left_end
                or right_start <= left_start <= right_end
                for index, (left_start, left_end) in enumerate(ranges)
                for right_start, right_end in ranges[index + 1 :]
            )
        )
        self.assertLessEqual(
            sum(item.estimated_bytes for item in candidate.sections),
            12 * 1024,
        )

    def test_body_hits_do_not_aggregate_across_sections(self) -> None:
        """分散在多个章节的正文弱证据不能拼成文件候选。"""
        self.write_spec(
            "notes.md",
            """# Notes

## One
alpha

## Two
bravo

## Three
charlie

## Four
delta

## Five
echo
""",
        )

        candidates = SPEC_ROUTER.find_candidates(
            self.root,
            "alpha bravo charlie delta echo",
            3,
        )

        self.assertEqual(candidates, [])

    def test_numbered_test_section_body_does_not_route_document(self) -> None:
        """带编号的测试章节正文示例不能反向召回文档。"""
        self.write_spec(
            "knowledge.md",
            """# Knowledge

## 6. Tests Required
open IntelliJ IDEA for current project local tool launch
""",
        )

        candidates = SPEC_ROUTER.find_candidates(
            self.root,
            "open IntelliJ IDEA local tool launch",
            3,
        )

        self.assertEqual(candidates, [])

    def test_anchored_candidate_ignores_numbered_test_section_body(self) -> None:
        """文件锚点存在时，测试章节负例也不能提升文件置信度。"""
        self.write_spec(
            "knowledge-router.md",
            """# Notes

## 6. Tests Required
open IntelliJ IDEA local tool launch
""",
        )

        candidate = self.first_candidate(
            "router open IntelliJ IDEA local tool launch"
        )

        self.assertEqual(candidate.confidence, "medium")
        self.assertEqual(candidate.action, "read full file if clearly relevant")
        self.assertFalse(
            any(reason.startswith("matched body tokens") for reason in candidate.reasons)
        )

    def test_default_limit_and_empty_output_remain_compatible(self) -> None:
        """默认候选数和无匹配输出保持旧 CLI 契约。"""
        args = SPEC_ROUTER.parse_args([])

        self.assertEqual(args.limit, 3)
        self.assertEqual(SPEC_ROUTER.format_json([]), "[]")
        self.assertIn(
            "No relevant project SOP/spec matched. Continue with the normal workflow.",
            SPEC_ROUTER.format_markdown([]),
        )

    def test_output_keeps_legacy_fields_without_inlining_body(self) -> None:
        """JSON 保留旧字段，Markdown 只展示加载计划而不泄漏正文。"""
        secret = "UNIQUE_SECRET_BODY_CONTENT"
        self.write_spec(
            "release.md",
            f"# Release Guide\n\n## Publish\n\nrelease publish tag changelog {secret}\n",
        )
        candidate = self.first_candidate("release publish tag changelog")

        payload = json.loads(SPEC_ROUTER.format_json([candidate]))[0]
        markdown = SPEC_ROUTER.format_markdown([candidate])

        self.assertTrue(
            {
                "file",
                "kind",
                "score",
                "confidence",
                "load",
                "priority",
                "reason",
                "action",
            }.issubset(payload)
        )
        self.assertIn("load_strategy", payload)
        self.assertIn("sections", payload)
        self.assertIn("load_strategy: full", markdown)
        self.assertNotIn(secret, markdown)

    def test_repository_positive_and_negative_queries_do_not_regress(self) -> None:
        """历史发版正例与轻量操作负例保持稳定。"""
        positive = SPEC_ROUTER.find_candidates(
            ROOT,
            "beta release publish tag changelog npm",
            3,
        )
        negative_queries = [
            "open IntelliJ IDEA for current project local tool launch",
            "edit README documentation typo small change",
            "draw architecture diagram visualize flow",
            "commit push changes to beta branch",
        ]

        self.assertEqual(
            positive[0].path,
            ".trellis/spec/flower-trellis/cli/release-and-publishing.md",
        )
        self.assertEqual(
            SPEC_ROUTER.find_candidates(ROOT, negative_queries[0], 3),
            [],
        )
        for query in negative_queries[1:]:
            with self.subTest(query=query):
                candidates = SPEC_ROUTER.find_candidates(ROOT, query, 3)
                self.assertFalse(
                    any(candidate.confidence == "high" for candidate in candidates)
                )


if __name__ == "__main__":
    unittest.main()
