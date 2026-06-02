export type BashApprovalConfig = {
  allowed: string[];
  splitChains: boolean;
};

export type BashApprovalSettings = {
  readonly splitChains?: unknown;
};

export type GlobalSettings = {
  readonly bashApproval?: BashApprovalSettings;
};

export type SplitState = {
  commandSubstitutionDepth: number;
  backtickDepth: number;
  current: string;
  parts: string[];
  quote: '"' | "'" | null;
};

export type NotifyLevel = "info" | "error";

export type ApprovalCtx = {
  readonly hasUI: boolean;
  readonly ui: {
    readonly notify: (message: string, level: NotifyLevel) => void;
    readonly select: (
      message: string,
      options: string[],
    ) => Promise<string | null | undefined>;
  };
};

export type PromptOptions = {
  readonly options: string[];
  readonly exactLabel: string;
  readonly prefixLabel: string | null;
  readonly suggested: string | null;
};

export type CommandEvaluation =
  | { allMatch: true }
  | { allMatch: false; failingSegment: string };
