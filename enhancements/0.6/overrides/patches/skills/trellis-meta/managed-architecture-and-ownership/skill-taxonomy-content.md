## What Counts As Bundled (vs. Adjacent Concepts)

Directory shape alone does not determine ownership:

| Ownership class | Evidence | Durable source |
| --- | --- | --- |
| Upstream bundled | Trellis template hashes and bundled-skill distribution | Trellis bundled template source or an explicitly local supplement |
| Skill-Garden managed | `flower/skill-garden` lock/state entries or `skill-garden patch` markers | `vendor/skill-garden/.trellis/0.6/` in the Flower source checkout |
| Flower managed | Flower Plugin state paths/patches and owner IDs | The owning Flower Plugin source, adapter, or `src/patches/` catalog |
| Shared common | Plugin state entry with shared ownership | The common source retained across dependent capabilities |
| Project-local | No upstream template or Plugin ownership claim, plus project intent | The project file itself |

For managed 0.6 changes, Patch leaves own `insert`/`replace`/`remove` transformations; selectors and full baselines fail closed on upstream drift; content files own replacement bytes; explicit targets and `each-existing` prevent accidental platform creation; Bundles own full/selected aliases; required preflight prevents partial writes; markers and first backups support migration/recovery; provenance records the selected operations; compatibility and conflict policies audit the final result; canonical compiled targets prove the pinned upstream output. These responsibilities must stay in the shared Patch Engine instead of being reimplemented by a skill-specific injector.

Discover what is active from the local skill roots, `.trellis/workflow.md`, available `overrides/bundles/`, and `.flower/state.json`. Do not infer ownership from a skill name or maintain a fixed Skill-Garden capability list in this document.
