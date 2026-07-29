## Overriding a Bundled Skill Locally

First determine whether the deployed bundled skill is only Trellis-managed or also owned by Flower/Skill-Garden.

- In a native Trellis project, template-hash conflict handling still permits a local divergence, with the normal cross-platform and future-update caveats.
- In a Flower-managed project, do not directly edit a target recorded in `.flower/state.json`. Change the owning Plugin/Patch source and let preflight plus the transaction writer update every existing platform target consistently.
- In the Flower source checkout, Skill-Garden 0.6 modifications belong under `vendor/skill-garden/.trellis/0.6/overrides/`; run `npm run sync`, refresh/check compiled targets, then apply the Plugin to dogfood targets.
- For project-private behavior, prefer `.trellis/spec/` or a differently named project-local skill that has no upstream or Plugin ownership claim.

If Skill-Garden is removed and its state ownership is cleanly released, the remaining bundled skill returns to native Trellis update semantics. Do not leave managed prose behind after uninstall or freeze assumptions into this reference.
