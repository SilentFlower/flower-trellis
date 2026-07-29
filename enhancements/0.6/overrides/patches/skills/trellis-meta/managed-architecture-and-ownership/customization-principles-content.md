## AI Customization Principles

1. **Inspect behavior and ownership separately**: Read the current `.trellis/` and platform files for runtime truth, then inspect `.flower/` state, template hashes, and managed markers to locate the durable authoring source.
2. **Choose the owner before the edit**: Project-local content may be edited locally. Trellis templates follow native update rules. Flower/Skill-Garden targets follow Plugin state and Patch ownership.
3. **Use the 0.6 Patch Engine for managed Trellis files**: Declare exact targets, selector/baseline/content, target policy, and Bundle selection. Do not add a special injector or modify only a deployed copy.
4. **Keep the lifecycle ordered**: Change `vendor/skill-garden/.trellis/0.6/`, run `npm run sync` to refresh `enhancements/0.6/`, regenerate/check compiled targets, then update dogfood through the Flower Plugin lifecycle.
5. **Keep shared semantics aligned**: Workflow owner changes may require matching skill, hook, helper, or platform entry updates, but each full procedure stays with its owning capability.
6. **Keep project-specific rules project-local**: Use `.trellis/spec/` or a separately owned local skill; do not turn public `trellis-meta` into a project notebook.
7. **Preserve evidence and user content**: Respect Plugin ownership, first-backup/provenance records, template conflicts, and current user modifications. Never use `node_modules` as an authoring target.
