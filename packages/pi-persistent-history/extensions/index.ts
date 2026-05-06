import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Box, Text } from "@mariozechner/pi-tui";

import {
  buildLoadedHistoryMessage,
  buildStatusMessage,
  createDefaultRuntime,
  injectHistoryIntoFocusedEditor,
  loadRuntime,
  persistRuntime,
  recordHistoryEntry,
} from "./utils";

const HISTORY_STATUS_MESSAGE_TYPE = "persistent-history-status";
const HEADING = "Persistent History";
const MARKDOWN_HEADING = `[${HEADING}]`;

export default function (pi: ExtensionAPI): void {
  registerHistoryStatusRenderer(pi);

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

    if (runtime.showStartupMessage) {
      sendHistoryStatusMessage(pi, buildLoadedHistoryMessage(runtime));
    }
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

      sendHistoryStatusMessage(
        pi,
        `Reloaded history (${runtime.entries.length} entries, max ${runtime.maxEntries})`,
      );
    },
  });

  pi.registerCommand("history-status", {
    description: "Show persistent prompt history status",
    // eslint-disable-next-line @typescript-eslint/require-await -- command API expects Promise<void>
    handler: async (_args, _ctx) => {
      sendHistoryStatusMessage(pi, buildStatusMessage(runtime));
    },
  });
}

function sendHistoryStatusMessage(pi: ExtensionAPI, message: string): void {
  pi.sendMessage({
    customType: HISTORY_STATUS_MESSAGE_TYPE,
    content: message,
    display: true,
  });
}

function styleHeading(content: string, styledHeading: string): string {
  const lines = content.split("\n");
  const firstLine = lines.at(0);

  if (firstLine !== MARKDOWN_HEADING) {
    return content;
  }

  return [styledHeading, ...lines.slice(1)].join("\n");
}

function registerHistoryStatusRenderer(pi: ExtensionAPI): void {
  pi.registerMessageRenderer(
    HISTORY_STATUS_MESSAGE_TYPE,
    (message, _options, theme) => {
      const styledHeading = theme.bold(theme.fg("mdHeading", `[${HEADING}]`));
      const content =
        typeof message.content === "string"
          ? styleHeading(message.content, styledHeading)
          : "Persistent history status";

      const text = new Text(content, 0, 0);
      const box = new Box(1, 1, (token) => theme.bg("customMessageBg", token));

      box.addChild(text);

      return box;
    },
  );
}
