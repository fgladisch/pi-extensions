# @fgladisch/pi-bash-approval

Guards Pi `bash` tool calls behind an interactive allow-list. Every bash tool
call is intercepted; commands matching configured patterns run silently, anything
else prompts the user. In non-interactive contexts (`pi -p`, no UI), unknown
commands are blocked with a reason pointing at the config files.

<img src="./example.png" alt="Bash approval prompt example" width="600">

## Install

```bash
pi install npm:@fgladisch/pi-bash-approval
```

## Config

The extension reads two files:

1. **Global settings**: `~/.pi/agent/settings.json`
2. **Allow-list rules**: `~/.pi/agent/.bash-approval`

### Global settings (`settings.json`)

`splitChains` lives at `bashApproval.splitChains`:

```json
{
  "bashApproval": {
    "splitChains": true
  }
}
```

If missing or malformed, `splitChains` defaults to `true`.

### Allow-list rules (`.bash-approval`)

One rule per line:

```text
# bash approval allow-list
ls
ls:*
git status:*
npm test:*
```

Blank lines and `#` comment lines are ignored.

### Pattern syntax (`.bash-approval` lines)

| Pattern        | Matches                                                |
| -------------- | ------------------------------------------------------ |
| `ls`           | exact: `ls` only                                       |
| `ls:*`         | `ls` exactly, `ls <anything>` (space-separated)        |
| `git status:*` | `git status` exactly, `git status <anything>`          |
| `git*`         | trailing-`*` glob: any command starting with raw `git` |

The `:*` form is recommended: it requires an exact prefix plus trailing space, so
`git status:*` does **not** match `git statusfoo`. Bare `*` is a raw prefix match
and should be used sparingly.

### `splitChains`

Default `true`: split incoming commands on shell separators (`&&`, `||`, `;`,
`|`, newline) and require **every** segment to match the allow-list. Example:
`cd foo && git log` only runs unprompted when both segments are allow-listed.
Set `false` to match the entire command string as one unit.

### Shell control filtering

When `splitChains` is `true`, shell control/declaration segments are ignored so
approval checks focus on actual commands:

- ignored heads include `if`, `then`, `elif`, `else`, `for`, `do`, `done`, `fi`,
  `while`, `until`, `case`, `esac`, `function`
- condition tests (`[ ... ]`, `[[ ... ]]`, `test ...`) are ignored
- assignment-only segments like `FOO=bar` are ignored
- redirection-only segments like `> /tmp/out` after shell groups are ignored
- separators inside command substitutions like `$(git ls-files | sort)` are not
  treated as outer command-chain separators
- assignment prefixes before commands are stripped, e.g. `FOO=bar npm test`
  evaluates as `npm test`
- command substitutions inside assignment tokens are evaluated by their inner
  command, e.g. `tmp=$(mktemp -d /tmp/foo-XXXXXX)` evaluates as
  `mktemp -d /tmp/foo-XXXXXX`

## Prompt behavior

Unknown interactive commands show options:

- **Allow once**: allow this command without changing config.
- **Allow always (exact): `<command>`**: append the full trimmed command.
- **Allow always: `<prefix>:*`**: append the suggested parameter-aware prefix
  rule. The suggestion uses the first two tokens when present (`git status:*`,
  `npm install:*`, `mkdir -p:*`), otherwise the first token (`ls:*`). The
  suggestion is derived from the **first failing chain segment**, not the command
  head.
- **Allow always (command): `<command>:*`**: append command-only prefix rule for
  the first token of the failing segment (`mkdir:*`, `git:*`, `npm:*`). Hidden
  when it duplicates the parameter-aware suggestion.
- **Deny**: block with reason `Blocked by user`.

Selecting nothing (cancel) is treated as deny. "Allow always" choices persist
immediately to `~/.pi/agent/.bash-approval`.

## Slash commands

| Command                 | Action                                                                          |
| ----------------------- | ------------------------------------------------------------------------------- |
| `/bash-approval-reload` | Re-read `~/.pi/agent/.bash-approval` and `~/.pi/agent/settings.json` from disk. |
| `/bash-approval-list`   | Show currently allowed bash patterns.                                           |

## Inter-extension events

The extension emits lifecycle events on `pi.events` so another extension can
mirror approvals remotely while the local TUI remains active. For manual
approval requests the first valid local or remote answer wins; late remote
responses return `{ accepted: false, reason: "already_resolved" }`. Listener
failures are ignored so normal bash approval behavior remains the fallback.

| Event                             | When it fires                                           |
| --------------------------------- | ------------------------------------------------------- |
| `pi-bash-approval:config_loaded`  | After startup config load.                              |
| `pi-bash-approval:reloaded`       | After `/bash-approval-reload`.                          |
| `pi-bash-approval:evaluated`      | After allow-list evaluation, including auto-allow.      |
| `pi-bash-approval:request`        | Before opening the local approval prompt.               |
| `pi-bash-approval:resolved`       | After local or remote approval decision wins.           |
| `pi-bash-approval:rule_persisted` | After an `Allow always` rule write attempt.             |
| `pi-bash-approval:allowed`        | When a command is allowed by allow-list or user choice. |
| `pi-bash-approval:blocked`        | When a command is blocked.                              |
| `pi-bash-approval:closed`         | When a manual approval request can no longer answer.    |

`pi-bash-approval:request` includes stable option IDs and a
`respond(response)` callback. Remote responders can submit
`{ source: "remote", action: "allow_once" }`,
`{ source: "remote", action: "allow_always", optionId, rule }`, or
`{ source: "remote", action: "deny", reason? }`.
