#!/usr/bin/env python3
"""Regression tests for xhgj-governed-mail-distribution."""

from __future__ import annotations

import copy
import datetime as dt
import hashlib
import json
import os
import shutil
import smtplib
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
import render_mail  # noqa: E402
import render_real_usage  # noqa: E402
import resolve_thread  # noqa: E402
import self_check  # noqa: E402
import send_mail  # noqa: E402
import thread_record  # noqa: E402


ACCOUNT_ENV = "GMD_TEST_ACCOUNT"
TOKEN_ENV = "GMD_TEST_TOKEN"
SAMPLE_MARKDOWN = """# 示例材料

这是无业务含义的测试正文，包含 `inline` 代码和 **重点**。

## 检查项

1. 第一项

2. 第二项

| 文件 | 校验 |
| --- | --- |
| example.bin | sha256 |
"""


class FakeSMTP(object):
    instances = []

    def __init__(self, host, port):
        self.host = host
        self.port = port
        self.sent = []
        self.envelope_recipients = []
        FakeSMTP.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False

    def login(self, account, token):
        self.account = account

    def send_message(self, message, from_addr=None, to_addrs=None):
        self.sent.append(message)
        self.envelope_recipients.append(list(to_addrs or []))
        return {}


class DisconnectingSMTP(FakeSMTP):
    def send_message(self, message, from_addr=None, to_addrs=None):
        raise smtplib.SMTPServerDisconnected("connection lost mid-send")


def write_thread_record(
    directory,
    status="resolved",
    message_id="<origin@example.invalid>",
    candidate_count=1,
    selected_by="unique-match",
    include_body=False,
):
    record = {
        "schema_version": "1.0",
        "status": status,
        "source": {
            "adapter": "json",
            "retrieved_at": "2026-08-04T18:00:00+08:00",
            "limitations": [],
        },
        "query": {"clues": {"subject": "示例材料"}},
        "resolution": {
            "candidate_count": candidate_count,
            "selected_by": selected_by,
            "evidence": ["subject"],
        },
    }
    if status in ("resolved", "missing-rfc-message-id"):
        record["resolution"].update({
            "candidate_id": "FIXTURE-CANDIDATE",
            "field_status": {
                "message_id": "parsed" if message_id else "missing",
                "references": "derived-from-message-id",
                "recipient_matrix": "parsed",
                "attachments": "none",
            },
        })
        record["message"] = {
            "message_id": message_id,
            "references": [message_id] if message_id else [],
            "subject": "示例材料",
            "date": "2026-08-04T18:00:00+08:00",
            "from": ["sender@example.invalid"],
            "to": ["recipient-a@example.invalid"],
            "cc": [],
            "reply_to": [],
            "attachment_names": [],
        }
        if include_body:
            record["message"]["body"] = "must not persist"
    elif status == "ambiguous":
        record["candidates"] = [{
            "candidate_id": "FIXTURE-CANDIDATE",
            "subject": "示例材料",
            "date": "2026-08-04T18:00:00+08:00",
            "from": ["sender@example.invalid"],
            "to": ["recipient-a@example.invalid"],
            "attachment_names": [],
        }]
    path = Path(directory) / "thread-record.json"
    path.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def now_local():
    return dt.datetime.now(dt.timezone.utc).astimezone()


def base_plan(directory, purpose="formal", now=None):
    directory = Path(directory)
    body = directory / "body.md"
    body.write_text(SAMPLE_MARKDOWN, encoding="utf-8")
    now = now or now_local()
    return {
        "schema_version": "2.0",
        "plan_state": "send-ready",
        "purpose": purpose,
        "intent": "formal-delivery",
        "governance": {
            "playbook_locator": "docs/playbooks/enterprise-mail-delivery.md",
            "current_source_verified": True,
            "required_source_accessible": True,
            "conflict_detected": False,
            "migration_registered": True,
            "target_canonical": True,
            "activation_confirmed": True,
        },
        "thread": {
            "kind": "new",
            "record_path": None,
            "in_reply_to": None,
            "references": [],
        },
        "communication": {
            "addressing": {
                "selected": "您好",
                "source": "user-explicit",
                "previous": None,
                "override_reason": None,
            }
        },
        "presentation": {
            "body_mode": "multipart",
            "style_strategy": "reviewed-template",
            "template_id": "governed-mail-v1",
        },
        "mail": {
            "from": "sender@example.invalid",
            "to": ["recipient-a@example.invalid"],
            "cc": [],
            "bcc": [],
            "subject": "[EXAMPLE v0.1] 示例材料交付",
            "material_id": "example-asset",
            "version": "v0.1",
            "body_markdown": "body.md",
            "footer_note": "example-asset v0.1",
        },
        "attachments": [],
        "recipients_review": {
            "frozen_by_owner": True,
            "roles_confirmed": True,
            "unexpected_domain_confirmed": True,
            "bcc_justified": False,
        },
        "transport": {
            "protocol": "smtp-ssl",
            "host": "smtp.example.invalid",
            "port": 465,
        },
        "credentials": {
            "provider": "env",
            "account_ref": ACCOUNT_ENV,
            "token_ref": TOKEN_ENV,
        },
        "human_review": {
            "approved": True,
            "approved_at": (now - dt.timedelta(seconds=300)).isoformat(),
            "reviewer": "测试负责人",
            "review_form": "offline-preview",
            "payload_sha256": "",
        },
        "preview": {
            "reviewed": True,
            "reviewed_at": (now - dt.timedelta(seconds=900)).isoformat(),
            "payload_sha256": "",
        },
        "explicit_send_authorization": True,
        "final_payload_frozen": True,
        "internal_notes_removed": True,
    }


def seal(plan, directory):
    digest = preflight.payload_sha256(plan, directory)
    plan["human_review"]["payload_sha256"] = digest
    plan["preview"]["payload_sha256"] = digest
    return plan


def error_text(plan, directory):
    return "\n".join(preflight.validate(plan, base_dir=directory)[0])


class GovernedMailTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="gmd-test-"))
        self.receipts = self.tmp / "receipts"
        os.environ[ACCOUNT_ENV] = "selftest-account@example.invalid"
        os.environ[TOKEN_ENV] = "fixture-token-value"
        FakeSMTP.instances = []

    def tearDown(self):
        shutil.rmtree(str(self.tmp), ignore_errors=True)
        os.environ.pop(ACCOUNT_ENV, None)
        os.environ.pop(TOKEN_ENV, None)

    def plan(self, purpose="formal"):
        return seal(base_plan(self.tmp, purpose=purpose), self.tmp)

    def add_attachment(self, plan, payload=b"fixture-attachment"):
        path = self.tmp / "example.bin"
        path.write_bytes(payload)
        plan["attachments"] = [{
            "path": path.name,
            "size": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest().upper(),
        }]
        return path

    def execute(self, plan, factory=FakeSMTP, resend=False):
        return send_mail.send(
            plan,
            base_dir=self.tmp,
            receipt_dir=self.receipts,
            execute=True,
            resend_authorized=resend,
            smtp_factory=lambda host, port: factory(host, port),
        )


class PreflightTests(GovernedMailTestCase):
    def test_valid_send_ready_plan_passes(self):
        errors, _ = preflight.validate(self.plan(), base_dir=self.tmp)
        self.assertEqual(errors, [])

    def test_migration_registration_is_required(self):
        plan = self.plan()
        plan["governance"]["migration_registered"] = False
        seal(plan, self.tmp)
        self.assertIn("governance.migration_registered must be true", error_text(plan, self.tmp))

    def test_target_canonical_is_required(self):
        plan = self.plan()
        plan["governance"]["target_canonical"] = False
        seal(plan, self.tmp)
        self.assertIn("governance.target_canonical must be true", error_text(plan, self.tmp))

    def test_activation_is_required(self):
        plan = self.plan()
        plan["governance"]["activation_confirmed"] = False
        seal(plan, self.tmp)
        self.assertIn("governance.activation_confirmed must be true", error_text(plan, self.tmp))

    def test_required_source_unavailable_is_blocked(self):
        plan = self.plan()
        plan["governance"]["required_source_accessible"] = False
        seal(plan, self.tmp)
        self.assertIn("required_source_accessible must be true", error_text(plan, self.tmp))

    def test_payload_drift_invalidates_human_review_and_preview(self):
        plan = self.plan()
        plan["mail"]["subject"] = "[EXAMPLE v0.1] 已变化"
        errors = error_text(plan, self.tmp)
        self.assertIn("human_review.payload_sha256 does not match", errors)
        self.assertIn("preview.payload_sha256 does not match", errors)

    def test_preview_digest_is_independently_required(self):
        plan = self.plan()
        plan["preview"]["payload_sha256"] = "0" * 64
        self.assertIn("preview.payload_sha256 does not match", error_text(plan, self.tmp))

    def test_reply_requires_resolved_thread_record(self):
        plan = self.plan()
        plan["thread"] = {"kind": "reply", "record_path": None}
        seal(plan, self.tmp)
        self.assertIn("requires thread.record_path", error_text(plan, self.tmp))

    def test_ambiguous_thread_record_is_blocked(self):
        plan = self.plan()
        record = write_thread_record(
            self.tmp, status="ambiguous", candidate_count=2, selected_by=None
        )
        plan["thread"] = {"kind": "reply", "record_path": record.name}
        seal(plan, self.tmp)
        self.assertIn("thread record status is ambiguous", error_text(plan, self.tmp))

    def test_thread_record_with_body_is_blocked(self):
        plan = self.plan()
        record = write_thread_record(self.tmp, include_body=True)
        plan["thread"] = {"kind": "reply", "record_path": record.name}
        seal(plan, self.tmp)
        self.assertIn("must not persist body or credentials", error_text(plan, self.tmp))

    def test_resolved_reply_passes_and_sets_headers(self):
        plan = self.plan()
        record = write_thread_record(self.tmp)
        plan["thread"] = {"kind": "reply", "record_path": record.name}
        seal(plan, self.tmp)
        errors, _ = preflight.validate(plan, base_dir=self.tmp)
        self.assertEqual(errors, [])
        message = send_mail.build_message(
            plan, render_mail.render_plan(plan, self.tmp), self.tmp, attachments=[]
        )
        self.assertEqual(message["In-Reply-To"], "<origin@example.invalid>")

    def test_attachment_drift_is_blocked(self):
        plan = base_plan(self.tmp)
        path = self.add_attachment(plan)
        seal(plan, self.tmp)
        path.write_bytes(b"changed")
        self.assertIn("mismatch", error_text(plan, self.tmp))

    def test_duplicate_recipient_is_blocked(self):
        plan = self.plan()
        plan["mail"]["cc"] = ["recipient-a@example.invalid"]
        seal(plan, self.tmp)
        self.assertIn("duplicate recipient", error_text(plan, self.tmp))

    def test_bcc_requires_justification(self):
        plan = self.plan()
        plan["mail"]["bcc"] = ["hidden@example.invalid"]
        seal(plan, self.tmp)
        self.assertIn("bcc_justified is not true", error_text(plan, self.tmp))

    def test_credential_reference_must_be_environment_name(self):
        plan = self.plan()
        plan["credentials"]["token_ref"] = "not-valid"
        seal(plan, self.tmp)
        self.assertIn("environment variable NAME", error_text(plan, self.tmp))

    def test_formal_test_phrase_is_blocked(self):
        plan = base_plan(self.tmp)
        (self.tmp / "body.md").write_text("这是一封测试邮件。", encoding="utf-8")
        seal(plan, self.tmp)
        self.assertIn("formal body/subject contains test phrase", error_text(plan, self.tmp))

    def test_addressing_drift_warns_without_weakening_hard_gates(self):
        plan = self.plan()
        plan["communication"]["addressing"] = {
            "selected": "新称呼",
            "source": "scenario-default",
            "previous": "原称呼",
            "override_reason": None,
        }
        seal(plan, self.tmp)
        errors, warnings = preflight.validate(plan, base_dir=self.tmp)
        self.assertEqual(errors, [])
        self.assertTrue(any("addressing changed" in item for item in warnings))

    def test_cli_json_reports_payload_digest(self):
        plan = self.plan()
        path = self.tmp / "plan.json"
        path.write_text(json.dumps(plan, ensure_ascii=False), encoding="utf-8")
        result = subprocess.run(
            [
                sys.executable,
                "-X",
                "utf8",
                str(SCRIPTS / "preflight.py"),
                "--input",
                str(path),
                "--json",
            ],
            text=True,
            encoding="utf-8",
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        summary = json.loads(result.stdout)
        self.assertEqual(summary["status"], "pass")
        self.assertRegex(summary["payload_sha256"], r"^[0-9a-f]{64}$")


class ReleaseGateTests(GovernedMailTestCase):
    """Release state must be provably produced after the artifact it reviews."""

    def selftest_receipt(self, now):
        """Run a real selftest round through FakeSMTP to obtain a machine receipt."""
        plan = base_plan(self.tmp, purpose="selftest", now=now)
        plan["mail"]["to"] = [plan["mail"]["from"]]
        seal(plan, self.tmp)
        result = self.execute(plan)
        self.assertEqual(result["status"], "sent", result.get("errors"))
        return Path(result["receipt_path"])

    def formal_after_selftest(self, now, sent_at, reviewed_at, approved_at,
                              preview_at=None):
        receipt_path = self.selftest_receipt(now)
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        receipt["sent_at"] = sent_at.isoformat()
        receipt_path.write_text(
            json.dumps(receipt, ensure_ascii=False, indent=2), encoding="utf-8")
        plan = base_plan(self.tmp, now=now)
        plan["human_review"]["review_form"] = "selftest-mail"
        plan["human_review"]["approved_at"] = approved_at.isoformat()
        plan["preview"]["reviewed_at"] = (preview_at or sent_at).isoformat()
        plan["selftest_evidence"] = {
            "reviewed_by_owner": True,
            "reviewed_at": reviewed_at.isoformat(),
            "receipt": receipt_path.relative_to(self.tmp).as_posix(),
        }
        seal(plan, self.tmp)
        return plan

    def test_selftest_backed_release_passes_with_real_review_time(self):
        now = now_local()
        plan = self.formal_after_selftest(
            now,
            sent_at=now - dt.timedelta(seconds=3600),
            reviewed_at=now - dt.timedelta(seconds=2400),
            approved_at=now - dt.timedelta(seconds=1800),
        )
        errors, _ = preflight.validate(plan, base_dir=self.tmp, now=now)
        self.assertEqual(errors, [])

    def test_approval_without_timestamp_is_not_release_state(self):
        plan = base_plan(self.tmp)
        plan["human_review"]["approved_at"] = None
        seal(plan, self.tmp)
        self.assertIn("human_review.approved_at is required",
                      error_text(plan, self.tmp))

    def test_naive_timestamp_without_offset_is_rejected(self):
        plan = base_plan(self.tmp)
        plan["human_review"]["approved_at"] = "2026-08-05T10:00:00"
        seal(plan, self.tmp)
        self.assertIn("must carry an explicit UTC offset", error_text(plan, self.tmp))

    def test_future_approval_cannot_be_release_state(self):
        now = now_local()
        plan = base_plan(self.tmp, now=now)
        plan["human_review"]["approved_at"] = (
            now + dt.timedelta(seconds=1800)).isoformat()
        seal(plan, self.tmp)
        errors, _ = preflight.validate(plan, base_dir=self.tmp, now=now)
        self.assertTrue(
            any("human_review.approved_at is in the future" in item for item in errors),
            errors)

    def test_approval_before_preview_is_rejected(self):
        now = now_local()
        plan = base_plan(self.tmp, now=now)
        plan["preview"]["reviewed_at"] = (now - dt.timedelta(seconds=60)).isoformat()
        plan["human_review"]["approved_at"] = (
            now - dt.timedelta(seconds=900)).isoformat()
        seal(plan, self.tmp)
        errors, _ = preflight.validate(plan, base_dir=self.tmp, now=now)
        self.assertTrue(
            any("precedes preview.reviewed_at" in item for item in errors), errors)

    def test_approval_before_selftest_delivery_is_rejected(self):
        now = now_local()
        plan = self.formal_after_selftest(
            now,
            sent_at=now - dt.timedelta(seconds=1800),
            reviewed_at=now - dt.timedelta(seconds=900),
            approved_at=now - dt.timedelta(seconds=3600),
            preview_at=now - dt.timedelta(seconds=7200),
        )
        errors, _ = preflight.validate(plan, base_dir=self.tmp, now=now)
        self.assertTrue(
            any("precedes the selftest delivery it claims to approve" in item
                for item in errors), errors)

    def test_reviewed_state_predating_this_selftest_is_residue(self):
        now = now_local()
        plan = self.formal_after_selftest(
            now,
            sent_at=now - dt.timedelta(seconds=3600),
            reviewed_at=now - dt.timedelta(seconds=7200),
            approved_at=now - dt.timedelta(seconds=1800),
        )
        errors, _ = preflight.validate(plan, base_dir=self.tmp, now=now)
        self.assertTrue(
            any("residue from an earlier round" in item for item in errors), errors)

    def test_review_window_shorter_than_minimum_is_rejected(self):
        now = now_local()
        plan = self.formal_after_selftest(
            now,
            sent_at=now - dt.timedelta(seconds=120),
            reviewed_at=now - dt.timedelta(seconds=90),
            approved_at=now - dt.timedelta(seconds=60),
        )
        errors, _ = preflight.validate(plan, base_dir=self.tmp, now=now)
        self.assertTrue(
            any("leaves no real review time" in item for item in errors), errors)

    def test_offline_preview_gets_a_warning_not_a_hard_gate(self):
        now = now_local()
        plan = base_plan(self.tmp, now=now)
        plan["preview"]["reviewed_at"] = (now - dt.timedelta(seconds=70)).isoformat()
        plan["human_review"]["approved_at"] = (
            now - dt.timedelta(seconds=60)).isoformat()
        seal(plan, self.tmp)
        errors, warnings = preflight.validate(plan, base_dir=self.tmp, now=now)
        self.assertEqual(errors, [])
        self.assertTrue(
            any("must confirm that review time was real" in item for item in warnings),
            warnings)

    def test_release_gate_does_not_move_the_payload_digest(self):
        now = now_local()
        plan = base_plan(self.tmp, now=now)
        before = preflight.payload_sha256(plan, self.tmp)
        plan["human_review"]["approved_at"] = (
            now - dt.timedelta(seconds=7200)).isoformat()
        plan["preview"]["reviewed_at"] = (
            now - dt.timedelta(seconds=7300)).isoformat()
        self.assertEqual(preflight.payload_sha256(plan, self.tmp), before)


class RenderTests(GovernedMailTestCase):
    def test_blank_lines_between_items_keep_one_list(self):
        html_body = render_mail.md_to_html("1. 第一项\n\n2. 第二项\n\n3. 第三项")
        self.assertEqual(html_body.count("<ol "), 1)
        self.assertEqual(html_body.count("<li "), 3)

    def test_explicit_link_preserves_exact_href_boundary(self):
        html_body = render_mail.md_to_html(
            "[示例记录](https://example.invalid/task?a=1&b=2)"
        )
        self.assertIn('href="https://example.invalid/task?a=1&amp;b=2"', html_body)
        self.assertNotIn("&gt;</a>", html_body)

    def test_plain_mode_has_no_html_part(self):
        plan = self.plan()
        plan["intent"] = "acknowledgement"
        plan["presentation"] = {
            "body_mode": "plain",
            "style_strategy": "minimal",
            "template_id": None,
        }
        seal(plan, self.tmp)
        rendered = render_mail.render_plan(plan, self.tmp)
        self.assertIsNone(rendered["html"])
        self.assertIsNone(rendered["html_sha256"])


class ThreadDiscoveryTests(GovernedMailTestCase):
    def candidate(self, message_id, subject="示例材料"):
        return thread_record.candidate_from_mapping({
            "internetMessageId": message_id,
            "subject": subject,
            "date": "2026-08-04T18:00:00+08:00",
            "from": ["sender@example.invalid"],
            "to": ["recipient-a@example.invalid"],
            "attachments": ["example.bin"],
            "body": "must not enter the record",
        }, "json:fixture", "json")

    def test_unique_clue_resolves_without_body(self):
        record = thread_record.resolve_candidates(
            [self.candidate("<one@example.invalid>"), self.candidate("<two@example.invalid>", "其它")],
            {"subject": "示例材料"},
            "json",
        )
        self.assertEqual(record["status"], "resolved")
        self.assertNotIn("body", json.dumps(record))

    def test_ambiguous_candidates_expose_minimum_metadata(self):
        record = thread_record.resolve_candidates(
            [self.candidate("<one@example.invalid>"), self.candidate("<two@example.invalid>")],
            {"subject": "示例材料"},
            "json",
        )
        self.assertEqual(record["status"], "ambiguous")
        self.assertNotIn("message_id", record["candidates"][0])

    def test_dws_internal_message_id_is_not_rfc_message_id(self):
        candidate = thread_record.candidate_from_mapping({
            "messageId": "internal-fixture-id",
            "subject": "示例材料",
            "date": "2026-08-04T18:00:00+08:00",
            "from": ["sender@example.invalid"],
            "to": ["recipient-a@example.invalid"],
        }, "dws:fixture", "dws")
        record = thread_record.resolve_candidates([candidate], {"subject": "示例材料"}, "dws")
        self.assertEqual(record["status"], "missing-rfc-message-id")

    def test_existing_record_can_be_reused(self):
        path = write_thread_record(self.tmp)
        reused = resolve_thread.reuse_record(path)
        self.assertEqual(reused["resolution"]["selected_by"], "context-reuse")
        self.assertIn("reused_from_sha256", reused["source"])


class SendTests(GovernedMailTestCase):
    def test_preview_never_touches_smtp_or_receipts(self):
        result = send_mail.send(
            self.plan(), base_dir=self.tmp, receipt_dir=self.receipts, execute=False
        )
        self.assertEqual(result["status"], "preview")
        self.assertEqual(FakeSMTP.instances, [])
        self.assertFalse(self.receipts.exists())

    def test_sent_receipt_blocks_duplicate_without_authorization(self):
        plan = self.plan()
        first = self.execute(plan)
        self.assertEqual(first["status"], "sent")
        second = self.execute(plan)
        self.assertEqual(second["status"], "blocked")
        self.assertTrue(any("already sent" in item for item in second["errors"]))

    def test_uncertain_receipt_blocks_resend_even_when_requested(self):
        plan = self.plan()
        first = self.execute(plan, DisconnectingSMTP)
        self.assertEqual(first["status"], "uncertain_or_failed")
        second = self.execute(plan, FakeSMTP, resend=True)
        self.assertEqual(second["status"], "blocked")
        self.assertTrue(any("unresolved" in item for item in second["errors"]))

    def test_pending_receipt_blocks_send(self):
        plan = self.plan()
        self.receipts.mkdir()
        key = send_mail.receipt_key(plan)
        (self.receipts / (key + ".receipt.json")).write_text(
            json.dumps({"status": "pending"}), encoding="utf-8"
        )
        result = self.execute(plan)
        self.assertEqual(result["status"], "blocked")
        self.assertTrue(any("unresolved status pending" in item for item in result["errors"]))

    def test_missing_credentials_block_before_receipt(self):
        plan = self.plan()
        os.environ.pop(TOKEN_ENV, None)
        result = self.execute(plan)
        self.assertEqual(result["status"], "blocked")
        self.assertFalse(self.receipts.exists())

    def test_bcc_exists_only_in_smtp_envelope(self):
        plan = self.plan()
        plan["mail"]["bcc"] = ["hidden@example.invalid"]
        plan["recipients_review"]["bcc_justified"] = True
        seal(plan, self.tmp)
        result = self.execute(plan)
        self.assertEqual(result["status"], "sent")
        smtp = FakeSMTP.instances[-1]
        self.assertIn("hidden@example.invalid", smtp.envelope_recipients[0])
        self.assertIsNone(smtp.sent[0].get("Bcc"))


class SkillContractTests(unittest.TestCase):
    def test_self_check_reports_incubating_passed_and_verified_clients(self):
        summary = self_check.validate_skill(ROOT)
        self.assertEqual(summary["skill"], "xhgj-governed-mail-distribution")
        self.assertEqual(summary["status"], "incubating")
        self.assertEqual(summary["usage_status"], "passed")
        self.assertEqual(summary["clients"], ["codex", "claude-code"])

    def test_expect_version_cli(self):
        result = subprocess.run(
            [
                sys.executable,
                "-X",
                "utf8",
                str(SCRIPTS / "self_check.py"),
                "--expect-version",
                "0.2.2",
                "--json",
            ],
            text=True,
            encoding="utf-8",
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["expected_version"], "0.2.2")

    def test_compare_reports_installed_version(self):
        with tempfile.TemporaryDirectory() as directory:
            copied = Path(directory) / ROOT.name
            shutil.copytree(ROOT, copied)
            version = self_check.installed_version(copied)
            differences = self_check.compare_installation(
                ROOT, copied, self_check.validate_skill(ROOT)["protected_paths"]
            )
        self.assertEqual(version, "0.2.2")
        self.assertEqual(differences, [])

    def test_compare_target_name_guard(self):
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

    def _validate_with_contract_override(self, directory, **overrides):
        copied = Path(directory) / ROOT.name
        shutil.copytree(ROOT, copied)
        contract_path = copied / "contract.yaml"
        contract = self_check.load_json_compatible(contract_path)
        contract["real_usage"].update(overrides)
        contract_path.write_text(
            json.dumps(contract, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return self_check.validate_skill(copied)

    def test_review_status_passed_requires_passed_usage_status(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(
                self_check.CheckError, "must also record a passed status"
            ):
                self._validate_with_contract_override(directory, status="executed")

    def test_review_status_rejects_unknown_value(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(
                self_check.CheckError, "not an admitted value"
            ):
                self._validate_with_contract_override(
                    directory, review_status="approved"
                )

    def test_usage_status_cannot_regress_below_executed(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(
                self_check.CheckError, "executed or passed"
            ):
                self._validate_with_contract_override(
                    directory, status="pending", review_status="pending-maintainer-review"
                )

    def test_maintainer_review_does_not_promote_the_lifecycle(self):
        with tempfile.TemporaryDirectory() as directory:
            copied = Path(directory) / ROOT.name
            shutil.copytree(ROOT, copied)
            contract_path = copied / "contract.yaml"
            contract = self_check.load_json_compatible(contract_path)
            self.assertEqual(contract["real_usage"]["review_status"], "passed")
            contract["status"] = "active"
            contract_path.write_text(
                json.dumps(contract, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(
                self_check.CheckError, "must remain incubating"
            ):
                self_check.validate_skill(copied)

    def test_client_claim_without_three_layer_evidence_is_blocked(self):
        contract_path = ROOT / "contract.yaml"
        contract = self_check.load_json_compatible(contract_path)
        changed = copy.deepcopy(contract)
        changed["compatibility"]["client_verification"]["results"] = []
        with self.assertRaisesRegex(self_check.CheckError, "must exactly match"):
            self_check.validate_client_verification(
                changed["compatibility"]["client_verification"],
                changed["compatibility"]["clients"],
            )

    def test_codex_claim_has_all_required_layers_and_limitations(self):
        contract = self_check.load_json_compatible(ROOT / "contract.yaml")
        result = contract["compatibility"]["client_verification"]["results"][0]
        self.assertEqual(result["client"], "codex")
        self.assertEqual(result["verified_layers"], self_check.REQUIRED_CLIENT_LAYERS)
        self.assertGreaterEqual(len(result["limitations"]), 3)

    def test_claude_code_claim_has_all_required_layers_and_limitations(self):
        contract = self_check.load_json_compatible(ROOT / "contract.yaml")
        result = contract["compatibility"]["client_verification"]["results"][1]
        self.assertEqual(result["client"], "claude-code")
        self.assertEqual(result["verified_layers"], self_check.REQUIRED_CLIENT_LAYERS)
        self.assertGreaterEqual(len(result["limitations"]), 3)
        self.assertEqual(
            result["evidence"],
            ["skill:tests/fixtures/real-usage-0.2.0-claude-code.json"],
        )
        self.assertTrue(
            (ROOT / "tests" / "fixtures" / "real-usage-0.2.0-claude-code.json").exists()
        )

    def test_real_usage_projection_is_deterministic(self):
        render_real_usage.check_projection(
            ROOT / "tests" / "fixtures" / "real-usage.json",
            ROOT / "tests" / "fixtures" / "real-usage.md",
        )

    def test_case_registry_covers_required_failures(self):
        routing_count, preflight_count = self_check.validate_cases(
            ROOT / "tests" / "cases.json"
        )
        self.assertGreaterEqual(routing_count, 5)
        self.assertGreaterEqual(preflight_count, 22)


if __name__ == "__main__":
    unittest.main()
