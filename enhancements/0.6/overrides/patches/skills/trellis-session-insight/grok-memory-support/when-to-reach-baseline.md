## When to reach for it

The bar is "would a senior teammate ask 'didn't we already talk about this?'" — those are the moments. Some concrete patterns:

- **Brainstorm rerun risk.** Starting a new task that touches an area the user has been in before, and you want to check whether a decision was already made — before re-asking the user.
- **Familiar-bug debugging.** The current bug pattern feels like one the user reported / fixed before. Pulling the relevant past session can save a full debugging loop.
- **Cross-session continuation.** The user resumes work after a gap and says "where were we" / "继续上次的" without being specific.
- **Decision retrieval.** The user references "the decision we made about X" but the decision lives in an old brainstorm, not in any `prd.md` / `spec/`.
- **Finish-work retrospective.** When the user explicitly asks for a wrap-up of what was decided / what hurt / what surprised them in this task — not as a forced step on every finish-work.
- **Pattern-spotting across past work.** The user asks "do I keep making the same mistake on X" / "我每次都踩这个坑吗" — search across sessions answers that.

If none of these apply, don't call `mem`. It is a tool, not a ceremony.
