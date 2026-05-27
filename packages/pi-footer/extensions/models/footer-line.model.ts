import type { Theme } from "@earendil-works/pi-coding-agent";
import type { FooterConfig } from "./footer-config.model";

export type FooterLineInput = {
  readonly config: FooterConfig;
  readonly modelId: string | null;
  readonly providerName: string | null;
  readonly thinkingLevel: string | null;
  readonly contextUsagePercent: number | null;
  readonly projectName: string;
  readonly branchName: string | null;
  readonly extensionStatuses: readonly string[];
  readonly theme: Theme;
};
