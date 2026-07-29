The operating scope depends on target ownership:

- Native or project-local Trellis files may be edited in the user project after reading their current content and update boundaries.
- Flower-managed or Skill-Garden-managed files are deployed results. Before editing them, inspect `.flower/plugins.json`, `.flower/plugin-lock.json`, `.flower/state.json`, and nearby `skill-garden patch` markers.
- When `flower/skill-garden` is declared and locked, its Plugin state and managed Patch contracts take precedence over conflicting native-only customization advice in this skill. The deployed file remains runtime truth for current behavior, but it is not automatically the authoring source.
- In the Flower source checkout, Skill-Garden 0.6 authoring lives under `vendor/skill-garden/.trellis/0.6/`; `enhancements/0.6/` is the synchronized release snapshot, while project `.trellis/`, `.agents/`, and `.claude/` files are dogfood outputs.
- Outside that source checkout, do not invent those authoring paths. Use the Plugin lifecycle or create separately owned project-local content instead of mutating a managed result.
- User-owned channel logs remain under `~/.trellis/channels/<project>/<channel>/events.jsonl`; raw conversation logs remain queryable through `trellis mem`.

Do not modify the global npm install directory or `node_modules`. Do not treat the presence of a local file alone as proof that it is user-owned.
