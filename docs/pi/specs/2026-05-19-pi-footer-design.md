# pi-footer Design

## Goal

Add a minimal configurable Pi extension package named `@fgladisch/pi-footer` that replaces Pi's TUI footer with a compact single-line workspace summary plus a trailing blank line so later footer additions render on a new line.

Example default output:

```text
 GPT-5.5  think:med   pi-extensions   main

```

## Architecture

The extension registers a custom footer with `ctx.ui.setFooter()` during `session_start` when `ctx.hasUI` is true. The footer renderer reads live data from the extension context and `footerData`, then returns two rendered lines: the formatted footer line and an empty string. Returning the empty second line creates vertical separation below this footer so other footer additions or terminal content begin on a fresh line.

The package follows existing workspace layout: source in `packages/pi-footer/extensions/`, tests in `packages/pi-footer/tests/`, and docs in `packages/pi-footer/README.md`.

## Configuration

The extension loads optional JSON config from `~/.pi/agent/footer.json`. If the file is absent or invalid, it uses defaults and continues silently enough for startup safety.

Supported config:

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

Partial config merges with defaults. Invalid field types are ignored per field.

## Footer Data

- Model: `ctx.model?.id`; fallback `no-model`.
- Thinking level: current value updated by the `thinking_level_select` event; initial fallback from config `defaultThinkingLevel`.
- Project: `basename(ctx.cwd)`; fallback `workspace` for empty basenames.
- Git branch: `footerData.getGitBranch()`; fallback `no-branch`.

The footer subscribes to `footerData.onBranchChange()` and calls `tui.requestRender()` when branch changes. The extension also requests a render on `thinking_level_select` and `model_select` when a footer handle exists. The returned unsubscribe function is exposed as footer component `dispose`.

## Commands

Register `/footer-reload` to re-read `~/.pi/agent/footer.json` and reapply the footer without restarting Pi. The command only acts when UI is available; otherwise it returns without error.

## Rendering

The renderer joins enabled parts with `separator` spacing and truncates the full line to the render width using `truncateToWidth()` from `@earendil-works/pi-tui`. It returns `[line, ""]` for the required blank line after the footer.

## Error Handling

- Missing config file uses defaults.
- Invalid JSON or unreadable config uses defaults.
- Non-UI sessions do not register the footer.
- Narrow terminal widths still receive lines no longer than `width`.

## Testing

Unit tests cover:

- registering a footer on UI session start;
- no footer registration without UI;
- default formatting of model, thinking, project, and branch;
- returning a blank line after the footer;
- truncation to width;
- config override of icons, separator, thinking prefix, and hidden fields;
- `/footer-reload` re-reading config and reapplying footer;
- branch-change, thinking-level, and model-change updates requesting re-render, plus dispose calling unsubscribe.

## Documentation

Update root `README.md` package list and add `packages/pi-footer/README.md` with install/config/example output. Add `CHANGELOG.md` for release readiness.
