#!/usr/bin/env python3
"""Resolve an original mail into a reusable, body-free thread record."""

import argparse
import datetime
import imaplib
import json
import os
from pathlib import Path
import poplib
import sys

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import thread_record  # noqa: E402


def credential_value(reference):
    if not reference:
        raise ValueError("credential environment variable name is required")
    value = os.environ.get(reference)
    if not value:
        raise ValueError(
            "credential environment variable not set: %s; restore the local "
            "environment without pasting the credential into the plan" % reference
        )
    return value


def nested_messages(payload):
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        raise ValueError("message JSON must be a list or an object containing messages")
    containers = [payload]
    for container in containers:
        for key in ("messages", "items"):
            if isinstance(container.get(key), list):
                return container[key]
        if isinstance(container.get("message"), dict):
            return [container["message"]]
        for key in ("result", "conversation", "data"):
            nested = container.get(key)
            if isinstance(nested, dict) and nested not in containers:
                containers.append(nested)
    for result in containers:
        for key in ("messages", "items"):
            if isinstance(result.get(key), list):
                return result[key]
    raise ValueError("message JSON does not contain a supported messages list")


def load_json_candidates(path, adapter):
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    return [
        thread_record.candidate_from_mapping(item, "%s#%d" % (path, index), adapter)
        for index, item in enumerate(nested_messages(payload), 1)
    ]


def load_eml_candidates(directory):
    candidates = []
    for path in sorted(Path(directory).glob("*.eml")):
        candidates.append(thread_record.candidate_from_bytes(
            path.read_bytes(), path.name, "eml"))
    return candidates


def imap_search_criteria(clues):
    def quote(value):
        escaped = str(value).replace("\\", "\\\\").replace('"', '\\"')
        return '"%s"' % escaped

    criteria = ["ALL"]
    # Decode and match subjects locally. Passing non-ASCII text directly through
    # imaplib search is not portable and commonly fails for Chinese subjects.
    if clues.get("from"):
        criteria.extend(["FROM", quote(clues["from"])])
    if clues.get("to"):
        criteria.extend(["TO", quote(clues["to"])])
    start = thread_record.parse_datetime(clues.get("time_start"))
    end = thread_record.parse_datetime(clues.get("time_end"))
    if start:
        criteria.extend(["SINCE", start.strftime("%d-%b-%Y")])
    if end:
        before = end + datetime.timedelta(days=1)
        criteria.extend(["BEFORE", before.strftime("%d-%b-%Y")])
    return criteria


def fetched_bytes(fetch_data):
    for item in fetch_data or []:
        if isinstance(item, tuple) and len(item) > 1 and isinstance(item[1], bytes):
            return item[1]
    return None


def load_imap_candidates(args, clues):
    account = credential_value(args.account_ref)
    token = credential_value(args.token_ref)
    client = imaplib.IMAP4_SSL(args.host, args.port)
    try:
        client.login(account, token)
        status, _ = client.select(args.mailbox, readonly=True)
        if status != "OK":
            raise ValueError("cannot open IMAP mailbox %s" % args.mailbox)
        status, data = client.search(None, *imap_search_criteria(clues))
        if status != "OK":
            raise ValueError("IMAP search failed")
        identifiers = (data[0].split() if data and data[0] else [])[-args.limit:]
        candidates = []
        for identifier in identifiers:
            needs_body = bool(clues.get("attachment_name"))
            query = "(BODY.PEEK[])" if needs_body else "(BODY.PEEK[HEADER])"
            status, fetched = client.fetch(identifier, query)
            raw = fetched_bytes(fetched)
            if status == "OK" and raw:
                locator = "imap:%s:%s" % (
                    args.mailbox, identifier.decode("ascii"))
                candidate = thread_record.candidate_from_bytes(
                    raw, locator, "imap", attachments_parsed=needs_body)
                matched, _ = thread_record.candidate_matches(candidate, clues)
                if matched and not needs_body:
                    full_status, full_fetched = client.fetch(
                        identifier, "(BODY.PEEK[])")
                    full_raw = fetched_bytes(full_fetched)
                    if full_status == "OK" and full_raw:
                        candidate = thread_record.candidate_from_bytes(
                            full_raw, locator, "imap", attachments_parsed=True)
                candidates.append(candidate)
        return candidates
    finally:
        try:
            client.logout()
        except Exception:
            pass


def load_pop3_candidates(args, clues):
    account = credential_value(args.account_ref)
    token = credential_value(args.token_ref)
    client = poplib.POP3_SSL(args.host, args.port, timeout=60)
    try:
        client.user(account)
        client.pass_(token)
        count, _ = client.stat()
        start = max(1, count - args.limit + 1)
        candidates = []
        for number in range(start, count + 1):
            if clues.get("attachment_name"):
                _, lines, _ = client.retr(number)
            else:
                _, lines, _ = client.top(number, 0)
            raw = b"\r\n".join(lines) + b"\r\n"
            candidates.append(thread_record.candidate_from_bytes(
                raw, "pop3:INBOX:%d" % number, "pop3",
                attachments_parsed=bool(clues.get("attachment_name"))))
        return candidates
    finally:
        try:
            client.quit()
        except Exception:
            pass


def reuse_record(path):
    record = thread_record.load_record(path)
    errors = thread_record.record_errors(record)
    if errors or record.get("status") != "resolved":
        raise ValueError("reusable thread record is not resolved: %s" % (errors or [
            record.get("status")]))
    copied = json.loads(json.dumps(record))
    copied["source"]["reused_at"] = thread_record.now_iso()
    copied["source"]["reused_from_sha256"] = thread_record.record_sha256(path)
    copied["resolution"]["selected_by"] = "context-reuse"
    return copied


def clues_from_args(args):
    return {
        "subject": args.subject,
        "time_start": args.time_start,
        "time_end": args.time_end,
        "from": args.from_address,
        "to": args.to_address,
        "attachment_name": args.attachment_name,
    }


def resolve(args):
    if args.adapter == "context-record":
        if not args.reuse_record:
            raise ValueError("--reuse-record is required for context-record adapter")
        return reuse_record(args.reuse_record)

    clues = clues_from_args(args)
    if not thread_record.normalized_clues(clues):
        raise ValueError(
            "mailbox discovery requires at least one business clue such as subject "
            "or time range"
        )
    limitations = []
    if args.adapter in ("json", "dws"):
        if not args.messages:
            raise ValueError("--messages is required for %s adapter" % args.adapter)
        candidates = load_json_candidates(args.messages, args.adapter)
        if args.adapter == "dws":
            limitations.append(
                "DWS internal messageId is ignored; only internetMessageId or an "
                "equivalent RFC field can resolve a thread"
            )
    elif args.adapter == "eml":
        if not args.eml_dir:
            raise ValueError("--eml-dir is required for eml adapter")
        candidates = load_eml_candidates(args.eml_dir)
    elif args.adapter == "imap":
        candidates = load_imap_candidates(args, clues)
    elif args.adapter == "pop3":
        candidates = load_pop3_candidates(args, clues)
        limitations.append(
            "POP3 only inspects recent INBOX messages and cannot search sent or "
            "archive folders"
        )
    else:
        raise ValueError("unsupported adapter: %s" % args.adapter)
    return thread_record.resolve_candidates(
        candidates, clues, args.adapter,
        selected_candidate_id=args.select_candidate,
        limitations=limitations,
    )


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--adapter", required=True,
                        choices=("context-record", "imap", "pop3", "dws", "eml", "json"))
    result.add_argument("--output", required=True, help="thread record JSON path")
    result.add_argument("--reuse-record", help="previously persisted resolved record")
    result.add_argument("--messages", help="normalized JSON or DWS read result")
    result.add_argument("--eml-dir", help="directory containing .eml files")
    result.add_argument("--host", help="mailbox host for IMAP/POP3")
    result.add_argument("--port", type=int, help="mailbox SSL port")
    result.add_argument("--mailbox", default="INBOX", help="IMAP mailbox name")
    result.add_argument("--account-ref", help="account environment variable name")
    result.add_argument("--token-ref", help="client authorization environment variable name")
    result.add_argument("--limit", type=int, default=200, help="maximum messages to inspect")
    result.add_argument("--subject", help="subject clue")
    result.add_argument("--time-start", help="inclusive ISO-8601 start time")
    result.add_argument("--time-end", help="inclusive ISO-8601 end time")
    result.add_argument("--from-address", help="sender address clue")
    result.add_argument("--to-address", help="recipient address clue")
    result.add_argument("--attachment-name", help="attachment filename clue")
    result.add_argument("--select-candidate", help="candidate_id selected by the owner")
    return result


def main():
    args = parser().parse_args()
    if args.limit < 1 or args.limit > 1000:
        print(json.dumps({"status": "blocked", "errors": [
            "--limit must be between 1 and 1000"]}, ensure_ascii=False, indent=2))
        return 2
    if args.adapter in ("imap", "pop3"):
        default_port = 993 if args.adapter == "imap" else 995
        args.port = args.port or default_port
        if not args.host:
            print(json.dumps({"status": "blocked", "errors": [
                "--host is required for %s adapter" % args.adapter
            ]}, ensure_ascii=False, indent=2))
            return 2
    try:
        record = resolve(args)
        errors = thread_record.record_errors(record)
        if errors:
            raise ValueError("; ".join(errors))
        output = Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(
            json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({
            "status": record["status"],
            "output": str(output),
            "candidate_count": record["resolution"]["candidate_count"],
            "candidates": record.get("candidates", []),
        }, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        print(json.dumps({"status": "blocked", "errors": [
            "%s: %s" % (type(exc).__name__, exc)
        ]}, ensure_ascii=False, indent=2))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
