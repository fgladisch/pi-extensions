import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  VALID_LEVELS,
  type CavemanState,
  type Exec,
  type Level,
  type Result,
} from "./types";

const DATA_DIR = path.join(os.homedir(), ".pi", "agent", "caveman");
const UPSTREAM_DIR = path.join(DATA_DIR, "upstream");
const SKILL_PATH = path.join(UPSTREAM_DIR, "skills", "caveman", "SKILL.md");
const STATE_PATH = path.join(DATA_DIR, "state.json");
const UPSTREAM_REPO = "https://github.com/JuliusBrussee/caveman.git";

export const DEFAULT_STATE = {
  enabled: true,
  level: "full",
} as const;

export const COMMAND_TOKENS = [
  ...VALID_LEVELS,
  "off",
  "status",
  "update",
] as const;

export const COMPLETION_ITEMS: readonly { value: string; label: string }[] =
  COMMAND_TOKENS.map((value) => ({ value, label: value }));

export function isLevel(value: unknown): value is Level {
  return (
    typeof value === "string" &&
    (VALID_LEVELS as readonly string[]).includes(value)
  );
}

function errnoCode(error: unknown): string | undefined {
  return error instanceof Error
    ? (error as NodeJS.ErrnoException).code
    : undefined;
}

function writeDefaultStateFile(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(
      STATE_PATH,
      `${JSON.stringify(DEFAULT_STATE, null, 2)}\n`,
      "utf8",
    );
  } catch {
    // Best effort; fall back to in-memory defaults.
  }
}

export function loadState(): CavemanState {
  try {
    const raw = fs.readFileSync(STATE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<CavemanState>;

    return {
      enabled: parsed.enabled !== false,
      level: isLevel(parsed.level) ? parsed.level : DEFAULT_STATE.level,
    };
  } catch (error: unknown) {
    if (errnoCode(error) === "ENOENT") {
      writeDefaultStateFile();
    }

    return { ...DEFAULT_STATE };
  }
}

function saveState(state: CavemanState): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function loadSkillContent(): string | null {
  try {
    return fs.readFileSync(SKILL_PATH, "utf8");
  } catch {
    return null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function persistState(next: CavemanState): Result {
  try {
    saveState(next);
    return { ok: true };
  } catch (error: unknown) {
    return {
      ok: false,
      reason: `failed to persist state: ${errorMessage(error)}`,
    };
  }
}

export async function runGitUpdate(exec: Exec): Promise<Result> {
  const isClone = !fs.existsSync(path.join(UPSTREAM_DIR, ".git"));
  const action = isClone ? "clone" : "update";
  const args = isClone
    ? ["clone", "--depth", "1", UPSTREAM_REPO, UPSTREAM_DIR]
    : ["-C", UPSTREAM_DIR, "pull", "--ff-only"];

  try {
    if (isClone) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    const result = await exec("git", args);

    if (result.code !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim();
      return { ok: false, reason: `${action} failed: ${detail}` };
    }

    return { ok: true };
  } catch (error: unknown) {
    return { ok: false, reason: `${action} failed: ${errorMessage(error)}` };
  }
}

export function buildSystemPromptInjection(
  state: CavemanState,
  skill: string,
): string {
  const trimmedSkill = skill.trim();

  return [
    "",
    "",
    `<caveman-mode active level=\"${state.level}\">`,
    `Caveman mode is ON. Active intensity: ${state.level}.`,
    "Apply the rules below to EVERY assistant response in this session",
    'unless the user says "stop caveman" or "normal mode".',
    "Pick the section matching the active intensity for behavior.",
    "",
    trimmedSkill,
    "</caveman-mode>",
  ].join("\n");
}

export function statusLine(state: CavemanState): string {
  return state.enabled ? `🪨 caveman ${state.level}` : "🪨 caveman off";
}

export function getSkillPath(): string {
  return SKILL_PATH;
}
