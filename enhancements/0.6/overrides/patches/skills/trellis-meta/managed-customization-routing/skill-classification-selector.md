When the user wants to change AI entry points, auto-trigger rules, or explicit command behavior, edit skills, commands, prompts, or workflows in local platform directories.

Before editing, classify the skill you are about to touch:

- **Bundled upstream skill** — `trellis-meta`, `trellis-spec-bootstrap`, `trellis-session-insight`, `trellis-channel`. Source of truth lives in the Trellis CLI repo under `packages/cli/src/templates/common/bundled-skills/<name>/`; auto-dispatched to every platform's skill root by `getBundledSkillTemplates()` on `trellis init` / `trellis update`. Local edits here are tracked by `.trellis/.template-hashes.json` and will be flagged on the next update.
- **Project-local skill** — anything else under `.{platform}/skills/`. Owned by the user; not refreshed by `trellis update`.

The remainder of this file uses "skill" for the local file; the override and conflict rules differ between the two cases.
