#!/usr/bin/env python3
"""Validate a frozen governed mail plan before any real SMTP send."""

import argparse
import datetime
import hashlib
import json
from pathlib import Path
import re

import mail_contract
import thread_record


ADDRESS_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
ENV_NAME_RE = re.compile(r"^[A-Z][A-Z0-9_]{2,}$")
STRUCTURED_MARKDOWN_RE = re.compile(
    r"(?m)^(?:#{1,4}\s+|```|\s*\|.+\|\s*$|\s*[-*]\s+|\s*\d+[.)]\s+)"
)
ANGLE_AUTOLINK_RE = re.compile(r"<https?://[^>\n]+>")
FORBIDDEN_FORMAL_PHRASES = (
    "自发自收",
    "排版测试",
    "不构成正式发布",
    "测试邮件",
    "仅供测试",
)
PLAYBOOK_LOCATOR = "docs/playbooks/enterprise-mail-delivery.md"
GOVERNANCE_KEYS = {
    "playbook_locator",
    "current_source_verified",
    "required_source_accessible",
    "conflict_detected",
    "migration_registered",
    "target_canonical",
    "activation_confirmed",
}
HUMAN_REVIEW_KEYS = {"approved", "approved_at", "reviewer", "review_form", "payload_sha256"}
PREVIEW_KEYS = {"reviewed", "reviewed_at", "payload_sha256"}
# 放行门禁：自测投递与正式投递之间必须存在负责人可能完成 review 的真实时间。
MIN_SELFTEST_REVIEW_SECONDS = 300
# 只吸收本机与回执之间的时钟抖动，不足以掩盖预置。
FUTURE_TOLERANCE_SECONDS = 60


def load_plan(path):
    with open(str(path), "r", encoding="utf-8") as handle:
        return json.load(handle)


def normalized_json_sha256(value):
    payload = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256((payload + "\n").encode("utf-8")).hexdigest()


def relative_file(path_value, base_dir):
    if not isinstance(path_value, str) or not path_value.strip():
        return None
    path = Path(path_value)
    if base_dir and not path.is_absolute():
        path = Path(base_dir) / path
    return path


def file_sha256(path_value, base_dir):
    path = relative_file(path_value, base_dir)
    if path is None or not path.is_file():
        return None
    return hashlib.sha256(path.read_bytes()).hexdigest().upper()


def canonical_payload(plan, base_dir=None):
    mail = plan.get("mail", {}) if isinstance(plan.get("mail"), dict) else {}
    thread = mail_contract.resolve_thread(plan, base_dir)
    thread_record_digest = None
    if not mail_contract.is_legacy(plan):
        thread_record_digest = file_sha256(
            mail_contract.raw_thread(plan).get("record_path"), base_dir
        )
    attachments = []
    for item in plan.get("attachments", []):
        if not isinstance(item, dict):
            continue
        raw_path = item.get("path")
        attachments.append({
            "name": Path(raw_path).name if isinstance(raw_path, str) else "",
            "size": item.get("size"),
            "sha256": str(item.get("sha256", "")).upper(),
        })
    review = plan.get("human_review", {})
    if not isinstance(review, dict):
        review = {}
    selftest = plan.get("selftest_evidence")
    selftest_receipt_sha256 = None
    if isinstance(selftest, dict):
        selftest_receipt_sha256 = file_sha256(selftest.get("receipt"), base_dir)
    return {
        "schema_version": mail_contract.schema_version(plan),
        "plan_state": plan.get("plan_state"),
        "purpose": plan.get("purpose"),
        "intent": mail_contract.resolve_intent(plan),
        "governance": plan.get("governance"),
        "thread": thread,
        "thread_record_sha256": thread_record_digest,
        "communication": plan.get("communication"),
        "presentation": mail_contract.resolve_presentation(plan),
        "mail": {
            "from": mail.get("from"),
            "to": mail.get("to"),
            "cc": mail.get("cc"),
            "bcc": mail.get("bcc"),
            "subject": mail.get("subject"),
            "material_id": mail.get("material_id"),
            "version": mail.get("version"),
            "footer_note": mail.get("footer_note"),
            "body_source_sha256": file_sha256(mail.get("body_markdown"), base_dir),
        },
        "attachments": attachments,
        "recipients_review": plan.get("recipients_review"),
        "transport": plan.get("transport"),
        "credentials": plan.get("credentials"),
        "review_form": review.get("review_form"),
        "selftest_receipt_sha256": selftest_receipt_sha256,
    }


def payload_sha256(plan, base_dir=None):
    return normalized_json_sha256(canonical_payload(plan, base_dir))


def require_true(plan, dotted, errors, message=None):
    value = plan
    for part in dotted.split("."):
        if not isinstance(value, dict) or part not in value:
            errors.append(message or ("missing required field: %s" % dotted))
            return
        value = value[part]
    if value is not True:
        errors.append(message or ("field must be true: %s" % dotted))


def object_field(plan, field, errors):
    value = plan.get(field)
    if not isinstance(value, dict):
        errors.append("missing or invalid object field: %s" % field)
        return {}
    return value


def non_empty_string(container, field, prefix, errors):
    value = container.get(field)
    if not isinstance(value, str) or not value.strip():
        errors.append("missing or empty field: %s.%s" % (prefix, field))
        return ""
    return value.strip()


def validate_schema(plan, errors, warnings):
    version = mail_contract.schema_version(plan)
    if mail_contract.is_legacy(plan):
        warnings.append(
            "legacy schema v1 plan: inferred formal-delivery + multipart + "
            "reviewed-template; add schema_version=2.0, intent, thread, "
            "communication.addressing and presentation before changing behavior"
        )
        return
    if version != mail_contract.CURRENT_SCHEMA_VERSION:
        errors.append(
            "schema_version must be %s or a legacy v1 value, got %r"
            % (mail_contract.CURRENT_SCHEMA_VERSION, version)
        )


def validate_governance(plan, errors):
    governance = object_field(plan, "governance", errors)
    if set(governance) != GOVERNANCE_KEYS:
        errors.append("governance fields must be exactly %s" % sorted(GOVERNANCE_KEYS))
    if governance.get("playbook_locator") != PLAYBOOK_LOCATOR:
        errors.append("governance.playbook_locator must identify the enterprise mail Playbook")
    for field in (
        "current_source_verified",
        "required_source_accessible",
        "migration_registered",
        "target_canonical",
        "activation_confirmed",
    ):
        if governance.get(field) is not True:
            errors.append("governance.%s must be true" % field)
    if governance.get("conflict_detected") is not False:
        errors.append("governance.conflict_detected must be false")


def validate_recipients(plan, mail, errors):
    sender = mail.get("from", "")
    to = mail.get("to")
    cc = mail.get("cc", [])
    bcc = mail.get("bcc", [])
    if not isinstance(to, list) or not to:
        errors.append("mail.to must be a non-empty list")
        to = []
    for label, group in (("to", to), ("cc", cc), ("bcc", bcc)):
        if not isinstance(group, list):
            errors.append("mail.%s must be a list" % label)
            continue
        for address in group:
            if not isinstance(address, str) or not ADDRESS_RE.match(address):
                errors.append("invalid address in mail.%s: %r" % (label, address))
    all_addresses = [a.lower() for a in list(to) + list(cc) + list(bcc)
                     if isinstance(a, str)]
    duplicates = sorted({a for a in all_addresses if all_addresses.count(a) > 1})
    for address in duplicates:
        errors.append("duplicate recipient across to/cc/bcc: %s" % address)

    review = object_field(plan, "recipients_review", errors)
    for field in ("frozen_by_owner", "roles_confirmed", "unexpected_domain_confirmed"):
        if review.get(field) is not True:
            errors.append("recipients_review.%s must be true" % field)
    if bcc and review.get("bcc_justified") is not True:
        errors.append("mail.bcc is non-empty but recipients_review.bcc_justified is not true")

    if plan.get("purpose") == "selftest":
        others = [a for a in all_addresses if a != sender.lower()]
        if others or len(to) != 1:
            errors.append("selftest recipients must be exactly the sender itself")


def validate_thread(plan, errors, warnings, base_dir):
    raw = mail_contract.raw_thread(plan)
    thread = mail_contract.resolve_thread(plan, base_dir)
    if not thread:
        field = "mail.thread" if mail_contract.is_legacy(plan) else "thread"
        errors.append("%s must be an object with an explicit kind" % field)
        return
    kind = thread.get("kind")
    if not mail_contract.is_legacy(plan):
        record_path = raw.get("record_path")
        if kind in ("reply", "update"):
            if not isinstance(record_path, str) or not record_path.strip():
                errors.append(
                    "thread.kind=%s requires thread.record_path to a resolved "
                    "thread record; reuse prior read metadata or run resolve_thread.py "
                    "before asking the user for an RFC Message-ID" % kind
                )
                return
            record, _, record_error = mail_contract.load_thread_record(plan, base_dir)
            if record_error:
                errors.append("cannot read thread.record_path: %s" % record_error)
                return
            record_problems = thread_record.record_errors(record)
            if record_problems:
                errors.extend("invalid thread record: %s" % item
                              for item in record_problems)
                return
            if record.get("status") != "resolved":
                errors.append(
                    "thread record status is %s; add business clues or select a "
                    "unique candidate before preparing a reply"
                    % record.get("status")
                )
                return
            source = record.get("source", {})
            resolution = record.get("resolution", {})
            if source.get("adapter") == "pop3":
                warnings.append(
                    "thread resolved through POP3; only recent INBOX messages were "
                    "searchable, so sent/archive coverage remains unverified"
                )
            if resolution.get("selected_by") not in (
                    "context-reuse", "unique-match", "owner-selection"):
                errors.append(
                    "thread record resolution.selected_by must prove context reuse, "
                    "a unique match, or explicit owner selection"
                )
            if resolution.get("field_status", {}).get("message_id") != "parsed":
                errors.append(
                    "thread record field_status.message_id must be parsed before send"
                )
            message = record.get("message", {})
            record_message_id = message.get("message_id")
            explicit_message_id = raw.get("in_reply_to")
            if (isinstance(explicit_message_id, str) and explicit_message_id.strip()
                    and explicit_message_id != record_message_id):
                errors.append(
                    "thread.in_reply_to conflicts with the persisted thread record"
                )
            explicit_references = raw.get("references")
            if isinstance(explicit_references, list) and explicit_references:
                if explicit_references != message.get("references"):
                    errors.append(
                        "thread.references conflicts with the persisted thread record"
                    )
        elif kind == "new" and record_path:
            errors.append("thread.kind=new must not set thread.record_path")
    in_reply_to = thread.get("in_reply_to", "")
    references = thread.get("references", [])
    if not isinstance(references, list):
        errors.append("thread.references must be a list")
        references = []
    else:
        for item in references:
            if not isinstance(item, str) or not item.strip():
                errors.append("thread.references entries must be non-empty strings")
    reply_kinds = ("update",) if mail_contract.is_legacy(plan) else ("reply", "update")
    if kind in reply_kinds:
        if not isinstance(in_reply_to, str) or not in_reply_to.strip():
            errors.append("thread.kind=%s requires in_reply_to of the original mail" % kind)
        elif in_reply_to not in references:
            errors.append("thread.in_reply_to must also be listed in thread.references")
    elif kind == "new":
        if isinstance(in_reply_to, str) and in_reply_to.strip():
            errors.append("thread.kind=new must not set in_reply_to")
    else:
        allowed = "new|update" if mail_contract.is_legacy(plan) else "new|reply|update"
        errors.append("thread.kind must be %s" % allowed)


def validate_body(plan, mail, errors, warnings, base_dir):
    body_rel = non_empty_string(mail, "body_markdown", "mail", errors)
    if not body_rel:
        return
    body_path = (Path(base_dir) / body_rel) if base_dir else Path(body_rel)
    if not body_path.is_file():
        errors.append("mail.body_markdown file not found: %s" % body_rel)
        return
    try:
        body = body_path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        errors.append("cannot read body markdown as UTF-8: %s" % exc)
        return
    if not body.strip():
        errors.append("mail.body_markdown file is empty")
    if plan.get("purpose") == "formal":
        haystack = body + "\n" + mail.get("subject", "")
        for phrase in FORBIDDEN_FORMAL_PHRASES:
            if phrase in haystack:
                errors.append("formal body/subject contains test phrase: %s" % phrase)
    presentation = mail_contract.resolve_presentation(plan)
    if (presentation.get("body_mode") == "plain"
            and STRUCTURED_MARKDOWN_RE.search(body)):
        warnings.append(
            "plain body contains structured Markdown; use multipart + "
            "reviewed-template or simplify the source to plain-text-compatible content"
        )
    if ANGLE_AUTOLINK_RE.search(body):
        warnings.append(
            "body contains angle-bracket URL autolinks; some mail clients may include "
            "the closing bracket in the clickable target — use [label](URL) instead"
        )


def validate_attachments(plan, errors, base_dir):
    attachments = plan.get("attachments", [])
    if not isinstance(attachments, list):
        errors.append("attachments must be a list")
        return
    for index, item in enumerate(attachments):
        prefix = "attachments[%d]" % index
        if not isinstance(item, dict):
            errors.append("%s must be an object" % prefix)
            continue
        rel = non_empty_string(item, "path", prefix, errors)
        expected_size = item.get("size")
        expected_sha = item.get("sha256")
        if not isinstance(expected_size, int):
            errors.append("%s.size must be an integer of frozen bytes" % prefix)
        if not isinstance(expected_sha, str) or len(expected_sha) != 64:
            errors.append("%s.sha256 must be the frozen 64-char digest" % prefix)
            expected_sha = ""
        if not rel:
            continue
        path = (Path(base_dir) / rel) if base_dir else Path(rel)
        if not path.is_file():
            errors.append("%s file not found: %s" % (prefix, rel))
            continue
        data = path.read_bytes()
        if isinstance(expected_size, int) and len(data) != expected_size:
            errors.append(
                "%s size mismatch: frozen %s, actual %d" % (prefix, expected_size, len(data))
            )
        if expected_sha:
            actual = hashlib.sha256(data).hexdigest()
            if actual.lower() != expected_sha.lower():
                errors.append("%s sha256 mismatch against frozen digest" % prefix)


def validate_transport_credentials(plan, errors):
    transport = object_field(plan, "transport", errors)
    if transport.get("protocol") != "smtp-ssl":
        errors.append("transport.protocol must be smtp-ssl")
    non_empty_string(transport, "host", "transport", errors)
    port = transport.get("port")
    if not isinstance(port, int) or not 0 < port < 65536:
        errors.append("transport.port must be a valid integer port")

    credentials = object_field(plan, "credentials", errors)
    if credentials.get("provider") != "env":
        errors.append("credentials.provider must be env (credential reference injection)")
    for field in ("account_ref", "token_ref"):
        ref = non_empty_string(credentials, field, "credentials", errors)
        if ref and not ENV_NAME_RE.match(ref):
            errors.append("credentials.%s must be an environment variable NAME" % field)


def validate_subject(plan, mail, warnings):
    if plan.get("purpose") != "formal":
        return
    if mail_contract.resolve_intent(plan) not in ("formal-delivery", "release"):
        return
    subject = mail.get("subject")
    version = mail.get("version")
    if not isinstance(subject, str) or not subject.strip():
        return
    if not subject.startswith("["):
        warnings.append(
            "subject does not start with the recommended [<material-code> "
            "<short-version>] tag for asset distribution; reply-style mails may "
            "keep the original thread subject — reviewer must judge")
    if isinstance(version, str) and version.strip():
        short_version = version.split("-")[0]
        if short_version not in subject:
            warnings.append(
                "subject does not contain the short version %r; recommended for "
                "asset-distribution mails — reviewer must judge" % short_version)


REVIEW_FORMS = ("selftest-mail", "offline-preview", "inline-summary")


def receipt_attachment_contract(plan):
    result = []
    attachments = plan.get("attachments", [])
    if not isinstance(attachments, list):
        return result
    for item in attachments:
        if not isinstance(item, dict):
            continue
        rel = item.get("path")
        result.append({
            "name": Path(rel).name if isinstance(rel, str) else "",
            "size": item.get("size"),
            "sha256": str(item.get("sha256", "")).upper(),
        })
    return result


def validate_review_form(plan, mail, presentation, errors, warnings, base_dir):
    if plan.get("purpose") != "formal":
        return
    review = plan.get("human_review")
    form = review.get("review_form") if isinstance(review, dict) else None
    if form not in REVIEW_FORMS:
        errors.append(
            "human_review.review_form must be one of %s (choose by presentation)"
            % (REVIEW_FORMS,))
        return
    if form != "selftest-mail" and presentation.get("body_mode") == "multipart":
        warnings.append(
            "review_form %r chosen; selftest-mail (real-mail review) is the "
            "recommended form for multipart mail — reviewer must explicitly accept "
            "the reduced review surface" % form)
        return
    if form != "selftest-mail":
        return
    evidence = plan.get("selftest_evidence")
    if not isinstance(evidence, dict):
        errors.append(
            "review_form selftest-mail requires selftest_evidence with the "
            "reviewed selftest receipt")
        return
    if evidence.get("reviewed_by_owner") is not True:
        errors.append("selftest_evidence.reviewed_by_owner must be true")
    rel = evidence.get("receipt")
    if not isinstance(rel, str) or not rel.strip():
        errors.append("selftest_evidence.receipt must point to the selftest receipt")
        return
    path = (Path(base_dir) / rel) if base_dir else Path(rel)
    if not path.is_file():
        errors.append("selftest receipt not found: %s" % rel)
        return
    try:
        receipt = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        errors.append("cannot read selftest receipt: %s" % exc)
        return
    if receipt.get("purpose") != "selftest":
        errors.append("selftest_evidence.receipt is not a selftest receipt")
    if receipt.get("status") != "sent":
        errors.append("selftest receipt status must be sent, got %r"
                      % receipt.get("status"))
    if not mail_contract.is_legacy(plan) and receipt.get("refused_count") != 0:
        errors.append("selftest receipt must have refused_count=0")
    for field in ("material_id", "version"):
        if receipt.get(field) != mail.get(field):
            errors.append(
                "selftest receipt %s does not match the frozen payload" % field)
    expected_presentation = {
        "body_mode": presentation.get("body_mode"),
        "style_strategy": presentation.get("style_strategy"),
        "template_id": presentation.get("template_id"),
    }
    if mail_contract.is_legacy(plan):
        if receipt.get("template_id") != expected_presentation["template_id"]:
            errors.append("selftest receipt template_id does not match the frozen payload")
    else:
        for field, expected in expected_presentation.items():
            if receipt.get(field) != expected:
                errors.append(
                    "selftest receipt %s does not match the frozen presentation" % field)
        try:
            body_rel = mail.get("body_markdown")
            body_path = (Path(base_dir) / body_rel) if base_dir else Path(body_rel)
            body_text = body_path.read_text(encoding="utf-8")
        except (OSError, TypeError, UnicodeDecodeError):
            body_text = None
        expected_fields = {
            "sender_sha256": hashlib.sha256(
                str(mail.get("from", "")).lower().encode("utf-8")
            ).hexdigest().upper(),
            "subject": mail.get("subject"),
            "intent": mail_contract.resolve_intent(plan),
            "thread_kind": mail_contract.resolve_thread(plan, base_dir).get("kind"),
            "thread": mail_contract.resolve_thread(plan, base_dir),
            "addressing": mail_contract.resolve_addressing(plan),
            "footer_note": mail.get("footer_note"),
            "source_sha256": (
                hashlib.sha256(body_text.encode("utf-8")).hexdigest().upper()
                if body_text is not None else None
            ),
            "attachments": receipt_attachment_contract(plan),
            "smtp_host": plan.get("transport", {}).get("host"),
            "smtp_port": plan.get("transport", {}).get("port"),
        }
        for field, expected in expected_fields.items():
            if receipt.get(field) != expected:
                errors.append(
                    "selftest receipt %s does not match the frozen payload" % field)


def validate_payload_binding(plan, errors, base_dir):
    digest = payload_sha256(plan, base_dir)
    review = object_field(plan, "human_review", errors)
    if set(review) != HUMAN_REVIEW_KEYS:
        errors.append("human_review fields must be exactly %s" % sorted(HUMAN_REVIEW_KEYS))
    if review.get("approved") is not True:
        errors.append("human_review.approved must be true")
    non_empty_string(review, "reviewer", "human_review", errors)
    if review.get("payload_sha256") != digest:
        errors.append("human_review.payload_sha256 does not match the frozen payload")

    preview = object_field(plan, "preview", errors)
    if set(preview) != PREVIEW_KEYS:
        errors.append("preview fields must be exactly %s" % sorted(PREVIEW_KEYS))
    if preview.get("reviewed") is not True:
        errors.append("preview.reviewed must be true")
    if preview.get("payload_sha256") != digest:
        errors.append("preview.payload_sha256 does not match the frozen payload")
    return digest


def parse_timestamp(value, label, errors):
    """Read an ISO-8601 moment that must carry an explicit UTC offset."""
    if not isinstance(value, str) or not value.strip():
        errors.append(
            "%s is required as an ISO-8601 timestamp with a UTC offset; release "
            "state must record when the owner actually stated it" % label)
        return None
    try:
        moment = datetime.datetime.fromisoformat(value.strip())
    except ValueError:
        errors.append("%s must be an ISO-8601 timestamp, got %r" % (label, value))
        return None
    if moment.tzinfo is None or moment.utcoffset() is None:
        errors.append("%s must carry an explicit UTC offset" % label)
        return None
    return moment


def selftest_sent_at(plan, errors, base_dir):
    """Return the machine-written delivery moment of the reviewed selftest.

    Unreadable receipts are already reported by validate_review_form, so this
    stays silent about them and only speaks up when a usable receipt carries no
    trustworthy sent_at.
    """
    evidence = plan.get("selftest_evidence")
    if not isinstance(evidence, dict):
        return None
    rel = evidence.get("receipt")
    if not isinstance(rel, str) or not rel.strip():
        return None
    path = (Path(base_dir) / rel) if base_dir else Path(rel)
    if not path.is_file():
        return None
    try:
        with open(str(path), "r", encoding="utf-8") as handle:
            receipt = json.load(handle)
    except (OSError, ValueError):
        return None
    if not isinstance(receipt, dict) or receipt.get("status") != "sent":
        return None
    return parse_timestamp(receipt.get("sent_at"), "selftest receipt sent_at", errors)


def validate_release_gate(plan, errors, warnings, base_dir, now):
    """Release state must be produced after the artifact it claims to review.

    The Playbook forbids release state that was preset by a script, template,
    config default or a previous run's residue, and requires real time between
    the selftest delivery and the formal delivery for the owner to actually
    review. Timestamps cannot prove who typed a value, so this gate is necessary
    rather than sufficient: it only rules out release state that could not have
    been produced by a review of this round.
    """
    review = plan.get("human_review")
    review = review if isinstance(review, dict) else {}
    preview = plan.get("preview")
    preview = preview if isinstance(preview, dict) else {}

    approved_at = parse_timestamp(
        review.get("approved_at"), "human_review.approved_at", errors)
    reviewed_at = parse_timestamp(
        preview.get("reviewed_at"), "preview.reviewed_at", errors)

    limit = now + datetime.timedelta(seconds=FUTURE_TOLERANCE_SECONDS)
    for label, moment in (("human_review.approved_at", approved_at),
                          ("preview.reviewed_at", reviewed_at)):
        if moment is not None and moment > limit:
            errors.append(
                "%s is in the future; release state cannot exist before the owner "
                "states it" % label)

    if approved_at is not None and reviewed_at is not None and approved_at < reviewed_at:
        errors.append(
            "human_review.approved_at precedes preview.reviewed_at; approval is a "
            "separate action taken after the reviewed artifact exists")

    if plan.get("purpose") != "formal":
        return

    if review.get("review_form") != "selftest-mail":
        if (approved_at is not None and reviewed_at is not None
                and 0 <= (approved_at - reviewed_at).total_seconds()
                < MIN_SELFTEST_REVIEW_SECONDS):
            warnings.append(
                "approval followed the preview after %d s and no selftest delivery "
                "backs this release; the reviewer must confirm that review time was "
                "real" % int((approved_at - reviewed_at).total_seconds()))
        return

    sent_at = selftest_sent_at(plan, errors, base_dir)
    evidence = plan.get("selftest_evidence")
    evidence = evidence if isinstance(evidence, dict) else {}
    owner_reviewed_at = parse_timestamp(
        evidence.get("reviewed_at"), "selftest_evidence.reviewed_at", errors)
    if owner_reviewed_at is not None and owner_reviewed_at > limit:
        errors.append(
            "selftest_evidence.reviewed_at is in the future; release state cannot "
            "exist before the owner states it")
    if sent_at is None or approved_at is None:
        return

    if owner_reviewed_at is not None and owner_reviewed_at < sent_at:
        errors.append(
            "selftest_evidence.reviewed_at precedes this selftest delivery; the "
            "reviewed state is residue from an earlier round")
    if approved_at < sent_at:
        errors.append(
            "human_review.approved_at precedes the selftest delivery it claims to "
            "approve; that approval cannot be a review of this round")
        return
    elapsed = int((approved_at - sent_at).total_seconds())
    if elapsed < MIN_SELFTEST_REVIEW_SECONDS:
        errors.append(
            "only %d s separate the selftest delivery and this approval, which "
            "leaves no real review time between the selftest and this send; stop "
            "and ask the owner to confirm again (minimum %d s)"
            % (elapsed, MIN_SELFTEST_REVIEW_SECONDS))


def validate_presentation(plan, mail, errors, warnings):
    presentation = mail_contract.resolve_presentation(plan)
    if mail_contract.is_legacy(plan):
        template_id = non_empty_string(mail, "template_id", "mail", errors)
        if template_id and template_id not in mail_contract.VERIFIED_TEMPLATE_IDS:
            errors.append(
                "template_id %r has no selftest evidence; run a selftest round first"
                % template_id
            )
        return presentation

    raw = plan.get("presentation")
    if not isinstance(raw, dict):
        errors.append("missing or invalid object field: presentation")
        return presentation
    body_mode = raw.get("body_mode")
    style_strategy = raw.get("style_strategy")
    template_id = raw.get("template_id")
    if body_mode not in mail_contract.BODY_MODES:
        errors.append("presentation.body_mode must be plain or multipart")
    if style_strategy not in mail_contract.STYLE_STRATEGIES:
        errors.append(
            "presentation.style_strategy must be minimal or reviewed-template")
    if body_mode == "plain":
        if style_strategy != "minimal":
            errors.append("plain body_mode requires style_strategy=minimal")
        if template_id not in (None, ""):
            errors.append("plain + minimal must not set presentation.template_id")
    if body_mode == "multipart":
        if style_strategy != "reviewed-template":
            errors.append(
                "multipart body_mode requires style_strategy=reviewed-template")
        if not isinstance(template_id, str) or not template_id.strip():
            errors.append(
                "multipart + reviewed-template requires presentation.template_id")
        elif template_id not in mail_contract.VERIFIED_TEMPLATE_IDS:
            errors.append(
                "template_id %r has no selftest evidence; run a selftest round first"
                % template_id
            )

    intent = mail_contract.resolve_intent(plan)
    if intent in ("acknowledgement", "discussion") and body_mode == "multipart":
        warnings.append(
            "intent %s normally uses plain + minimal; keep multipart only when "
            "content complexity requires structure" % intent)
    if intent in ("formal-delivery", "release") and body_mode == "plain":
        warnings.append(
            "intent %s normally uses multipart + reviewed-template; keep plain only "
            "when the content is genuinely short and unstructured" % intent)
    return presentation


def validate_intent_addressing(plan, errors, warnings):
    if mail_contract.is_legacy(plan):
        return
    intent = plan.get("intent")
    if intent not in mail_contract.INTENTS:
        errors.append("intent must be one of %s" % (mail_contract.INTENTS,))

    communication = plan.get("communication")
    if not isinstance(communication, dict):
        errors.append("missing or invalid object field: communication")
        return
    addressing = communication.get("addressing")
    if not isinstance(addressing, dict):
        errors.append("communication.addressing must be an object")
        return
    source = addressing.get("source")
    selected = addressing.get("selected")
    previous = addressing.get("previous")
    reason = addressing.get("override_reason")
    if source not in mail_contract.ADDRESSING_SOURCES:
        errors.append(
            "communication.addressing.source must be one of %s"
            % (mail_contract.ADDRESSING_SOURCES,)
        )
    selected_text = selected.strip() if isinstance(selected, str) else ""
    previous_text = previous.strip() if isinstance(previous, str) else ""
    reason_text = reason.strip() if isinstance(reason, str) else ""
    if selected is not None and not isinstance(selected, str):
        errors.append("communication.addressing.selected must be a string or null")
    if previous is not None and not isinstance(previous, str):
        errors.append("communication.addressing.previous must be a string or null")
    if reason is not None and not isinstance(reason, str):
        errors.append("communication.addressing.override_reason must be a string or null")
    if source == "omitted" and selected_text:
        errors.append("addressing.source=omitted requires selected to be null or empty")
    if source in mail_contract.ADDRESSING_SOURCES[:-1] and not selected_text:
        errors.append("addressing.source=%s requires a selected salutation" % source)
    if source == "thread-history":
        if not previous_text:
            errors.append("addressing.source=thread-history requires previous")
        elif selected_text != previous_text:
            errors.append("thread-history addressing must preserve the previous salutation")
    if previous_text and selected_text != previous_text and not reason_text:
        warnings.append(
            "addressing changed from %r to %r without override_reason; same-thread "
            "drift is discouraged but remains a reviewer judgment"
            % (previous_text, selected_text or "<omitted>")
        )


def validate(plan, base_dir=None, now=None):
    errors = []
    warnings = []
    if now is None:
        now = datetime.datetime.now(datetime.timezone.utc).astimezone()

    if plan.get("plan_state") != "send-ready":
        errors.append("plan_state must be send-ready for preflight")
    purpose = plan.get("purpose")
    if purpose not in ("formal", "selftest"):
        errors.append("purpose must be formal or selftest")

    validate_schema(plan, errors, warnings)
    validate_governance(plan, errors)

    mail = object_field(plan, "mail", errors)
    for field in ("from", "subject", "material_id", "version"):
        non_empty_string(mail, field, "mail", errors)
    sender = mail.get("from", "")
    if isinstance(sender, str) and sender and not ADDRESS_RE.match(sender):
        errors.append("mail.from is not a valid address")
    presentation = validate_presentation(plan, mail, errors, warnings)
    validate_intent_addressing(plan, errors, warnings)

    validate_recipients(plan, mail, errors)
    validate_subject(plan, mail, warnings)
    validate_thread(plan, errors, warnings, base_dir)
    validate_body(plan, mail, errors, warnings, base_dir)
    validate_attachments(plan, errors, base_dir)
    validate_transport_credentials(plan, errors)
    validate_review_form(plan, mail, presentation, errors, warnings, base_dir)
    validate_payload_binding(plan, errors, base_dir)
    validate_release_gate(plan, errors, warnings, base_dir, now)
    require_true(plan, "explicit_send_authorization", errors)
    require_true(plan, "final_payload_frozen", errors)
    require_true(plan, "internal_notes_removed", errors)

    if purpose == "selftest":
        warnings.append("selftest round: verify desktop and mobile rendering by hand")
    return errors, warnings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="mail plan JSON path")
    parser.add_argument("--base-dir", default=None,
                        help="base dir for relative paths (default: plan directory)")
    parser.add_argument("--json", action="store_true",
                        help="emit compact machine-readable JSON")
    args = parser.parse_args()

    plan_path = Path(args.input)
    base_dir = Path(args.base_dir) if args.base_dir else plan_path.resolve().parent
    plan = load_plan(plan_path)
    errors, warnings = validate(plan, base_dir=base_dir)
    status = "pass" if not errors else "blocked"
    summary = {
        "status": status,
        "payload_sha256": payload_sha256(plan, base_dir),
        "errors": errors,
        "warnings": warnings,
    }
    print(json.dumps(
        summary,
        ensure_ascii=False,
        sort_keys=args.json,
        indent=None if args.json else 2,
    ))
    return 0 if not errors else 2


if __name__ == "__main__":
    raise SystemExit(main())
