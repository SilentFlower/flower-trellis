## Planning Handoff

Once the Quality Bar is satisfied, load `trellis-task-brief`, refresh `brief.md` from the final planning artifacts, display the full brief in chat, and end the current turn. Wait for the user's planning review confirmation before running `task.py start` or beginning implementation.

Implementation intent expressed before the final artifacts and full brief are shown authorizes planning only; it cannot be reused as the final review confirmation.

For `## Open Questions`, use Markdown checkbox state rather than placeholder prose: unresolved items are `- [ ]`; resolved items move into requirements/decisions or are removed; when no open questions remain, remove the section or leave it empty. Do not write bare placeholders such as `- None`, `- TBD`, or `- 已确认` because historical bare list items require an explicit auto-loop semantic review.
