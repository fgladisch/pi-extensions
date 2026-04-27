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

const DEFAULT_CONFIG: BashApprovalConfig = {
  allowed: [],
  splitChains: true,
};

const PREFIX_GLOB_SUFFIX_LENGTH = 2;
const TRAILING_GLOB_SUFFIX_LENGTH = 1;

function loadConfig(): BashApprovalConfig {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<BashApprovalConfig>;

    return {
      allowed: Array.isArray(parsed.allowed)
        ? parsed.allowed.filter(
            (entry): entry is string => typeof entry === "string",
          )
        : [],
      splitChains: parsed.splitChains !== false,
    };
  } catch (error: unknown) {
    const code =
      error instanceof Error
        ? (error as NodeJS.ErrnoException).code
        : undefined;

    if (code === "ENOENT") {
      try {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
        fs.writeFileSync(
          CONFIG_PATH,
          `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`,
          "utf8",
        );
      } catch {
        // Best effort; fall back to in-memory defaults below.
      }

      return { ...DEFAULT_CONFIG };
    }

    // Malformed JSON or other error – fall back to a safe default that prompts on every command.
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(config: BashApprovalConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function matchesPattern(command: string, pattern: string): boolean {
  const trimmedCommand = command.trim();
  const trimmedPattern = pattern.trim();

  if (!trimmedPattern) {
    return false;
  }

  // "<prefix>:*" matches `<prefix>` exactly or `<prefix> <anything>`
  if (trimmedPattern.endsWith(":*")) {
    const prefix = trimmedPattern.slice(0, -PREFIX_GLOB_SUFFIX_LENGTH).trim();

    if (!prefix) {
      return false;
    }

    return trimmedCommand === prefix || trimmedCommand.startsWith(`${prefix} `);
  }

  // Trailing "*" – simple glob: prefix match.
  if (trimmedPattern.endsWith("*")) {
    const prefix = trimmedPattern.slice(0, -TRAILING_GLOB_SUFFIX_LENGTH);

    return trimmedCommand.startsWith(prefix);
  }

  // Exact match.
  return trimmedCommand === trimmedPattern;
}

/**
 * Split a command string on shell separators (`&&`, `||`, `;`, `|`, newline)
 * while respecting single/double quotes. Good enough for the common cases the
 * agent actually emits; it is not a full shell parser.
 */
function splitCommand(command: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let index = 0;

  while (index < command.length) {
    const char = command.at(index) ?? "";
    const nextChar =
      index + 1 < command.length ? (command.at(index + 1) ?? "") : undefined;

    if (quote) {
      if (char === "\\" && nextChar !== undefined) {
        current += `${char}${nextChar}`;
        index += 2;
        continue;
      }

      if (char === quote) {
        quote = null;
      }

      current += char;
      index++;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      index++;
      continue;
    }

    if (
      (char === "&" && nextChar === "&") ||
      (char === "|" && nextChar === "|")
    ) {
      parts.push(current);
      current = "";
      index += 2;
      continue;
    }

    if (char === ";" || char === "|" || char === "\n") {
      parts.push(current);
      current = "";
      index++;
      continue;
    }

    current += char;
    index++;
  }

  if (current.trim()) {
    parts.push(current);
  }

  return parts.map((part) => part.trim()).filter(Boolean);
}

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
      return undefined;
    }

    const command = String(event.input.command ?? "");
    const trimmedCommand = command.trim();

    if (!trimmedCommand) {
      return undefined;
    }

    const segments = config.splitChains
      ? splitCommand(command)
      : [trimmedCommand];

    const allMatch =
      segments.length > 0 &&
      segments.every((segment) =>
        config.allowed.some((rule) => matchesPattern(segment, rule)),
      );

    if (allMatch) {
      return undefined;
    }

    if (!ctx.hasUI) {
      return {
        block: true,
        reason: `Bash command not on allow-list (configure ~/.pi/agent/bash-approval.json): ${trimmedCommand}`,
      };
    }

    const exactLabel = `Allow always (exact): ${trimmedCommand}`;
    const suggested = suggestPrefixPattern(trimmedCommand);
    const prefixLabel =
      suggested &&
      suggested !== trimmedCommand &&
      !config.allowed.includes(suggested)
        ? `Allow always: ${suggested}`
        : null;

    const options: string[] = ["Allow once"];

    if (!config.allowed.includes(trimmedCommand)) {
      options.push(exactLabel);
    }

    if (prefixLabel) {
      options.push(prefixLabel);
    }

    options.push("Deny");

    const choice = await ctx.ui.select(
      `Approve bash command?\n\n  ${trimmedCommand}`,
      options,
    );

    if (!choice || choice === "Deny") {
      return { block: true, reason: "Blocked by user" };
    }

    if (choice === exactLabel) {
      if (!config.allowed.includes(trimmedCommand)) {
        config.allowed.push(trimmedCommand);

        try {
          saveConfig(config);
          ctx.ui.notify(`Added rule: ${trimmedCommand}`, "info");
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`Failed to persist rule: ${message}`, "error");
        }
      }
    } else if (prefixLabel && choice === prefixLabel && suggested) {
      if (!config.allowed.includes(suggested)) {
        config.allowed.push(suggested);

        try {
          saveConfig(config);
          ctx.ui.notify(`Added rule: ${suggested}`, "info");
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`Failed to persist rule: ${message}`, "error");
        }
      }
    }

    // "Allow once" or already-present rule: just proceed.
    return undefined;
  });
}
