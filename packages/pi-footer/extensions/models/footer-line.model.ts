import type { FooterConfig } from "./footer-config.model";

export type FooterLineInput = {
  readonly config: FooterConfig;
  readonly modelId: string | null;
  readonly thinkingLevel: string | null;
  readonly contextUsagePercent: number | null;
  readonly projectName: string;
  readonly branchName: string | null;
  readonly extensionStatuses: readonly string[];
};
