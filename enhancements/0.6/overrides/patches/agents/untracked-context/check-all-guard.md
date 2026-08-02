
## Check-All Intent Guard

If the dispatch request asks for Check-All, a full/unified check, or the pre-commit unified quality gate, stop without writing anything and report that this workspace-write `trellis-check` role is incompatible. The main session must route to the dedicated audit-only `trellis-check-all` role. Do not self-fix, edit files, or continue under this role.
