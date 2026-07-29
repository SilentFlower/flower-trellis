## Local Customization Boundaries

Classify before editing:

| Ownership | Durable edit point |
| --- | --- |
| Project-local | The current project file, after reading its call chain and related workflow semantics. |
| Upstream Trellis template | A local customization or upstream Trellis source, depending on the user's stated goal and template-hash behavior. |
| Skill-Garden managed | `vendor/skill-garden/.trellis/0.6/` in the Flower source checkout, expressed through Patch/Bundle declarations for existing Trellis targets. |
| Flower managed | The owning Flower source, Plugin manifest/adapter, or Patch catalog; never only the deployed result. |
| Shared common | The shared source plus Plugin state ownership rules; preserve content shared by more than one capability. |

Never hand-edit concrete runtime state, `.flower/` lock/state files, template hash contents, global npm caches, or `node_modules` as an implementation shortcut. If the Flower source checkout is not present, use the installed Plugin lifecycle or create separately owned project-local content rather than pretending the managed source exists locally.
