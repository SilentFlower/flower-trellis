### Bundled vs. Project-Local

The same directory shape is used by two very different ownership models:

| Aspect | Bundled (`trellis-meta`, `trellis-spec-bootstrap`, `trellis-session-insight`, `trellis-channel`) | Project-local |
| --- | --- | --- |
| Source of truth | `packages/cli/src/templates/common/bundled-skills/<name>/` in Trellis CLI repo | Inside the user project itself |
| Dispatch | Auto-dispatched to every platform skill root by `getBundledSkillTemplates()` (`packages/cli/src/templates/common/index.ts`) on `trellis init` / `trellis update` | Created by the user (or another skill) and never moved |
| Hash tracking | Every file recorded in `.trellis/.template-hashes.json`; conflict prompt on update | Not tracked |
| Editing locally | Allowed but will be marked "modified by user" on next update | Free editing |
| The right way to customize | Add a *new* project-local skill with a *different* name that supplements (or supersedes) the bundled one | Edit the file directly |

If the goal is "make my project's AI behave differently when discussing release notes," the answer is almost always a project-local skill, not surgery on `trellis-meta/`.
