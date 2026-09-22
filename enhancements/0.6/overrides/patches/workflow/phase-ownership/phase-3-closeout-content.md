#### 3.5 Completion handoff

Successful Phase 3.4 writes deterministic Close through its owning progress path. There is no separate model-driven wrap-up command. Report only unresolved Close blockers, retained local changes, or publication recovery that still needs user action; SessionStart owns delayed physical GC.
