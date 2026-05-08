# @fgladisch/pi-bash-approval

## 0.2.1

- Ignore shell condition-test segments (`[ ... ]`, `[[ ... ]]`, `test ...`) during approval matching so prompts no longer suggest invalid rules like `[ -f:*`.
- Move extension settings/split parser types from `extensions/utils.ts` to `extensions/types.ts` for clearer type ownership.

_Changes based on: `8c62ec9`._

## 0.2.0

- Migrate configuration to `~/.pi/agent/.bash-approval` (rules) and `~/.pi/agent/settings.json` (`bashApproval.splitChains`) instead of `bash-approval.json`.
- Improve shell-chain parsing by ignoring control/declaration scaffolding (`if/then/fi`, `for/do/done`, assignment-only segments) and evaluating real command segments.
- Update reload/help text and non-interactive block reason to point to new config paths.

_Changes based on: `ab08f61`._

## 0.1.0

- Initial release of interactive bash allow-list guard.

_Changes based on: `c32e7ac`._
