import type { AgentToolResult } from "@earendil-works/pi-coding-agent";

export type SelectOption = {
  label: string;
  description?: string;
};

export type UserSelectInput = {
  question: string;
  options: SelectOption[];
  allowCustom?: boolean;
};

export type UserSelectDetails = {
  question: string;
  options: string[];
  answer: string | null;
  wasCustom: boolean;
  cancelled: boolean;
};

export type ExecuteResult = AgentToolResult<UserSelectDetails>;
