# Codex SessionStart Hooks Research

## Source

- OpenAI Codex manual fetched by `openai-docs` helper:
  - Manual path: `/private/tmp/openai-docs-cache/codex-manual.md`
  - Status: local manual was already current
  - Relevant section: Hooks, source page `/codex/hooks.md`

## Findings

- Codex hooks can be configured in `hooks.json` next to active config layers or inline `[hooks]` tables in `config.toml`.
- Project-local hooks load only when the project `.codex/` layer is trusted.
- Hook config has three levels: event, matcher group, and hook handlers.
- `timeout` is measured in seconds; if omitted, Codex uses 600 seconds.
- `SessionStart` matcher filters start source. Supported values are `startup`, `resume`, `clear`, and `compact`.
- Omitting `matcher`, using an empty matcher, or using `*` matches every occurrence of the supported event.
- Multiple matching command hooks for the same event are launched concurrently; one matching hook cannot prevent another matching hook from starting.

## Task Implications

- Codex Trellis main context hook should use an explicit matcher instead of relying on omitted matcher behavior:
  - `matcher: "startup|resume|clear|compact"`
  - `timeout: 30`
- Codex flower update hook should be narrower because it is user-facing update prompting rather than core Trellis context:
  - `matcher: "startup"`
  - `timeout: 30`
- `codex-tweaks.js` must migrate old no-matcher groups for these commands to avoid duplicate matching hooks.
