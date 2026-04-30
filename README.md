# pi-extensions

Monorepo for personal Pi extensions.

This root workspace holds shared tooling. Source-of-truth extension code
and full documentation live in `packages/`.

## Packages

- [`@fgladisch/pi-bash-approval`](packages/pi-bash-approval/README.md): Intercepts Pi bash calls and asks for approval unless a command matches your allow-list.
- [`@fgladisch/pi-caveman`](packages/pi-caveman/README.md): Injects an always-on caveman prompt style with switchable intensity levels.
- [`@fgladisch/pi-user-select`](packages/pi-user-select/README.md): Adds a `user_select` tool so Pi can ask humans multiple-choice questions in workflow.
- [`@fgladisch/pi-welcome-message`](packages/pi-welcome-message/README.md): Shows a startup workspace summary with package info, git status, and useful resource links.
