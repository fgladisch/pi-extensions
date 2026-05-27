# @fgladisch/pi-footer

Minimal configurable footer and prompt input extension for Pi.

Default prompt input prefix:

```text
➜
```

Footer example:

![Footer example](../../assets/example.png)

Footer items render in the active theme's text color over the theme's `customMessageBg` background, with padding before the first item and before the end cap. Separators render in the active theme's dim color.

## Install

```bash
pi install npm:@fgladisch/pi-footer
```

Or use from this workspace with Pi extension package discovery.

## Configuration

Optional config file: `~/.pi/agent/footer.json`

Emoji icon example:

```json
{
  "icons": {
    "provider": "☁️",
    "model": "🤖",
    "context": "⏱️",
    "project": "📁",
    "branch": "🌿"
  },
  "promptInput": {
    "prefix": "➜"
  },
  "separator": "|",
  "segments": {
    "provider": true,
    "model": true,
    "context": true,
    "project": true,
    "branch": true
  }
}
```

Partial config is supported. Invalid fields fall back to defaults. Set `promptInput.prefix` to customize the arrow shown next to the prompt input; it renders in the active theme's accent color. Use an empty string to hide it.

The `provider` segment is off by default. Enable it to distinguish models served by different providers (for example, `anthropic` via the official API versus a custom provider such as `claude-bridge`). When enabled it renders immediately before the model segment.

## Commands

- `/footer-reload` — reload `~/.pi/agent/footer.json` and reapply the footer.
