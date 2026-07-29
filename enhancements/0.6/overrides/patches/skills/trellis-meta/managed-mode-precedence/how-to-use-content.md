## How To Use

1. Read `references/local-architecture/overview.md` first to establish the local Trellis system model.
2. Determine ownership before choosing an edit point. Inspect `.flower/plugins.json`, `.flower/plugin-lock.json`, `.flower/state.json`, `.trellis/.template-hashes.json`, and managed markers that actually exist.
3. If `flower/skill-garden` owns the target, read `references/customize-local/overview.md` and follow the managed source/Patch route. If it does not, follow the native or project-local route described by the relevant reference.
4. For a specific AI tool, read `references/platform-files/platform-map.md` and the relevant platform notes. For multi-agent dispatch or channel workers, also read `references/local-architecture/multi-agent-channel.md` and `.trellis/agents/`.
5. Before editing, read the actual target, its owner state, and its authoring source. Runtime content is authoritative for what currently executes; ownership evidence is authoritative for where a durable change belongs.
