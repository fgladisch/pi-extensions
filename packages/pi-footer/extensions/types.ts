export type FooterIconsConfig = {
  readonly model: string;
  readonly project: string;
  readonly branch: string;
};

export type FooterSegmentsConfig = {
  readonly model: boolean;
  readonly project: boolean;
  readonly branch: boolean;
};

export type FooterConfig = {
  readonly icons: FooterIconsConfig;
  readonly separator: string;
  readonly segments: FooterSegmentsConfig;
};

export type FooterLineInput = {
  readonly config: FooterConfig;
  readonly modelId: string;
  readonly thinkingLevel: string | null;
  readonly projectName: string;
  readonly branchName: string;
  readonly extensionStatuses: readonly string[];
};

export const DEFAULT_FOOTER_CONFIG: FooterConfig = {
  icons: {
    model: "",
    project: "",
    branch: "",
  },
  separator: "",
  segments: {
    model: true,
    project: true,
    branch: true,
  },
};
