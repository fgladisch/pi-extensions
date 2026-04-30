# @fgladisch/pi-caveman

Always-on **caveman mode** for Pi: prepends the upstream
[JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) ruleset to
the system prompt every turn so the model speaks like a smart caveman and
burns ~75% fewer output tokens.

## Install

```bash
pi install npm:@fgladisch/pi-caveman
```

## First-time setup

Fetch upstream ruleset:

```bash
/caveman update
```

This clones into `~/.pi/agent/caveman/upstream/`. Re-running `/caveman update`
pulls latest. If ruleset is missing on session start, extension warns and skips
injection until you run update.

## Slash commands

| Command                         | Action                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------- |
| `/caveman` or `/caveman status` | Show current status (level + whether `SKILL.md` is loaded)                      |
| `/caveman lite`                 | Enable, intensity `lite`: no filler/hedging, full sentences                     |
| `/caveman full`                 | Enable, intensity `full` (default): drop articles, fragments OK, short synonyms |
| `/caveman ultra`                | Enable, intensity `ultra`: abbreviations, arrows, one-word answers              |
| `/caveman off`                  | Disable injection (state persists, data stays installed)                        |
| `/caveman update`               | `git clone` (first run) or `git pull --ff-only` upstream repo                   |

Argument completion is wired up. Typing `/caveman ` and tabbing cycles valid
tokens. Status bar shows `🪨 caveman <level>` or `🪨 caveman off`.

## Switching off mid-session

Ruleset itself reserves phrases **`stop caveman`** and **`normal mode`**. Say
either to model and it drops caveman style for remainder of response. Injection
stays active until `/caveman off`.

## Levels at a glance

Example: "Why React component re-render?"

- **lite**: "Your component re-renders because you create a new object reference each render. Wrap it in `useMemo`."
- **full**: "New object ref each render. Inline object prop = new ref = re-render. Wrap in `useMemo`."
- **ultra**: "Inline obj prop → new ref → re-render. `useMemo`."

## Auto-clarity

Ruleset tells model to drop caveman style for security warnings,
irreversible-action confirmations, multi-step sequences where fragment order
risks misreads, and explicit "clarify / repeat" requests, then resume.
Code/commits/PR text stays normal English.
