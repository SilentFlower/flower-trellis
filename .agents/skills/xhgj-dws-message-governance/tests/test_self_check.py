#!/usr/bin/env python3
"""Regression tests for xhgj-dws-message-governance."""

from __future__ import annotations

import copy
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import preflight  # noqa: E402
import render_real_usage  # noqa: E402
import self_check  # noqa: E402


def valid_plan():
    plan = {
        "schema_version": 1,
        "message_state": "send-ready",
        "governance": {
            "standard_locator": "docs/standards/dingtalk-message-governance.md",
            "playbook_locator": "docs/playbooks/dws-message-delivery.md",
            "current_source_verified": True,
            "required_source_accessible": True,
            "conflict_detected": False,
        },
        "dws_runtime": {
            "installed": True,
            "authenticated": True,
            "organization_confirmed": True,
            "version": "v-test-1",
            "commands_rechecked": True,
        },
        "target": {
            "type": "group",
            "identifier": "group-fixture-001",
            "confirmed": True,
        },
        "recipients": {
            "to": [],
            "cc": [],
            "fyi": [{"label": "群内成员"}],
            "all_members_role": "none",
        },
        "message_profile": "notification",
        "profile_contract": {
            "change": "测试规则更新",
            "impact": "仅测试 fixture",
            "action_requirement": "无需行动",
        },
        "recipient_review": {
            "need_is_clear": True,
            "action_is_clear": True,
            "mobile_readable": True,
            "references_accessible": True,
            "sensitive_content_removed": True,
        },
        "title": "测试通知",
        "message_type": "text",
        "text": "这是一条不执行真实发送的测试通知。",
        "payload_ref": "",
        "ai_tag": True,
        "uuid": "fixture-uuid-0001",
        "explicit_send_authorization": True,
        "human_review": {
            "approved": True,
            "reviewer": "测试负责人",
            "payload_sha256": "",
        },
        "dry_run": {"reviewed": True, "payload_sha256": ""},
        "final_payload_frozen": True,
        "internal_notes_removed": True,
        "at_all": False,
        "at_open_dingtalk_ids": [],
        "mention_verification": {},
        "requires_response": False,
        "response": {},
        "transport": "single-line",
        "post_send_readback": {
            "planned": True,
            "method": "chat message list",
            "non_first_line_check": False,
        },
    }
    return seal(plan)


def valid_bootstrap_plan():
    plan = valid_plan()
    plan["message_state"] = "mention-bootstrap-ready"
    plan["recipients"] = {
        "to": [],
        "cc": [
            {
                "label": "测试参与者",
                "open_dingtalk_id": "fixture-person-1",
            }
        ],
        "fyi": [],
        "all_members_role": "none",
    }
    plan["message_profile"] = "mention-bootstrap"
    plan["profile_contract"] = {
        "test_purpose": "named-mention-rendering",
        "authorization_locator": "fixture:request-authorization",
        "test_recipient_open_dingtalk_ids": ["fixture-person-1"],
        "participants_confirmed": True,
        "minimum_disclosure_confirmed": True,
        "business_action_present": False,
        "pre_send_duplicate_check_completed": True,
        "duplicate_check_locator": "fixture:uuid-duplicate-check",
        "evidence_output_locator": "fixture:bootstrap-evidence",
        "recipient_delivery_confirmation_planned": True,
    }
    plan["title"] = "具名提醒受控测试"
    plan["text"] = "【具名提醒受控测试】<@fixture-person-1> 请观察本次测试提醒。"
    plan["at_open_dingtalk_ids"] = ["fixture-person-1"]
    plan["mention_verification"] = {}
    return seal(plan)


def seal(plan):
    digest = preflight.payload_sha256(plan)
    plan["human_review"]["payload_sha256"] = digest
    plan["dry_run"]["payload_sha256"] = digest
    return plan


def error_text(plan):
    return "\n".join(preflight.validate_plan(plan)["errors"])


class PreflightTests(unittest.TestCase):
    def test_valid_send_ready_plan_passes(self):
        summary = preflight.validate_plan(valid_plan())
        self.assertEqual(summary["status"], "pass")
        self.assertEqual(summary["errors"], [])

    def test_draft_is_blocked(self):
        plan = valid_plan()
        plan["message_state"] = "draft"
        self.assertIn("message_state must be send-ready", error_text(plan))

    def test_required_source_unavailable_is_blocked(self):
        plan = valid_plan()
        plan["governance"]["required_source_accessible"] = False
        self.assertIn("required_source_accessible must be true", error_text(plan))

    def test_payload_drift_invalidates_review_and_dry_run(self):
        plan = valid_plan()
        plan["text"] = "载荷在 review 后发生了变化。"
        errors = error_text(plan)
        self.assertIn("human_review.payload_sha256 does not match", errors)
        self.assertIn("dry_run.payload_sha256 does not match", errors)

    def test_named_mentions_must_match_recipients(self):
        plan = valid_plan()
        plan["recipients"] = {
            "to": [{"label": "执行人", "open_dingtalk_id": "fixture-person-1"}],
            "cc": [],
            "fyi": [],
            "all_members_role": "none",
        }
        plan["text"] = "<@fixture-person-1> 请确认。"
        plan["mention_verification"] = {
            "post_send_readback_planned": True,
            "controlled_recipient_test_confirmed": True,
            "tested_dws_version": "v-test-1",
            "evidence_locator": "fixture:controlled-recipient-test",
        }
        plan["requires_response"] = True
        plan["response"] = {
            "deadline": "2026-08-04T18:00:00+08:00",
            "deadline_policy": "",
            "method": "引用回复",
            "minimum_response": "确认或提出异议",
            "non_response_policy": "按未确认处理",
            "closer": "测试负责人",
        }
        seal(plan)
        self.assertIn(
            "must exactly match named TO/CC recipients", error_text(plan)
        )

    def test_named_mentions_pass_when_three_surfaces_match(self):
        plan = valid_plan()
        plan["recipients"] = {
            "to": [{"label": "执行人", "open_dingtalk_id": "fixture-person-1"}],
            "cc": [],
            "fyi": [],
            "all_members_role": "none",
        }
        plan["text"] = "<@fixture-person-1> 请确认。"
        plan["at_open_dingtalk_ids"] = ["fixture-person-1"]
        plan["mention_verification"] = {
            "post_send_readback_planned": True,
            "controlled_recipient_test_confirmed": True,
            "tested_dws_version": "v-test-1",
            "evidence_locator": "fixture:controlled-recipient-test",
        }
        plan["requires_response"] = True
        plan["response"] = {
            "deadline": "2026-08-04T18:00:00+08:00",
            "deadline_policy": "",
            "method": "引用回复",
            "minimum_response": "确认或提出异议",
            "non_response_policy": "按未确认处理",
            "closer": "测试负责人",
        }
        seal(plan)
        self.assertEqual(preflight.validate_plan(plan)["status"], "pass")

    def test_first_named_mention_bootstrap_passes(self):
        summary = preflight.validate_plan(valid_bootstrap_plan())
        self.assertEqual(summary["status"], "pass")
        evidence = summary["bootstrap_evidence_template"]
        self.assertEqual(evidence["status"], "pending-test-execution")
        self.assertFalse(evidence["eligible_for_ordinary_send"])
        self.assertEqual(evidence["authorization"]["status"], "confirmed")

    def test_ordinary_named_mention_without_existing_evidence_still_fails(self):
        plan = valid_plan()
        plan["recipients"] = {
            "to": [],
            "cc": [
                {
                    "label": "接收人",
                    "open_dingtalk_id": "fixture-person-1",
                }
            ],
            "fyi": [],
            "all_members_role": "none",
        }
        plan["text"] = "<@fixture-person-1> 请知悉。"
        plan["at_open_dingtalk_ids"] = ["fixture-person-1"]
        plan["mention_verification"] = {
            "post_send_readback_planned": True,
            "controlled_recipient_test_confirmed": False,
            "tested_dws_version": "v-test-1",
            "evidence_locator": "",
        }
        seal(plan)
        errors = error_text(plan)
        self.assertIn("controlled_recipient_test_confirmed must be true", errors)
        self.assertIn("evidence_locator must be a non-empty string", errors)

    def test_bootstrap_with_business_action_is_blocked(self):
        plan = valid_bootstrap_plan()
        plan["profile_contract"]["business_action_present"] = True
        self.assertIn("business_action_present must be false", error_text(plan))

    def test_bootstrap_without_authorization_locator_is_blocked(self):
        plan = valid_bootstrap_plan()
        plan["profile_contract"]["authorization_locator"] = ""
        self.assertIn("authorization_locator must be a non-empty string", error_text(plan))

    def test_bootstrap_does_not_reuse_completed_test_assertion(self):
        plan = valid_bootstrap_plan()
        plan["mention_verification"] = {
            "post_send_readback_planned": True,
            "controlled_recipient_test_confirmed": True,
            "tested_dws_version": "v-test-1",
            "evidence_locator": "fixture:existing-evidence",
        }
        self.assertIn(
            "mention_verification must be empty for mention bootstrap",
            error_text(plan),
        )

    def test_bootstrap_cannot_mention_non_test_recipient(self):
        plan = valid_bootstrap_plan()
        plan["recipients"]["cc"].append(
            {
                "label": "非测试接收人",
                "open_dingtalk_id": "fixture-person-2",
            }
        )
        plan["at_open_dingtalk_ids"].append("fixture-person-2")
        plan["text"] += " <@fixture-person-2>"
        seal(plan)
        self.assertIn(
            "test_recipient_open_dingtalk_ids must exactly match named TO/CC recipients",
            error_text(plan),
        )

    def test_bootstrap_evidence_keeps_recipient_confirmation_independent(self):
        plan = valid_bootstrap_plan()
        result = {
            "schema_version": 1,
            "message_id": "fixture-message-1",
            "sent_at": "2026-08-04T14:00:00+08:00",
            "technical_readback": {
                "status": "passed",
                "locator": "fixture:technical-readback",
                "rendered_open_dingtalk_ids": ["fixture-person-1"],
            },
            "recipient_delivery_confirmation": {
                "status": "pending",
                "locator": "",
            },
        }
        evidence, errors = preflight.validate_bootstrap_result(plan, result)
        self.assertEqual(errors, [])
        self.assertEqual(evidence["technical_readback"]["status"], "passed")
        self.assertEqual(
            evidence["recipient_delivery_confirmation"]["status"], "pending"
        )
        self.assertFalse(evidence["eligible_for_ordinary_send"])

        result["recipient_delivery_confirmation"] = {
            "status": "confirmed",
            "locator": "fixture:recipient-confirmation",
        }
        evidence, errors = preflight.validate_bootstrap_result(plan, result)
        self.assertEqual(errors, [])
        self.assertTrue(evidence["eligible_for_ordinary_send"])

    def test_cli_renders_structured_bootstrap_evidence(self):
        plan = valid_bootstrap_plan()
        result_payload = {
            "schema_version": 1,
            "message_id": "fixture-message-1",
            "sent_at": "2026-08-04T14:00:00+08:00",
            "technical_readback": {
                "status": "passed",
                "locator": "fixture:technical-readback",
                "rendered_open_dingtalk_ids": ["fixture-person-1"],
            },
            "recipient_delivery_confirmation": {
                "status": "pending",
                "locator": "",
            },
        }
        with tempfile.TemporaryDirectory() as directory:
            plan_path = Path(directory) / "plan.json"
            result_path = Path(directory) / "result.json"
            plan_path.write_text(
                json.dumps(plan, ensure_ascii=False), encoding="utf-8"
            )
            result_path.write_text(
                json.dumps(result_payload, ensure_ascii=False), encoding="utf-8"
            )
            result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPTS / "preflight.py"),
                    "--input",
                    str(plan_path),
                    "--bootstrap-result",
                    str(result_path),
                    "--json",
                ],
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        summary = json.loads(result.stdout)
        self.assertEqual(summary["bootstrap_evidence"]["status"], "awaiting-recipient-confirmation")
        self.assertFalse(summary["bootstrap_evidence"]["eligible_for_ordinary_send"])

    def test_manual_at_all_text_is_blocked(self):
        plan = valid_plan()
        plan["recipients"] = {
            "to": [],
            "cc": [],
            "fyi": [],
            "all_members_role": "cc",
        }
        plan["at_all"] = True
        plan["text"] = "@所有人 请知悉。"
        plan["mention_verification"] = {
            "post_send_readback_planned": True,
            "controlled_recipient_test_confirmed": True,
            "tested_dws_version": "v-test-1",
            "evidence_locator": "fixture:controlled-recipient-test",
        }
        seal(plan)
        self.assertIn("manual all-member mention", error_text(plan))

    def test_multiline_cmd_shim_is_blocked(self):
        plan = valid_plan()
        plan["text"] = "第一行\n\n第二行"
        plan["post_send_readback"]["non_first_line_check"] = True
        seal(plan)
        self.assertIn(
            "multiline text requires node-entry or native-binary transport",
            error_text(plan),
        )

    def test_non_one_ordered_list_requires_blank_line(self):
        plan = valid_plan()
        plan["text"] = "说明\n2. 第二项"
        plan["transport"] = "node-entry"
        plan["post_send_readback"]["non_first_line_check"] = True
        seal(plan)
        self.assertIn(
            "non-1 Markdown ordered list must start after a blank line",
            error_text(plan),
        )

    def test_multiline_non_first_line_readback_is_required(self):
        plan = valid_plan()
        plan["text"] = "第一行\n\n第二行"
        plan["transport"] = "node-entry"
        plan["post_send_readback"]["non_first_line_check"] = False
        seal(plan)
        self.assertIn("non-first-line readback check", error_text(plan))

    def test_direct_message_requires_one_implicit_to(self):
        plan = valid_plan()
        plan["target"] = {
            "type": "direct",
            "identifier": "direct-fixture-001",
            "confirmed": True,
        }
        plan["recipients"] = {
            "to": [{"label": "接收人"}],
            "cc": [],
            "fyi": [],
            "all_members_role": "none",
        }
        plan["requires_response"] = True
        plan["response"] = {
            "deadline": "",
            "deadline_policy": "请在方便时回复",
            "method": "直接回复",
            "minimum_response": "给出结论",
            "non_response_policy": "保持未确认",
            "closer": "发起人",
        }
        plan["post_send_readback"]["method"] = "chat message list-direct"
        seal(plan)
        self.assertEqual(preflight.validate_plan(plan)["status"], "pass")

    def test_cli_json_reports_payload_digest(self):
        plan = valid_plan()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "plan.json"
            path.write_text(json.dumps(plan, ensure_ascii=False), encoding="utf-8")
            result = subprocess.run(
                [sys.executable, str(SCRIPTS / "preflight.py"), "--input", str(path), "--json"],
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        summary = json.loads(result.stdout)
        self.assertEqual(summary["status"], "pass")
        self.assertRegex(summary["payload_sha256"], r"^[0-9a-f]{64}$")


class SkillContractTests(unittest.TestCase):
    def test_self_check_passes_and_reports_incubating(self):
        summary = self_check.validate_skill(ROOT)
        self.assertEqual(summary["skill"], "xhgj-dws-message-governance")
        self.assertEqual(summary["status"], "incubating")
        self.assertEqual(summary["usage_status"], "executed")

    def test_expect_version_cli(self):
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPTS / "self_check.py"),
                "--expect-version",
                "0.2.0",
                "--json",
            ],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["expected_version"], "0.2.0")

    def test_compare_reports_installed_version(self):
        with tempfile.TemporaryDirectory() as directory:
            copied = Path(directory) / ROOT.name
            shutil.copytree(ROOT, copied)
            version = self_check.installed_version(copied)
            differences = self_check.compare_installation(
                ROOT,
                copied,
                self_check.validate_skill(ROOT)["protected_paths"],
            )
        self.assertEqual(version, "0.2.0")
        self.assertEqual(differences, [])

    def test_compare_target_skill_name_guard(self):
        with tempfile.TemporaryDirectory() as directory:
            copied = Path(directory) / ROOT.name
            shutil.copytree(ROOT, copied)
            contract_path = copied / "contract.yaml"
            contract = self_check.load_json_compatible(contract_path)
            contract["name"] = "xhgj-rd-guide"
            contract_path.write_text(
                json.dumps(contract, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(self_check.CheckError, "skill mismatch"):
                self_check.installed_version(copied)

    def test_compare_detects_protected_difference(self):
        with tempfile.TemporaryDirectory() as directory:
            copied = Path(directory) / ROOT.name
            shutil.copytree(ROOT, copied)
            with (copied / "SKILL.md").open("a", encoding="utf-8") as handle:
                handle.write("\nlocal difference\n")
            differences = self_check.compare_installation(
                ROOT,
                copied,
                self_check.validate_skill(ROOT)["protected_paths"],
            )
        self.assertIn("SKILL.md", differences)

    def test_real_usage_projection_is_deterministic(self):
        render_real_usage.check_projection(
            ROOT / "tests" / "fixtures" / "real-usage.json",
            ROOT / "tests" / "fixtures" / "real-usage.md",
        )

    def test_real_usage_metadata_two_red_one_green(self):
        evidence = self_check.load_json_compatible(
            ROOT / "tests/fixtures/real-usage.json"
        )
        metadata = evidence["usage_metadata"]
        missing = copy.deepcopy(metadata)
        missing.pop("client_version")
        with self.assertRaisesRegex(self_check.CheckError, "fields must be exactly"):
            self_check.validate_usage_metadata(missing, evidence["skill_version"])

        invalid = copy.deepcopy(metadata)
        invalid["client_version"] = {"unavailable": "future-enum"}
        with self.assertRaisesRegex(self_check.CheckError, "unavailable is invalid"):
            self_check.validate_usage_metadata(invalid, evidence["skill_version"])

        non_blocking = copy.deepcopy(metadata)
        non_blocking["operating_system"] = {"unavailable": "not-collected"}
        self_check.validate_usage_metadata(non_blocking, evidence["skill_version"])

    def test_case_registry_covers_required_failures(self):
        routing_count, preflight_count = self_check.validate_cases(
            ROOT / "tests" / "cases.json"
        )
        self.assertGreaterEqual(routing_count, 3)
        self.assertGreaterEqual(preflight_count, 13)


if __name__ == "__main__":
    unittest.main()
