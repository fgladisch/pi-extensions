/**
 * Caveman Extension
 *
 * Always-on caveman-mode injection: appends the caveman SKILL.md content
 * to the system prompt every turn so the model speaks like a smart caveman
 * and uses ~75% fewer output tokens. Wraps
 * https://github.com/JuliusBrussee/caveman as a pi extension instead of a
 * passive skill (a pi skill would only inject its description, not the full
 * ruleset, which defeats the purpose).
 *
 * Data layout:
 *   ~/.pi/agent/caveman/upstream/                          cloned upstream repo
 *   ~/.pi/agent/caveman/upstream/skills/caveman/SKILL.md   ruleset injected each turn
 *   ~/.pi/agent/caveman/state.json                         persisted enabled flag and level
 *
 * Commands:
 *   /caveman                                 show current status
 *   /caveman lite | full | ultra |           enable with that intensity level
 *     wenyan-lite | wenyan-full | wenyan-ultra
 *   /caveman off                             disable injection (data stays installed)
 *   /caveman update                          git pull the upstream repo
 *
 * State (level + enabled flag) persists across sessions so the choice survives
 * restarts. Default on first run: ON, level=full.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const DATA_DIR = path.join(os.homedir(), ".pi", "agent", "caveman");
const UPSTREAM_DIR = path.join(DATA_DIR, "upstream");
const SKILL_PATH = path.join(UPSTREAM_DIR, "skills", "caveman", "SKILL.md");
const STATE_PATH = path.join(DATA_DIR, "state.json");
const UPSTREAM_REPO = "https://github.com/JuliusBrussee/caveman.git";

const VALID_LEVELS = [
  "lite",
  "full",
  "ultra",
  "wenyan-lite",
  "wenyan-full",
  "wenyan-ultra",
] as const;

const DEFAULT_STATE = {
  enabled: true,
  level: "full",
} as const;

const COMMAND_TOKENS = [...VALID_LEVELS, "off", "status", "update"] as const;

const COMPLETION_ITEMS: readonly { value: string; label: string }[] =
  COMMAND_TOKENS.map((value) => ({ value, label: value }));

type Level = (typeof VALID_LEVELS)[number];

type CavemanState = {
  readonly enabled: boolean;
  readonly level: Level;
};

type Result = { ok: true } | { ok: false; reason: string };

type Exec = (
  command: string,
  args: string[],
) => Promise<{ code: number; stdout: string; stderr: string }>;

type CavemanUi = {
  notify: (message: string, level: "info" | "warning" | "error") => void;
  setStatus: (name: string, value: string) => void;
};

function isLevel(value: unknown): value is Level {
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

function loadState(): CavemanState {
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

function loadSkillContent(): string | null {
  try {
    return fs.readFileSync(SKILL_PATH, "utf8");
  } catch {
    // All I/O errors (ENOENT, permission, etc.) have the same recovery: return null.
    return null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function persistState(next: CavemanState): Result {
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

async function runGitUpdate(exec: Exec): Promise<Result> {
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

function buildSystemPromptInjection(
  state: CavemanState,
  skill: string,
): string {
  const trimmedSkill = skill.trim();

  return [
    "",
    "",
    `<caveman-mode active level="${state.level}">`,
    `Caveman mode is ON. Active intensity: ${state.level}.`,
    "Apply the rules below to EVERY assistant response in this session",
    'unless the user says "stop caveman" or "normal mode".',
    "Pick the section matching the active intensity for behavior.",
    "",
    trimmedSkill,
    "</caveman-mode>",
  ].join("\n");
}

function statusLine(state: CavemanState): string {
  return state.enabled ? `🪨 caveman ${state.level} •` : "🪨 caveman off •";
}

export default function (pi: ExtensionAPI) {
  let state = loadState();
  let skillContent = loadSkillContent();
  let cachedInjection: string | null = null;

  function applyState(
    next: CavemanState,
    successMessage: string,
    ui: CavemanUi,
  ): void {
    const result = persistState(next);

    if (!result.ok) {
      ui.notify(`caveman: ${result.reason}`, "error");
      return;
    }

    state = next;
    cachedInjection = null;
    ui.setStatus("caveman", statusLine(state));
    ui.notify(successMessage, "info");
  }

  pi.on("session_start", (_event, ctx) => {
    if (!skillContent) {
      ctx.ui.notify(
        `caveman: SKILL.md not found at ${SKILL_PATH}. Run \`/caveman update\` to fetch.`,
        "warning",
      );
    }

    ctx.ui.setStatus("caveman", statusLine(state));
  });

  pi.on("before_agent_start", (event) => {
    if (!state.enabled) {
      return;
    }

    if (!skillContent) {
      return;
    }

    cachedInjection ??= buildSystemPromptInjection(state, skillContent);

    return {
      systemPrompt: event.systemPrompt + cachedInjection,
    };
  });

  pi.registerCommand("caveman", {
    description:
      "Toggle caveman mode and switch intensity (lite/full/ultra/wenyan-*/off/update)",
    getArgumentCompletions: (prefix) => {
      const filtered = COMPLETION_ITEMS.filter(({ value }) =>
        value.startsWith(prefix),
      );
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      const { ui } = ctx;
      const arg = (args ?? "").trim() || "status";

      if (arg === "status") {
        const skillStatus = skillContent ? "loaded" : "MISSING";
        ui.notify(`${statusLine(state)} (SKILL.md ${skillStatus})`, "info");
        return;
      }

      if (arg === "off") {
        applyState({ ...state, enabled: false }, "caveman OFF", ui);
        return;
      }

      if (arg === "update") {
        ui.notify("caveman: updating from upstream...", "info");

        const result = await runGitUpdate(pi.exec.bind(pi));

        if (!result.ok) {
          ui.notify(`caveman: ${result.reason}`, "error");
          return;
        }

        skillContent = loadSkillContent();
        cachedInjection = null;

        if (!skillContent) {
          ui.notify(
            `caveman: updated, but SKILL.md not found at ${SKILL_PATH}`,
            "warning",
          );
          return;
        }

        ui.notify("caveman: SKILL.md updated", "info");
        return;
      }

      if (isLevel(arg)) {
        applyState({ enabled: true, level: arg }, `caveman ON (${arg})`, ui);
        return;
      }

      ui.notify(
        `caveman: unknown arg "${arg}". Try one of: ${COMMAND_TOKENS.join(", ")}`,
        "warning",
      );
    },
  });
}
