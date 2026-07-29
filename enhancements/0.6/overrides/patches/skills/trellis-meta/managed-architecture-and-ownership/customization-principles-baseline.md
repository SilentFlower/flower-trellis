## AI Customization Principles

1. **Find the local source of truth first**: Do not edit from memory. Read `.trellis/workflow.md`, `.trellis/config.yaml`, the relevant platform directory, and related task files first.
2. **Edit the user project, not the npm package cache**: Modify generated files inside the project, not `node_modules` or the global npm install directory.
3. **Keep platform files aligned with `.trellis/`**: If workflow routing changes, also check whether platform skills or commands still describe the same flow.
4. **Put project-specific rules in `.trellis/spec/` or a local skill**: Do not put team conventions into `trellis-meta`.
5. **Preserve user changes**: If a file was already modified locally, work from the current content instead of overwriting it with a default template.
