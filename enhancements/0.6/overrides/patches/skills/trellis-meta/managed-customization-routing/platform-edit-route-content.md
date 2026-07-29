## Local Modification Order

When customizing a platform:

1. Read `.trellis/workflow.md` and the target platform's settings, hooks, agents, skills, commands, prompts, or workflows.
2. Inspect `.flower/plugin-lock.json`, `.flower/state.json`, template hashes, and managed markers for every candidate target.
3. For project-local files, modify the narrow local source and keep shared workflow semantics aligned.
4. For managed files, modify the owning Plugin/Patch source and preserve explicit platform targets with `each-existing`/`missing: skip`; do not create roots for platforms that are not enabled.
5. Apply the lifecycle and compare final bytes across all existing platform roots. Shared `.agents/skills` consumers must remain byte-consistent, while platform-specific frontmatter may retain its native differences.

Never claim cross-platform support after changing only one deployed copy.
