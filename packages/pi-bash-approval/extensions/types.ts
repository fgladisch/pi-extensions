export type BashApprovalConfig = {
  allowed: string[];
  splitChains: boolean;
};

export type BashApprovalSettings = {
  splitChains?: unknown;
};

export type GlobalSettings = {
  bashApproval?: BashApprovalSettings;
};

export type SplitState = {
  current: string;
  parts: string[];
  quote: '"' | "'" | null;
};

export type NotifyLevel = "info" | "error";

export type ApprovalCtx = {
  hasUI: boolean;
  ui: {
    notify: (message: string, level: NotifyLevel) => void;
    select: (
      message: string,
      options: string[],
    ) => Promise<string | null | undefined>;
  };
};

export type PromptOptions = {
  options: string[];
  exactLabel: string;
  prefixLabel: string | null;
  suggested: string | null;
};

export type CommandEvaluation =
  | { allMatch: true }
  | { allMatch: false; failingSegment: string };
