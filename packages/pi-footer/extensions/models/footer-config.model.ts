export type FooterIconsConfig = {
  readonly model: string;
  readonly context: string;
  readonly project: string;
  readonly branch: string;
  readonly provider: string;
};

export type FooterSegmentsConfig = {
  readonly model: boolean;
  readonly context: boolean;
  readonly project: boolean;
  readonly branch: boolean;
  readonly provider: boolean;
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
