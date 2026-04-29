/**
 * Bash Approval Extension
 *
 * Asks for approval before executing bash tool calls unless the command
 * matches an entry in the allow-list configured at:
 *
 *   ~/.pi/agent/bash-approval.json
 *
 * Config format:
 * {
 *   "allowed": [
 *     "ls",            // exact match
 *     "ls:*",          // matches "ls" and "ls <anything>"
 *     "git status:*",  // matches "git status" and "git status <anything>"
 *     "npx test:*"
 *   ],
 *   "splitChains": true  // (default) split on &&, ||, ;, | and require every segment to match
 * }
 *
 * On a non-matching command, the user is prompted with options to:
 *   - allow once,
 *   - allow always (persist exact command to the JSON),
 *   - allow always with a sensible "<prefix>:*" rule,
 *   - or deny.
 *
 * In non-interactive contexts (e.g. `pi -p`), non-matching commands are blocked.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const CONFIG_DIR = path.join(os.homedir(), ".pi", "agent");
const CONFIG_PATH = path.join(CONFIG_DIR, "bash-approval.json");

type BashApprovalConfig = {
  allowed: string[];
  splitChains: boolean;
};

type NotifyLevel = "info" | "error";

type ApprovalCtx = {
  hasUI: boolean;
  ui: {
    notify: (message: string, level: NotifyLevel) => void;
    select: (
      message: string,
      options: string[],
    ) => Promise<string | null | undefined>;
  };
};

type PromptOptions = {
  options: string[];
  exactLabel: string;
  prefixLabel: string | null;
  suggested: string | null;
};

const DEFAULT_CONFIG: BashApprovalConfig = {
  allowed: [],
  splitChains: true,
};

const PREFIX_GLOB_SUFFIX_LENGTH = 2;
const TRAILING_GLOB_SUFFIX_LENGTH = 1;
const EXACT_LABEL_COMMAND_MAX_LENGTH = 60;

const ALLOW_ONCE = "Allow once";
const DENY = "Deny";
const BLOCKED_BY_USER = "Blocked by user";

// ---------- formatting helpers ----------

function truncateForLabel(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}…`;
}

function errnoCode(error: unknown): string | undefined {
  if (error instanceof Error) {
    return (error as NodeJS.ErrnoException).code;
  }

  return;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

// ---------- config I/O ----------

function parseConfig(raw: string): BashApprovalConfig {
  const parsed = JSON.parse(raw) as Partial<BashApprovalConfig>;

  const allowed = Array.isArray(parsed.allowed)
    ? parsed.allowed.filter(
        (entry): entry is string => typeof entry === "string",
      )
    : [];

  return {
    allowed,
    splitChains: parsed.splitChains !== false,
  };
}

function writeDefaultConfigFile(): void {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(
      CONFIG_PATH,
      `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`,
      "utf8",
    );
  } catch {
    // Best effort; the caller falls back to in-memory defaults.
  }
}

function loadConfig(): BashApprovalConfig {
  try {
    return parseConfig(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch (error: unknown) {
    if (errnoCode(error) === "ENOENT") {
      writeDefaultConfigFile();
    }

    // Malformed JSON or other error – fall back to a safe default that prompts on every command.
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(config: BashApprovalConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

// ---------- pattern matching ----------

function matchesPrefixGlob(command: string, pattern: string): boolean {
  const prefix = pattern.slice(0, -PREFIX_GLOB_SUFFIX_LENGTH).trim();

  if (!prefix) {
    return false;
  }

  return command === prefix || command.startsWith(`${prefix} `);
}

function matchesPattern(command: string, pattern: string): boolean {
  const trimmedCommand = command.trim();
  const trimmedPattern = pattern.trim();

  if (!trimmedPattern) {
    return false;
  }

  // "<prefix>:*" matches `<prefix>` exactly or `<prefix> <anything>`
  if (trimmedPattern.endsWith(":*")) {
    return matchesPrefixGlob(trimmedCommand, trimmedPattern);
  }

  // Trailing "*" – simple glob: prefix match.
  if (trimmedPattern.endsWith("*")) {
    const prefix = trimmedPattern.slice(0, -TRAILING_GLOB_SUFFIX_LENGTH);

    return trimmedCommand.startsWith(prefix);
  }

  // Exact match.
  return trimmedCommand === trimmedPattern;
}

// ---------- shell splitting ----------

type SplitState = {
  current: string;
  parts: string[];
  quote: '"' | "'" | null;
};

function isDoubleSeparator(
  char: string,
  nextChar: string | undefined,
): boolean {
  return (
    (char === "&" && nextChar === "&") || (char === "|" && nextChar === "|")
  );
}

function isSingleSeparator(char: string): boolean {
  return char === ";" || char === "|" || char === "\n";
}

function flushSegment(state: SplitState): void {
  state.parts.push(state.current);
  state.current = "";
}

function stepInsideQuote(
  char: string,
  nextChar: string | undefined,
  state: SplitState,
): number {
  if (char === "\\" && nextChar !== undefined) {
    state.current += `${char}${nextChar}`;
    return 2;
  }

  if (char === state.quote) {
    state.quote = null;
  }

  state.current += char;
  return 1;
}

function stepOutsideQuote(
  char: string,
  nextChar: string | undefined,
  state: SplitState,
): number {
  if (char === '"' || char === "'") {
    state.quote = char;
    state.current += char;
    return 1;
  }

  if (isDoubleSeparator(char, nextChar)) {
    flushSegment(state);
    return 2;
  }

  if (isSingleSeparator(char)) {
    flushSegment(state);
    return 1;
  }

  state.current += char;
  return 1;
}

/**
 * Split a command string on shell separators (`&&`, `||`, `;`, `|`, newline)
 * while respecting single/double quotes. Good enough for the common cases the
 * agent actually emits; it is not a full shell parser.
 */
function splitCommand(command: string): string[] {
  const state: SplitState = { current: "", parts: [], quote: null };
  let index = 0;

  while (index < command.length) {
    const char = command.at(index) ?? "";
    const nextChar = command.at(index + 1);

    index += state.quote
      ? stepInsideQuote(char, nextChar, state)
      : stepOutsideQuote(char, nextChar, state);
  }

  if (state.current.trim()) {
    state.parts.push(state.current);
  }

  return state.parts.map((part) => part.trim()).filter(Boolean);
}

// ---------- approval helpers ----------

/**
 * Suggest a `<prefix>:*` pattern for the given command. Uses the first two
 * tokens when available so subcommand-style tools (e.g. `git status`,
 * `npm install`, `kubectl get`) get a useful default; falls back to the
 * single first token for one-word commands.
 */
function suggestPrefixPattern(command: string): string | null {
  const tokens = command.trim().split(/\s+/).filter(Boolean);
  const firstToken = tokens.at(0);

  if (!firstToken) {
    return null;
  }

  const secondToken = tokens.at(1);

  if (secondToken) {
    return `${firstToken} ${secondToken}:*`;
  }

  return `${firstToken}:*`;
}

type CommandEvaluation =
  | { allMatch: true }
  | { allMatch: false; failingSegment: string };

function firstFailingSegment(
  segments: readonly string[],
  rules: readonly string[],
): string | null {
  return (
    segments.find(
      (segment) => !rules.some((rule) => matchesPattern(segment, rule)),
    ) ?? null
  );
}

function evaluateCommand(
  command: string,
  config: BashApprovalConfig,
): CommandEvaluation {
  const trimmedCommand = command.trim();
  const segments = config.splitChains
    ? splitCommand(command)
    : [trimmedCommand];

  if (segments.length === 0) {
    return { allMatch: false, failingSegment: trimmedCommand };
  }

  const failingSegment = firstFailingSegment(segments, config.allowed);

  if (!failingSegment) {
    return { allMatch: true };
  }

  // Base the prefix suggestion on the first segment that actually fails so
  // that the offered "<prefix>:*" rule would unblock the command. Without
  // this, a chain like `cd /some/path && git log ...` (where only `git log`
  // is missing from the allow-list) would surface a useless
  // `cd /some/path:*` suggestion derived from the head of the chain.
  return { allMatch: false, failingSegment };
}

function buildPromptOptions(
  trimmedCommand: string,
  failingSegment: string,
  config: BashApprovalConfig,
): PromptOptions {
  const exactLabel = `Allow always (exact): ${truncateForLabel(
    trimmedCommand,
    EXACT_LABEL_COMMAND_MAX_LENGTH,
  )}`;

  const suggested = suggestPrefixPattern(failingSegment);
  const prefixLabel =
    suggested &&
    suggested !== trimmedCommand &&
    !config.allowed.includes(suggested)
      ? `Allow always: ${suggested}`
      : null;

  const options: string[] = [ALLOW_ONCE];

  if (!config.allowed.includes(trimmedCommand)) {
    options.push(exactLabel);
  }

  if (prefixLabel) {
    options.push(prefixLabel);
  }

  options.push(DENY);

  return { options, exactLabel, prefixLabel, suggested };
}

function persistRule(
  config: BashApprovalConfig,
  rule: string,
  ctx: ApprovalCtx,
): void {
  if (config.allowed.includes(rule)) {
    return;
  }

  config.allowed.push(rule);

  try {
    saveConfig(config);
    ctx.ui.notify(`Added rule: ${rule}`, "info");
  } catch (error: unknown) {
    ctx.ui.notify(`Failed to persist rule: ${errorMessage(error)}`, "error");
  }
}

function applyChoice(
  choice: string,
  trimmedCommand: string,
  prompt: PromptOptions,
  config: BashApprovalConfig,
  ctx: ApprovalCtx,
): void {
  if (choice === prompt.exactLabel) {
    persistRule(config, trimmedCommand, ctx);
    return;
  }

  if (prompt.prefixLabel && choice === prompt.prefixLabel && prompt.suggested) {
    persistRule(config, prompt.suggested, ctx);
  }

  // "Allow once" or already-present rule: just proceed.
}

export default function (pi: ExtensionAPI) {
  let config = loadConfig();

  pi.registerCommand("bash-approval-reload", {
    description:
      "Reload the bash approval allow-list from ~/.pi/agent/bash-approval.json",
    // eslint-disable-next-line @typescript-eslint/require-await -- API requires Promise<void>
    handler: async (_args, ctx) => {
      config = loadConfig();
      ctx.ui.notify(
        `Reloaded ${config.allowed.length} bash approval rule(s)`,
        "info",
      );
    },
  });

  pi.registerCommand("bash-approval-list", {
    description: "Show currently allowed bash command patterns",
    // eslint-disable-next-line @typescript-eslint/require-await -- API requires Promise<void>
    handler: async (_args, ctx) => {
      if (config.allowed.length === 0) {
        ctx.ui.notify("No bash approval rules configured", "info");
        return;
      }

      ctx.ui.notify(
        `Allowed bash patterns:\n  - ${config.allowed.join("\n  - ")}`,
        "info",
      );
    },
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) {
      return;
    }

    const command = String(event.input.command ?? "");
    const trimmedCommand = command.trim();

    if (!trimmedCommand) {
      return;
    }

    const evaluation = evaluateCommand(command, config);

    if (evaluation.allMatch) {
      return;
    }

    const { failingSegment } = evaluation;

    if (!ctx.hasUI) {
      return {
        block: true,
        reason: `Bash command not on allow-list (configure ~/.pi/agent/bash-approval.json): ${trimmedCommand}`,
      };
    }

    const prompt = buildPromptOptions(trimmedCommand, failingSegment, config);

    const choice = await ctx.ui.select(
      `Approve bash command?\n\n  ${trimmedCommand}`,
      prompt.options,
    );

    if (!choice || choice === DENY) {
      return { block: true, reason: BLOCKED_BY_USER };
    }

    applyChoice(choice, trimmedCommand, prompt, config, ctx);
  });
}
