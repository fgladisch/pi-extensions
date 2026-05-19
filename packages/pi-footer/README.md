# @fgladisch/pi-footer

Minimal configurable footer and prompt input extension for Pi.

Default prompt input prefix:

```text
➜
```

Default footer:

```text
 gpt-5.5 (med)   pi-extensions   main
```

On session start, the footer reads Pi's current thinking level via `pi.getThinkingLevel()`, so it is visible immediately. Later changes update through Pi's `thinking_level_select` event.

The extension renders Pi extension statuses from `ctx.ui.setStatus()` after the git branch, using the same separator between status entries. Existing ANSI styling on those statuses is stripped and re-applied with the footer's dim color so statuses visually match the other footer segments.

## Install

```bash
pi install npm:@fgladisch/pi-footer
```

Or use from this workspace with Pi extension package discovery.

## Configuration

Optional config file: `~/.pi/agent/footer.json`

```json
{
  "icons": {
    "model": "",
    "project": "",
    "branch": ""
  },
  "promptInput": {
    "prefix": "➜"
  },
  "separator": "",
  "segments": {
    "model": true,
    "project": true,
    "branch": true
  }
}
```

Partial config is supported. Invalid fields fall back to defaults. Set `promptInput.prefix` to customize the arrow shown next to the prompt input; it renders in the active theme's accent color. Use an empty string to hide it.

## Commands

- `/footer-reload` — reload `~/.pi/agent/footer.json` and reapply the footer.
