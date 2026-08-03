---
"@fgladisch/pi-user-select": minor
---

Emit `herdr:blocked` events (toggling `active`) around interactive `user_select` prompts so a co-installed herdr agent-state extension reports the pane as blocked while awaiting a selection or custom answer. Controlled by the opt-in `userSelect.notifyHerdr` setting (default `false`).
