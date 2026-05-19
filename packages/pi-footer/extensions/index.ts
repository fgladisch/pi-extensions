import {
  CustomEditor,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import * as path from "node:path";

import { DEFAULT_FOOTER_CONFIG, type FooterConfig } from "./types";
import { formatFooterLine, loadFooterConfig } from "./utils";

type FooterContext = {
  readonly hasUI: boolean;
  readonly cwd: string;
  readonly model?: { readonly id?: string };
  readonly ui: {
    readonly setEditorComponent: (
      factory: PromptInputEditorFactory | undefined,
    ) => void;
    readonly setFooter: (factory: FooterFactory | undefined) => void;
    readonly notify: (
      message: string,
      level: "info" | "warning" | "error",
    ) => void;
    readonly theme: {
      readonly fg: (color: "accent", text: string) => string;
    };
  };
};

type PromptInputEditorFactory = (
  tui: ConstructorParameters<typeof CustomEditor>[0],
  theme: ConstructorParameters<typeof CustomEditor>[1],
  keybindings: ConstructorParameters<typeof CustomEditor>[2],
) => PromptInputEditor;

type FooterFactory = (
  tui: { readonly requestRender: () => void },
  theme: FooterTheme,
  footerData: FooterData,
) => FooterComponent;

type FooterTheme = {
  readonly fg: (color: "text", text: string) => string;
};

type FooterData = {
  readonly getGitBranch: () => string | null;
  readonly getExtensionStatuses: () => ReadonlyMap<string, string>;
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

const ANSI_PATTERN =
  /(?:\u001B\][\s\S]*?(?:\u0007|\u001B\\|\u009C))|[\u001B\u009B][[\]()#;?]*(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]/g;
const NO_MODEL = "no-model";
const NO_BRANCH = "no-branch";
const WORKSPACE_FALLBACK = "workspace";
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
    currentModelId = ctx.model?.id ?? NO_MODEL;
    currentThinkingLevel = pi.getThinkingLevel();

    const projectName = path.basename(ctx.cwd) || WORKSPACE_FALLBACK;

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
      let cachedExtensionStatusesKey: string | null = null;
      let cachedLines: string[] | null = null;

      const invalidate = () => {
        cachedWidth = null;
        cachedBranchName = null;
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
          const branchName = footerData.getGitBranch() ?? NO_BRANCH;
          const extensionStatuses = Array.from(
            footerData.getExtensionStatuses().values(),
          ).map(stripAnsi);
          const extensionStatusesKey = extensionStatuses.join("\0");

          if (
            cachedLines &&
            cachedWidth === width &&
            cachedBranchName === branchName &&
            cachedExtensionStatusesKey === extensionStatusesKey
          ) {
            return cachedLines;
          }

          const line = formatFooterLine({
            config: currentConfig,
            modelId: currentModelId,
            thinkingLevel: currentThinkingLevel,
            projectName,
            branchName,
            extensionStatuses,
          });

          cachedWidth = width;
          cachedBranchName = branchName;
          cachedExtensionStatusesKey = extensionStatusesKey;
          cachedLines = [theme.fg("text", truncateToWidth(line, width))];

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
