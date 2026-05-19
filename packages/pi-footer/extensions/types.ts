export type FooterIconsConfig = {
  readonly model: string;
  readonly context: string;
  readonly project: string;
  readonly branch: string;
};

export type FooterSegmentsConfig = {
  readonly model: boolean;
  readonly context: boolean;
  readonly project: boolean;
  readonly branch: boolean;
};

export type PromptInputConfig = {
  readonly prefix: string;
};

export type FooterConfig = {
  readonly icons: FooterIconsConfig;
  readonly promptInput: PromptInputConfig;
  readonly separator: string;
  readonly segments: FooterSegmentsConfig;
};

export type FooterLineInput = {
  readonly config: FooterConfig;
  readonly modelId: string;
  readonly thinkingLevel: string | null;
  readonly contextUsagePercent: number | null;
  readonly projectName: string;
  readonly branchName: string;
  readonly extensionStatuses: readonly string[];
};

export const DEFAULT_FOOTER_CONFIG: FooterConfig = {
  icons: {
    model: "",
    context: "󰊚",
    project: "",
    branch: "",
  },
  promptInput: {
    prefix: "➜",
  },
  separator: "",
  segments: {
    model: true,
    context: true,
    project: true,
    branch: true,
  },
};
