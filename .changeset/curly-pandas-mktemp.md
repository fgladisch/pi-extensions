---
"@fgladisch/pi-bash-approval": patch
---

Evaluate command substitutions inside assignment tokens by their inner command so bash approval suggestions no longer offer invalid flag prefixes like `-d ...):*`, and assignment-prefixed commands check setup substitutions before the main command.
