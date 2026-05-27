import type { FooterConfig } from "./models";

export const DEFAULT_FOOTER_CONFIG: FooterConfig = {
  icons: {
    model: "",
    context: "󰊚",
    project: "",
    branch: "",
    provider: "",
  },
  promptInput: {
    prefix: "➜",
  },
  separator: "",
  segments: {
    model: true,
    context: true,
    project: true,
    branch: true,
    provider: false,
  },
};
