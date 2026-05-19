# @fgladisch/pi-footer

Minimal configurable footer extension for Pi.

Default footer:

```text
 gpt-5.5 (med)   pi-extensions   main
```

If Pi has not reported a thinking level yet, the model segment omits it:

```text
 gpt-5.5   pi-extensions   main
```

The extension renders Pi extension statuses from `ctx.ui.setStatus()` after the git branch, using the same separator between status entries.

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
  "separator": "",
  "segments": {
    "model": true,
    "project": true,
    "branch": true
  }
}
```

Partial config is supported. Invalid fields fall back to defaults.

## Commands

- `/footer-reload` — reload `~/.pi/agent/footer.json` and reapply the footer.
