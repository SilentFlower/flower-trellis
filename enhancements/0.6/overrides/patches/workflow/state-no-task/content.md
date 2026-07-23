No active task. Infer the current request intent before acting.
Repair intent alone is not a no-task switch; inspect unknown scope and reclassify before edits.
For non-trivial project work, follow the `Request Triage` Project Knowledge Discovery contract before routing the action. Load a Trellis capability directly only when the user explicitly names it or the request exactly matches that capability; route project-specific workflow actions through the matched SOP instead of keyword-mapping a general release/publish request to `trellis-release`.
Handle `discuss` and `inspect` silently. For non-destructive `direct_edit`, state once that task/progress will not be recorded and proceed.
For high-confidence complex implementation, create an auto-routed planning task through `task_intent.py create`, show one non-blocking switch hint, and enter `trellis-brainstorm`. Ask only for material ambiguity or independent safety gates.
