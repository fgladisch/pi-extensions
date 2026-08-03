# @fgladisch/pi-user-select

## 0.2.0

### Minor Changes

- [#41](https://github.com/fgladisch/pi-extensions/pull/41) [`07397b6`](https://github.com/fgladisch/pi-extensions/commit/07397b6c78236a36eeee2425a46fedf6156deb61) Thanks [@flying7eleven](https://github.com/flying7eleven)! - Emit `herdr:blocked` events (toggling `active`) around interactive `user_select` prompts so a co-installed herdr agent-state extension reports the pane as blocked while awaiting a selection or custom answer. Controlled by the opt-in `userSelect.notifyHerdr` setting (default `false`).

## 0.1.4

### Patch Changes

- [#37](https://github.com/fgladisch/pi-extensions/pull/37) [`6c18825`](https://github.com/fgladisch/pi-extensions/commit/6c18825f2ee194817c9be03cd24ef4181b06b4cd) Thanks [@testzugang](https://github.com/testzugang)! - Add inter-extension lifecycle events for remote prompt and bash approval mirroring with first-response-wins callbacks.

## 0.1.3

### Patch Changes

- Render a trailing blank line after option descriptions in user select prompts.

## 0.1.1

- Fix multiline option description formatting to keep wrapped lines readable with hanging indentation.

_Changes based on: `7378051`._

## 0.1.0

- Initial release of `user_select` tool for interactive multiple-choice prompts with optional custom answers.

_Changes based on: `c32e7ac`._
