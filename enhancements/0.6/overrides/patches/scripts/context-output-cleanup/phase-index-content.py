    section = tag_re.sub("", section)
    # Keep ownership markers in workflow.md; omit only their standalone output lines.
    section = _re.sub(
        r"^<!-- (?:BEGIN|END) skill-garden patch [^<>\r\n]+ -->(?:\r?\n|$)",
        "",
        section,
        flags=_re.MULTILINE,
    )
    return section.rstrip() + "\n"
