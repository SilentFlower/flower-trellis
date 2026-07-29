## Local Modification Patterns

Common changes:

| Goal | Edit point |
| --- | --- |
| Add a phase | Update the Phase Index, phase body, routing, and state blocks. |
| Change task creation policy | Update the `no_task` state block and Phase 1 description. |
| Change the default implementation/check path | Update Phase 2 and skill routing. |
| Change the wrap-up flow | Update Phase 3 and `finish-work` related descriptions. Note the current split: Phase 3.4 = AI-driven code commits (batched, user-confirmed), Phase 3.5 = `/finish-work` (archive + record session). `/finish-work` refuses to run if the working tree is dirty. |
| Change platform differences | Update routing descriptions grouped by platform. |

After editing, make the AI reread `.trellis/workflow.md`; do not assume the flow from the old conversation is still valid.
