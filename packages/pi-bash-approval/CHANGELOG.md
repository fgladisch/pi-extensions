# @fgladisch/pi-bash-approval

## Unreleased

- Add inter-extension lifecycle events for remote bash approval mirroring and responses.

## 0.2.6

- Ignore heredoc bodies during bash approval command splitting so literal commit message content is not suggested as an allow-list command.

## 0.2.5

- Require nested backtick, command, and process substitutions to match bash approval rules.

## 0.2.4

- Add a command-only allow-list prompt option for bash approvals.

## 0.2.3

- Evaluate command substitutions inside assignment tokens by their inner command so bash approval suggestions no longer offer invalid flag prefixes like `-d ...):*`, and assignment-prefixed commands check setup substitutions before the main command.

## 0.2.2

- Ignore redirection-only shell group segments when suggesting bash approval rules.
- Avoid splitting bash approval command chains on separators inside command substitutions.

## 0.2.1

- Ignore shell condition-test segments (`[ ... ]`, `[[ ... ]]`, `test ...`) during approval matching so prompts no longer suggest invalid rules like `[ -f:*`.
- Move extension settings/split parser types from `extensions/utils.ts` to `extensions/types.ts` for clearer type ownership.

## 0.2.0

- Migrate configuration to `~/.pi/agent/.bash-approval` (rules) and `~/.pi/agent/settings.json` (`bashApproval.splitChains`) instead of `bash-approval.json`.
- Improve shell-chain parsing by ignoring control/declaration scaffolding (`if/then/fi`, `for/do/done`, assignment-only segments) and evaluating real command segments.
- Update reload/help text and non-interactive block reason to point to new config paths.

## 0.1.0

- Initial release of interactive bash allow-list guard.
