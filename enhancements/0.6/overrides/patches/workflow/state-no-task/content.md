No active task. Infer the current request intent before acting.
Handle `discuss` and `inspect` silently. For `workflow_action`, load the named Trellis capability directly. For non-destructive `direct_edit`, state once that task/progress will not be recorded and proceed.
For high-confidence complex implementation, create an auto-routed planning task through `task_intent.py create`, show one non-blocking switch hint, and enter `trellis-brainstorm`. Ask only for material ambiguity or independent safety gates.
