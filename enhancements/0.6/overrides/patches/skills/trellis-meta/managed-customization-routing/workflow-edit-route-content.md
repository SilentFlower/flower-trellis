## Modification Steps

1. Find the runtime section in `.trellis/workflow.md` and identify the owner named by the Workflow Owner Index or owning skill/helper.
2. Inspect Plugin state and nearby markers. If the section is not managed, make the narrow local edit and keep trigger/next-action semantics explicit.
3. If Skill-Garden owns the section, change the matching 0.6 Patch selector/baseline/content and Bundle policy. Do not add a parallel workflow injector or edit only the dogfood workflow.
4. Keep workflow-state tags paired, but do not duplicate a full owner procedure into the state block. State holds a one-hop gate; the owner skill/helper holds the detailed contract.
5. Synchronize affected skills, hooks, helpers, or platform entries through their own managed sources when the shared semantics require it.
6. Run source-to-snapshot sync, conflict checks, compiled target generation/check, final-output review, and idempotent dogfood application before treating the change as complete.
