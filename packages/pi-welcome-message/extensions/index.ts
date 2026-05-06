import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Box, Text } from "@mariozechner/pi-tui";

import {
  buildGitInfo,
  buildPackageInfo,
  buildResourcesInfo,
  formatWelcomeOutput,
  loadEnabledWelcomeSections,
} from "./utils";

export default function (pi: ExtensionAPI): void {
  registerWelcomeRenderer(pi);

  pi.on("session_start", async (event, ctx) => {
    if (event.reason !== "startup") {
      return;
    }

    const { hasUI, ui, cwd } = ctx;

    if (!hasUI) {
      return;
    }

    const { theme } = ui;
    const enabledSections = await loadEnabledWelcomeSections();
    const [packageInfo, gitInfo, resourcesInfo] = await Promise.all([
      enabledSections.nodePackage
        ? buildPackageInfo(cwd, theme)
        : Promise.resolve(""),
      enabledSections.git ? buildGitInfo(pi, cwd, theme) : Promise.resolve(""),
      enabledSections.piResources
        ? buildResourcesInfo(pi, cwd, theme)
        : Promise.resolve(""),
    ]);

    const output = formatWelcomeOutput([packageInfo, gitInfo, resourcesInfo]);

    if (output === null) {
      return;
    }

    pi.sendMessage({
      customType: "welcome",
      content: output,
      display: true,
    });
  });
}

function registerWelcomeRenderer(pi: ExtensionAPI): void {
  pi.registerMessageRenderer("welcome", (message, _options, theme) => {
    const text = new Text(
      typeof message.content === "string" ? message.content : "Welcome",
      0,
      0,
    );
    const box = new Box(1, 1, (token) => theme.bg("customMessageBg", token));

    box.addChild(text);

    return box;
  });
}
