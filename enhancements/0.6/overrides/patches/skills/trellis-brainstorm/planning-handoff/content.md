## Quality Bar

Before declaring planning ready:

- `prd.md` contains testable acceptance criteria.
- `prd.md` has passed the PRD convergence pass: no unresolved temporary brainstorm sections, no duplicate facts across sections, and no lost anchors, decisions, or acceptance mappings.
- Repository-answerable questions have already been answered through inspection.
- Blocking open questions are empty.
- Complex tasks have `design.md` and `implement.md`.
- Sub-agent-dispatch tasks have real curated entries in both `implement.jsonl` and `check.jsonl`; seed-only manifests are not ready.
- Planning artifacts are ready for the final Brief handoff.
- The latest full Brief has been presented to the user.
- In a subsequent message, the user explicitly approved that Brief for implementation.

Do not start implementation merely because the user originally asked for implementation.

## Planning Handoff

Once the Quality Bar is satisfied, load `trellis-task-brief`, refresh `brief.md` from the final planning artifacts, display the full Brief in chat, and end the current turn. Wait for the user's planning review confirmation before running `task.py start` or beginning implementation.

Implementation intent expressed before the final artifacts and full Brief are shown authorizes planning only; it cannot be reused as the final review confirmation.

For `## Open Questions`, use Markdown checkbox state rather than placeholder prose: unresolved items are `- [ ]`; resolved items move into requirements/decisions or are removed; when no open questions remain, remove the section or leave it empty. Do not write bare placeholders such as `- None`, `- TBD`, or `- 已确认` because historical bare list items require an explicit auto-loop semantic review.
