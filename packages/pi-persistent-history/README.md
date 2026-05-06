# @fgladisch/pi-persistent-history

Persist Pi prompt input history per project.

## Install

```bash
pi install npm:@fgladisch/pi-persistent-history
```

## Behavior

- Stores history in `<project>/.pi/input-history.json`
- Captures prompts from `input` events (including slash commands)
- Skips consecutive duplicates
- Respects `maxEntries` (default `250`)
- Loads and injects history at startup for up/down recall
- In non-interactive mode, performs no action

## Slash commands

- `/history-reload` — Reload project history file and re-inject entries into editor history
- `/history-status` — Show file path, entry count, maxEntries, and injection status

## File format

```json
{
  "maxEntries": 250,
  "entries": ["latest first", "older"]
}
```
