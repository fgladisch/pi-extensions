# @fgladisch/pi-footer

Minimal configurable footer extension for Pi.

Default footer:

```text
 GPT-5.5  think:med   pi-extensions   main

```

The extension renders Pi extension statuses from `ctx.ui.setStatus()` after the git branch, using the same separator between status entries. It also intentionally renders a blank line after the footer so terminal content starts on a new line.

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
  "thinkingPrefix": "think:",
  "defaultThinkingLevel": "med",
  "show": {
    "model": true,
    "thinking": true,
    "project": true,
    "branch": true
  }
}
```

Partial config is supported. Invalid fields fall back to defaults.

## Commands

- `/footer-reload` — reload `~/.pi/agent/footer.json` and reapply the footer.
