## Local Customization Boundaries

Editable by default:

- `.trellis/workflow.md`
- `.trellis/config.yaml`
- `.trellis/spec/**`
- `.trellis/scripts/**`
- Platform hooks, settings, agents, skills, commands, prompts, and workflows

Do not edit by default:

- Global npm install directory
- `node_modules/@mindfoldhq/trellis`
- Trellis GitHub repository source code
- Concrete state files under `.trellis/.runtime/**`
- Hash contents inside `.trellis/.template-hashes.json`

Switch to the Trellis CLI source-code perspective only when the user explicitly wants to contribute upstream.
