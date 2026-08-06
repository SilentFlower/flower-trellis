#!/usr/bin/env python3
"""Render a Markdown mail source into text/plain plus inline-CSS HTML."""

import argparse
import hashlib
import html
import json
from pathlib import Path
import re

import mail_contract


TEMPLATE_ID = mail_contract.VERIFIED_TEMPLATE_IDS[0]
SELFTEST_BANNER = ("自发自收复测说明：本邮件仅发送给本人，用于确认模板与排版效果，"
                   "不构成正式分发，请勿转发或据此执行。")

FONT_STACK = ("-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',"
              "Arial,sans-serif")
MONO_STACK = "Consolas,Monaco,monospace"
STYLES = {
    "h1": ("margin:0 0 8px;color:#172B4D;font-size:28px;line-height:1.35;"
           "font-weight:700;"),
    "h2": ("margin:32px 0 14px;padding-bottom:8px;border-bottom:1px solid #D7DEE7;"
           "color:#17324D;font-size:20px;line-height:1.45;font-weight:700;"),
    "h3": ("margin:22px 0 10px;color:#176B52;font-size:16px;line-height:1.5;"
           "font-weight:700;"),
    "h4": "margin:18px 0 8px;color:#17324D;font-size:15px;font-weight:700;",
    "p": "margin:0 0 14px;color:#263442;font-size:15px;line-height:1.75;",
    "ul": "margin:8px 0 18px;padding-left:22px;color:#263442;",
    "ol": "margin:8px 0 18px;padding-left:24px;color:#263442;",
    "li": "margin:0 0 9px;font-size:15px;line-height:1.7;",
    "pre": ("margin:10px 0 18px;padding:14px 16px;border-radius:4px;"
            "background:#202936;color:#F5F7FA;font-family:" + MONO_STACK +
            ";font-size:13px;line-height:1.6;white-space:pre-wrap;"
            "word-break:break-word;overflow-wrap:anywhere;"),
    "code": "font-family:" + MONO_STACK + ";font-size:13px;",
    "table": ("width:100%;margin:10px 0 20px;border-collapse:collapse;"
              "border:1px solid #D7DEE7;font-size:14px;line-height:1.55;"),
    "th": ("padding:10px 12px;border:1px solid #D7DEE7;background:#F2F5F8;"
           "color:#17324D;text-align:left;font-weight:700;"),
    "td": ("padding:10px 12px;border:1px solid #D7DEE7;color:#263442;"
           "vertical-align:top;word-break:break-word;"),
    "blockquote": ("margin:16px 0 22px;padding:12px 16px;"
                   "border-left:4px solid #176B52;background:#EDF7F3;"
                   "color:#24483D;"),
    "hr": "margin:28px 0 18px;border:0;border-top:1px solid #D7DEE7;",
    "a": "color:#176B52;",
}

HEADING_RE = re.compile(r"^(#{1,4})\s+(.*)$")
HR_RE = re.compile(r"^(-{3,}|\*{3,})\s*$")
UL_RE = re.compile(r"^\s*[-*]\s+(.*)$")
OL_RE = re.compile(r"^\s*\d+[.)]\s+(.*)$")
TABLE_SEP_RE = re.compile(r"^\s*\|?[\s:|-]+\|[\s:|-]*$")
CODE_SPAN_RE = re.compile(r"`([^`]+)`")
BOLD_RE = re.compile(r"\*\*([^*]+)\*\*")
LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)")


def inline_html(text):
    escaped = html.escape(text, quote=False)
    escaped = CODE_SPAN_RE.sub(
        lambda m: '<code style="%s">%s</code>' % (STYLES["code"], m.group(1)), escaped)
    escaped = BOLD_RE.sub(r"<strong>\1</strong>", escaped)
    escaped = LINK_RE.sub(
        lambda m: '<a style="%s" href="%s">%s</a>'
        % (STYLES["a"], m.group(2), m.group(1)), escaped)
    return escaped


def render_list(items, tag):
    parts = ['<%s style="%s">' % (tag, STYLES[tag])]
    for item in items:
        parts.append('<li style="%s">%s</li>' % (STYLES["li"], inline_html(item)))
    parts.append("</%s>" % tag)
    return "".join(parts)


def collect_list_items(lines, start, pattern):
    items = []
    i = start
    total = len(lines)
    while i < total:
        bullet = pattern.match(lines[i])
        if not bullet:
            break
        items.append(bullet.group(1))
        i += 1
        if (i + 1 < total and not lines[i].strip()
                and pattern.match(lines[i + 1])):
            i += 1
    return items, i


def split_table_row(line):
    return [cell.strip() for cell in line.strip().strip("|").split("|")]


def md_to_blocks(markdown_text):
    lines = markdown_text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    blocks = []
    i = 0
    total = len(lines)
    while i < total:
        line = lines[i]
        if not line.strip():
            i += 1
            continue
        if line.startswith("```"):
            code = []
            i += 1
            while i < total and not lines[i].startswith("```"):
                code.append(lines[i])
                i += 1
            i += 1
            blocks.append('<pre style="%s">%s</pre>'
                          % (STYLES["pre"], html.escape("\n".join(code), quote=False)))
            continue
        heading = HEADING_RE.match(line)
        if heading:
            level = len(heading.group(1))
            tag = "h%d" % level
            blocks.append('<%s style="%s">%s</%s>'
                          % (tag, STYLES[tag], inline_html(heading.group(2)), tag))
            i += 1
            continue
        if HR_RE.match(line):
            blocks.append('<hr style="%s">' % STYLES["hr"])
            i += 1
            continue
        if line.lstrip().startswith(">"):
            quote = []
            while i < total and lines[i].lstrip().startswith(">"):
                quote.append(lines[i].lstrip()[1:].lstrip())
                i += 1
            blocks.append('<blockquote style="%s">%s</blockquote>'
                          % (STYLES["blockquote"],
                             "<br>".join(inline_html(q) for q in quote if q)))
            continue
        if (line.strip().startswith("|") and i + 1 < total
                and TABLE_SEP_RE.match(lines[i + 1])):
            header = split_table_row(line)
            i += 2
            rows = []
            while i < total and lines[i].strip().startswith("|"):
                rows.append(split_table_row(lines[i]))
                i += 1
            parts = ['<table role="presentation" style="%s"><tr>' % STYLES["table"]]
            for cell in header:
                parts.append('<th style="%s">%s</th>' % (STYLES["th"], inline_html(cell)))
            parts.append("</tr>")
            for row in rows:
                parts.append("<tr>")
                for cell in row:
                    parts.append('<td style="%s">%s</td>'
                                 % (STYLES["td"], inline_html(cell)))
                parts.append("</tr>")
            parts.append("</table>")
            blocks.append("".join(parts))
            continue
        matched = UL_RE.match(line)
        if matched:
            items, i = collect_list_items(lines, i, UL_RE)
            blocks.append(render_list(items, "ul"))
            continue
        matched = OL_RE.match(line)
        if matched:
            items, i = collect_list_items(lines, i, OL_RE)
            blocks.append(render_list(items, "ol"))
            continue
        paragraph = []
        while i < total and lines[i].strip():
            probe = lines[i]
            if (probe.startswith("```") or HEADING_RE.match(probe) or HR_RE.match(probe)
                    or probe.lstrip().startswith(">") or UL_RE.match(probe)
                    or OL_RE.match(probe) or probe.strip().startswith("|")):
                break
            paragraph.append(probe.strip())
            i += 1
        if paragraph:
            blocks.append('<p style="%s">%s</p>'
                          % (STYLES["p"], "<br>".join(inline_html(p) for p in paragraph)))
    return blocks


def md_to_html(markdown_text):
    return "\n".join(md_to_blocks(markdown_text))


def render(markdown_text, purpose, subject="", footer=""):
    text_body = markdown_text
    blocks = md_to_blocks(markdown_text)
    if purpose == "selftest":
        heading, separator, remainder = markdown_text.partition("\n")
        notice_md = "> **%s**" % SELFTEST_BANNER
        if separator and heading.startswith("# "):
            text_body = heading + "\n\n" + notice_md + "\n" + remainder.lstrip("\n")
        else:
            text_body = notice_md + "\n\n" + markdown_text
        notice_html = ('<blockquote style="%s"><strong>%s</strong></blockquote>'
                       % (STYLES["blockquote"],
                          html.escape(SELFTEST_BANNER, quote=False)))
        if blocks and blocks[0].startswith("<h1"):
            blocks.insert(1, notice_html)
        else:
            blocks.insert(0, notice_html)
    fragment = "\n".join(blocks)
    preheader = html.escape(subject, quote=False)
    footer_html = html.escape(footer, quote=False)
    html_body = (
        '<!doctype html><html><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '</head><body style="margin:0;padding:0;background:#F5F7FA;'
        "font-family:" + FONT_STACK + ';">'
        '<div style="display:none;max-height:0;overflow:hidden;color:transparent;">'
        + preheader
        + '</div><div style="width:100%;background:#F5F7FA;padding:24px 0;">'
        '<div style="max-width:760px;margin:0 auto;background:#FFFFFF;'
        'border:1px solid #DDE3EA;">'
        '<div style="height:6px;background:#176B52;"></div>'
        '<div style="padding:30px 38px 34px;">\n'
        + fragment
        + '\n</div><div style="padding:14px 38px;background:#F2F5F8;color:#607080;'
        'font-size:12px;line-height:1.6;">'
        + footer_html
        + "</div></div></div></body></html>\n"
    )
    return text_body, html_body


def render_plan(plan, base_dir=None):
    mail = plan.get("mail", {})
    presentation = mail_contract.resolve_presentation(plan)
    body_mode = presentation.get("body_mode")
    style_strategy = presentation.get("style_strategy")
    template_id = presentation.get("template_id")
    if body_mode == "plain":
        if style_strategy != "minimal" or template_id:
            raise ValueError("plain body_mode requires minimal style and no template_id")
    elif body_mode == "multipart":
        if style_strategy != "reviewed-template":
            raise ValueError("multipart body_mode requires reviewed-template style")
        if template_id != TEMPLATE_ID:
            raise ValueError("unsupported template_id: %r" % template_id)
    else:
        raise ValueError("unsupported body_mode: %r" % body_mode)
    body_rel = mail.get("body_markdown")
    body_path = (Path(base_dir) / body_rel) if base_dir else Path(body_rel)
    markdown_text = body_path.read_text(encoding="utf-8")
    footer = mail.get("footer_note") or (
        "%s %s · template %s" % (mail.get("material_id", ""),
                                 mail.get("version", ""), template_id))
    text_body, html_body = render(
        markdown_text, plan.get("purpose"),
        subject=mail.get("subject", ""), footer=footer)
    if body_mode == "plain":
        html_body = None
    return {
        "body_mode": body_mode,
        "style_strategy": style_strategy,
        "template_id": template_id,
        "text": text_body,
        "html": html_body,
        "source_sha256": hashlib.sha256(markdown_text.encode("utf-8")).hexdigest().upper(),
        "text_sha256": hashlib.sha256(text_body.encode("utf-8")).hexdigest().upper(),
        "html_sha256": (
            hashlib.sha256(html_body.encode("utf-8")).hexdigest().upper()
            if html_body is not None else None
        ),
    }


def write_preview(rendered, outdir):
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    (outdir / "body.txt").write_text(rendered["text"], encoding="utf-8")
    html_path = outdir / "body.html"
    if rendered["html"] is not None:
        html_path.write_text(rendered["html"], encoding="utf-8")
    elif html_path.exists():
        html_path.unlink()
    manifest = {
        "body_mode": rendered["body_mode"],
        "style_strategy": rendered["style_strategy"],
        "template_id": rendered["template_id"],
        "source_sha256": rendered["source_sha256"],
        "text_sha256": rendered["text_sha256"],
        "html_sha256": rendered["html_sha256"],
    }
    (outdir / "preview-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="mail plan JSON path")
    parser.add_argument("--outdir", required=True, help="preview output directory")
    parser.add_argument("--base-dir", default=None,
                        help="base dir for relative paths (default: plan directory)")
    args = parser.parse_args()

    plan_path = Path(args.input)
    base_dir = Path(args.base_dir) if args.base_dir else plan_path.resolve().parent
    with open(str(plan_path), "r", encoding="utf-8") as handle:
        plan = json.load(handle)

    rendered = render_plan(plan, base_dir)
    manifest = write_preview(rendered, args.outdir)
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
