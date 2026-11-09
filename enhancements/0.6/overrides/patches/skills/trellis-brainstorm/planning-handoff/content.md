## Quality Bar

Before declaring planning ready:

- `prd.md` contains testable acceptance criteria.
- `prd.md` has passed the PRD convergence pass: no unresolved temporary brainstorm sections, no duplicate facts across sections, and no lost anchors, decisions, or acceptance mappings.
- Repository-answerable questions have already been answered through inspection.
- Blocking open questions are empty.
- Complex tasks have `design.md` and `implement.md`.
- Sub-agent-dispatch tasks have real curated entries in both `implement.jsonl` and `check.jsonl`; seed-only manifests are not ready.
- Planning artifacts are ready for the final Brief handoff.

Do not start implementation merely because the user originally asked for implementation.

## Planning Handoff

Once the Quality Bar is satisfied, load `trellis-task-brief` and delegate confirmation mode to that owner BEFORE the final reply: refresh the Brief, attempt its eligible background prepare/wait, and display the full returned display. Only exclusions or actual failure use manual confirmation with the reason. Do not impose a separate human-only stop. Preparation does not permit implementation; start only after that owner's valid human/runner authorization or one-time policy_timeout claim plus started receipt.

Ordinary implementation intent expressed before the final artifacts and full Brief are shown authorizes planning only; it cannot be reused as the final review confirmation.

Once initial Brief approval exists, plan updates use `trellis-task-brief`'s incremental change rules. Artifact refresh alone does not require another whole-Brief review; unresolved new decisions still pause the affected work.

For `## Open Questions`, use Markdown checkbox state rather than placeholder prose: unresolved items are `- [ ]`; resolved items move into requirements/decisions or are removed; when no open questions remain, remove the section or leave it empty. Do not write bare placeholders such as `- None`, `- TBD`, or `- 已确认` because historical bare list items require an explicit auto-loop semantic review.
