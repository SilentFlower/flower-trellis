When the user wants to change AI entry points, auto-trigger rules, or explicit command behavior, inspect the deployed skill/command/prompt/workflow and then classify its owner.

- **Upstream bundled**: distributed by Trellis and tracked by template hashes.
- **Skill-Garden managed**: modified or projected by `flower/skill-garden`, proven by lock/state entries or managed Patch markers.
- **Flower managed**: owned by another Flower Plugin, adapter, or Flower Patch catalog.
- **Shared common**: projected with shared ownership and retained across dependent capabilities.
- **Project-local**: no upstream template or Plugin ownership claim, and intentionally maintained by the project.

Do not classify every non-bundled name as project-local. Use `.flower/state.json`, `.trellis/.template-hashes.json`, local skill roots, and available Bundle declarations as evidence before selecting an edit route.
