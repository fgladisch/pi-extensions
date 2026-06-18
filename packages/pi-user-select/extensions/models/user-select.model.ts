import type { AgentToolResult } from "@earendil-works/pi-coding-agent";

export type SelectOption = {
  readonly label: string;
  readonly description?: string;
};

export type UserSelectInput = {
  readonly question: string;
  readonly options: readonly SelectOption[];
  readonly allowCustom?: boolean;
};

export type UserSelectDetails = {
  readonly question: string;
  readonly options: readonly string[];
  readonly answer: string | null;
  readonly wasCustom: boolean;
  readonly cancelled: boolean;
};

export type ExecuteResult = AgentToolResult<UserSelectDetails>;

export type InteractionSource = "local" | "remote" | "system" | "timeout";

export type RespondResult =
  | { readonly accepted: true }
  | {
      readonly accepted: false;
      readonly reason: "already_resolved" | "expired" | "invalid_response";
    };

export type InteractionBase = {
  readonly requestId: string;
  readonly plugin: "pi-user-select";
  readonly kind: "select" | "custom_input";
  readonly toolCallId?: string;
  readonly cwd?: string;
  readonly createdAt: string;
  readonly expiresAt?: string;
};

export type UserSelectResponse =
  | {
      readonly source: "remote";
      readonly kind: "select";
      readonly optionIndex: number;
    }
  | {
      readonly source: "remote";
      readonly kind: "custom";
      readonly value: string;
    }
  | {
      readonly source: "remote";
      readonly kind: "cancel";
    };

export type CustomInputResponse =
  | {
      readonly source: "remote";
      readonly kind: "submit";
      readonly value: string;
    }
  | {
      readonly source: "remote";
      readonly kind: "cancel";
    };

export type UserSelectRequestEvent = InteractionBase & {
  readonly kind: "select";
  readonly question: string;
  readonly options: readonly {
    readonly index: number;
    readonly label: string;
    readonly description?: string;
    readonly displayLabel: string;
  }[];
  readonly allowCustom: boolean;
  readonly respond: (response: UserSelectResponse) => RespondResult;
};

export type CustomInputRequestEvent = InteractionBase & {
  readonly kind: "custom_input";
  readonly question: string;
  readonly respond: (response: CustomInputResponse) => RespondResult;
};

export type UserSelectResolvedEvent = InteractionBase & {
  readonly selectedBy: InteractionSource;
  readonly result:
    | {
        readonly kind: "select";
        readonly optionIndex: number;
        readonly label: string;
      }
    | { readonly kind: "custom"; readonly value: string }
    | { readonly kind: "cancel" };
};

export type UserSelectClosedEvent = InteractionBase & {
  readonly reason: "resolved" | "cancelled" | "error" | "session_shutdown";
};

export type UserSelectErrorEvent = InteractionBase & {
  readonly error: string;
};
