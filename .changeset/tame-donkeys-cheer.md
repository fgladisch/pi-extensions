---
"@fgladisch/pi-bash-approval": patch
---

Treat trailing backslash-newline as a line continuation when splitting commands. Multi-line commands using `\` line continuations no longer produce a spurious `\` segment that triggers a separate approval prompt.
