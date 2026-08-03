---
"@fgladisch/pi-bash-approval": minor
---

Emit `herdr:blocked` events (toggling `active`) around interactive bash approval prompts so a co-installed herdr agent-state extension reports the pane as blocked while awaiting approval. Controlled by the opt-in `bashApproval.notifyHerdr` setting (default `false`).
