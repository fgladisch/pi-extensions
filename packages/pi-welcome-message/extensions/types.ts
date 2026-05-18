import type {
  ExtensionAPI,
  PackageSource,
  Theme,
} from "@earendil-works/pi-coding-agent";

export type PackageConfig = {
  readonly name?: string;
  readonly version?: string;
  readonly description?: string;
};

export type CommandDescriptor = {
  readonly name: string;
  readonly source: string;
};

export type CommandResults = {
  readonly code: number;
  readonly stdout: string;
};

export enum WelcomeLogoColor {
  Blue = "blue",
  Orange = "orange",
  Green = "green",
}

export enum WelcomeSection {
  NodePackage = "nodePackage",
  Git = "git",
  PiResources = "piResources",
}

export type EnabledWelcomeSections = {
  readonly nodePackage: boolean;
  readonly git: boolean;
  readonly piResources: boolean;
};

export type WelcomeMessageConfig = {
  readonly sections: EnabledWelcomeSections;
  readonly showLogo: boolean;
  readonly showOnNewSession: boolean;
  readonly logoColor: WelcomeLogoColor;
};

export type WelcomeMessageHeader = {
  readonly modelId: string;
  readonly logoColor: WelcomeLogoColor;
};

export type WelcomeExtensionAPI = Pick<ExtensionAPI, "exec" | "getCommands">;

export type { PackageSource, Theme };
