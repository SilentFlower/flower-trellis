## Meaning Of Template Hashes

`.trellis/.template-hashes.json` records native Trellis template hashes and still governs ordinary `trellis update` conflicts:

| Case | Native update behavior |
| --- | --- |
| File matches the recorded template hash | Trellis may update it automatically. |
| File differs from the recorded template hash | Trellis may prompt to overwrite, keep, or generate `.new`. |
| File is no longer a current template | Trellis migration rules decide whether to delete, rename, or preserve it. |

This file is not the complete ownership model in a Flower-managed project. When `.flower/plugin-lock.json` and `.flower/state.json` claim a target, Plugin ownership, Patch provenance, transaction checks, and managed result hashes also apply. Do not hand-edit either hash store; inspect both before deciding whether a difference is a user customization, a managed overlay, or drift.
