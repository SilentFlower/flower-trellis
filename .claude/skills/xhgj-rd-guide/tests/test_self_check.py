from __future__ import annotations

import copy
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SKILL_ROOT = Path(__file__).resolve().parents[1]
SELF_CHECK = SKILL_ROOT / "scripts" / "self_check.py"
RENDERER = SKILL_ROOT / "scripts" / "render_real_usage.py"
sys.path.insert(0, str(SKILL_ROOT / "scripts"))

import self_check as check  # noqa: E402


def run_check(*args: str, cwd: Path = SKILL_ROOT) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(cwd / "scripts" / "self_check.py"), *args],
        cwd=cwd,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )


def run_renderer(*args: str, cwd: Path = SKILL_ROOT) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(cwd / "scripts" / "render_real_usage.py"), *args],
        cwd=cwd,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )


def load_json_compatible(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    payload = "\n".join(
        line for line in text.splitlines() if not line.lstrip().startswith("#")
    )
    return json.loads(payload)


def write_json(path: Path, value: dict) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


class SelfCheckTests(unittest.TestCase):
    def test_current_skill_passes_offline_check(self):
        result = run_check("--json")
        self.assertEqual(result.returncode, 0, result.stderr)
        summary = json.loads(result.stdout)
        self.assertEqual(summary["skill"], "xhgj-rd-guide")
        self.assertEqual(summary["status"], "incubating")
        self.assertEqual(summary["version"], "0.4.0")
        self.assertEqual(summary["usage_status"], "passed")
        self.assertGreaterEqual(summary["cases"], 7)
        self.assertEqual(summary["deterministic_cases"], 4)

    def test_historical_aliases_are_preserved(self):
        contract = load_json_compatible(SKILL_ROOT / "contract.yaml")
        self.assertEqual(contract["aliases"], ["rd-guide-meta", "rd-guide"])

    def test_client_verification_keeps_partial_claude_out_of_clients(self):
        contract = load_json_compatible(SKILL_ROOT / "contract.yaml")
        verification = contract["compatibility"]["client_verification"]
        by_client = {item["client"]: item for item in verification["results"]}
        self.assertEqual(contract["compatibility"]["clients"], ["codex"])
        self.assertEqual(
            by_client["codex"]["verified_layers"],
            ["discovery", "routing", "constraints"],
        )
        self.assertEqual(by_client["claude"]["verified_layers"], ["discovery"])

    def test_self_check_rejects_partially_verified_client_in_clients(self):
        with tempfile.TemporaryDirectory() as directory:
            copied = Path(directory) / SKILL_ROOT.name
            shutil.copytree(SKILL_ROOT, copied)
            contract_path = copied / "contract.yaml"
            contract = load_json_compatible(contract_path)
            contract["compatibility"]["clients"].append("claude")
            write_json(contract_path, contract)
            result = run_check(cwd=copied)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("must exactly match clients verified", result.stderr)

    def test_real_usage_projection_is_current_and_human_readable(self):
        result = run_renderer("--check")
        self.assertEqual(result.returncode, 0, result.stderr)
        projection = (SKILL_ROOT / "tests/fixtures/real-usage.md").read_text(
            encoding="utf-8"
        )
        self.assertIn("由 JSON 生成，请勿手工编辑", projection)
        self.assertIn("机器 canonical：`tests/fixtures/real-usage.json`", projection)
        self.assertIn("规范化内容 SHA-256", projection)
        self.assertIn("Maintainer 状态：`pending-maintainer-review`", projection)
        self.assertIn("019fb28e-e1a0-7233-a890-d639694be22d", projection)
        self.assertIn("安装副本均为 0.2.0", projection)
        for scenario_id in (
            "positive-multi-session",
            "negative-ordinary-code",
            "failure-required-source",
            "failure-authority-conflict",
            "degrade-optional-detail",
            "project-trellis-present",
            "project-trellis-absent",
            "catalog-only-stable-locator",
            "installation-version-gap",
        ):
            self.assertIn(scenario_id, projection)

    def test_real_usage_metadata_two_red_one_green(self):
        evidence = load_json_compatible(
            SKILL_ROOT / "tests/fixtures/real-usage.json"
        )
        metadata = evidence["usage_metadata"]
        missing = copy.deepcopy(metadata)
        missing.pop("client_version")
        with self.assertRaisesRegex(check.CheckError, "fields must be exactly"):
            check.validate_usage_metadata(missing, evidence["skill_version"])

        invalid = copy.deepcopy(metadata)
        invalid["client_version"] = {"unavailable": "future-enum"}
        with self.assertRaisesRegex(check.CheckError, "unavailable is invalid"):
            check.validate_usage_metadata(invalid, evidence["skill_version"])

        non_blocking = copy.deepcopy(metadata)
        non_blocking["operating_system"] = {"unavailable": "not-collected"}
        check.validate_usage_metadata(non_blocking, evidence["skill_version"])

    def test_deterministic_case_matrix_covers_installability_gates(self):
        matrix = load_json_compatible(SKILL_ROOT / "tests/cases.json")
        deterministic = {case["id"]: case for case in matrix["deterministic_cases"]}
        self.assertEqual(
            set(deterministic),
            {
                "failure-required-source-stale-fallback",
                "failure-authority-conflict-locator-omission",
                "failure-catalog-only-stable-locator-omission",
                "failure-main-only-effectiveness-claim",
            },
        )

    def test_each_deterministic_mutation_is_detected(self):
        cases_path = SKILL_ROOT / "tests/cases.json"
        mutations = [
            (
                "failure-required-source-stale-fallback",
                "validate_required_source_access",
            ),
            (
                "failure-authority-conflict-locator-omission",
                "validate_authority_conflict_routing",
            ),
            (
                "failure-catalog-only-stable-locator-omission",
                "validate_catalog_only_routing",
            ),
            (
                "failure-main-only-effectiveness-claim",
                "validate_installation_effectiveness",
            ),
        ]
        for case_id, target in mutations:
            with self.subTest(case_id=case_id), mock.patch.object(
                check, target, lambda value: None
            ):
                with self.assertRaisesRegex(check.CheckError, case_id):
                    check.validate_cases(cases_path)

    def test_feedback_routing_cases_distinguish_content_and_skill_issues(self):
        cases = load_json_compatible(SKILL_ROOT / "tests/cases.json")["cases"]
        by_id = {case["id"]: case for case in cases}

        generic = by_id["failure-authority-conflict"]
        self.assertEqual(
            generic["expected_action"],
            "stop-calibrate-then-create-dedicated-issue",
        )
        self.assertNotIn("issue:1", generic["expected_routes"])

        matching = by_id["authority-conflict-matching-existing-issue"]
        self.assertEqual(
            matching["expected_action"], "stop-and-route-matching-existing-issue"
        )
        self.assertIn("issue:1", matching["expected_routes"])

        distinct = by_id["authority-conflict-distinct-feedback"]
        self.assertEqual(
            distinct["expected_action"], "stop-and-request-joint-calibration"
        )
        self.assertIn("issue:41", distinct["expected_routes"])
        self.assertIn("issue:42", distinct["expected_routes"])

        skill_defect = by_id["skill-routing-defect"]
        self.assertEqual(skill_defect["expected_routes"], ["contract.yaml", "issue:3"])
        self.assertNotIn("issue:3", generic["expected_routes"])

    def test_catalog_source_kinds_route_by_authority_and_reference_mode(self):
        catalog_path = SKILL_ROOT.parents[1] / "catalog/sources.yaml"
        if not catalog_path.is_file():
            self.skipTest("repository source catalog is unavailable")

        sources = load_json_compatible(catalog_path)["entries"]
        sources_by_id = {source["id"]: source for source in sources}
        cases = load_json_compatible(SKILL_ROOT / "tests/cases.json")["cases"]
        cases_by_id = {case["id"]: case for case in cases}

        expectations = {
            "src-dingtalk-workspace-cli-upstream": {
                "kind": "external-git",
                "reference_mode": "optional-detail",
                "case": "route-external-git-optional-detail",
                "action": "read-pinned-optional-detail",
            },
            "src-digital-rd-team-wiki-projection": {
                "kind": "dingtalk-wiki",
                "reference_mode": "catalog-only",
                "case": "route-dingtalk-wiki-catalog-only",
                "action": "use-catalog-only-candidate-projection",
            },
        }

        for source_id, expected in expectations.items():
            with self.subTest(source_id=source_id):
                source = sources_by_id[source_id]
                self.assertEqual(source["kind"], expected["kind"])
                self.assertEqual(source["authority"], "rd-guide-maintainers")
                self.assertEqual(
                    source["reference_mode"], expected["reference_mode"]
                )
                self.assertNotEqual(source["role"], "canonical")

                case = cases_by_id[expected["case"]]
                self.assertIn("catalog/sources.yaml", case["expected_routes"])
                self.assertIn(
                    "governance/authority-registry.yaml", case["expected_routes"]
                )
                self.assertIn(source["locator"], case["expected_routes"])
                self.assertEqual(case["expected_action"], expected["action"])

    def test_conflict_guidance_requires_scope_matched_feedback(self):
        skill_text = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")
        reference_text = (
            SKILL_ROOT / "references/authority-and-access.md"
        ).read_text(encoding="utf-8")

        self.assertNotIn("停止裁决并路由到 `issue:1`", skill_text)
        self.assertNotIn("冲突双方、scope 和事实截止路由到 `issue:1`", reference_text)
        self.assertIn("只有 Registry 明确解析到 `issue:1`", reference_text)
        self.assertIn("若双方入口不同，同时列出双方负责人和反馈入口", reference_text)
        self.assertIn("创建专门 issue", reference_text)
        self.assertIn("Skill feedback 入口 `issue:3`", reference_text)

    def test_user_outputs_translate_internal_governance_terms(self):
        evidence = json.loads(
            (SKILL_ROOT / "tests/fixtures/real-usage.json").read_text(encoding="utf-8")
        )
        by_id = {scenario["id"]: scenario for scenario in evidence["scenarios"]}

        required_source_output = by_id["failure-required-source"]["output"]
        for internal_phrase in (
            "owner/feedback",
            "required-source",
            "请求对应 authority",
        ):
            self.assertNotIn(internal_phrase, required_source_output)
        self.assertIn("维护负责人和反馈入口", required_source_output)
        self.assertIn("所必需的原始资料", required_source_output)

        conflict_output = by_id["failure-authority-conflict"]["output"]
        self.assertNotIn("issue:1", conflict_output)
        self.assertIn("先联系双方规则负责人进行轻量校准", conflict_output)
        self.assertIn("新建专门 issue", conflict_output)

    def test_versioned_trellis_fixture_drives_positive_and_negative_evidence(self):
        fixture = (
            SKILL_ROOT
            / "tests/fixtures/trellis-project/.trellis/spec/release-check.md"
        )
        fixture_text = fixture.read_text(encoding="utf-8")
        expected_rule = "上线前必须确认验证记录和回滚方案，并由项目维护者完成确认。"
        self.assertIn("不代表真实公司或业务规则", fixture_text)
        self.assertIn(expected_rule, fixture_text)

        evidence = json.loads(
            (SKILL_ROOT / "tests/fixtures/real-usage.json").read_text(encoding="utf-8")
        )
        by_id = {scenario["id"]: scenario for scenario in evidence["scenarios"]}
        present = by_id["project-trellis-present"]
        self.assertIn(".trellis/spec/release-check.md", present["read_files"])
        self.assertIn(expected_rule, present["output"])
        self.assertNotIn("支付", present["input"] + present["output"])

        absent = by_id["project-trellis-absent"]
        self.assertNotIn(".trellis/spec/release-check.md", absent["read_files"])
        self.assertIn("不得虚构项目规则", absent["output"])

    def test_canonical_and_alias_namespaces_are_independent(self):
        for field, value, expected in (
            ("name", "rd-guide", "xhgj-<domain>"),
            ("aliases", ["rd-guide", "xhgj-legacy"], "outside xhgj-"),
        ):
            with self.subTest(field=field):
                with tempfile.TemporaryDirectory() as directory:
                    copied = Path(directory) / SKILL_ROOT.name
                    shutil.copytree(SKILL_ROOT, copied)
                    contract = load_json_compatible(copied / "contract.yaml")
                    contract[field] = value
                    write_json(copied / "contract.yaml", contract)
                    result = run_check(cwd=copied)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(expected, result.stderr)

    def test_missing_entrypoint_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            copied = Path(directory) / SKILL_ROOT.name
            shutil.copytree(SKILL_ROOT, copied)
            (copied / "SKILL.md").unlink()
            result = run_check(cwd=copied)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("entrypoint", result.stderr)

    def test_rejects_absolute_paths_for_all_contract_locators(self):
        fields = (
            "entrypoint",
            "self_check",
            "tests",
            "protected_paths",
            "evidence",
            "review_projection",
        )
        for field in fields:
            with self.subTest(field=field):
                with tempfile.TemporaryDirectory() as directory:
                    copied = Path(directory) / SKILL_ROOT.name
                    shutil.copytree(SKILL_ROOT, copied)
                    contract = load_json_compatible(copied / "contract.yaml")
                    absolute_paths = {
                        "entrypoint": str((copied / "SKILL.md").resolve()),
                        "self_check": str((copied / "scripts/self_check.py").resolve()),
                        "tests": str((copied / "tests/test_self_check.py").resolve()),
                        "protected_paths": str((copied / "tests").resolve()),
                        "evidence": str(
                            (copied / "tests/fixtures/real-usage.json").resolve()
                        ),
                        "review_projection": str(
                            (copied / "tests/fixtures/real-usage.md").resolve()
                        ),
                    }
                    if field == "tests":
                        contract["tests"][0] = absolute_paths[field]
                    elif field == "protected_paths":
                        contract["upgrade_protection"]["protected_paths"][0] = (
                            absolute_paths[field]
                        )
                    elif field in {"evidence", "review_projection"}:
                        contract["real_usage"][field] = absolute_paths[field]
                    else:
                        contract[field] = absolute_paths[field]
                    write_json(copied / "contract.yaml", contract)
                    result = run_check(cwd=copied)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("absolute paths are not allowed", result.stderr)

    def test_rejects_foreign_absolute_path_syntax(self):
        for value in ("/tmp/SKILL.md", r"C:\\temp\\SKILL.md", r"\\\\server\\share\\SKILL.md"):
            with self.subTest(value=value):
                with tempfile.TemporaryDirectory() as directory:
                    copied = Path(directory) / SKILL_ROOT.name
                    shutil.copytree(SKILL_ROOT, copied)
                    contract = load_json_compatible(copied / "contract.yaml")
                    contract["entrypoint"] = value
                    write_json(copied / "contract.yaml", contract)
                    result = run_check(cwd=copied)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("absolute paths are not allowed", result.stderr)

    def test_projection_drift_fails_for_json_or_markdown_change(self):
        for changed_path in ("json", "markdown"):
            with self.subTest(changed_path=changed_path):
                with tempfile.TemporaryDirectory() as directory:
                    copied = Path(directory) / SKILL_ROOT.name
                    shutil.copytree(SKILL_ROOT, copied)
                    if changed_path == "json":
                        evidence_path = copied / "tests/fixtures/real-usage.json"
                        evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
                        evidence["review"]["agent_review"]["summary"] += " changed"
                        write_json(evidence_path, evidence)
                    else:
                        with (copied / "tests/fixtures/real-usage.md").open(
                            "a", encoding="utf-8"
                        ) as handle:
                            handle.write("\nmanual change\n")
                    result = run_check(cwd=copied)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("review projection drift detected", result.stderr)

    def test_renderer_repairs_projection_after_json_change(self):
        with tempfile.TemporaryDirectory() as directory:
            copied = Path(directory) / SKILL_ROOT.name
            shutil.copytree(SKILL_ROOT, copied)
            evidence_path = copied / "tests/fixtures/real-usage.json"
            evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
            evidence["review"]["agent_review"]["summary"] += " regenerated"
            write_json(evidence_path, evidence)
            render_result = run_renderer(cwd=copied)
            self.assertEqual(render_result.returncode, 0, render_result.stderr)
            result = run_check(cwd=copied)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_renderer_uses_fences_longer_than_embedded_backticks(self):
        with tempfile.TemporaryDirectory() as directory:
            copied = Path(directory) / SKILL_ROOT.name
            shutil.copytree(SKILL_ROOT, copied)
            evidence_path = copied / "tests/fixtures/real-usage.json"
            evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
            evidence["scenarios"][0]["input"] = (
                "输入含代码块：\n```java\nint x = 1;\n```"
            )
            evidence["scenarios"][0]["output"] = (
                "输出含四反引号：\n````text\nvalue\n````"
            )
            write_json(evidence_path, evidence)

            result = run_renderer(cwd=copied)
            self.assertEqual(result.returncode, 0, result.stderr)
            projection = (copied / "tests/fixtures/real-usage.md").read_text(
                encoding="utf-8"
            )

        self.assertIn(
            "````text\n输入含代码块：\n```java\nint x = 1;\n```\n````",
            projection,
        )
        self.assertIn(
            "`````text\n输出含四反引号：\n````text\nvalue\n````\n`````",
            projection,
        )

    def test_upgrade_compare_accepts_identical_copy(self):
        with tempfile.TemporaryDirectory() as directory:
            copied = Path(directory) / SKILL_ROOT.name
            shutil.copytree(SKILL_ROOT, copied)
            result = run_check("--compare", str(copied))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("no-differences", result.stdout)
        self.assertIn('"installed_version": "0.4.0"', result.stdout)

    def test_expect_version_verifies_the_copy_being_executed(self):
        result = run_check("--expect-version", "0.4.0", "--json")
        self.assertEqual(result.returncode, 0, result.stderr)
        summary = json.loads(result.stdout)
        self.assertEqual(summary["expected_version"], "0.4.0")

        mismatch = run_check("--expect-version", "0.2.1")
        self.assertNotEqual(mismatch.returncode, 0)
        self.assertIn(
            "installed-version-mismatch: expected=0.2.1 actual=0.4.0",
            mismatch.stderr,
        )

    def test_upgrade_compare_ignores_python_runtime_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            copied = Path(directory) / SKILL_ROOT.name
            shutil.copytree(SKILL_ROOT, copied)
            cache = copied / "tests" / "__pycache__"
            cache.mkdir(exist_ok=True)
            (cache / "local.pyc").write_bytes(b"runtime cache")
            result = run_check("--compare", str(copied))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("no-differences", result.stdout)

    def test_upgrade_compare_accepts_lf_crlf_only_difference(self):
        with tempfile.TemporaryDirectory() as directory:
            copied = Path(directory) / SKILL_ROOT.name
            shutil.copytree(SKILL_ROOT, copied)
            skill_path = copied / "SKILL.md"
            text = skill_path.read_text(encoding="utf-8")
            with skill_path.open("w", encoding="utf-8", newline="") as handle:
                handle.write(text.replace("\n", "\r\n"))
            result = run_check("--compare", str(copied))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("no-differences", result.stdout)

    def test_upgrade_compare_stops_on_local_difference(self):
        with tempfile.TemporaryDirectory() as directory:
            copied = Path(directory) / SKILL_ROOT.name
            shutil.copytree(SKILL_ROOT, copied)
            with (copied / "SKILL.md").open("a", encoding="utf-8") as handle:
                handle.write("\nlocal preference\n")
            result = run_check("--compare", str(copied))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("explicit choice required", result.stderr)
        self.assertIn("SKILL.md", result.stderr)

    def test_upgrade_compare_protects_evidence_and_test_code(self):
        for relative_path in (
            Path("tests/fixtures/real-usage.json"),
            Path("tests/fixtures/real-usage.md"),
            Path("tests/fixtures/trellis-project/.trellis/spec/release-check.md"),
            Path("tests/test_self_check.py"),
        ):
            with self.subTest(path=relative_path.as_posix()):
                with tempfile.TemporaryDirectory() as directory:
                    copied = Path(directory) / SKILL_ROOT.name
                    shutil.copytree(SKILL_ROOT, copied)
                    target = copied / relative_path
                    if target.suffix == ".json":
                        evidence = json.loads(target.read_text(encoding="utf-8"))
                        evidence["review"]["agent_review"]["summary"] += " local"
                        write_json(target, evidence)
                    else:
                        with target.open("a", encoding="utf-8") as handle:
                            handle.write("\n# local test change\n")
                    result = run_check("--compare", str(copied))
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("explicit choice required", result.stderr)
                self.assertIn(relative_path.as_posix(), result.stderr)

    def test_active_rejects_pending_maintainer_review_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            copied = Path(directory) / SKILL_ROOT.name
            shutil.copytree(SKILL_ROOT, copied)
            contract = load_json_compatible(copied / "contract.yaml")
            contract["status"] = "active"
            contract["real_usage"]["status"] = "passed"
            contract["real_usage"]["review_status"] = "passed"
            write_json(copied / "contract.yaml", contract)
            evidence_path = copied / contract["real_usage"]["evidence"]
            evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
            evidence["status"] = "passed"
            evidence["review"]["maintainer_review"]["status"] = (
                "pending-maintainer-review"
            )
            evidence["review"]["maintainer_review"]["summary"] = (
                "MR review remains the activation gate"
            )
            write_json(evidence_path, evidence)
            result = run_check(cwd=copied)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Maintainer review status must match its evidence", result.stderr)


if __name__ == "__main__":
    unittest.main()
