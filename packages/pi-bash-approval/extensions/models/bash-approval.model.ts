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
  readonly rulesByOption: Record<string, string>;
};

export type CommandEvaluation =
  | { allMatch: true }
  | { allMatch: false; failingSegment: string };

export type PersistRuleResult = {
  readonly rule: string;
  readonly path: string;
  readonly success: boolean;
  readonly error?: string;
};

export type InteractionSource = "local" | "remote" | "system" | "timeout";

export type RespondResult =
  | { readonly accepted: true }
  | {
      readonly accepted: false;
      readonly reason: "already_resolved" | "expired" | "invalid_response";
    };

export type BashApprovalDecision =
  | { readonly action: "allow_once" }
  | { readonly action: "allow_always"; readonly rule: string }
  | { readonly action: "deny"; readonly reason?: string };

export type BashApprovalResponse =
  | { readonly source: "remote"; readonly action: "allow_once" }
  | {
      readonly source: "remote";
      readonly action: "allow_always";
      readonly optionId: string;
      readonly rule: string;
    }
  | {
      readonly source: "remote";
      readonly action: "deny";
      readonly reason?: string;
    };

export type BashApprovalOption =
  | {
      readonly id: "allow_once";
      readonly label: "Allow once";
      readonly action: "allow_once";
    }
  | {
      readonly id: string;
      readonly label: string;
      readonly action: "allow_always";
      readonly rule: string;
    }
  | { readonly id: "deny"; readonly label: "Deny"; readonly action: "deny" };

export type BashApprovalRequestEvent = {
  readonly requestId: string;
  readonly plugin: "pi-bash-approval";
  readonly kind: "bash_approval";
  readonly toolCallId: string;
  readonly cwd: string;
  readonly command: string;
  readonly trimmedCommand: string;
  readonly failingSegment: string;
  readonly options: readonly BashApprovalOption[];
  readonly createdAt: string;
  readonly expiresAt?: string;
  readonly respond: (response: BashApprovalResponse) => RespondResult;
};

export type BashApprovalResolvedEvent = {
  readonly requestId: string;
  readonly plugin: "pi-bash-approval";
  readonly kind: "bash_approval";
  readonly toolCallId: string;
  readonly cwd: string;
  readonly command: string;
  readonly selectedBy: InteractionSource;
  readonly decision: BashApprovalDecision;
  readonly createdAt: string;
};

export type BashApprovalClosedEvent = {
  readonly requestId: string;
  readonly plugin: "pi-bash-approval";
  readonly kind: "bash_approval";
  readonly toolCallId: string;
  readonly cwd: string;
  readonly createdAt: string;
  readonly reason: "resolved" | "cancelled" | "error" | "session_shutdown";
};

export type BashApprovalConfigLoadedEvent = {
  readonly plugin: "pi-bash-approval";
  readonly allowedCount: number;
  readonly splitChains: boolean;
  readonly createdAt: string;
};

export type BashApprovalReloadedEvent = {
  readonly plugin: "pi-bash-approval";
  readonly allowedCount: number;
  readonly splitChains: boolean;
  readonly source: "command" | "startup";
  readonly createdAt: string;
};

export type BashApprovalEvaluatedEvent = {
  readonly plugin: "pi-bash-approval";
  readonly toolCallId: string;
  readonly cwd: string;
  readonly command: string;
  readonly trimmedCommand: string;
  readonly allMatch: boolean;
  readonly failingSegment?: string;
  readonly splitChains: boolean;
  readonly createdAt: string;
};

export type BashApprovalRulePersistedEvent = {
  readonly plugin: "pi-bash-approval";
  readonly requestId: string;
  readonly toolCallId: string;
  readonly rule: string;
  readonly path: string;
  readonly success: boolean;
  readonly error?: string;
  readonly createdAt: string;
};

export type BashApprovalBlockedEvent = {
  readonly plugin: "pi-bash-approval";
  readonly requestId?: string;
  readonly toolCallId: string;
  readonly cwd: string;
  readonly command: string;
  readonly reason: string;
  readonly selectedBy?: InteractionSource;
  readonly createdAt: string;
};

export type BashApprovalAllowedEvent = {
  readonly plugin: "pi-bash-approval";
  readonly requestId?: string;
  readonly toolCallId: string;
  readonly cwd: string;
  readonly command: string;
  readonly mode: "allowlist" | "allow_once" | "allow_always";
  readonly selectedBy?: InteractionSource;
  readonly rule?: string;
  readonly createdAt: string;
};
