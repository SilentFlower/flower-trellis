### Bundled vs. Project-Local

Use the ownership evidence, not the directory shape:

| Owner | Update evidence | Correct edit route |
| --- | --- | --- |
| Upstream Trellis | `.trellis/.template-hashes.json` only | Local supplement/divergence or upstream source, according to user intent |
| Skill-Garden | `flower/skill-garden` lock/state entry or managed marker | 0.6 Patch/Bundle source under `vendor/skill-garden` when authoring Flower |
| Flower Plugin | `.flower/state.json` owner/path/patch entry | Owning Plugin source or Flower Patch catalog |
| Shared common | State path with shared ownership | Shared common source; preserve other consumers |
| Project-local | No managed ownership claim | Edit the project file directly |

For a managed target, the durable sequence is source change -> required preflight -> transaction -> state/provenance update. For a project-private behavior, a differently named local skill or `.trellis/spec/` remains preferable to mutating a public bundled skill.
