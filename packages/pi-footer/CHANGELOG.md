# @fgladisch/pi-footer

## Unreleased

### Minor Changes

- Add a configurable prompt input prefix, defaulting to an accent-colored `➜` via `promptInput.prefix` in `footer.json`.

### Patch Changes

- Render footer items and extension statuses with the explicit theme `text` color instead of leaving footer items unstyled and coloring extension statuses with `dim`.

## 0.3.0

### Minor Changes

- Render extension status entries from `ctx.ui.setStatus()` after the git branch.

## 0.1.0

### Minor Changes

- Add minimal configurable Pi footer extension.
