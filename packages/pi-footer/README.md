# @fgladisch/pi-footer

Minimal configurable footer and prompt input extension for Pi.

Default prompt input prefix:

```text
➜
```

Footer example with GitHub-renderable emoji icons:

```text
🤖 gpt-5.5 (med) | ⏱️ 69% | 📁 pi-extensions | 🌿 main
```

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
    "model": true,
    "context": true,
    "project": true,
    "branch": true
  }
}
```

Partial config is supported. Invalid fields fall back to defaults. Set `promptInput.prefix` to customize the arrow shown next to the prompt input; it renders in the active theme's accent color. Use an empty string to hide it.

## Commands

- `/footer-reload` — reload `~/.pi/agent/footer.json` and reapply the footer.
