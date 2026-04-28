# pi-extensions

Personal pi extensions. Pi auto-discovers `*.ts` files in this directory at
runtime; the `package.json`, `tsconfig.json`, and `node_modules/` here exist
solely to give VSCode/tsserver type resolution and to host dev tooling.

> Do **not** add a `pi.extensions` field to `package.json` — that would
> override pi's auto-discovery.

## Setup

Install dev dependencies:

```sh
npm install
```

## Scripts

- `npm run typecheck` — run `tsc --noEmit`
- `npm test` — run jest
- `npm run test:coverage` — jest with coverage
- `npm run lint` — eslint (auto-fix) over root and `tests/` `.ts` files
- `npm run lint:file <path>` — eslint (auto-fix) on a single file
- `npm run format` — prettier `--write` over `**/*.{ts,js,cjs,md,json}`
- `npm run format:file <path>` — prettier `--write` on a single file

## Extensions

### `caveman.ts`

Always-on **caveman mode**: prepends the upstream caveman ruleset to the system
prompt every turn so the model speaks like a smart caveman and burns ~75%
fewer output tokens. Wraps [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman)
as a pi extension instead of a passive skill — a pi skill would only inject
its `description`, not the full ruleset, which defeats the purpose.

#### Install

First run fetches the upstream repo:

```
/caveman update
```

This clones `https://github.com/JuliusBrussee/caveman.git` into
`~/.pi/agent/caveman/upstream/` (shallow, depth 1). Re-running
`/caveman update` does a `git pull --ff-only` against that checkout.

If `SKILL.md` is missing on session start, the extension surfaces a warning
telling you to run `/caveman update`. Injection is skipped in that state —
pi keeps working normally.

#### Data layout

```
~/.pi/agent/caveman/
├── state.json                          # { enabled, level } persisted across sessions
└── upstream/                           # cloned upstream repo
    └── skills/caveman/SKILL.md         # ruleset injected each turn
```

`state.json` is created with defaults (`{ enabled: true, level: "full" }`) on
first run. Edit via the `/caveman` command, not by hand.

#### Slash commands

| Command                         | Action                                                                           |
| ------------------------------- | -------------------------------------------------------------------------------- |
| `/caveman` or `/caveman status` | Show current status (level + whether `SKILL.md` is loaded)                       |
| `/caveman lite`                 | Enable, intensity `lite` — no filler/hedging, full sentences                     |
| `/caveman full`                 | Enable, intensity `full` (default) — drop articles, fragments OK, short synonyms |
| `/caveman ultra`                | Enable, intensity `ultra` — abbreviations, arrows, one-word answers              |
| `/caveman wenyan-lite`          | Enable, classical Chinese lite (semi-classical, full grammar)                    |
| `/caveman wenyan-full`          | Enable, classical Chinese full (文言文, ~80–90% char reduction)                  |
| `/caveman wenyan-ultra`         | Enable, classical Chinese ultra (extreme compression)                            |
| `/caveman off`                  | Disable injection (state persists, data stays installed)                         |
| `/caveman update`               | `git clone` (first run) or `git pull --ff-only` upstream repo                    |

Argument completion is wired up — typing `/caveman ` and tabbing cycles
through the valid tokens above.

#### Hooks

- `session_start` — loads `SKILL.md` into memory, sets the status bar entry
  (`🪨 caveman <level>` or `🪨 caveman off`), warns if `SKILL.md` is missing.
- `before_agent_start` — when enabled and skill is loaded, appends a
  `<caveman-mode active level="…">…</caveman-mode>` block to
  `event.systemPrompt`. Returns `undefined` (no-op) when disabled or skill
  missing.

#### Switching off mid-session

The ruleset itself reserves the phrases **`stop caveman`** and **`normal
mode`** — say either to the model and it drops caveman style for the
remainder of the response. The injection itself stays active until you run
`/caveman off`. To kill it permanently for the session, use the slash
command.

#### Levels at a glance

Example — "Why React component re-render?"

- **lite**: "Your component re-renders because you create a new object reference each render. Wrap it in `useMemo`."
- **full**: "New object ref each render. Inline object prop = new ref = re-render. Wrap in `useMemo`."
- **ultra**: "Inline obj prop → new ref → re-render. `useMemo`."
- **wenyan-lite**: "組件頻重繪，以每繪新生對象參照故。以 useMemo 包之。"
- **wenyan-full**: "物出新參照，致重繪。useMemo Wrap之。"
- **wenyan-ultra**: "新參照→重繪。useMemo Wrap。"

#### Auto-clarity

The ruleset tells the model to drop caveman style for security warnings,
irreversible-action confirmations, multi-step sequences where fragment order
risks misreads, and explicit "clarify / repeat that" requests — then resume
caveman after the clear part is done. Code, commits, and PR text are always
written in normal English.

### `welcome-message.ts`

Displays a custom workspace summary block in the UI at the start of a session.

When pi starts in an interactive UI context (`ctx.hasUI === true`), this extension renders a welcome message with:

- **Package Info**: The project name and version from `package.json` (if present).
- **Git Context**: The current branch, working directory status (clean or dirty with shortstat), and the last 5 commits.

The output uses custom UI components and theme colors (e.g., `customMessageBg`, `toolPendingBg`) for distinct visual sections.

#### Hooks

- `session_start` — Gathers `package.json` and git data via `pi.exec`, then emits a custom message using `pi.sendMessage`.
- `registerMessageRenderer("welcome")` — Defines the TUI rendering logic for the custom message type.

### `bash-approval.ts`

Guards the `bash` tool behind an interactive allow-list. Every bash tool call
is intercepted; commands matching a configured pattern run silently, anything
else prompts the user. In non-interactive contexts (`pi -p`, no UI), unknown
commands are blocked outright with a reason pointing at the config file.

#### Config

Lives at `~/.pi/agent/bash-approval.json`. Created with defaults on first run
(ENOENT → write `{ "allowed": [], "splitChains": true }`). Malformed JSON or
other read errors fall back to the in-memory default — pi keeps working, every
command just prompts.

```json
{
  "allowed": ["ls", "ls:*", "git status:*", "npm test:*"],
  "splitChains": true
}
```

**Pattern syntax** (`allowed[]`):

| Pattern        | Matches                                             |
| -------------- | --------------------------------------------------- |
| `ls`           | exact: `ls` only                                    |
| `ls:*`         | `ls` exactly, or `ls <anything>` (space-separated)  |
| `git status:*` | `git status` exactly, or `git status <anything>`    |
| `git*`         | trailing-`*` glob — any command starting with `git` |

The `:*` form is the recommended one: it requires either an exact match or a
trailing space, so `git status:*` does **not** accidentally match
`git statusfoo`. The bare-`*` form is a raw prefix match — use sparingly.

**`splitChains`** (default `true`): split incoming commands on shell
separators (`&&`, `||`, `;`, `|`, newline) — respecting single/double quotes
and backslash escapes — and require **every** segment to match the allow-list.
A chain like `cd foo && git log` only runs unprompted when both `cd foo` and
`git log` resolve to allow-list entries. Set `false` to match the entire
command string as one unit. The splitter is a pragmatic shell-ish parser, not
a full POSIX one — good enough for the commands the agent actually emits.

#### Approval prompt

On a non-matching command in interactive mode, the user picks from:

- **Allow once** — run this invocation, persist nothing.
- **Allow always (exact): `<command>`** — append the literal command to
  `allowed[]` (truncated to 60 chars in the label only). Hidden when the
  exact command is already on the list.
- **Allow always: `<prefix>:*`** — append a suggested prefix rule. Suggestion
  uses the first two tokens when present (`git status:*`, `npm install:*`,
  `kubectl get:*`) so subcommand-style tools get a useful default; falls back
  to the first token alone (`ls:*`). Crucially, the suggestion is derived from
  the **first failing segment** of a chain, not the head — so
  `cd /tmp && git log` with only `cd` allow-listed offers `git log:*`, not
  `cd /tmp:*`. Hidden when the suggested rule equals the exact command or is
  already on the list.
- **Deny** — block with reason `Blocked by user`.

Selecting nothing (cancel) is treated as deny. Persisted rules are written
back to `bash-approval.json` immediately; write failures surface via
`ctx.ui.notify(..., "error")` and the rule is dropped from the in-memory
config too.

#### Slash commands

| Command                 | Action                                                                          |
| ----------------------- | ------------------------------------------------------------------------------- |
| `/bash-approval-reload` | Re-read `~/.pi/agent/bash-approval.json` from disk (use after editing by hand). |
| `/bash-approval-list`   | Show currently allowed bash patterns.                                           |

#### Hooks

- `tool_call` — only acts on `bash` tool calls (via `isToolCallEventType`).
  Empty/whitespace commands fall through. Matching commands fall through.
  Non-matching commands either block (no UI) or prompt and apply the user's
  choice.

See [bash-approval.ts](bash-approval.ts) and
[tests/bash-approval.spec.ts](tests/bash-approval.spec.ts).
