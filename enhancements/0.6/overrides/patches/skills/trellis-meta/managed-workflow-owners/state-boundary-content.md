## Workflow-State Prompt Blocks

`workflow.md` may contain paired blocks such as `[workflow-state:no_task]...[/workflow-state:no_task]`. Hooks select the current block and inject it as a one-hop next-action guard.

State blocks are not the owner of complete planning, routing, checking, commit, or archive procedures. Keep detailed semantics in the owner skill/helper and keep the state body small enough to identify the immediate gate. If a managed state policy changes, update its Skill-Garden Patch baseline/content and the owning workflow contract together; do not edit only the deployed block.

Treat the status names actually present in the local workflow and task runtime as authoritative. Do not copy a fixed state or error matrix into this reference.
