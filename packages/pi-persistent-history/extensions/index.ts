import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import {
  buildStatusMessage,
  createDefaultRuntime,
  injectHistoryIntoFocusedEditor,
  loadRuntime,
  persistRuntime,
  recordHistoryEntry,
} from "./utils";

export default function (pi: ExtensionAPI) {
  let runtime = createDefaultRuntime();

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) {
      return;
    }

    runtime = loadRuntime(ctx.cwd);
    runtime = {
      ...runtime,
      lastInjection: injectHistoryIntoFocusedEditor(ctx.ui, runtime.entries),
    };
  });

  pi.on("input", (event, ctx) => {
    if (!ctx.hasUI) {
      return { action: "continue" };
    }

    const nextEntries = recordHistoryEntry(
      runtime.entries,
      event.text,
      runtime.maxEntries,
    );

    runtime = {
      ...runtime,
      entries: nextEntries,
    };

    try {
      persistRuntime(ctx.cwd, runtime);
    } catch {
      // Silent failure in passive input flow.
    }

    return { action: "continue" };
  });

  pi.registerCommand("history-reload", {
    description: "Reload persistent prompt history from disk",
    // eslint-disable-next-line @typescript-eslint/require-await -- command API expects Promise<void>
    handler: async (_args, ctx) => {
      runtime = loadRuntime(ctx.cwd);
      runtime = {
        ...runtime,
        lastInjection: injectHistoryIntoFocusedEditor(ctx.ui, runtime.entries),
      };

      ctx.ui.notify(
        `Reloaded history (${runtime.entries.length} entries, max ${runtime.maxEntries})`,
        "info",
      );
    },
  });

  pi.registerCommand("history-status", {
    description: "Show persistent prompt history status",
    // eslint-disable-next-line @typescript-eslint/require-await -- command API expects Promise<void>
    handler: async (_args, ctx) => {
      ctx.ui.notify(buildStatusMessage(ctx.cwd, runtime), "info");
    },
  });
}
