export type FooterIconsConfig = {
  readonly model: string;
  readonly project: string;
  readonly branch: string;
};

export type FooterShowConfig = {
  readonly model: boolean;
  readonly thinking: boolean;
  readonly project: boolean;
  readonly branch: boolean;
};

export type FooterConfig = {
  readonly icons: FooterIconsConfig;
  readonly separator: string;
  readonly thinkingPrefix: string;
  readonly defaultThinkingLevel: string;
  readonly show: FooterShowConfig;
};

export type FooterLineInput = {
  readonly config: FooterConfig;
  readonly modelId: string;
  readonly thinkingLevel: string;
  readonly projectName: string;
  readonly branchName: string;
};

export const DEFAULT_FOOTER_CONFIG: FooterConfig = {
  icons: {
    model: "",
    project: "",
    branch: "",
  },
  separator: "",
  thinkingPrefix: "think:",
  defaultThinkingLevel: "med",
  show: {
    model: true,
    thinking: true,
    project: true,
    branch: true,
  },
};
