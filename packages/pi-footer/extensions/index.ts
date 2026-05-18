import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import * as path from "node:path";

import { DEFAULT_FOOTER_CONFIG, type FooterConfig } from "./types";
import { formatFooterLine, loadFooterConfig } from "./utils";

type FooterContext = {
  readonly hasUI: boolean;
  readonly cwd: string;
  readonly model?: { readonly id?: string };
  readonly ui: {
    readonly setFooter: (factory: FooterFactory | undefined) => void;
    readonly notify: (
      message: string,
      level: "info" | "warning" | "error",
    ) => void;
  };
};

type FooterFactory = (
  tui: { readonly requestRender: () => void },
  theme: unknown,
  footerData: FooterData,
) => FooterComponent;

type FooterData = {
  readonly getGitBranch: () => string | null;
  readonly onBranchChange: (callback: () => void) => () => void;
};

type FooterComponent = {
  readonly render: (width: number) => string[];
  readonly invalidate: () => void;
  readonly dispose: () => void;
};

type ThinkingLevelEvent = {
  readonly level?: unknown;
};

type ModelSelectEvent = {
  readonly model?: {
    readonly id?: unknown;
  };
};

const NO_MODEL = "no-model";
const NO_BRANCH = "no-branch";
const WORKSPACE_FALLBACK = "workspace";

export default function (pi: ExtensionAPI): void {
  let currentConfig: FooterConfig = DEFAULT_FOOTER_CONFIG;
  let currentThinkingLevel = currentConfig.defaultThinkingLevel;
  let currentModelId = NO_MODEL;
  let invalidateFooterRender: (() => void) | null = null;
  let requestFooterRender: (() => void) | null = null;

  function requestChangedFooterRender(): void {
    invalidateFooterRender?.();
    requestFooterRender?.();
  }

  async function applyFooter(ctx: FooterContext): Promise<void> {
    if (!ctx.hasUI) {
      return;
    }

    currentConfig = await loadFooterConfig();
    currentThinkingLevel ||= currentConfig.defaultThinkingLevel;
    currentModelId = ctx.model?.id ?? NO_MODEL;

    const projectName = path.basename(ctx.cwd) || WORKSPACE_FALLBACK;

    ctx.ui.setFooter((tui, _theme, footerData) => {
      let cachedWidth: number | null = null;
      let cachedBranchName: string | null = null;
      let cachedLines: string[] | null = null;

      const invalidate = () => {
        cachedWidth = null;
        cachedBranchName = null;
        cachedLines = null;
      };

      invalidateFooterRender = invalidate;
      requestFooterRender = () => tui.requestRender();
      const unsubscribeBranchChange = footerData.onBranchChange(() => {
        invalidate();
        tui.requestRender();
      });

      return {
        dispose() {
          unsubscribeBranchChange();
        },
        invalidate,
        render(width: number): string[] {
          const branchName = footerData.getGitBranch() ?? NO_BRANCH;

          if (
            cachedLines &&
            cachedWidth === width &&
            cachedBranchName === branchName
          ) {
            return cachedLines;
          }

          const line = formatFooterLine({
            config: currentConfig,
            modelId: currentModelId,
            thinkingLevel: currentThinkingLevel,
            projectName,
            branchName,
          });

          cachedWidth = width;
          cachedBranchName = branchName;
          cachedLines = [truncateToWidth(line, width), ""];

          return cachedLines;
        },
      };
    });
  }

  pi.on("session_start", async (_event, ctx) => {
    await applyFooter(ctx as FooterContext);
  });

  pi.on("thinking_level_select", (event) => {
    const { level } = event as ThinkingLevelEvent;

    if (typeof level !== "string" || level === currentThinkingLevel) {
      return;
    }

    currentThinkingLevel = level;
    requestChangedFooterRender();
  });

  pi.on("model_select", (event) => {
    const { model } = event as ModelSelectEvent;

    if (typeof model?.id !== "string" || model.id === currentModelId) {
      return;
    }

    currentModelId = model.id;
    requestChangedFooterRender();
  });

  pi.registerCommand("footer-reload", {
    description: "Reload pi-footer config",
    handler: async (_args, ctx) => {
      const footerCtx = ctx as FooterContext;

      await applyFooter(footerCtx);

      if (footerCtx.hasUI) {
        footerCtx.ui.notify("Footer reloaded", "info");
      }
    },
  });
}
