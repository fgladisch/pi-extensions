# @fgladisch/pi-zsh-shell

Run Pi user bash commands through `zsh` while sourcing Pi-specific shell functions from `~/.pi/agent/zsh-functions`.

## What it does

This extension hooks Pi's `user_bash` execution and wraps each command in:

```sh
exec /bin/zsh -fc 'if [ -r ~/.pi/agent/zsh-functions ]; then source ~/.pi/agent/zsh-functions; fi
<your command>'
```

`zsh -f` keeps startup fast and avoids loading interactive config such as `~/.zshrc`, prompt plugins, Powerlevel10k, or gitstatus.

## Pi zsh functions

Create `~/.pi/agent/zsh-functions` for helpers you want available inside Pi commands:

```sh
gst() {
  git status "$@"
}

ll() {
  ls -lah "$@"
}
```

The file is sourced only when readable. Missing file is ignored.

Prefer functions over aliases. Functions work reliably in this non-interactive `zsh -f -c` flow, while aliases are parsed earlier and can be surprising.

## Shell selection

By default the extension uses:

1. `PI_ZSH_SHELL`, if set
2. `$SHELL`, when its basename is `zsh`
3. `/bin/zsh`

Example:

```sh
export PI_ZSH_SHELL=/opt/homebrew/bin/zsh
```
