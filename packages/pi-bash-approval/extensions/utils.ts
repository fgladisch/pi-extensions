import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type {
  ApprovalCtx,
  BashApprovalConfig,
  BashApprovalSettings,
  CommandEvaluation,
  GlobalSettings,
  PersistRuleResult,
  PromptOptions,
  SplitState,
} from "./models";

const CONFIG_DIR = path.join(os.homedir(), ".pi", "agent");
const SETTINGS_PATH = path.join(CONFIG_DIR, "settings.json");
export const ALLOW_LIST_PATH = path.join(CONFIG_DIR, ".bash-approval");

const DEFAULT_CONFIG: BashApprovalConfig = {
  allowed: [],
  splitChains: true,
};

const PREFIX_GLOB_SUFFIX_LENGTH = 2;
const TRAILING_GLOB_SUFFIX_LENGTH = 1;
const EXACT_LABEL_COMMAND_MAX_LENGTH = 60;

const ALLOW_ONCE = "Allow once";
export const DENY = "Deny";
export const BLOCKED_BY_USER = "Blocked by user";

const COMMENT_PREFIX = "#";
const VARIABLE_ASSIGNMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*=/;
const REDIRECTION_OPERATOR_PATTERN =
  /^(?:\d*)?(?:<|>|>>|<>|>&|<&|<<|<<<|&>|&>>)$/;
const HEREDOC_REDIRECT_PATTERN = /^(?:\d*)<<-?([^<].*)$/;
const MAX_NORMALIZATION_DEPTH = 8;

const DECLARATION_ONLY_HEADS = new Set([
  "for",
  "fi",
  "done",
  "case",
  "esac",
  "function",
  "local",
  "declare",
  "typeset",
  "readonly",
]);

const STRIPPABLE_CONTROL_HEADS = new Set([
  "if",
  "then",
  "elif",
  "else",
  "do",
  "while",
  "until",
  "{",
  "}",
  "(",
  ")",
]);

const CONDITION_TEST_HEADS = new Set(["[", "[[", "test"]);

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

function sanitizeSplitChains(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  return DEFAULT_CONFIG.splitChains;
}

function parseGlobalSettings(raw: string): Partial<GlobalSettings> {
  return JSON.parse(raw) as Partial<GlobalSettings>;
}

function getBashApprovalSettings(
  settings: Partial<GlobalSettings>,
): Partial<BashApprovalSettings> {
  const { bashApproval } = settings;

  if (!bashApproval || typeof bashApproval !== "object") {
    return {};
  }

  return bashApproval;
}

function loadSplitChainsSetting(): boolean {
  try {
    const rawSettings = fs.readFileSync(SETTINGS_PATH, "utf8");
    const parsedSettings = parseGlobalSettings(rawSettings);
    const bashApprovalSettings = getBashApprovalSettings(parsedSettings);

    return sanitizeSplitChains(bashApprovalSettings.splitChains);
  } catch {
    return DEFAULT_CONFIG.splitChains;
  }
}

function parseAllowList(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith(COMMENT_PREFIX));
}

function writeDefaultAllowListFile(): void {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(ALLOW_LIST_PATH, "", "utf8");
  } catch {
    // Best effort; the caller falls back to in-memory defaults.
  }
}

function loadAllowList(): string[] {
  try {
    const rawAllowList = fs.readFileSync(ALLOW_LIST_PATH, "utf8");

    return parseAllowList(rawAllowList);
  } catch (error: unknown) {
    if (errnoCode(error) === "ENOENT") {
      writeDefaultAllowListFile();
    }

    return [];
  }
}

export function loadConfig(): BashApprovalConfig {
  const splitChains = loadSplitChainsSetting();
  const allowed = loadAllowList();

  return {
    allowed,
    splitChains,
  };
}

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

  if (trimmedPattern.endsWith(":*")) {
    return matchesPrefixGlob(trimmedCommand, trimmedPattern);
  }

  if (trimmedPattern.endsWith("*")) {
    const prefix = trimmedPattern.slice(0, -TRAILING_GLOB_SUFFIX_LENGTH);

    return trimmedCommand.startsWith(prefix);
  }

  return trimmedCommand === trimmedPattern;
}

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

function stepOutsideBacktick(
  char: string,
  nextChar: string | undefined,
  state: SplitState,
): number {
  if (char === "\\" && nextChar !== undefined) {
    state.current += `${char}${nextChar}`;
    return 2;
  }

  if (char === "`") {
    state.backtickDepth -= 1;
    state.current += char;
    return 1;
  }

  if (char === "$" && nextChar === "(") {
    state.commandSubstitutionDepth += 1;
    state.current += "$(";
    return 2;
  }

  if ((char === "<" || char === ">") && nextChar === "(") {
    state.commandSubstitutionDepth += 1;
    state.current += `${char}(`;
    return 2;
  }

  if (state.commandSubstitutionDepth > 0) {
    if (char === "(") {
      state.commandSubstitutionDepth += 1;
    } else if (char === ")") {
      state.commandSubstitutionDepth -= 1;
    }

    state.current += char;
    return 1;
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

  if (char === "`") {
    state.backtickDepth += 1;
    state.current += char;
    return 1;
  }

  if (char === "$" && nextChar === "(") {
    state.commandSubstitutionDepth += 1;
    state.current += "$(";
    return 2;
  }

  if ((char === "<" || char === ">") && nextChar === "(") {
    state.commandSubstitutionDepth += 1;
    state.current += `${char}(`;
    return 2;
  }

  if (state.commandSubstitutionDepth > 0) {
    if (char === "(") {
      state.commandSubstitutionDepth += 1;
    } else if (char === ")") {
      state.commandSubstitutionDepth -= 1;
    }

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

function splitCommand(command: string): string[] {
  const commandWithoutHeredocBodies = stripHeredocBodies(command);
  const state: SplitState = {
    commandSubstitutionDepth: 0,
    backtickDepth: 0,
    current: "",
    parts: [],
    quote: null,
  };
  let index = 0;

  while (index < commandWithoutHeredocBodies.length) {
    const char = commandWithoutHeredocBodies.at(index) ?? "";
    const nextChar = commandWithoutHeredocBodies.at(index + 1);

    if (state.backtickDepth > 0) {
      index += stepOutsideBacktick(char, nextChar, state);
    } else if (state.quote) {
      index += stepInsideQuote(char, nextChar, state);
    } else {
      index += stepOutsideQuote(char, nextChar, state);
    }
  }

  if (state.current.trim()) {
    state.parts.push(state.current);
  }

  return state.parts.map((part) => part.trim()).filter(Boolean);
}

function flushToken(tokens: string[], current: string): string {
  if (current) {
    tokens.push(current);
  }

  return "";
}

function isWhitespaceChar(char: string): boolean {
  return /\s/.test(char);
}

function tokenizeSegment(segment: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let commandSubstitutionDepth = 0;
  let backtickDepth = 0;
  let index = 0;

  while (index < segment.length) {
    const char = segment.at(index) ?? "";
    const nextChar = segment.at(index + 1);

    if (backtickDepth === 0 && char === "\\" && nextChar !== undefined) {
      current += `${char}${nextChar}`;
      index += 2;
      continue;
    }

    if (backtickDepth > 0) {
      if (char === "\\" && nextChar !== undefined) {
        current += `${char}${nextChar}`;
        index += 2;
        continue;
      }

      if (char === "`") {
        backtickDepth -= 1;
        current += char;
        index += 1;
        continue;
      }

      if (char === "$" && nextChar === "(") {
        commandSubstitutionDepth += 1;
        current += "$(";
        index += 2;
        continue;
      }

      if ((char === "<" || char === ">") && nextChar === "(") {
        commandSubstitutionDepth += 1;
        current += `${char}(`;
        index += 2;
        continue;
      }

      if (commandSubstitutionDepth > 0) {
        if (char === "(") {
          commandSubstitutionDepth += 1;
        } else if (char === ")") {
          commandSubstitutionDepth -= 1;
        }

        current += char;
        index += 1;
        continue;
      }

      current += char;
      index += 1;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      }

      if (quote !== "'" && char === "$" && nextChar === "(") {
        commandSubstitutionDepth += 1;
        current += "$(";
        index += 2;
        continue;
      }

      current += char;
      index += 1;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      index += 1;
      continue;
    }

    if (char === "`") {
      backtickDepth += 1;
      current += char;
      index += 1;
      continue;
    }

    if (char === "$" && nextChar === "(") {
      commandSubstitutionDepth += 1;
      current += "$(";
      index += 2;
      continue;
    }

    if ((char === "<" || char === ">") && nextChar === "(") {
      commandSubstitutionDepth += 1;
      current += `${char}(`;
      index += 2;
      continue;
    }

    if (commandSubstitutionDepth > 0) {
      if (char === "(") {
        commandSubstitutionDepth += 1;
      } else if (char === ")") {
        commandSubstitutionDepth -= 1;
      }

      current += char;
      index += 1;
      continue;
    }

    if (isWhitespaceChar(char)) {
      current = flushToken(tokens, current);
      index += 1;
      continue;
    }

    current += char;
    index += 1;
  }

  flushToken(tokens, current);

  return tokens;
}

function unquoteHeredocDelimiter(token: string): string {
  return token.replace(/["']/g, "");
}

function tokenHeredocDelimiter(
  token: string,
  nextToken: string | undefined,
): string | null {
  if (token === "<<" || token === "<<-") {
    return nextToken ? unquoteHeredocDelimiter(nextToken) : null;
  }

  const match = HEREDOC_REDIRECT_PATTERN.exec(token);
  const delimiter = match?.at(1);

  return delimiter ? unquoteHeredocDelimiter(delimiter) : null;
}

function findHeredocDelimiters(line: string): string[] {
  const tokens = tokenizeSegment(line);

  return tokens
    .map((token, index) => tokenHeredocDelimiter(token, tokens.at(index + 1)))
    .filter((delimiter): delimiter is string => Boolean(delimiter));
}

function stripHeredocBodies(command: string): string {
  if (!command.includes("<<")) {
    return command;
  }

  const outputLines: string[] = [];
  const pendingDelimiters: string[] = [];

  for (const line of command.split("\n")) {
    const pendingDelimiter = pendingDelimiters.at(0);

    if (pendingDelimiter) {
      if (line.trim() === pendingDelimiter) {
        pendingDelimiters.shift();
      }

      continue;
    }

    outputLines.push(line);
    pendingDelimiters.push(...findHeredocDelimiters(line));
  }

  return outputLines.join("\n");
}

function isVariableAssignmentToken(token: string): boolean {
  return VARIABLE_ASSIGNMENT_PATTERN.test(token);
}

function isConditionTestHead(token: string | undefined): boolean {
  if (!token) {
    return false;
  }

  return CONDITION_TEST_HEADS.has(token);
}

function isRedirectionOperatorToken(token: string | undefined): boolean {
  if (!token) {
    return false;
  }

  return REDIRECTION_OPERATOR_PATTERN.test(token);
}

function readCommandSubstitution(
  value: string,
  substitutionStartIndex: number,
): { readonly nextIndex: number; readonly substitution: string } | null {
  const startIndex = substitutionStartIndex + 2;
  let depth = 1;
  let innerQuote: '"' | "'" | null = null;
  let index = startIndex;

  while (index < value.length && depth > 0) {
    const char = value.at(index) ?? "";
    const nextChar = value.at(index + 1);

    if (char === "\\" && nextChar !== undefined) {
      index += 2;
      continue;
    }

    if (innerQuote) {
      if (char === innerQuote) {
        innerQuote = null;
      }

      index += 1;
      continue;
    }

    if (char === '"' || char === "'") {
      innerQuote = char;
      index += 1;
      continue;
    }

    if (char === "$" && nextChar === "(") {
      depth += 1;
      index += 2;
      continue;
    }

    if ((char === "<" || char === ">") && nextChar === "(") {
      depth += 1;
      index += 2;
      continue;
    }

    if (char === ")") {
      depth -= 1;

      if (depth === 0) {
        return {
          nextIndex: index + 1,
          substitution: value.slice(startIndex, index).trim(),
        };
      }
    }

    index += 1;
  }

  return null;
}

function readBacktickSubstitution(
  value: string,
  startIndex: number,
): { readonly nextIndex: number; readonly substitution: string } | null {
  let index = startIndex + 1;
  let innerQuote: '"' | "'" | null = null;
  let cmdSubDepth = 0;

  while (index < value.length) {
    const char = value.at(index) ?? "";
    const nextChar = value.at(index + 1);

    if (char === "\\" && nextChar !== undefined) {
      index += 2;
      continue;
    }

    if (innerQuote) {
      if (char === innerQuote) {
        innerQuote = null;
      }

      index += 1;
      continue;
    }

    if (char === '"' || char === "'") {
      innerQuote = char;
      index += 1;
      continue;
    }

    if (char === "$" && nextChar === "(") {
      cmdSubDepth += 1;
      index += 2;
      continue;
    }

    if ((char === "<" || char === ">") && nextChar === "(") {
      cmdSubDepth += 1;
      index += 2;
      continue;
    }

    if (cmdSubDepth > 0) {
      if (char === "(") {
        cmdSubDepth += 1;
      } else if (char === ")") {
        cmdSubDepth -= 1;
      }

      index += 1;
      continue;
    }

    if (char === "`") {
      return {
        nextIndex: index + 1,
        substitution: value.slice(startIndex + 1, index).trim(),
      };
    }

    index += 1;
  }

  return null;
}

function findCommandSubstitutions(value: string): string[] {
  const substitutions: string[] = [];
  let quote: '"' | "'" | null = null;
  let index = 0;

  while (index < value.length) {
    const char = value.at(index) ?? "";
    const nextChar = value.at(index + 1);

    if (char === "\\" && nextChar !== undefined) {
      index += 2;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
        index += 1;
        continue;
      }

      if (quote === '"') {
        if (char === "`") {
          const backtickResult = readBacktickSubstitution(value, index);

          if (!backtickResult) {
            index += 1;
            continue;
          }

          substitutions.push(backtickResult.substitution);
          index = backtickResult.nextIndex;
          continue;
        }

        if (char !== "$" && char !== "<" && char !== ">") {
          index += 1;
          continue;
        }

        if (nextChar !== "(") {
          index += 1;
          continue;
        }
      } else {
        index += 1;
        continue;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
      index += 1;
      continue;
    } else if (char === "`") {
      const backtickResult = readBacktickSubstitution(value, index);

      if (!backtickResult) {
        index += 1;
        continue;
      }

      substitutions.push(backtickResult.substitution);
      index = backtickResult.nextIndex;
      continue;
    } else if (char !== "$" && char !== "<" && char !== ">") {
      index += 1;
      continue;
    } else if (nextChar !== "(") {
      index += 1;
      continue;
    }

    const result = readCommandSubstitution(value, index);

    if (!result) {
      index += 2;
      continue;
    }

    substitutions.push(result.substitution);
    index = result.nextIndex;
  }

  return substitutions.filter(Boolean);
}

function normalizeSubstitution(substitution: string, depth: number): string[] {
  return splitCommand(substitution).flatMap((segment) =>
    normalizeCommandSegments(segment, depth + 1),
  );
}

function normalizeTokenSubstitutions(
  tokens: readonly string[],
  depth: number,
): string[] {
  return tokens.flatMap((token) =>
    findCommandSubstitutions(token).flatMap((substitution) =>
      normalizeSubstitution(substitution, depth),
    ),
  );
}

function normalizeCommandSegments(segment: string, depth = 0): string[] {
  if (depth > MAX_NORMALIZATION_DEPTH) {
    const trimmedSegment = segment.trim();

    return trimmedSegment ? [trimmedSegment] : [];
  }

  let tokens = tokenizeSegment(segment);

  if (tokens.length === 0) {
    return [];
  }

  while (tokens.length > 0) {
    const firstToken = tokens.at(0);

    if (!firstToken) {
      return [];
    }

    if (DECLARATION_ONLY_HEADS.has(firstToken)) {
      return [];
    }

    if (!STRIPPABLE_CONTROL_HEADS.has(firstToken)) {
      break;
    }

    tokens = tokens.slice(1);
  }

  if (tokens.length === 0) {
    return [];
  }

  if (isConditionTestHead(tokens.at(0))) {
    return [];
  }

  if (isRedirectionOperatorToken(tokens.at(0))) {
    return [];
  }

  if (tokens.at(0) === "export") {
    return [];
  }

  let assignmentPrefixLength = 0;

  while (assignmentPrefixLength < tokens.length) {
    const token = tokens.at(assignmentPrefixLength);

    if (!token || !isVariableAssignmentToken(token)) {
      break;
    }

    assignmentPrefixLength += 1;
  }

  const substitutionCommands = normalizeTokenSubstitutions(tokens, depth);

  if (assignmentPrefixLength === tokens.length) {
    return substitutionCommands;
  }

  const commandTokens = tokens.slice(assignmentPrefixLength);

  return [...substitutionCommands, commandTokens.join(" ")];
}

function suggestCommandPattern(tokens: readonly string[]): string | null {
  const firstToken = tokens.at(0);

  if (!firstToken) {
    return null;
  }

  return `${firstToken}:*`;
}

function suggestPrefixPattern(tokens: readonly string[]): string | null {
  const firstToken = tokens.at(0);
  const commandPattern = suggestCommandPattern(tokens);

  if (!firstToken || !commandPattern) {
    return null;
  }

  const secondToken = tokens.at(1);

  if (secondToken) {
    return `${firstToken} ${secondToken}:*`;
  }

  return commandPattern;
}

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

export function evaluateCommand(
  command: string,
  config: BashApprovalConfig,
): CommandEvaluation {
  const trimmedCommand = command.trim();
  const rawSegments = config.splitChains
    ? splitCommand(command)
    : [trimmedCommand];
  const segments = rawSegments.flatMap((segment) =>
    normalizeCommandSegments(segment),
  );

  if (segments.length === 0) {
    return { allMatch: true };
  }

  const failingSegment = firstFailingSegment(segments, config.allowed);

  if (!failingSegment) {
    return { allMatch: true };
  }

  return { allMatch: false, failingSegment };
}

function addRuleOption(
  options: string[],
  rulesByOption: Record<string, string>,
  label: string,
  rule: string | null,
  config: BashApprovalConfig,
): void {
  if (!rule || config.allowed.includes(rule)) {
    return;
  }

  if (Object.values(rulesByOption).includes(rule)) {
    return;
  }

  options.push(label);
  rulesByOption[label] = rule;
}

export function buildPromptOptions(
  trimmedCommand: string,
  failingSegment: string,
  config: BashApprovalConfig,
): PromptOptions {
  const exactLabel = `Allow always (exact): ${truncateForLabel(
    trimmedCommand,
    EXACT_LABEL_COMMAND_MAX_LENGTH,
  )}`;
  const suggestionTokens = tokenizeSegment(failingSegment);
  const suggested = suggestPrefixPattern(suggestionTokens);
  const suggestedCommand = suggestCommandPattern(suggestionTokens);
  const options: string[] = [ALLOW_ONCE];
  const rulesByOption: Record<string, string> = {};

  addRuleOption(options, rulesByOption, exactLabel, trimmedCommand, config);

  if (suggested !== trimmedCommand) {
    addRuleOption(
      options,
      rulesByOption,
      `Allow always: ${suggested}`,
      suggested,
      config,
    );
  }

  if (suggestedCommand !== trimmedCommand) {
    addRuleOption(
      options,
      rulesByOption,
      `Allow always (command): ${suggestedCommand}`,
      suggestedCommand,
      config,
    );
  }

  options.push(DENY);

  return { options, rulesByOption };
}

function persistRule(
  config: BashApprovalConfig,
  rule: string,
  ctx: ApprovalCtx,
): PersistRuleResult {
  if (config.allowed.includes(rule)) {
    return { rule, path: ALLOW_LIST_PATH, success: true };
  }

  config.allowed.push(rule);

  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.appendFileSync(ALLOW_LIST_PATH, `${rule}\n`, "utf8");
    ctx.ui.notify(`Added rule: ${rule}`, "info");

    return { rule, path: ALLOW_LIST_PATH, success: true };
  } catch (error: unknown) {
    const message = errorMessage(error);
    ctx.ui.notify(`Failed to persist rule: ${message}`, "error");

    return { rule, path: ALLOW_LIST_PATH, success: false, error: message };
  }
}

export function applyChoice(
  choice: string,
  prompt: PromptOptions,
  config: BashApprovalConfig,
  ctx: ApprovalCtx,
): PersistRuleResult | null {
  const rule = prompt.rulesByOption[choice];

  if (!rule) {
    return null;
  }

  return persistRule(config, rule, ctx);
}
