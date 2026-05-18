import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { CavemanState, CavemanUi } from "./types";
import {
  buildSystemPromptInjection,
  COMMAND_TOKENS,
  COMPLETION_ITEMS,
  getSkillPath,
  isLevel,
  loadSkillContent,
  loadState,
  persistState,
  runGitUpdate,
  statusLine,
} from "./utils";

export default function (pi: ExtensionAPI) {
  let state: CavemanState = loadState();
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
        `caveman: SKILL.md not found at ${getSkillPath()}. Run \`/caveman update\` to fetch.`,
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

  async function updateFromUpstream(ui: CavemanUi): Promise<void> {
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
        `caveman: updated, but SKILL.md not found at ${getSkillPath()}`,
        "warning",
      );
      return;
    }

    ui.notify("caveman: SKILL.md updated", "info");
  }

  pi.registerCommand("caveman", {
    description:
      "Toggle caveman mode and switch intensity (lite/full/ultra/off/update)",
    getArgumentCompletions: (prefix) => {
      const filtered = COMPLETION_ITEMS.filter(({ value }) =>
        value.startsWith(prefix),
      );
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      const { ui } = ctx;
      const arg = (args ?? "").trim() || "status";

      switch (arg) {
        case "status": {
          const skillStatus = skillContent ? "loaded" : "MISSING";
          ui.notify(`${statusLine(state)} (SKILL.md ${skillStatus})`, "info");
          return;
        }
        case "off":
          applyState({ ...state, enabled: false }, "caveman OFF", ui);
          return;
        case "update":
          await updateFromUpstream(ui);
          return;
        default:
          if (isLevel(arg)) {
            applyState(
              { enabled: true, level: arg },
              `caveman ON (${arg})`,
              ui,
            );
            return;
          }

          ui.notify(
            `caveman: unknown arg "${arg}". Try one of: ${COMMAND_TOKENS.join(", ")}`,
            "warning",
          );
      }
    },
  });
}
