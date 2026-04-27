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

### `bash-approval.ts`

See [bash-approval.ts](bash-approval.ts) and
[tests/bash-approval.spec.ts](tests/bash-approval.spec.ts).
