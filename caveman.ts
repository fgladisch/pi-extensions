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

type Level = (typeof VALID_LEVELS)[number];

type CavemanState = {
  enabled: boolean;
  level: Level;
};

const DEFAULT_STATE: CavemanState = {
  enabled: true,
  level: "full",
};

const COMMAND_TOKENS = [...VALID_LEVELS, "off", "status", "update"] as const;

function isLevel(value: unknown): value is Level {
  return (
    typeof value === "string" &&
    (VALID_LEVELS as readonly string[]).includes(value)
  );
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
    const code =
      error instanceof Error
        ? (error as NodeJS.ErrnoException).code
        : undefined;

    if (code === "ENOENT") {
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

      return { ...DEFAULT_STATE };
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
    return null;
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
  return state.enabled ? `🪨 caveman ${state.level}` : "🪨 caveman off";
}

export default function (pi: ExtensionAPI) {
  let state = loadState();
  let skillContent = loadSkillContent();

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
      return undefined;
    }

    if (!skillContent) {
      return undefined;
    }

    return {
      systemPrompt:
        event.systemPrompt + buildSystemPromptInjection(state, skillContent),
    };
  });

  pi.registerCommand("caveman", {
    description:
      "Toggle caveman mode and switch intensity (lite/full/ultra/wenyan-*/off/update)",
    getArgumentCompletions: (prefix: string) => {
      const items = COMMAND_TOKENS.map((value) => ({ value, label: value }));
      const filtered = items.filter((item) => item.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      const arg = (args ?? "").trim();

      if (!arg || arg === "status") {
        const skillStatus = skillContent ? "loaded" : "MISSING";
        ctx.ui.notify(`${statusLine(state)} (SKILL.md ${skillStatus})`, "info");
        return;
      }

      if (arg === "off") {
        state = { ...state, enabled: false };

        try {
          saveState(state);
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          ctx.ui.notify(
            `caveman: failed to persist state: ${message}`,
            "error",
          );
          return;
        }

        ctx.ui.setStatus("caveman", statusLine(state));
        ctx.ui.notify("caveman OFF", "info");
        return;
      }

      if (arg === "update") {
        ctx.ui.notify("caveman: updating from upstream...", "info");

        try {
          const hasGitDir = fs.existsSync(path.join(UPSTREAM_DIR, ".git"));

          if (hasGitDir) {
            const result = await pi.exec("git", [
              "-C",
              UPSTREAM_DIR,
              "pull",
              "--ff-only",
            ]);

            if (result.code !== 0) {
              const stderr = result.stderr.trim() || result.stdout.trim();
              ctx.ui.notify(`caveman: update failed: ${stderr}`, "error");
              return;
            }
          } else {
            fs.mkdirSync(DATA_DIR, { recursive: true });
            const result = await pi.exec("git", [
              "clone",
              "--depth",
              "1",
              UPSTREAM_REPO,
              UPSTREAM_DIR,
            ]);

            if (result.code !== 0) {
              const stderr = result.stderr.trim() || result.stdout.trim();
              ctx.ui.notify(`caveman: clone failed: ${stderr}`, "error");
              return;
            }
          }

          skillContent = loadSkillContent();

          if (!skillContent) {
            ctx.ui.notify(
              `caveman: updated, but SKILL.md not found at ${SKILL_PATH}`,
              "warning",
            );
            return;
          }

          ctx.ui.notify("caveman: SKILL.md updated", "info");
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`caveman: update failed: ${message}`, "error");
        }

        return;
      }

      if (isLevel(arg)) {
        state = { enabled: true, level: arg };

        try {
          saveState(state);
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          ctx.ui.notify(
            `caveman: failed to persist state: ${message}`,
            "error",
          );
          return;
        }

        ctx.ui.setStatus("caveman", statusLine(state));
        ctx.ui.notify(`caveman ON (${state.level})`, "info");
        return;
      }

      ctx.ui.notify(
        `caveman: unknown arg "${arg}". Try one of: ${COMMAND_TOKENS.join(", ")}`,
        "warning",
      );
    },
  });
}
