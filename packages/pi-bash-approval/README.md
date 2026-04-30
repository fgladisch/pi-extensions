# @fgladisch/pi-bash-approval

Guards Pi `bash` tool behind interactive allow-list. Every bash tool call is
intercepted; commands matching configured pattern run silently, anything else
prompts user. In non-interactive contexts (`pi -p`, no UI), unknown commands
are blocked with reason pointing at config file.

## Install

```bash
pi install npm:@fgladisch/pi-bash-approval
```

## Config

Lives at `~/.pi/agent/bash-approval.json`. Created with sensible defaults on
first run. If file is malformed, every command prompts.

```json
{
  "allowed": ["ls", "ls:*", "git status:*", "npm test:*"],
  "splitChains": true
}
```

### Pattern syntax (`allowed[]`)

| Pattern        | Matches                                            |
| -------------- | -------------------------------------------------- |
| `ls`           | exact: `ls` only                                   |
| `ls:*`         | `ls` exactly, or `ls <anything>` (space-separated) |
| `git status:*` | `git status` exactly, or `git status <anything>`   |
| `git*`         | trailing-`*` glob: any command starting with `git` |

`:*` form is recommended: requires exact match or trailing space, so
`git status:*` does **not** match `git statusfoo`. Bare `*` form is raw prefix
match. Use sparingly.

### `splitChains`

Default `true`: split incoming commands on shell separators (`&&`, `||`, `;`,
`|`, newline) and require **every** segment to match allow-list. Example:
`cd foo && git log` only runs unprompted when both segments are allow-listed.

Set `false` to match entire command string as one unit.

## Approval prompt

On non-matching command in interactive mode, user picks:

- **Allow once**: run this invocation, persist nothing.
- **Allow always (exact): `<command>`**: append literal command to
  `allowed[]` (truncated to 60 chars in label only). Hidden when exact command
  already on list.
- **Allow always: `<prefix>:*`**: append suggested prefix rule. Suggestion
  uses first two tokens when present (`git status:*`, `npm install:*`,
  `kubectl get:*`), otherwise first token (`ls:*`). Suggestion is derived from
  **first failing chain segment**, not head.
- **Deny**: block with reason `Blocked by user`.

Selecting nothing (cancel) is treated as deny. "Allow always" choices persist
immediately to `bash-approval.json`.

## Slash commands

| Command                 | Action                                                                          |
| ----------------------- | ------------------------------------------------------------------------------- |
| `/bash-approval-reload` | Re-read `~/.pi/agent/bash-approval.json` from disk (use after editing by hand). |
| `/bash-approval-list`   | Show currently allowed bash patterns.                                           |
