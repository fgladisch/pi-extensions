import { getAgentDir } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  DEFAULT_FOOTER_CONFIG,
  type FooterConfig,
  type FooterLineInput,
} from "./types";

const CONFIG_FILENAME = "footer.json";

export function getFooterConfigPath(): string {
  return path.join(getAgentDir(), CONFIG_FILENAME);
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function parseConfig(raw: string): FooterConfig {
  const parsed = JSON.parse(raw) as Partial<FooterConfig>;
  const icons =
    parsed.icons && typeof parsed.icons === "object"
      ? parsed.icons
      : ({} as Partial<FooterConfig["icons"]>);
  const show =
    parsed.show && typeof parsed.show === "object"
      ? parsed.show
      : ({} as Partial<FooterConfig["show"]>);

  return {
    icons: {
      model: readString(icons.model, DEFAULT_FOOTER_CONFIG.icons.model),
      project: readString(icons.project, DEFAULT_FOOTER_CONFIG.icons.project),
      branch: readString(icons.branch, DEFAULT_FOOTER_CONFIG.icons.branch),
    },
    separator: readString(parsed.separator, DEFAULT_FOOTER_CONFIG.separator),
    thinkingPrefix: readString(
      parsed.thinkingPrefix,
      DEFAULT_FOOTER_CONFIG.thinkingPrefix,
    ),
    defaultThinkingLevel: readString(
      parsed.defaultThinkingLevel,
      DEFAULT_FOOTER_CONFIG.defaultThinkingLevel,
    ),
    show: {
      model: readBoolean(show.model, DEFAULT_FOOTER_CONFIG.show.model),
      thinking: readBoolean(show.thinking, DEFAULT_FOOTER_CONFIG.show.thinking),
      project: readBoolean(show.project, DEFAULT_FOOTER_CONFIG.show.project),
      branch: readBoolean(show.branch, DEFAULT_FOOTER_CONFIG.show.branch),
    },
  };
}

export async function loadFooterConfig(): Promise<FooterConfig> {
  try {
    const raw = await fs.readFile(getFooterConfigPath(), "utf8");

    return parseConfig(raw);
  } catch {
    return { ...DEFAULT_FOOTER_CONFIG };
  }
}

export function formatFooterLine(input: FooterLineInput): string {
  const {
    config,
    modelId,
    thinkingLevel,
    projectName,
    branchName,
    extensionStatuses,
  } = input;
  const parts: string[] = [];

  if (config.show.model) {
    parts.push(`${config.icons.model} ${modelId}`);
  }

  if (config.show.thinking) {
    parts.push(`${config.thinkingPrefix}${thinkingLevel}`);
  }

  if (config.show.project) {
    parts.push(`${config.icons.project} ${projectName}`);
  }

  if (config.show.branch) {
    parts.push(`${config.icons.branch} ${branchName}`);
  }

  parts.push(...extensionStatuses);

  return parts.join(` ${config.separator} `);
}
