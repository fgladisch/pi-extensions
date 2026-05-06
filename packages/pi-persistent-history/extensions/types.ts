export type HistoryFile = {
  maxEntries: number;
  entries: string[];
};

export enum InjectionStatus {
  Applied = "applied",
  Unavailable = "unavailable",
  Failed = "failed",
}

export type InjectionResult = {
  status: InjectionStatus;
  message: string;
};

export type RuntimeState = {
  maxEntries: number;
  entries: string[];
  lastInjection: InjectionResult | null;
};
