## Modification Steps

1. Confirm the current task and inspect `task.json`, planning artifacts, saved progress, and the current workflow state.
2. Identify the exact lifecycle writer and owner. Do not treat `task.py`, progress text, a state block, and an owner skill as interchangeable sources of truth.
3. Preserve the stable sequence: Brief review before planning activation; final progress synchronization before local completion; explicit finish-work after completion; explicit reopen before rework.
4. For project-local behavior, edit the narrow local owner. For Flower/Skill-Garden-managed behavior, change the canonical Patch/skill/helper source and then synchronize snapshot, compiled targets, and dogfood.
5. Update every affected caller, guard, recovery path, conflict assertion, and final-output test. A status transition is incomplete if another entry can bypass or contradict it.
6. Re-run the relevant task lifecycle, Patch conflict, compiled-target, and idempotency checks before relying on the new behavior.
