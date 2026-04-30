# @fgladisch/pi-welcome-message

Shows workspace summary in UI when session starts.

Only runs on real startup in interactive UI. `/new`, forks, and headless
(`pi -p`) runs are silent. Sections with nothing to show are dropped; if every
section is empty, no message appears.

## Install

```bash
pi install npm:@fgladisch/pi-welcome-message
```

## Example

![Welcome message example](./example.png)

## Summary sections

- **📦 Package**: name, version, and description from `package.json`.
- **🌿 Git**: current branch, working-tree status (clean or dirty shortstat),
  and last 5 commits.
- **Resources**
  - `[Skills]`: registered skill commands.
  - `[Prompts]`: registered prompt commands.
  - `[Extensions]`: extensions installed locally in
    `~/.pi/agent/extensions/` plus any `packages` entries from
    `~/.pi/agent/settings.json`.

No config, no slash commands.
