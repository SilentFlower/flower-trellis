## General Operation Order

1. **Confirm scope**: inspect enabled platform roots and the current active task.
2. **Read runtime truth**: read `.trellis/workflow.md`, `.trellis/config.yaml`, and the relevant platform files.
3. **Resolve ownership**: inspect `.flower/plugins.json`, `.flower/plugin-lock.json`, `.flower/state.json`, `.trellis/.template-hashes.json`, and managed markers.
4. **Choose one route**:
   - project-local or native local customization: edit the narrowly scoped local source;
   - Flower/Skill-Garden managed target: edit the owning Plugin/Patch source, not the deployed result.
5. **For Skill-Garden 0.6 authoring**: change `vendor/skill-garden/.trellis/0.6/`, run `npm run sync`, regenerate/check compiled targets, then apply the Flower lifecycle to dogfood targets.
6. **Verify final semantics**: check every existing platform target, conflict assertions, provenance, and idempotency. The final files must agree with `.trellis/workflow.md` and their workflow owner.
