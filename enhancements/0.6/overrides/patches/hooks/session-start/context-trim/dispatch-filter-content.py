    if phases:
        phases = _platform_dispatch_summary(phases, platform)
        out_lines.append(_strip_breadcrumb_tag_blocks(phases).rstrip())
