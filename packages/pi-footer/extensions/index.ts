import {
  CustomEditor,
  ExtensionContext,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import * as path from "node:path";

import { DEFAULT_FOOTER_CONFIG } from "./defaults";
import type {
  FooterConfig,
  ModelSelectEvent,
  ThinkingLevelEvent,
} from "./models";
import { formatFooterLine, loadFooterConfig } from "./utils";

const ANSI_PATTERN =
  /(?:\u001B\][\s\S]*?(?:\u0007|\u001B\\|\u009C))|[\u001B\u009B][[\]()#;?]*(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]/g;
const NO_MODEL: string | null = null;
const NO_PROVIDER: string | null = null;
const ROOT_WORKSPACE_FALLBACK = "(root)";
const PROMPT_PREFIX_GAP = " ";

function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

class PromptInputEditor extends CustomEditor {
  constructor(
    tui: ConstructorParameters<typeof CustomEditor>[0],
    theme: ConstructorParameters<typeof CustomEditor>[1],
    keybindings: ConstructorParameters<typeof CustomEditor>[2],
    private readonly styledPromptInputPrefix: string,
  ) {
    super(tui, theme, keybindings);
  }

  override render(width: number): string[] {
    const prefix = this.styledPromptInputPrefix
      ? `${this.styledPromptInputPrefix}${PROMPT_PREFIX_GAP}`
      : "";
    const prefixWidth = visibleWidth(prefix);
    const editorWidth = Math.max(1, width - prefixWidth);
    const indentation = " ".repeat(prefixWidth);

    return super.render(editorWidth).map((line, lineIndex) => {
      const linePrefix = lineIndex === 1 ? prefix : indentation;

      return truncateToWidth(`${linePrefix}${line}`, width);
    });
  }
}

export default function (pi: ExtensionAPI): void {
  let currentConfig: FooterConfig = DEFAULT_FOOTER_CONFIG;
  let currentThinkingLevel: string | null = null;
  let currentModelId = NO_MODEL;
  let currentProviderName = NO_PROVIDER;
  let invalidateFooterRender: (() => void) | null = null;
  let requestFooterRender: (() => void) | null = null;

  function requestChangedFooterRender(): void {
    invalidateFooterRender?.();
    requestFooterRender?.();
  }

  async function applyFooter(ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI) {
      return;
    }

    currentConfig = await loadFooterConfig();
    currentModelId = ctx.model?.id ?? NO_MODEL;
    currentProviderName = ctx.model?.provider ?? NO_PROVIDER;
    currentThinkingLevel = pi.getThinkingLevel();

    const projectName = path.basename(ctx.cwd) || ROOT_WORKSPACE_FALLBACK;

    const styledPromptInputPrefix = currentConfig.promptInput.prefix
      ? ctx.ui.theme.fg("accent", currentConfig.promptInput.prefix)
      : "";

    ctx.ui.setEditorComponent(
      (tui, theme, keybindings) =>
        new PromptInputEditor(tui, theme, keybindings, styledPromptInputPrefix),
    );

    ctx.ui.setFooter((tui, theme, footerData) => {
      let cachedWidth: number | null = null;
      let cachedBranchName: string | null = null;
      let cachedContextUsagePercent: number | null = null;
      let cachedExtensionStatusesKey: string | null = null;
      let cachedLines: string[] | null = null;

      const invalidate = () => {
        cachedWidth = null;
        cachedBranchName = null;
        cachedContextUsagePercent = null;
        cachedExtensionStatusesKey = null;
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
          const branchName = footerData.getGitBranch();
          const contextUsagePercent = ctx.getContextUsage()?.percent ?? null;
          const extensionStatuses = Array.from(
            footerData.getExtensionStatuses().values(),
          ).map(stripAnsi);
          const extensionStatusesKey = extensionStatuses.join("\0");

          if (
            cachedLines &&
            cachedWidth === width &&
            cachedBranchName === branchName &&
            cachedContextUsagePercent === contextUsagePercent &&
            cachedExtensionStatusesKey === extensionStatusesKey
          ) {
            return cachedLines;
          }

          const line = formatFooterLine({
            config: currentConfig,
            modelId: currentModelId,
            providerName: currentProviderName,
            thinkingLevel: currentThinkingLevel,
            contextUsagePercent,
            projectName,
            branchName,
            extensionStatuses,
            theme,
          });

          cachedWidth = width;
          cachedBranchName = branchName;
          cachedContextUsagePercent = contextUsagePercent;
          cachedExtensionStatusesKey = extensionStatusesKey;
          cachedLines = [truncateToWidth(line, width)];

          return cachedLines;
        },
      };
    });
  }

  pi.on("session_start", async (_event, ctx) => {
    await applyFooter(ctx);
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

    if (typeof model?.id !== "string") {
      return;
    }

    const nextProviderName =
      typeof model.provider === "string" ? model.provider : NO_PROVIDER;

    if (
      model.id === currentModelId &&
      nextProviderName === currentProviderName
    ) {
      return;
    }

    currentModelId = model.id;
    currentProviderName = nextProviderName;
    requestChangedFooterRender();
  });

  pi.registerCommand("footer-reload", {
    description: "Reload pi-footer config",
    handler: async (_args, ctx) => {
      const footerCtx = ctx;

      await applyFooter(footerCtx);

      if (footerCtx.hasUI) {
        footerCtx.ui.notify("Footer reloaded", "info");
      }
    },
  });
}
