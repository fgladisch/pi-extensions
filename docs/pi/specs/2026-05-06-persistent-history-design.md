# Design: `@fgladisch/pi-persistent-history`

- Date: 2026-05-06
- Status: Approved (design)
- Owner: @fgladisch

## 1) Problem Statement

Pi editor prompt history (up/down recall) is session-local and in-memory. It is not persisted as a project-local input history file by default. This extension adds per-project persistence so prompt recall survives restarts in the same repository/workspace.

This design is inspired by discussion `badlogic/pi-mono#1496`, adapted to this repo's extension conventions.

## 2) Goals

1. Persist prompt input history per project.
2. Reload persisted history on startup into editor up/down navigation.
3. Avoid permanent custom editor replacement conflicts.
4. Keep behavior simple and predictable.
5. Provide inspection/reload commands.

## 3) Non-Goals

1. Persist full chat transcript (assistant responses, tool output).
2. Build a global cross-project history.
3. Add fuzzy search UX for history.
4. Add migration logic for multiple legacy formats.

## 4) Chosen Approach

### Option selected

**Option A**: project file + `input` hook + one-time startup injection.

- Persist to `<cwd>/.pi/input-history.json`.
- Capture new prompts via `pi.on("input")`.
- On startup, perform a one-time injection into current editor history by reading `tui.focusedComponent` in `setEditorComponent(...)`, then return original editor unchanged.

### Why this option

- Meets per-project persistence requirement.
- Avoids permanent editor replacement (lower extension conflict risk).
- Keeps explicit, user-visible file with simple semantics.

### Trade-off accepted

- Startup preload uses internal TUI state (`focusedComponent`), which can break on future Pi internals changes.
- Extension degrades safely: persistence still works even if preload injection fails.

## 5) Public Surface

### Package name

- `@fgladisch/pi-persistent-history`

### Slash commands

- `/history-reload`
  - Re-read project history file and attempt re-injection into current editor history.
- `/history-status`
  - Show active project path, history file path, loaded count, effective max entries, and injector status.

## 6) Data Model

History file path:

- `<cwd>/.pi/input-history.json`

JSON shape:

```json
{
  "maxEntries": 250,
  "entries": ["latest command or prompt", "older prompt"]
}
```

Rules:

- `maxEntries`
  - Optional number in file.
  - Default: `250`.
  - Invalid/missing values fall back to default.
- `entries`
  - Array of strings.
  - Invalid entries are filtered out.

## 7) Runtime Components

1. **History store** (file I/O)
   - Load/parse/validate JSON.
   - Write normalized JSON back to disk.

2. **History runtime** (in-memory)
   - Keep current `entries` and effective `maxEntries`.
   - Append new input using dedupe + truncation rules.

3. **Editor injector** (startup/reload apply)
   - One-time `setEditorComponent` callback.
   - Read focused editor instance.
   - Call `addToHistory(...)` in reverse insertion order.
   - Return original editor unchanged.

## 8) Behavior Specification

### 8.1 Startup (`session_start`)

- If `ctx.hasUI === false`: no-op, return.
- Load history file.
- ENOENT:
  - Use defaults in memory.
  - Ensure `.pi/` exists and write default file.
- Attempt one-time injection into editor history.
- Record injector status for `/history-status`.

### 8.2 Input capture (`input` event)

- Read `event.text`.
- `trim()` and skip empty input.
- Include slash commands as normal entries.
- Duplicate policy: skip only consecutive duplicates.
- Insert new entry at front.
- Truncate to `maxEntries`.
- Persist file best-effort.

### 8.3 Reload command (`/history-reload`)

- Reload file from disk.
- Update in-memory state.
- Re-run injection attempt.
- Notify summary (`count`, `maxEntries`, injection status).

### 8.4 Status command (`/history-status`)

- Notify:
  - package/feature name,
  - cwd,
  - absolute file path,
  - entry count,
  - effective `maxEntries`,
  - last injection status.

### 8.5 Non-interactive mode

- Silent no-op for all UI-coupled behavior.
- No prompt/no error spam.

## 9) Error Handling

- Never throw from extension hooks for recoverable filesystem errors.
- Read errors:
  - `ENOENT`: recover with defaults and file creation.
  - malformed JSON/schema mismatch: recover with defaults.
- Write errors:
  - passive `input` flow: silent failure.
  - command-triggered operations (`/history-reload`, `/history-status` dependent operations): user-visible error via `ctx.ui.notify(..., "error")` where relevant.
- Injection errors:
  - report in runtime status,
  - do not block session.

## 10) Testing Plan (Jest)

File: `packages/pi-persistent-history/tests/persistent-history.spec.ts`

Core cases:

1. Registers expected commands and handlers.
2. Loads defaults on missing file and creates default file.
3. Falls back safely on malformed JSON.
4. Filters invalid `entries` and invalid `maxEntries`.
5. Captures prompt input and persists.
6. Includes slash commands in persisted history.
7. Skips consecutive duplicates only.
8. Enforces truncation to `maxEntries`.
9. No-op in non-interactive mode.
10. Injector success path adds loaded entries.
11. Injector failure path does not crash; status reflects failure.
12. `/history-reload` refreshes state and reports result.
13. `/history-status` reports resolved configuration and state.

Coverage target follows workspace defaults.

## 11) Implementation Boundaries

- Keep scope limited to prompt history persistence and preload.
- Do not add unrelated editor customization.
- Do not parse historic session files in v1.
- Do not add extra config files; use one project-local JSON file.

## 12) Future Extensions (Out of Scope for v1)

- Optional session-derived bootstrap.
- History search UI.
- Advanced dedupe modes (move-to-top/global dedupe).
- Multi-file history profiles per branch/worktree.

## 13) Acceptance Criteria

1. Prompt entered in project A is recalled after restart in project A.
2. Prompt history does not leak into project B.
3. Consecutive duplicate prompt is not duplicated.
4. History length never exceeds effective `maxEntries`.
5. Startup works even when injection fails (no crash).
6. Commands `/history-reload` and `/history-status` work as specified.
