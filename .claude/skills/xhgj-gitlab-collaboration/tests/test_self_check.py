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
SCRIPTS = SKILL_ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

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


class FakeRunner:
    def __init__(self, responses: dict[tuple[str, ...], tuple[int, str, str]]):
        self.responses = responses
        self.calls: list[tuple[str, ...]] = []

    def __call__(
        self, argv: list[str] | tuple[str, ...], cwd: Path | None = None
    ) -> subprocess.CompletedProcess[str]:
        key = tuple(argv)
        self.calls.append(key)
        code, stdout, stderr = self.responses.get(key, (127, "", "unexpected command"))
        return subprocess.CompletedProcess(list(argv), code, stdout, stderr)


def positive_responses(repo: Path, access_level: int = 30) -> dict:
    glab = "glab-test"
    git_prefix = ("git", "-C", str(repo.resolve()))
    secret = "gl" + "pat-" + "runtime-only-sensitive-value"
    return {
        (glab, "version"): (0, "glab 1.0\n", ""),
        (glab, "auth", "status", "--hostname", check.EXPECTED_HOST): (
            0,
            f"authenticated with {secret}\n",
            "",
        ),
        (glab, "api", "--hostname", check.EXPECTED_HOST, "user"): (
            0,
            json.dumps({"username": "test-user", "name": "许海川"}),
            "",
        ),
        (
            glab,
            "api",
            "--hostname",
            check.EXPECTED_HOST,
            "projects/digital-rd-governance%2Frd-guide",
        ): (
            0,
            json.dumps(
                {
                    "path_with_namespace": "digital-rd-governance/rd-guide",
                    "permissions": {
                        "project_access": None,
                        "group_access": {"access_level": access_level},
                    },
                }
            ),
            "",
        ),
        (*git_prefix, "remote", "get-url", "origin"): (
            0,
            "http://gitlab.xhgjdev.com/digital-rd-governance/rd-guide.git\n",
            "",
        ),
        (*git_prefix, "config", "user.name"): (0, "许海川\n", ""),
        (*git_prefix, "config", "user.email"): (
            0,
            "xhc6848@xianhengguoji.com\n",
            "",
        ),
        (*git_prefix, "branch", "--show-current"): (0, "feature/test\n", ""),
        (*git_prefix, "status", "--porcelain=v1", "-b"): (
            0,
            "## feature/test...origin/main\n",
            "",
        ),
    }


class SelfCheckTests(unittest.TestCase):
    def test_current_skill_passes_offline_check(self):
        result = run_check("--json")
        self.assertEqual(result.returncode, 0, result.stderr)
        summary = json.loads(result.stdout)
        self.assertEqual(summary["skill"], "xhgj-gitlab-collaboration")
        self.assertEqual(summary["status"], "active")
        self.assertEqual(summary["usage_status"], "passed")
        self.assertEqual(summary["review_status"], "passed")
        self.assertEqual(summary["version"], "0.4.2")
        self.assertGreaterEqual(summary["cases"], 13)
        self.assertEqual(summary["deterministic_cases"], 5)

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

    def test_current_operation_evidence_passes_deterministic_gate(self):
        evidence = SKILL_ROOT / "tests/fixtures/operation-evidence-v0.3.0.json"
        result = run_check("--evidence", str(evidence), "--json")
        self.assertEqual(result.returncode, 0, result.stderr)
        summary = json.loads(result.stdout)
        self.assertEqual(summary["evidence"]["checks"], 3)
        self.assertEqual(
            summary["evidence"]["kinds"],
            ["cross-project-references", "merge-gate", "merge-result"],
        )

    def test_local_and_code_references_do_not_trigger_cross_project_gate(self):
        check.validate_cross_project_evidence(
            {
                "current_project": "digital-rd-governance/rd-guide",
                "body": "本仓 MR !39；示例 `!3`；代码块：\n```text\n#57\n```",
                "confirmed_local_refs": ["!39"],
                "rendered_targets": {},
            }
        )

    def test_markdown_fragment_anchor_does_not_trigger_cross_project_gate(self):
        check.validate_cross_project_evidence(
            {
                "current_project": "digital-rd-governance/rd-guide",
                "body": "参见 [§4](#4-routing-map)。",
                "confirmed_local_refs": [],
                "rendered_targets": {},
            }
        )

    def test_bare_issue_reference_still_triggers_cross_project_gate(self):
        with self.assertRaisesRegex(check.CheckError, "cross-project-bare-ref"):
            check.validate_cross_project_evidence(
                {
                    "current_project": "digital-rd-governance/rd-guide",
                    "body": "见 #4",
                    "confirmed_local_refs": [],
                    "rendered_targets": {},
                }
            )

    def test_alternative_acceptance_evidence_passes_without_ci_gate(self):
        check.validate_merge_gate(
            {
                "uses_pipeline_as_admission_evidence": False,
                "pipeline_content_trusted": False,
                "project_setting_readback": True,
                "only_allow_merge_if_pipeline_succeeds": False,
                "alternative_evidence": "Maintainer reviewed the recorded manual checklist.",
            }
        )

    def test_non_squash_merge_result_passes_with_empty_squash_sha(self):
        check.validate_merge_result(
            {
                "merged": True,
                "project_squash_option": "default_off",
                "mr_squash": False,
                "expected_squash": False,
                "method_comparison_complete": True,
                "result_readback": True,
                "squash_commit_sha": None,
            }
        )

    def test_real_usage_projection_is_passed_and_current(self):
        result = run_renderer("--check")
        self.assertEqual(result.returncode, 0, result.stderr)
        projection = (SKILL_ROOT / "tests/fixtures/real-usage.md").read_text(
            encoding="utf-8"
        )
        self.assertIn("由 JSON 生成，请勿手工编辑", projection)
        self.assertIn("状态：`passed`", projection)
        self.assertIn("Maintainer 状态：`passed`", projection)
        self.assertIn("Skill 版本：`0.4.2`", projection)
        self.assertIn("019fb211-a090-7a01-a86c-461efe8bc3ab", projection)
        self.assertIn("未修改任何安装副本", projection)

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

    def test_subprocess_runner_decodes_utf8_without_system_locale(self):
        completed = subprocess.CompletedProcess(
            ["glab-test", "api"], 0, "许海川\n".encode("utf-8"), b""
        )
        with mock.patch.object(check.subprocess, "run", return_value=completed) as run:
            result = check.subprocess_runner(["glab-test", "api"])

        self.assertEqual(result.stdout, "许海川\n")
        self.assertEqual(result.stderr, "")
        self.assertNotIn("text", run.call_args.kwargs)
        self.assertNotIn("encoding", run.call_args.kwargs)

    def test_subprocess_runner_rejects_non_utf8_output_deterministically(self):
        completed = subprocess.CompletedProcess(
            ["glab-test", "api"], 0, b"\x81", b""
        )
        with mock.patch.object(check.subprocess, "run", return_value=completed):
            with self.assertRaisesRegex(
                check.CheckError, "preflight-output-not-utf8"
            ):
                check.subprocess_runner(["glab-test", "api"])

    def test_json_input_args_require_content_type_and_standard_input(self):
        args = check.glab_json_input_args(
            "glab-test",
            host=check.EXPECTED_HOST,
            method="post",
            endpoint="projects/example%2Frepo/issues/1/notes",
        )
        self.assertEqual(
            args,
            [
                "glab-test",
                "api",
                "--hostname",
                check.EXPECTED_HOST,
                "--method",
                "POST",
                "--header",
                "Content-Type: application/json",
                "--input",
                "-",
                "projects/example%2Frepo/issues/1/notes",
            ],
        )
        with self.assertRaisesRegex(check.CheckError, "wrong-host"):
            check.glab_json_input_args(
                "glab-test",
                host="gitlab.com",
                method="POST",
                endpoint="projects/example%2Frepo/issues/1/notes",
            )

    def test_gitlab_text_roundtrip_trims_only_terminal_newlines(self):
        comparison = check.compare_gitlab_text("正文\n\n", "正文\r\n")
        self.assertTrue(comparison["equal"])
        self.assertNotEqual(
            comparison["expected_raw_sha256"], comparison["actual_raw_sha256"]
        )
        self.assertEqual(
            comparison["expected_normalized_sha256"],
            comparison["actual_normalized_sha256"],
        )
        self.assertFalse(check.compare_gitlab_text("正\r文\n", "正文\n")["equal"])

    def test_live_preflight_returns_only_selected_non_sensitive_facts(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)
            runner = FakeRunner(positive_responses(repo))
            result = check.live_preflight(
                host=check.EXPECTED_HOST,
                project="digital-rd-governance/rd-guide",
                repo=repo,
                expected_username="test-user",
                expected_name="许海川",
                expected_email="xhc6848@xianhengguoji.com",
                expected_branch="feature/test",
                glab_path="glab-test",
                runner=runner,
            )
        rendered = json.dumps(result, ensure_ascii=False)
        secret = "gl" + "pat-" + "runtime-only-sensitive-value"
        self.assertNotIn(secret, rendered)
        self.assertEqual(result["access"]["role"], "Developer")
        self.assertEqual(result["access"]["source"], "group-inherited")
        self.assertEqual(result["remote"]["form"], "hostname-form")
        self.assertEqual(result["credential_material"], "not-read-not-output")

    def test_wrong_host_stops_before_any_command(self):
        with tempfile.TemporaryDirectory() as directory:
            runner = FakeRunner({})
            with self.assertRaisesRegex(check.CheckError, "wrong-host"):
                check.live_preflight(
                    host="gitlab.com",
                    project="digital-rd-governance/rd-guide",
                    repo=Path(directory),
                    expected_username="test-user",
                    expected_name="许海川",
                    expected_email="xhc6848@xianhengguoji.com",
                    expected_branch=None,
                    glab_path="glab-test",
                    runner=runner,
                )
        self.assertEqual(runner.calls, [])

    def test_auth_failure_does_not_forward_raw_output(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)
            responses = positive_responses(repo)
            key = (
                "glab-test",
                "auth",
                "status",
                "--hostname",
                check.EXPECTED_HOST,
            )
            secret = "gl" + "pat-" + "runtime-auth-failure-value"
            responses[key] = (1, "", secret)
            runner = FakeRunner(responses)
            with self.assertRaises(check.CheckError) as caught:
                check.live_preflight(
                    host=check.EXPECTED_HOST,
                    project="digital-rd-governance/rd-guide",
                    repo=repo,
                    expected_username="test-user",
                    expected_name="许海川",
                    expected_email="xhc6848@xianhengguoji.com",
                    expected_branch=None,
                    glab_path="glab-test",
                    runner=runner,
                )
        self.assertEqual(str(caught.exception), "gitlab-not-authenticated")
        self.assertNotIn(secret, str(caught.exception))

    def test_role_below_developer_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)
            runner = FakeRunner(positive_responses(repo, access_level=20))
            with self.assertRaisesRegex(check.CheckError, "gitlab-role-below-developer"):
                check.live_preflight(
                    host=check.EXPECTED_HOST,
                    project="digital-rd-governance/rd-guide",
                    repo=repo,
                    expected_username="test-user",
                    expected_name="许海川",
                    expected_email="xhc6848@xianhengguoji.com",
                    expected_branch=None,
                    glab_path="glab-test",
                    runner=runner,
                )

    def test_remote_with_embedded_credential_fails_without_echoing_it(self):
        secret = "gl" + "pat-" + "runtime-remote-value"
        raw = (
            "http://oauth2:"
            + secret
            + "@gitlab.xhgjdev.com/digital-rd-governance/rd-guide.git"
        )
        with self.assertRaises(check.CheckError) as caught:
            check.parse_remote(raw, "digital-rd-governance/rd-guide")
        self.assertEqual(str(caught.exception), "credential-embedded-in-remote")
        self.assertNotIn(secret, str(caught.exception))

    def test_ip_remote_is_classified_without_rewriting(self):
        result = check.parse_remote(
            f"http://{check.LEGACY_NEW_GITLAB_IP}/digital-rd-governance/rd-guide.git",
            "digital-rd-governance/rd-guide",
        )
        self.assertEqual(result["form"], "ip-form")
        self.assertEqual(result["host"], check.LEGACY_NEW_GITLAB_IP)

    def test_worktime_writes_only_through_timelog_create(self):
        script_text = (SCRIPTS / "self_check.py").read_text(encoding="utf-8")
        self.assertNotIn("/spend", script_text)
        reference = (SKILL_ROOT / "references/execution-contract.md").read_text(
            encoding="utf-8"
        )
        self.assertIn("写入通道固定为 GraphQL `timelogCreate`", reference)
        self.assertIn("不发送 `/spend`", reference)
        self.assertIn("行首 slash", reference)
        skill = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("必须先取得本人对时长、归属日期和 `summary` 的明确确认", skill)

    def test_high_impact_commands_are_absent_from_scripts(self):
        script_text = "\n".join(
            path.read_text(encoding="utf-8") for path in sorted(SCRIPTS.glob("*.py"))
        )
        for marker in (
            "glab mr merge",
            "merge_requests/{iid}/merge",
            "auto_merge=true",
            "members/",
            "protected_branches",
            "issue close",
        ):
            self.assertNotIn(marker, script_text)

    def test_secret_literal_scanner_rejects_token_shaped_content(self):
        with tempfile.TemporaryDirectory() as directory:
            copied = Path(directory) / SKILL_ROOT.name
            shutil.copytree(SKILL_ROOT, copied)
            secret = "gl" + "pat-" + "scanner-detects-this-value"
            target = copied / "references" / "injected.md"
            target.write_text(secret, encoding="utf-8")
            result = run_check(cwd=copied)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("credential-like literal", result.stderr)
        self.assertNotIn(secret, result.stderr)

    def test_upgrade_compare_stops_on_local_difference(self):
        with tempfile.TemporaryDirectory() as directory:
            copied = Path(directory) / SKILL_ROOT.name
            shutil.copytree(SKILL_ROOT, copied)
            with (copied / "SKILL.md").open("a", encoding="utf-8") as handle:
                handle.write("\nlocal preference\n")
            result = run_check("--compare", str(copied))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("explicit choice required", result.stderr)
        self.assertIn("reference=0.4.2 installed=0.4.2", result.stderr)
        self.assertIn("SKILL.md", result.stderr)

    def test_expect_version_verifies_the_copy_being_executed(self):
        accepted = run_check("--expect-version", "0.4.2", "--json")
        self.assertEqual(accepted.returncode, 0, accepted.stderr)
        summary = json.loads(accepted.stdout)
        self.assertEqual(summary["expected_version"], "0.4.2")

        rejected = run_check("--expect-version", "0.4.0")
        self.assertNotEqual(rejected.returncode, 0)
        self.assertIn(
            "installed-version-mismatch: expected=0.4.0 actual=0.4.2",
            rejected.stderr,
        )

    def test_expect_version_rejects_non_semver(self):
        result = run_check("--expect-version", "0.4")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("--expect-version must be semantic x.y.z", result.stderr)

    def test_upgrade_compare_accepts_identical_copy(self):
        with tempfile.TemporaryDirectory() as directory:
            copied = Path(directory) / SKILL_ROOT.name
            shutil.copytree(SKILL_ROOT, copied)
            result = run_check("--compare", str(copied), "--json")
        self.assertEqual(result.returncode, 0, result.stderr)
        summary = json.loads(result.stdout)
        self.assertEqual(summary["compare"], "no-differences")
        self.assertEqual(summary["installed_version"], "0.4.2")

    def test_upgrade_compare_rejects_different_skill(self):
        with tempfile.TemporaryDirectory() as directory:
            copied = Path(directory) / "xhgj-rd-guide"
            shutil.copytree(SKILL_ROOT, copied)
            contract_path = copied / "contract.yaml"
            contract = load_json_compatible(contract_path)
            contract["name"] = "xhgj-rd-guide"
            write_json(contract_path, contract)
            result = run_check("--compare", str(copied))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(
            "compare target skill mismatch: expected "
            "xhgj-gitlab-collaboration, got xhgj-rd-guide",
            result.stderr,
        )

    def test_upgrade_compare_accepts_lf_crlf_only_difference(self):
        with tempfile.TemporaryDirectory() as directory:
            copied = Path(directory) / SKILL_ROOT.name
            shutil.copytree(SKILL_ROOT, copied)
            source = SKILL_ROOT / "agents" / "openai.yaml"
            target = copied / "agents" / "openai.yaml"
            original = source.read_bytes()
            normalized = original.decode("utf-8").replace("\r\n", "\n")
            lf_bytes = normalized.encode("utf-8")
            crlf_bytes = normalized.replace("\n", "\r\n").encode("utf-8")
            target.write_bytes(lf_bytes if original != lf_bytes else crlf_bytes)
            self.assertNotEqual(original, target.read_bytes())
            result = run_check("--compare", str(copied))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('"compare": "no-differences"', result.stdout)
        self.assertIn('"installed_version": "0.4.2"', result.stdout)

    def test_case_matrix_covers_all_fail_closed_kinds(self):
        matrix = json.loads(
            (SKILL_ROOT / "tests/cases.json").read_text(encoding="utf-8")
        )
        cases = matrix["cases"]
        kinds = {case["kind"] for case in cases}
        self.assertTrue(check.REQUIRED_CASE_KINDS <= kinds)
        by_id = {case["id"]: case for case in cases}
        self.assertEqual(
            by_id["failure-write-readback"]["expected_action"],
            "mark-unknown-no-resend",
        )
        self.assertEqual(
            by_id["reject-high-impact-request"]["expected_action"],
            "refuse-high-impact-action",
        )
        self.assertEqual(
            by_id["positive-worktime-recording"]["expected_action"],
            "write-timelog-via-timelog-create-and-verify-three-faces",
        )
        self.assertEqual(
            by_id["degrade-worktime-unconfirmed"]["expected_action"],
            "draft-and-request-owner-confirmation",
        )
        self.assertEqual(
            by_id["reject-quick-action-injection"]["expected_action"],
            "refuse-quick-action-passthrough",
        )
        self.assertEqual(
            by_id["failure-worktime-readback-mismatch"]["expected_action"],
            "mark-unknown-no-resend",
        )
        deterministic = {case["id"]: case for case in matrix["deterministic_cases"]}
        self.assertEqual(set(deterministic), {
            "failure-bare-cross-project-ref",
            "failure-roundtrip-without-render-check",
            "failure-merge-gate-pipeline-only",
            "failure-merge-result-not-readback",
            "failure-render-readback-link-wrong-project",
        })

    def test_each_deterministic_mutation_is_detected(self):
        cases_path = SKILL_ROOT / "tests/cases.json"
        mutations = [
            (
                "failure-bare-cross-project-ref",
                "require_no_unconfirmed_bare_refs",
                lambda body, confirmed: None,
            ),
            (
                "failure-roundtrip-without-render-check",
                "require_render_target",
                lambda locator, actual: None,
            ),
            (
                "failure-merge-gate-pipeline-only",
                "validate_merge_gate",
                lambda value: None,
            ),
            (
                "failure-merge-result-not-readback",
                "validate_merge_result",
                lambda value: None,
            ),
            (
                "failure-render-readback-link-wrong-project",
                "require_render_target_project",
                lambda expected, actual: None,
            ),
        ]
        for case_id, target, replacement in mutations:
            with self.subTest(case_id=case_id), mock.patch.object(
                check, target, replacement
            ):
                with self.assertRaisesRegex(check.CheckError, case_id):
                    check.validate_cases(cases_path)


if __name__ == "__main__":
    unittest.main()
