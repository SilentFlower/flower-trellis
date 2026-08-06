#!/usr/bin/env python3
"""Preview or execute a governed SMTP mail send with receipts and dedupe."""

import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import smtplib
import sys
from email.message import EmailMessage
from email.utils import formatdate, make_msgid

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import preflight  # noqa: E402
import render_mail  # noqa: E402
import mail_contract  # noqa: E402


KEY_SANITIZE_RE = re.compile(r"[^A-Za-z0-9._-]+")


def receipt_key(plan):
    mail = plan.get("mail", {})
    raw = "%s-%s-%s" % (mail.get("material_id"), mail.get("version"), plan.get("purpose"))
    return KEY_SANITIZE_RE.sub("_", raw)


def scan_receipts(receipt_dir, key):
    receipt_dir = Path(receipt_dir)
    if not receipt_dir.is_dir():
        return []
    found = []
    for path in sorted(receipt_dir.glob("%s*.receipt.json" % key)):
        if ".resolved." in path.name:
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            data = {"status": "unreadable"}
        found.append((path, data))
    return found


def blocking_reason(receipts, resend_authorized):
    for path, data in receipts:
        status = data.get("status")
        if status in ("pending", "uncertain_or_failed", "unreadable"):
            return ("receipt %s has unresolved status %s; investigate, then rename it "
                    "to *.resolved.json before any resend" % (path.name, status))
        if status == "sent" and not resend_authorized:
            return ("receipt %s shows this material+version already sent; pass "
                    "--resend-authorized only with explicit owner approval" % path.name)
    return None


def next_receipt_path(receipt_dir, key):
    receipt_dir = Path(receipt_dir)
    candidate = receipt_dir / ("%s.receipt.json" % key)
    serial = 2
    while candidate.exists():
        candidate = receipt_dir / ("%s.r%d.receipt.json" % (key, serial))
        serial += 1
    return candidate


def attachment_metadata(plan, base_dir):
    result = []
    for item in plan.get("attachments", []):
        rel = item.get("path")
        path = (Path(base_dir) / rel) if base_dir else Path(rel)
        data = path.read_bytes()
        digest = hashlib.sha256(data).hexdigest().upper()
        if digest.lower() != str(item.get("sha256", "")).lower():
            raise ValueError("attachment digest changed after freeze: %s" % rel)
        result.append({"name": path.name, "size": len(data),
                       "sha256": digest, "data": data})
    return result


def build_message(plan, rendered, base_dir=None, attachments=None):
    mail = plan["mail"]
    message = EmailMessage()
    message["From"] = mail["from"]
    message["To"] = ", ".join(mail["to"])
    if mail.get("cc"):
        message["Cc"] = ", ".join(mail["cc"])
    message["Subject"] = mail["subject"]
    message["Date"] = formatdate(localtime=True)
    domain = mail["from"].split("@", 1)[1]
    message["Message-ID"] = make_msgid(domain=domain)
    thread = mail_contract.resolve_thread(plan, base_dir)
    if thread.get("kind") in ("reply", "update"):
        message["In-Reply-To"] = thread["in_reply_to"]
        message["References"] = " ".join(thread.get("references", []))
    message.set_content(rendered["text"])
    if rendered["body_mode"] == "multipart":
        message.add_alternative(rendered["html"], subtype="html")
    if attachments is None:
        attachments = attachment_metadata(plan, base_dir)
    for item in attachments:
        message.add_attachment(
            item["data"], maintype="application", subtype="octet-stream",
            filename=item["name"])
    return message


def resolve_credentials(plan):
    credentials = plan.get("credentials", {})
    missing = []
    values = []
    for field in ("account_ref", "token_ref"):
        name = credentials.get(field, "")
        value = os.environ.get(name)
        if not value:
            missing.append(name or field)
        values.append(value)
    return values[0], values[1], missing


def recipient_counts(plan):
    mail = plan["mail"]
    to = mail.get("to", [])
    cc = mail.get("cc", [])
    bcc = mail.get("bcc", [])
    unique = {a.lower() for a in list(to) + list(cc) + list(bcc)}
    return {"to_count": len(to), "cc_count": len(cc), "bcc_count": len(bcc),
            "unique_recipient_count": len(unique)}


def envelope_recipients(plan):
    mail = plan["mail"]
    return list(mail.get("to", [])) + list(mail.get("cc", [])) + list(mail.get("bcc", []))


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).astimezone().isoformat()


def send(plan, base_dir=None, receipt_dir=None, execute=False,
         resend_authorized=False, smtp_factory=None):
    errors, warnings = preflight.validate(plan, base_dir=base_dir)
    if errors:
        return {"status": "blocked", "errors": errors, "warnings": warnings}

    rendered = render_mail.render_plan(plan, base_dir)
    attachments = attachment_metadata(plan, base_dir)
    mail = plan["mail"]
    addressing = mail_contract.resolve_addressing(plan)
    thread = mail_contract.resolve_thread(plan, base_dir)
    summary = {
        "schema_version": mail_contract.schema_version(plan) or "1.0-legacy",
        "sender_sha256": hashlib.sha256(mail["from"].lower().encode("utf-8")).hexdigest().upper(),
        "subject": mail["subject"],
        "material_id": mail["material_id"],
        "version": mail["version"],
        "purpose": plan["purpose"],
        "intent": mail_contract.resolve_intent(plan),
        "thread_kind": thread.get("kind"),
        "thread": thread,
        "footer_note": mail.get("footer_note"),
        "body_mode": rendered["body_mode"],
        "style_strategy": rendered["style_strategy"],
        "template_id": rendered["template_id"],
        "source_sha256": rendered["source_sha256"],
        "text_sha256": rendered["text_sha256"],
        "html_sha256": rendered["html_sha256"],
        "payload_sha256": preflight.payload_sha256(plan, base_dir),
        "attachments": [
            {"name": a["name"], "size": a["size"], "sha256": a["sha256"]}
            for a in attachments
        ],
    }
    if addressing is not None:
        summary["addressing"] = addressing
    summary.update(recipient_counts(plan))

    if not execute:
        summary["status"] = "preview"
        summary["warnings"] = warnings
        return summary

    if not receipt_dir:
        return {"status": "blocked",
                "errors": ["--receipt-dir is required for --execute"]}
    receipt_dir = Path(receipt_dir)
    key = receipt_key(plan)
    reason = blocking_reason(scan_receipts(receipt_dir, key), resend_authorized)
    if reason:
        return {"status": "blocked", "errors": [reason]}

    account, token, missing = resolve_credentials(plan)
    if missing:
        return {"status": "blocked", "errors": [
            "credential environment variable not set: %s; ask the owner to restore "
            "the environment, do not fall back to another send channel" % name
            for name in missing
        ]}

    receipt_dir.mkdir(parents=True, exist_ok=True)
    message = build_message(plan, rendered, base_dir, attachments)
    transport = plan["transport"]
    receipt = dict(summary)
    receipt["status"] = "pending"
    receipt["prepared_at"] = now_iso()
    receipt["message_id"] = message["Message-ID"]
    if message.get("In-Reply-To"):
        receipt["in_reply_to"] = message["In-Reply-To"]
    receipt["smtp_host"] = transport["host"]
    receipt["smtp_port"] = transport["port"]
    receipt_path = next_receipt_path(receipt_dir, key)
    receipt_path.write_text(
        json.dumps(receipt, ensure_ascii=False, indent=2), encoding="utf-8")

    factory = smtp_factory or (
        lambda host, port: smtplib.SMTP_SSL(host, port, timeout=60))
    try:
        with factory(transport["host"], transport["port"]) as client:
            client.login(account, token)
            refused = client.send_message(message, to_addrs=envelope_recipients(plan))
        receipt["status"] = "sent"
        receipt["sent_at"] = now_iso()
        receipt["refused_count"] = len(refused)
        receipt["refused_addresses"] = sorted(refused)
    except Exception as exc:  # noqa: BLE001 - any failure is an uncertain outcome
        receipt["status"] = "uncertain_or_failed"
        receipt["error"] = "%s: %s" % (type(exc).__name__, exc)
    receipt_path.write_text(
        json.dumps(receipt, ensure_ascii=False, indent=2), encoding="utf-8")
    receipt["receipt_path"] = str(receipt_path)
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="mail plan JSON path")
    parser.add_argument("--base-dir", default=None,
                        help="base dir for relative paths (default: plan directory)")
    parser.add_argument("--receipt-dir", default=None,
                        help="receipt registry directory (required for --execute)")
    parser.add_argument("--execute", action="store_true",
                        help="perform the real SMTP send (default: preview only)")
    parser.add_argument("--resend-authorized", action="store_true",
                        help="allow resend after a prior sent receipt, with owner approval")
    args = parser.parse_args()

    plan_path = Path(args.input)
    base_dir = Path(args.base_dir) if args.base_dir else plan_path.resolve().parent
    with open(str(plan_path), "r", encoding="utf-8") as handle:
        plan = json.load(handle)

    result = send(plan, base_dir=base_dir, receipt_dir=args.receipt_dir,
                  execute=args.execute, resend_authorized=args.resend_authorized)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("status") in ("preview", "sent") else 2


if __name__ == "__main__":
    raise SystemExit(main())
