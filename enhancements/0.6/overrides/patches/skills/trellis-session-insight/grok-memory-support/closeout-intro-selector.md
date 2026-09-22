---
name: trellis-session-insight
description: "Reach into past AI conversation history through the `trellis mem` CLI. Use whenever the user asks 'how did we solve X last time', 'have we discussed this before', 'what was the decision on X', 'remind me what we did in this task', '上次怎么解的', '之前讨论过吗', '想起一段对话', or when starting a brainstorm that overlaps prior work, debugging a familiar bug, continuing a task across sessions, or doing a finish-work review. Returns raw past dialogue; decide for the moment whether to update spec, append to task notes, quote inline in the answer, or just internalize."
---

# Trellis Session Insight

This skill teaches an AI **how to call `trellis mem`** — the project's cross-session memory feedstock — and **when reaching for it is the right move**.

It is intentionally a **capability skill, not a workflow**. There is no fixed output file, no required write-back step, no "always run after finish-work" rule. What to do with what `mem` returns is a judgement call made in the moment of the conversation. The skill exists so the AI knows the capability is there and can decide.
