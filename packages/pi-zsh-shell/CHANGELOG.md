# @fgladisch/pi-zsh-shell

## 0.2.1

### Patch Changes

- Require configured zsh shell paths from `PI_ZSH_SHELL` and `SHELL` to be absolute before using them.

## 0.2.0

### Minor Changes

- Add configurable zsh shell selection using `PI_ZSH_SHELL`, `$SHELL` when it points to zsh, and `/bin/zsh` fallback.

## 0.1.0

### Minor Changes

- Initial release. Run Pi user bash commands through zsh and source `~/.pi/agent/zsh-functions` when present.
