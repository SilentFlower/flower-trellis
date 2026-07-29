## Skill Routing

`workflow.md` separates routing by platform capability:

- Platforms with sub-agent support: dispatch `trellis-implement` by default for implementation and `trellis-check` for checking.
- Platforms without sub-agent support: the main session reads skills such as `trellis-before-dev`, then executes directly.

When changing local AI behavior, update the routing descriptions in `workflow.md` first, then check whether the corresponding platform skill, command, or agent files need to stay in sync.
